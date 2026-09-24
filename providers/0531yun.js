// 0531yun cloud (www.0531yun.com) sensor provider.
//
// Every provider returns snapshots in one internal shape, so the collector and storage never see vendor formats:
//   { deviceId, online, ts, recordTimeStr, nodes: [{ nodeId, registerItem: [{ registerId, registerName, value, data, unit,
//     alarmLevel, alarmColor, alarmInfo }] }] }
// `nodes` keeps the node/register grouping the frontend sensor cards render (serverRealtime.dataItems).
const { formatBeijing, parseBeijing } = require('../lib/time');

const REALTIME_BATCH_SIZE = 20;
const HISTORY_LOOKBACK_MS = 36 * 60 * 60 * 1000;

function createProvider({ requestJson, concurrency = 5 }) {
    const tokenCache = new Map();   // key -> { token, expiry }
    const tokenInFlight = new Map(); // key -> Promise<token>

    const baseUrlOf = apiUrl => String(apiUrl || '').replace(/\/+$/, '');
    const accountKey = config => `${config.loginName}@${baseUrlOf(config.apiUrl)}`;

    async function getToken(loginName, password, apiUrl) {
        const key = `${loginName}@${baseUrlOf(apiUrl)}`;
        const cached = tokenCache.get(key);
        if (cached && Date.now() / 1000 < cached.expiry - 60) return cached.token;
        if (tokenInFlight.has(key)) return tokenInFlight.get(key);
        const promise = (async () => {
            const url = `${baseUrlOf(apiUrl)}/api/getToken?loginName=${encodeURIComponent(loginName)}&password=${encodeURIComponent(password)}`;
            const res = await requestJson(url, { method: 'GET' });
            if (res.data?.code !== 1000) throw new Error('0531yun auth failed');
            tokenCache.set(key, { token: res.data.data.token, expiry: res.data.data.expiration });
            return res.data.data.token;
        })().finally(() => tokenInFlight.delete(key));
        tokenInFlight.set(key, promise);
        return promise;
    }

    async function mapLimit(items, limit, fn) {
        const results = new Array(items.length);
        let next = 0;
        const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (next < items.length) {
                const index = next++;
                results[index] = await fn(items[index], index);
            }
        });
        await Promise.all(workers);
        return results;
    }

    function normalizeRegister(item) {
        const numeric = item.value !== undefined ? Number(item.value) : Number(item.data);
        return {
            registerId: item.registerId,
            registerName: String(item.registerName || '').trim(),
            data: item.data !== undefined ? String(item.data) : String(numeric),
            value: numeric,
            alarmLevel: item.alarmLevel || 0,
            alarmColor: item.alarmColor || '',
            alarmInfo: item.alarmInfo || '',
            unit: item.unit || '',
        };
    }

    function hasRegisters(nodes) {
        return Array.isArray(nodes) && nodes.some(node => (node.registerItem || []).length);
    }

    // History boxes grouped by record time -> [{ recordTimeStr, ts, nodes }], newest first.
    async function fetchHistoryBoxes(config, token, nodeIds, start, end, pageSize) {
        const base = baseUrlOf(config.apiUrl);
        const grouped = {};
        const results = await Promise.allSettled(nodeIds.map(async nodeId => {
            const url = `${base}/api/data/historyList?deviceAddr=${encodeURIComponent(config.deviceAddr)}&nodeId=${encodeURIComponent(nodeId)}`
                + `&startTime=${encodeURIComponent(formatBeijing(start))}&endTime=${encodeURIComponent(formatBeijing(end))}&pageSize=${pageSize}`;
            const res = await requestJson(url, { method: 'GET', headers: { authorization: token } });
            return { nodeId, res };
        }));
        results.forEach(result => {
            if (result.status !== 'fulfilled') return;
            const { nodeId, res } = result.value;
            if (res.data?.code !== 1000 || !Array.isArray(res.data.data)) return;
            res.data.data.forEach(box => {
                const time = box.recordTimeStr || box.recordTime || box.time;
                if (!time) return;
                const entry = grouped[time] || (grouped[time] = { recordTimeStr: String(time), nodesById: {} });
                const node = entry.nodesById[nodeId] || (entry.nodesById[nodeId] = { nodeId, registerItem: [] });
                (box.data || []).forEach(item => {
                    if (item.registerName) node.registerItem.push(normalizeRegister(item));
                });
            });
        });
        return Object.values(grouped)
            .map(entry => ({ recordTimeStr: entry.recordTimeStr, ts: parseBeijing(entry.recordTimeStr), nodes: Object.values(entry.nodesById) }))
            .filter(entry => Number.isFinite(entry.ts) && hasRegisters(entry.nodes))
            .sort((a, b) => b.ts - a.ts);
    }

    // devices: [{ id, apiConfig: { loginName, password, apiUrl, deviceAddr } }]
    // Returns Map deviceId -> snapshot | { deviceId, online: false } | { deviceId, error }.
    async function fetchRealtime(devices) {
        const out = new Map();
        const groups = new Map();
        devices.forEach(dev => {
            const key = accountKey(dev.apiConfig);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(dev);
        });

        const withData = [];
        await mapLimit([...groups.values()], concurrency, async group => {
            const config = group[0].apiConfig;
            let token;
            try {
                token = await getToken(config.loginName, config.password, config.apiUrl);
            } catch (error) {
                group.forEach(dev => out.set(dev.id, { deviceId: dev.id, error: error.message }));
                return;
            }
            for (let i = 0; i < group.length; i += REALTIME_BATCH_SIZE) {
                const batch = group.slice(i, i + REALTIME_BATCH_SIZE);
                const addrs = batch.map(dev => dev.apiConfig.deviceAddr).join(',');
                try {
                    const url = `${baseUrlOf(config.apiUrl)}/api/data/getRealTimeDataByDeviceAddr?deviceAddrs=${encodeURIComponent(addrs)}`;
                    const res = await requestJson(url, { method: 'GET', headers: { authorization: token } });
                    if (res.data?.code !== 1000 || !Array.isArray(res.data.data)) throw new Error(res.data?.message || 'realtime request failed');
                    const rowsByAddr = new Map(res.data.data.map(row => [String(row.deviceAddr), row]));
                    batch.forEach(dev => {
                        const row = rowsByAddr.get(String(dev.apiConfig.deviceAddr));
                        const nodes = (row?.dataItem || []).map(node => ({
                            nodeId: node.nodeId,
                            registerItem: (node.registerItem || []).map(normalizeRegister).filter(item => item.registerName),
                        }));
                        if (!row || !hasRegisters(nodes)) {
                            out.set(dev.id, { deviceId: dev.id, online: false });
                            return;
                        }
                        withData.push({ dev, token, row, nodes });
                    });
                } catch (error) {
                    batch.forEach(dev => out.set(dev.id, { deviceId: dev.id, error: error.message }));
                }
            }
        });

        // The realtime endpoint does not reliably carry the record time; the newest history box does.
        await mapLimit(withData, concurrency, async ({ dev, token, row, nodes }) => {
            const end = Date.now();
            let latest = null;
            try {
                const nodeIds = nodes.map(node => node.nodeId);
                [latest] = await fetchHistoryBoxes(dev.apiConfig, token, nodeIds, end - HISTORY_LOOKBACK_MS, end, 10);
            } catch {
                latest = null;
            }
            const realtimeTs = Number(row.timeStamp);
            out.set(dev.id, latest
                ? { deviceId: dev.id, online: true, ts: latest.ts, recordTimeStr: latest.recordTimeStr, nodes: latest.nodes }
                : { deviceId: dev.id, online: true, ts: realtimeTs > 0 ? realtimeTs : Date.now(), recordTimeStr: null, nodes });
        });
        return out;
    }

    // Snapshots between start and end (epoch ms), newest first.
    async function fetchHistory(dev, start, end) {
        const config = dev.apiConfig;
        const token = await getToken(config.loginName, config.password, config.apiUrl);
        const url = `${baseUrlOf(config.apiUrl)}/api/data/getRealTimeDataByDeviceAddr?deviceAddrs=${encodeURIComponent(config.deviceAddr)}`;
        const rt = await requestJson(url, { method: 'GET', headers: { authorization: token } });
        const row = rt.data?.code === 1000 ? rt.data.data?.[0] : null;
        const nodeIds = row?.dataItem?.length ? row.dataItem.map(node => node.nodeId) : [1];
        const boxes = await fetchHistoryBoxes(config, token, nodeIds, start, end, 1000);
        return boxes.map(box => ({ deviceId: dev.id, online: true, ...box }));
    }

    // Devices visible to a 0531yun access code (used when adding devices).
    async function listDevices(accessCode, apiUrl) {
        const token = await getToken(accessCode, accessCode, apiUrl);
        const res = await requestJson(`${baseUrlOf(apiUrl)}/api/device/getDeviceList`, { method: 'GET', headers: { authorization: token } });
        if (res.data?.code !== 1000 || !Array.isArray(res.data.data)) throw new Error(res.data?.message || 'Failed to fetch cloud devices');
        return res.data.data;
    }

    return { id: '0531yun', fetchRealtime, fetchHistory, listDevices };
}

module.exports = { createProvider };
