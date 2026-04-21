const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'server-data');
const STATE_FILE = path.join(DATA_DIR, 'app-state.json');
const PHOTO_RECORDS_FILE = path.join(DATA_DIR, 'photo-records.json');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
const DEFAULT_TARGET_BASE = 'http://www.0531yun.com';
const DEFAULT_TENANT_ID = 'tenant_default';
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123456';
const TOKEN_TTL_SECONDS = 8 * 60 * 60;
const MAX_SENSOR_READINGS = 100000;
const MAX_RAW_PAYLOADS = 10000;
const CLOUD_POLL_INTERVAL_MS = Number(process.env.CLOUD_POLL_INTERVAL_MS || 5 * 60 * 1000);
const WRITE_DEBOUNCE_MS = 1000;

let cachedState = null;
let writeTimeout = null;
let isDirty = false;
let isShuttingDown = false;
let isSyncInProgress = false;
let signatureSet = new Set();

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PHOTOS_DIR, { recursive: true });
if (!fs.existsSync(PHOTO_RECORDS_FILE)) writePhotoRecords(readPhotoRecords());

function emptyState() {
    return {
        schemaVersion: 2,
        tenants: [],
        users: [],
        cloudAccounts: [],
        externalBindings: [],
        channels: [],
        sensorReadings: [],
        rawIngestPayloads: [],
        realtimeState: {},
        actuators: [],
        controlCommands: [],
        alertEvents: [],
        analysisJobs: [],
        recommendations: [],
        locations: [],
        devices: [],
        automations: [],
        autoLog: [],
        history: {},
        serverRealtime: {},
        collector: {},
    };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
    return `pbkdf2$${salt}$${hash}`;
}

function verifyPassword(password, encoded) {
    if (!encoded || !encoded.startsWith('pbkdf2$')) return false;
    const [, salt, expected] = encoded.split('$');
    const actual = hashPassword(password, salt).split('$')[2];
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function safeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeState(raw = {}) {
    const state = { ...emptyState(), ...raw };
    let changed = false;

    if (state.schemaVersion !== 2) {
        state.schemaVersion = 2;
        changed = true;
    }

    if (!state.authSecret) {
        state.authSecret = crypto.randomBytes(32).toString('hex');
        changed = true;
    }

    if (!Array.isArray(state.tenants)) {
        state.tenants = [];
        changed = true;
    }
    if (!state.tenants.some(item => item.id === DEFAULT_TENANT_ID)) {
        state.tenants.unshift({
            id: DEFAULT_TENANT_ID,
            name: 'Default Farm',
            status: 'active',
            createdAt: new Date().toISOString(),
        });
        changed = true;
    }

    if (!Array.isArray(state.users)) {
        state.users = [];
        changed = true;
    }
    if (!state.users.some(item => item.account === 'admin')) {
        state.users.unshift({
            id: 'user_admin',
            tenantId: DEFAULT_TENANT_ID,
            account: 'admin',
            name: 'Platform Admin',
            role: 'platform_admin',
            status: 'active',
            passwordHash: hashPassword(DEFAULT_ADMIN_PASSWORD),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        changed = true;
    }

    [
        'cloudAccounts',
        'externalBindings',
        'channels',
        'sensorReadings',
        'rawIngestPayloads',
        'actuators',
        'controlCommands',
        'alertEvents',
        'analysisJobs',
        'recommendations',
        'locations',
        'devices',
        'automations',
        'autoLog'
    ].forEach(key => {
        if (!Array.isArray(state[key])) {
            state[key] = [];
            changed = true;
        }
    });
    ['history', 'serverRealtime', 'realtimeState', 'collector'].forEach(key => {
        if (!state[key] || typeof state[key] !== 'object' || Array.isArray(state[key])) {
            state[key] = {};
            changed = true;
        }
    });

    state.locations = state.locations.map(item => {
        if (item.tenantId && item.isDemo !== undefined) return item;
        changed = true;
        return {
            tenantId: item.tenantId || DEFAULT_TENANT_ID,
            isDemo: Boolean(item.isDemo || item.metadata?.demo),
            ...item,
        };
    });

    state.devices = state.devices.map(item => {
        if (item.tenantId && item.isDemo !== undefined) return item;
        changed = true;
        return {
            tenantId: item.tenantId || DEFAULT_TENANT_ID,
            isDemo: Boolean(item.isDemo || item.metadata?.demo),
            ...item,
        };
    });

    return { state, changed };
}

function readState() {
    if (cachedState) return cachedState;
    try {
        const raw = fs.existsSync(STATE_FILE)
            ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
            : emptyState();
        const { state, changed } = normalizeState(raw);
        cachedState = state;
        signatureSet = new Set((cachedState.sensorReadings || []).map(item => item.signature).filter(Boolean));
        if (changed) writeState(state);
        return cachedState;
    } catch (error) {
        console.error('[State] read failed:', error.message);
        const { state } = normalizeState(emptyState());
        cachedState = state;
        signatureSet = new Set((cachedState.sensorReadings || []).map(item => item.signature).filter(Boolean));
        return cachedState;
    }
}

async function flushToDisk() {
    writeTimeout = null;
    if (!isDirty || !cachedState) return;
    isDirty = false;
    try {
        await fs.promises.writeFile(STATE_FILE, JSON.stringify(cachedState), 'utf8');
        console.log('[Storage] State flushed to disk.');
    } catch (error) {
        console.error('[Storage] flush failed:', error.message);
        isDirty = true;
    } finally {
        if (isDirty && !writeTimeout && !isShuttingDown) {
            writeTimeout = setTimeout(() => {
                void flushToDisk();
            }, WRITE_DEBOUNCE_MS);
        }
    }
}

function writeState(data) {
    cachedState = data;
    isDirty = true;
    if (writeTimeout) return;
    writeTimeout = setTimeout(() => {
        void flushToDisk();
    }, WRITE_DEBOUNCE_MS);
}

function readPhotoRecords() {
    // Return the initial photo records structure when the file does not exist.
    if (!fs.existsSync(PHOTO_RECORDS_FILE)) {
        return { crops: [], records: [], config: {
            qweatherKey: 'f5832afbc18d40069dfe1e07da03663a',
            visionApiKey: '', visionModel: 'qwen-vl-plus' }};
    }
    return JSON.parse(fs.readFileSync(PHOTO_RECORDS_FILE, 'utf8'));
}

function writePhotoRecords(data) {
    fs.writeFileSync(PHOTO_RECORDS_FILE, JSON.stringify(data));
}

function deletePhotoRecordFile(record) {
    if (!record?.imagePath) return;
    try {
        const imgPath = path.join(__dirname, record.imagePath);
        if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    } catch (error) {
        console.warn('[Photos] image delete failed:', error.message);
    }
}

function flushSyncBeforeExit(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    if (writeTimeout) {
        clearTimeout(writeTimeout);
        writeTimeout = null;
    }
    if (!isDirty || !cachedState) return;
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(cachedState), 'utf8');
        isDirty = false;
        console.log(`[Storage] Final synchronous flush before ${signal}.`);
    } catch (error) {
        console.error('[Storage] final flush failed:', error.message);
    }
}

process.on('SIGINT', () => {
    flushSyncBeforeExit('SIGINT');
    process.exit(0);
});

process.on('SIGTERM', () => {
    flushSyncBeforeExit('SIGTERM');
    process.exit(0);
});

function publicUser(user) {
    if (!user) return null;
    const { passwordHash, ...safe } = user;
    return safe;
}

function operationalSnapshot(state, user) {
    const tenantId = user.role === 'platform_admin' ? null : user.tenantId;
    const scoped = rows => tenantId ? rows.filter(item => !item.tenantId || item.tenantId === tenantId) : rows;
    return {
        locations: scoped(state.locations),
        devices: scoped(state.devices),
        automations: scoped(state.automations),
        autoLog: scoped(state.autoLog),
        history: state.history || {},
        serverRealtime: state.serverRealtime || {},
        realtimeState: state.realtimeState || {},
        channels: scoped(state.channels || []),
        sensorReadings: tenantId
            ? (state.sensorReadings || []).filter(item => item.tenantId === tenantId).slice(-1000)
            : (state.sensorReadings || []).slice(-1000),
    };
}

function mergeOperationalState(current, incoming, user) {
    const next = { ...current };
    const tenantId = user.tenantId || DEFAULT_TENANT_ID;
    const own = item => user.role === 'platform_admin' || !item.tenantId || item.tenantId === tenantId;

    ['locations', 'automations', 'autoLog', 'channels'].forEach(key => {
        if (!Array.isArray(incoming[key])) return;
        if (user.role === 'platform_admin') {
            next[key] = incoming[key].map(item => ({ ...item, tenantId: item.tenantId || tenantId }));
            return;
        }
        const foreign = (next[key] || []).filter(item => !own(item));
        const scoped = incoming[key].map(item => ({ ...item, tenantId }));
        next[key] = [...foreign, ...scoped];
    });

    if (Array.isArray(incoming.devices)) {
        const previousDevices = next.devices || [];
        const incomingDevices = incoming.devices.map(item => ({ ...item, tenantId: item.tenantId || tenantId }));
        const incomingIds = new Set(incomingDevices.map(item => item.id).filter(Boolean));
        const removedIds = previousDevices
            .filter(item => own(item) && item.id && !incomingIds.has(item.id))
            .map(item => item.id);

        if (user.role === 'platform_admin') {
            next.devices = incomingDevices;
        } else {
            const foreign = previousDevices.filter(item => !own(item));
            next.devices = [...foreign, ...incomingDevices.map(item => ({ ...item, tenantId }))];
        }

        if (removedIds.length) {
            const removed = new Set(removedIds);
            next.channels = (next.channels || []).filter(item => !removed.has(item.deviceId));
            next.sensorReadings = (next.sensorReadings || []).filter(item => !removed.has(item.deviceId));
            next.rawIngestPayloads = (next.rawIngestPayloads || []).filter(item => !removed.has(item.deviceId));
            ['history', 'serverRealtime', 'realtimeState'].forEach(key => {
                const bucket = next[key] || {};
                removedIds.forEach(id => delete bucket[id]);
                next[key] = bucket;
            });
        }
    }

    return next;
}

function signToken(payload, secret) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
    return `${encoded}.${sig}`;
}

function verifyToken(token, secret) {
    if (!token || !token.includes('.')) return null;
    const [encoded, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
}

function getAuthUser(req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const state = readState();
    const payload = verifyToken(token, state.authSecret);
    if (!payload) return { state, user: null };
    const user = (state.users || []).find(item => item.id === payload.sub && item.status !== 'disabled');
    return { state, user };
}

function readBody(req, limit = 1024 * 1024) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > limit) {
                reject(new Error('Body too large'));
                req.destroy();
            }
        });
        req.on('end', () => {
            if (!body) return resolve({});
            try { resolve(JSON.parse(body)); }
            catch { reject(new Error('Invalid JSON body')); }
        });
        req.on('error', reject);
    });
}

function requestJson(targetUrl, options, bodyStr = null) {
    return new Promise((resolve, reject) => {
        const client = targetUrl.startsWith('https') ? https : http;
        const req = client.request(targetUrl, { ...options, timeout: 15000 }, (res) => {
            res.setEncoding('utf8');
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const cleaned = data.trim().replace(/^\uFEFF/, '').replace(/^[^{[]+/, '').replace(/[^}\]]+$/, '');
                    if (!cleaned) throw new Error('Empty');
                    resolve({ status: res.statusCode, data: JSON.parse(cleaned) });
                } catch (e) { reject(new Error('Invalid JSON')); }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

async function getCloudToken(loginName, password, apiUrl) {
    const baseUrl = apiUrl.replace(/\/+$/, '');
    const key = `${loginName}@${baseUrl}`;
    if (tokenCache[key] && (Date.now() / 1000) < tokenCache[key].expiry - 60) return tokenCache[key].token;
    const authUrl = `${baseUrl}/api/getToken?loginName=${encodeURIComponent(loginName)}&password=${encodeURIComponent(password)}`;
    const res = await requestJson(authUrl, { method: 'GET' });
    if (res.data?.code === 1000) {
        tokenCache[key] = { token: res.data.data.token, expiry: res.data.data.expiration };
        return res.data.data.token;
    }
    throw new Error('Auth fail');
}
const tokenCache = {};

function formatCloudTime(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function parseCloudRecordTime(value) {
    if (!value) return Date.now();
    if (typeof value === 'number') return value;
    const parsed = new Date(String(value).trim().replace(' ', 'T')).getTime();
    return Number.isFinite(parsed) ? parsed : Date.now();
}

function parseQueryTime(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    const text = String(value).trim();
    if (!text) return fallback;
    const asNumber = Number(text);
    if (Number.isFinite(asNumber)) return asNumber;
    const parsed = new Date(text.replace(' ', 'T')).getTime();
    return Number.isFinite(parsed) ? parsed : fallback;
}

async function fetchCloudRealtime(dev, token) {
    const c = dev.apiConfig;
    const url = `${c.apiUrl.replace(/\/+$/, '')}/api/data/getRealTimeDataByDeviceAddr?deviceAddrs=${encodeURIComponent(c.deviceAddr)}`;
    const rt = await requestJson(url, { method: 'GET', headers: { 'authorization': token } });
    return rt.data?.code === 1000 && rt.data.data?.[0] ? rt.data.data[0] : null;
}

async function fetchLatestCloudHistoryRecord(dev, token, realtimeRow = null) {
    const c = dev.apiConfig;
    const baseUrl = c.apiUrl.replace(/\/+$/, '');
    const row = realtimeRow || await fetchCloudRealtime(dev, token);
    const nodeIds = row?.dataItem?.length ? row.dataItem.map(item => item.nodeId) : [1];
    const end = new Date();
    const start = new Date(end.getTime() - 36 * 60 * 60 * 1000);
    const grouped = {};

    const historyResults = await Promise.allSettled(nodeIds.map(async nodeId => {
        const url = `${baseUrl}/api/data/historyList?deviceAddr=${encodeURIComponent(c.deviceAddr)}&nodeId=${encodeURIComponent(nodeId)}&startTime=${encodeURIComponent(formatCloudTime(start))}&endTime=${encodeURIComponent(formatCloudTime(end))}&pageSize=10`;
        const res = await requestJson(url, { method: 'GET', headers: { 'authorization': token } });
        return { nodeId, res };
    }));

    historyResults.forEach(result => {
        if (result.status !== 'fulfilled') return;
        const { nodeId, res } = result.value;
        if (res.data?.code !== 1000 || !Array.isArray(res.data.data)) return;
        res.data.data.forEach(box => {
            const time = box.recordTimeStr || box.recordTime || box.time;
            if (!time) return;
            if (!grouped[time]) grouped[time] = { recordTimeStr: time, dataItemsByNode: {} };
            grouped[time].dataItemsByNode[nodeId] = grouped[time].dataItemsByNode[nodeId] || { nodeId, registerItem: [] };
            (box.data || []).forEach(item => {
                if (!item.registerName) return;
                const numeric = item.value !== undefined ? Number(item.value) : Number(item.data);
                grouped[time].dataItemsByNode[nodeId].registerItem.push({
                    registerId: item.registerId,
                    registerName: item.registerName,
                    data: item.data !== undefined ? String(item.data) : String(numeric),
                    value: numeric,
                    alarmLevel: item.alarmLevel || 0,
                    alarmColor: item.alarmColor || '',
                    alarmInfo: item.alarmInfo || '',
                    unit: item.unit || '',
                });
            });
        });
    });

    const latest = Object.values(grouped).sort((a, b) => parseCloudRecordTime(b.recordTimeStr) - parseCloudRecordTime(a.recordTimeStr))[0];
    if (!latest) return row;
    return {
        systemCode: row?.systemCode,
        deviceAddr: row?.deviceAddr || Number(c.deviceAddr),
        deviceName: row?.deviceName || dev.name,
        lat: row?.lat || dev.lat,
        lng: row?.lng || dev.lng,
        deviceStatus: row?.deviceStatus,
        dataItem: Object.values(latest.dataItemsByNode),
        timeStamp: parseCloudRecordTime(latest.recordTimeStr),
        recordTimeStr: latest.recordTimeStr,
    };
}

function channelKey(name = '', unit = '') {
    const text = `${name}_${unit}`.trim();
    return 'ch_' + crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
}

function inferChannelCategory(name = '') {
    if (/PH|\u7535\u5bfc|EC|\u542b\u6c34|\u571f\u58e4|\u6e7f\u5ea6|\u6e29\u5ea6/.test(name)) return 'soil';
    if (/\u5149|\u7167/.test(name)) return 'light';
    if (/\u6c2e|\u78f7|\u94be|\u517b\u5206/.test(name)) return 'nutrient';
    if (/\u7535\u91cf|\u4fe1\u53f7|\u72b6\u6001/.test(name)) return 'status';
    return 'other';
}

function ensureChannels(state, dev, dataItems = []) {
    const channels = Array.isArray(state.channels) ? state.channels : [];
    dataItems.forEach(node => {
        (node.registerItem || []).forEach(reg => {
            const externalName = String(reg.registerName || '').trim();
            if (!externalName) return;
            const existing = channels.find(item => item.deviceId === dev.id && item.externalName === externalName);
            if (existing) return;
            channels.push({
                id: safeId('channel'),
                tenantId: dev.tenantId || DEFAULT_TENANT_ID,
                deviceId: dev.id,
                key: channelKey(externalName, reg.unit || ''),
                externalName,
                displayName: externalName,
                category: inferChannelCategory(externalName),
                unit: reg.unit || '',
                valueType: 'number',
                precision: Number.isInteger(reg.digits) ? reg.digits : 1,
                enabled: true,
                createdAt: new Date().toISOString(),
            });
        });
    });
    state.channels = channels;
}

function normalizeCloudRow(dev, row) {
    const values = {};
    (row.dataItem || []).forEach(node => {
        (node.registerItem || []).forEach(item => {
            if (item.registerName) values[item.registerName] = item.value;
        });
    });
    const deviceTimestamp = Number(row.timeStamp) || Date.now();
    return {
        ts: deviceTimestamp,
        deviceTimestamp,
        receivedAt: Date.now(),
        values,
        source: 'cloud-server',
    };
}

function inferPlatformChannelCategory(name = '') {
    if (/PH|ph|EC|\u7535\u5bfc|\u542b\u6c34|\u571f\u58e4|\u6e7f\u5ea6|\u6e29\u5ea6|temperature|moisture|humidity/i.test(name)) return 'soil';
    if (/\u5149|\u7167|light|lux/i.test(name)) return 'light';
    if (/\u6c2e|\u78f7|\u94be|\u517b\u5206|N|P|K/i.test(name)) return 'nutrient';
    if (/\u7535\u91cf|\u4fe1\u53f7|\u72b6\u6001|battery|signal|status/i.test(name)) return 'status';
    return 'other';
}

function ensurePlatformChannels(state, dev, dataItems = []) {
    const channels = Array.isArray(state.channels) ? state.channels : [];
    const channelMap = {};
    dataItems.forEach(node => {
        (node.registerItem || []).forEach(reg => {
            const externalName = String(reg.registerName || '').trim();
            if (!externalName) return;
            const existing = channels.find(item => item.deviceId === dev.id && item.externalName === externalName);
            if (existing) {
                channelMap[externalName] = existing;
                return;
            }
            const channel = {
                id: safeId('channel'),
                tenantId: dev.tenantId || DEFAULT_TENANT_ID,
                deviceId: dev.id,
                key: channelKey(externalName, reg.unit || ''),
                externalName,
                displayName: externalName,
                category: inferPlatformChannelCategory(externalName),
                unit: reg.unit || '',
                valueType: 'number',
                precision: Number.isInteger(reg.digits) ? reg.digits : 1,
                enabled: true,
                createdAt: new Date().toISOString(),
            };
            channels.push(channel);
            channelMap[externalName] = channel;
        });
    });
    state.channels = channels;
    return channelMap;
}

function createRawPayload(state, dev, provider, payload) {
    const raw = {
        id: safeId('raw'),
        tenantId: dev.tenantId || DEFAULT_TENANT_ID,
        provider,
        externalDeviceId: String(dev.apiConfig?.deviceAddr || dev.externalId || dev.address || dev.id),
        deviceId: dev.id,
        receivedAt: Date.now(),
        payload,
    };
    state.rawIngestPayloads.push(raw);
    if (state.rawIngestPayloads.length > MAX_RAW_PAYLOADS) {
        state.rawIngestPayloads = state.rawIngestPayloads.slice(-MAX_RAW_PAYLOADS);
    }
    return raw;
}

function normalizePlatformCloudRow(state, dev, row, source = 'cloud-poll') {
    const channelMap = ensurePlatformChannels(state, dev, row.dataItem || []);
    const values = {};
    const externalValues = {};
    (row.dataItem || []).forEach(node => {
        (node.registerItem || []).forEach(item => {
            const externalName = String(item.registerName || '').trim();
            if (!externalName) return;
            externalValues[externalName] = roundReadingValue(item.value);
            const channel = channelMap[externalName] || state.channels.find(ch => ch.deviceId === dev.id && ch.externalName === externalName);
            if (channel) values[channel.key] = roundReadingValue(item.value);
        });
    });
    const deviceTimestamp = Number(row.timeStamp) || Date.now();
    const rawPayload = createRawPayload(state, dev, '0531yun', row);
    return {
        id: safeId('reading'),
        tenantId: dev.tenantId || DEFAULT_TENANT_ID,
        deviceId: dev.id,
        externalDeviceId: String(dev.apiConfig?.deviceAddr || dev.externalId || dev.address || dev.id),
        provider: '0531yun',
        source,
        ts: deviceTimestamp,
        deviceTimestamp,
        recordTimeStr: row.recordTimeStr ? String(row.recordTimeStr) : null,
        receivedAt: Date.now(),
        values,
        externalValues,
        rawPayloadId: rawPayload.id,
    };
}

function roundReadingValue(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return value;
    return Number(value.toFixed(1));
}

function extractExternalValues(row) {
    const values = {};
    (row.dataItem || []).forEach(node => {
        (node.registerItem || []).forEach(item => {
            const externalName = String(item.registerName || '').trim();
            if (externalName) values[externalName] = roundReadingValue(item.value);
        });
    });
    return values;
}

function cloudRowChanged(state, dev, row) {
    const deviceTimestamp = Number(row.timeStamp) || Date.now();
    const latest = state.realtimeState?.[dev.id];
    if (!latest) return true;
    // Cloud history API can lag behind realtime API, so skip records strictly older than
    // what we already have, otherwise a lagging history poll downgrades serverRealtime.
    if (deviceTimestamp < latest.deviceTimestamp) return false;
    if (deviceTimestamp !== latest.deviceTimestamp) return true;
    const nextValues = extractExternalValues(row);
    return JSON.stringify(latest.externalValues || {}) !== JSON.stringify(nextValues);
}

function readingSignature(record) {
    const body = JSON.stringify(record.values || {});
    return crypto.createHash('sha1').update(`${record.deviceId}|${record.deviceTimestamp}|${body}`).digest('hex');
}

function appendPlatformReading(state, record) {
    const signature = readingSignature(record);
    if (signatureSet.has(signature)) return false;
    state.sensorReadings.push({ ...record, signature });
    signatureSet.add(signature);
    if (state.sensorReadings.length > MAX_SENSOR_READINGS) {
        state.sensorReadings = state.sensorReadings.slice(-MAX_SENSOR_READINGS);
        signatureSet = new Set((state.sensorReadings || []).map(item => item.signature).filter(Boolean));
    }
    if (!state.history[record.deviceId]) state.history[record.deviceId] = [];
    state.history[record.deviceId].push({
        ts: record.deviceTimestamp,
        deviceTimestamp: record.deviceTimestamp,
        recordTimeStr: record.recordTimeStr || null,
        receivedAt: record.receivedAt,
        values: record.externalValues,
        channelValues: record.values,
        readingId: record.id,
        source: record.source,
    });
    if (state.history[record.deviceId].length > 2880) {
        state.history[record.deviceId] = state.history[record.deviceId].slice(-2880);
    }
    return true;
}

function updatePlatformRealtime(state, dev, record, dataItems = []) {
    state.realtimeState[dev.id] = {
        ok: true,
        tenantId: record.tenantId,
        deviceId: dev.id,
        externalDeviceId: record.externalDeviceId,
        provider: record.provider,
        deviceTimestamp: record.deviceTimestamp,
        receivedAt: record.receivedAt,
        values: record.values,
        externalValues: record.externalValues,
        source: record.source,
        readingId: record.id,
    };
    state.serverRealtime[dev.id] = {
        ok: true,
        timestamp: record.deviceTimestamp,
        deviceTimestamp: record.deviceTimestamp,
        receivedAt: record.receivedAt,
        values: record.externalValues,
        channelValues: record.values,
        dataItems,
    };
}

async function runCollector() {
    while (true) {
        try {
            const state = readState();
            const cloudDevices = (state.devices || []).filter(d => d.type === 'sensor_soil_api' && d.apiConfig);
            for (const dev of cloudDevices) {
                try {
                    const c = dev.apiConfig;
                    const token = await getCloudToken(c.loginName, c.password, c.apiUrl);
                    const realtimeRow = await fetchCloudRealtime(dev, token);
                    if (!realtimeRow) continue;
                    const row = await fetchLatestCloudHistoryRecord(dev, token, realtimeRow);
                    if (!row) continue;
                    const current = readState();
                    if (!cloudRowChanged(current, dev, row)) continue;
                    const record = normalizePlatformCloudRow(current, dev, row, 'cloud-poll');
                    const saved = appendPlatformReading(current, record);
                    if (saved) {
                        console.log(`[Collector] Record saved for ${dev.name} (${new Date(record.deviceTimestamp).toISOString()})`);
                    }
                    updatePlatformRealtime(current, dev, record, row.dataItem || []);
                    const dIdx = current.devices.findIndex(x => x.id === dev.id);
                    if (dIdx >= 0) current.devices[dIdx].online = true;
                    writeState(current);
                } catch (e) {
                    console.warn('[Collector Device]', dev.id, e.message);
                }
            }
        } catch (e) {
            console.warn('[Collector]', e.message);
        }
        await new Promise(r => setTimeout(r, CLOUD_POLL_INTERVAL_MS));
    }
}

readState();
runCollector();

const server = http.createServer(async (req, res) => {
    const myUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = myUrl.pathname.replace(/\/$/, '');
    const query = Object.fromEntries(myUrl.searchParams);

    const sendJson = (status, obj) => {
        res.writeHead(status, {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'authorization, content-type, x-target-base',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        });
        res.end(JSON.stringify(obj));
    };

    const requireAuth = () => {
        const auth = getAuthUser(req);
        if (!auth.user) {
            sendJson(401, { ok: false, msg: 'Unauthorized' });
            return null;
        }
        return auth;
    };

    const requireAdmin = () => {
        const auth = requireAuth();
        if (!auth) return null;
        if (auth.user.role !== 'platform_admin') {
            sendJson(403, { ok: false, msg: 'Admin only' });
            return null;
        }
        return auth;
    };

    console.log(`[Request] ${req.method} ${pathname}`);

    if (req.method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'authorization, content-type, x-target-base',
        });
        return res.end();
    }

    try {
        if (pathname === '/api/v1/health') return sendJson(200, { ok: true });

        if (pathname === '/api/v1/auth/login' && req.method === 'POST') {
            const body = await readBody(req);
            const state = readState();
            const account = String(body.account || '').trim();
            const user = state.users.find(item => item.account === account && item.status !== 'disabled');
            if (!user || !verifyPassword(String(body.password || ''), user.passwordHash)) {
                return sendJson(401, { ok: false, msg: 'Invalid account or password' });
            }
            user.lastLoginAt = new Date().toISOString();
            writeState(state);
            const token = signToken({
                sub: user.id,
                exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
            }, state.authSecret);
            return sendJson(200, { ok: true, accessToken: token, user: publicUser(user) });
        }

        if (pathname === '/api/v1/auth/me') {
            const auth = requireAuth();
            if (!auth) return;
            return sendJson(200, { ok: true, user: publicUser(auth.user) });
        }

        if (pathname === '/api/v1/users') {
            const auth = requireAdmin();
            if (!auth) return;
            if (req.method === 'GET') {
                return sendJson(200, { ok: true, users: auth.state.users.map(publicUser) });
            }
            if (req.method === 'POST') {
                const body = await readBody(req);
                const account = String(body.account || '').trim();
                const password = String(body.password || '');
                if (!account || !password) return sendJson(400, { ok: false, msg: 'Account and password are required' });
                if (auth.state.users.some(item => item.account === account)) return sendJson(409, { ok: false, msg: 'Account already exists' });
                const now = new Date().toISOString();
                const user = {
                    id: safeId('user'),
                    tenantId: body.tenantId || DEFAULT_TENANT_ID,
                    account,
                    name: String(body.name || account).trim(),
                    role: body.role === 'platform_admin' ? 'platform_admin' : 'tenant_admin',
                    status: body.status === 'disabled' ? 'disabled' : 'active',
                    passwordHash: hashPassword(password),
                    createdAt: now,
                    updatedAt: now,
                };
                auth.state.users.push(user);
                writeState(auth.state);
                return sendJson(201, { ok: true, user: publicUser(user) });
            }
        }

        if (pathname.startsWith('/api/v1/users/')) {
            const auth = requireAdmin();
            if (!auth) return;
            const userId = decodeURIComponent(pathname.split('/').pop());
            const user = auth.state.users.find(item => item.id === userId);
            if (!user) return sendJson(404, { ok: false, msg: 'User not found' });

            if (req.method === 'PUT') {
                const body = await readBody(req);
                user.name = String(body.name || user.name || user.account).trim();
                user.role = body.role === 'platform_admin' ? 'platform_admin' : 'tenant_admin';
                user.status = body.status === 'disabled' ? 'disabled' : 'active';
                user.tenantId = body.tenantId || user.tenantId || DEFAULT_TENANT_ID;
                if (body.password) user.passwordHash = hashPassword(String(body.password));
                user.updatedAt = new Date().toISOString();
                writeState(auth.state);
                return sendJson(200, { ok: true, user: publicUser(user) });
            }

            if (req.method === 'DELETE') {
                if (user.id === auth.user.id) return sendJson(400, { ok: false, msg: 'Cannot delete current user' });
                const admins = auth.state.users.filter(item => item.role === 'platform_admin' && item.status !== 'disabled');
                if (user.role === 'platform_admin' && admins.length <= 1) return sendJson(400, { ok: false, msg: 'Cannot delete last admin' });
                auth.state.users = auth.state.users.filter(item => item.id !== user.id);
                writeState(auth.state);
                return sendJson(200, { ok: true });
            }
        }

        if (pathname === '/api/v1/app-state') {
            const auth = requireAuth();
            if (!auth) return;
            if (req.method === 'PUT') {
                const body = await readBody(req, 10 * 1024 * 1024);
                const next = mergeOperationalState(auth.state, body, auth.user);
                writeState(next);
                return sendJson(200, { ok: true });
            }
            return sendJson(200, operationalSnapshot(auth.state, auth.user));
        }

        if (pathname === '/api/v1/cloud-devices') {
            const auth = requireAuth();
            if (!auth) return;
            const accessCode = String(query.accessCode || '').trim();
            const apiUrl = String(query.apiUrl || DEFAULT_TARGET_BASE).trim() || DEFAULT_TARGET_BASE;
            if (!accessCode) return sendJson(400, { ok: false, msg: 'accessCode is required' });
            try {
                const token = await getCloudToken(accessCode, accessCode, apiUrl);
                const listUrl = `${apiUrl.replace(/\/+$/, '')}/api/device/getDeviceList`;
                const response = await requestJson(listUrl, {
                    method: 'GET',
                    headers: { authorization: token },
                });
                if (response.data?.code !== 1000 || !Array.isArray(response.data.data)) {
                    return sendJson(502, { ok: false, msg: response.data?.message || 'Failed to fetch cloud devices' });
                }
                const devices = response.data.data.map(item => ({
                    ...item,
                    apiConfig: {
                        deviceAddr: String(item.deviceAddr || ''),
                        loginName: accessCode,
                        password: accessCode,
                        apiUrl,
                        factors: item.factors || [],
                    },
                }));
                return sendJson(200, { ok: true, devices });
            } catch (error) {
                return sendJson(502, { ok: false, msg: error.message || 'Cloud request failed' });
            }
        }

        if (pathname === '/api/v1/device-realtime') {
            const auth = requireAuth();
            if (!auth) return;
            const deviceId = String(query.deviceId || '').trim();
            if (!deviceId) return sendJson(400, { ok: false, msg: 'deviceId is required' });

            const scopedDevices = auth.user.role === 'platform_admin'
                ? (auth.state.devices || [])
                : (auth.state.devices || []).filter(item => !item.tenantId || item.tenantId === auth.user.tenantId);
            const dev = scopedDevices.find(d => d.id === deviceId);
            if (!dev) return sendJson(404, { ok: false, msg: 'Device not found' });

            let rt = auth.state.serverRealtime?.[deviceId];
            const force = String(query.force || '').toLowerCase() === 'true';
            if (force && dev.type === 'sensor_soil_api' && dev.apiConfig) {
                try {
                    const c = dev.apiConfig;
                    const token = await getCloudToken(c.loginName, c.password, c.apiUrl);
                    const realtimeRow = await fetchCloudRealtime(dev, token);
                    if (realtimeRow) {
                        const current = readState();
                        const record = normalizePlatformCloudRow(current, dev, realtimeRow, 'cloud-live-fetch');
                        appendPlatformReading(current, record);
                        updatePlatformRealtime(current, dev, record, realtimeRow.dataItem || []);
                        rt = current.serverRealtime?.[deviceId] || rt;
                        const dIdx = current.devices.findIndex(x => x.id === deviceId);
                        if (dIdx >= 0) current.devices[dIdx].online = true;
                        writeState(current);
                    }
                } catch (e) {
                    console.error('[LiveFetch Error]', e.message);
                }
            }

            return sendJson(200, rt || { ok: false, msg: 'No realtime data yet' });
        }

        if (pathname === '/api/v1/device-history') {
            const auth = requireAuth();
            if (!auth) return;
            const deviceId = String(query.deviceId || '').trim();
            if (!deviceId) return sendJson(400, { ok: false, msg: 'deviceId is required' });
            const scopedDevices = auth.user.role === 'platform_admin'
                ? (auth.state.devices || [])
                : (auth.state.devices || []).filter(item => !item.tenantId || item.tenantId === auth.user.tenantId);
            const dev = scopedDevices.find(d => d.id === deviceId);
            if (!dev) return sendJson(404, { ok: false, msg: 'Device not found' });
            const startTime = parseQueryTime(query.startTime, Number.NEGATIVE_INFINITY);
            const endTime = parseQueryTime(query.endTime, Number.POSITIVE_INFINITY);
            const requestedLimit = Number(query.limit);
            const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
                ? Math.min(Math.floor(requestedLimit), 5000)
                : 500;
            const order = String(query.order || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
            const readings = auth.state.sensorReadings || [];
            let rows = [];

            // Scan from newest to oldest and stop when enough rows are collected.
            for (let i = readings.length - 1; i >= 0; i -= 1) {
                const item = readings[i];
                if (!item || item.deviceId !== deviceId) continue;
                const ts = Number(item.deviceTimestamp);
                if (!Number.isFinite(ts) || ts < startTime || ts > endTime) continue;
                rows.push({
                    ts,
                    deviceTimestamp: ts,
                    recordTimeStr: item.recordTimeStr || null,
                    receivedAt: item.receivedAt,
                    values: item.externalValues || {},
                    channelValues: item.values || {},
                    readingId: item.id,
                    source: item.source,
                });
                if (rows.length >= limit) break;
            }
            if (order === 'asc') rows = rows.reverse();
            return sendJson(200, { deviceId, rows });
        }

        if (pathname === '/api/v1/readings') {
            const auth = requireAuth();
            if (!auth) return;
            const deviceId = String(query.deviceId || '').trim();
            const limit = Math.min(Number(query.limit) || 500, 5000);
            const order = String(query.order || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
            const readings = auth.state.sensorReadings || [];
            let rows = [];
            for (let i = readings.length - 1; i >= 0; i -= 1) {
                const item = readings[i];
                if (!item) continue;
                if (deviceId && item.deviceId !== deviceId) continue;
                rows.push(item);
                if (rows.length >= limit) break;
            }
            if (order === 'asc') rows = rows.reverse();
            return sendJson(200, { ok: true, rows });
        }

        if (pathname === '/api/v1/cloud-history-sync') {
            const auth = requireAuth();
            if (!auth) return;
            if (isSyncInProgress) return sendJson(429, { ok: false, msg: 'Sync already in progress' });
            const { deviceId, startTime, endTime } = query;
            const state = readState();
            const dev = (state.devices || []).find(d => d.id === deviceId);
            if (!dev) return sendJson(404, { ok: false, msg: 'Device not found' });
            isSyncInProgress = true;
            try {
                const token = await getCloudToken(dev.apiConfig.loginName, dev.apiConfig.password, dev.apiConfig.apiUrl);
                const rtRes = await requestJson(`${dev.apiConfig.apiUrl}/api/data/getRealTimeDataByDeviceAddr?deviceAddrs=${dev.apiConfig.deviceAddr}`, { method: 'GET', headers: { 'authorization': token } });
                let nodeIds = [1];
                if (rtRes.data?.code === 1000 && rtRes.data.data?.[0]?.dataItem) nodeIds = rtRes.data.data[0].dataItem.map(i => i.nodeId);

                const grouped = {};
                const historyResults = await Promise.allSettled(nodeIds.map(async nid => {
                    const hRes = await requestJson(`${dev.apiConfig.apiUrl}/api/data/historyList?deviceAddr=${dev.apiConfig.deviceAddr}&nodeId=${nid}&startTime=${startTime.replace('T', ' ')}&endTime=${endTime.replace('T', ' ')}&pageSize=1000`, { method: 'GET', headers: { 'authorization': token } });
                    return { nid, hRes };
                }));

                historyResults.forEach(result => {
                    if (result.status !== 'fulfilled') return;
                    const { nid, hRes } = result.value;
                    if (hRes.data?.code === 1000 && Array.isArray(hRes.data.data)) {
                        hRes.data.data.forEach(box => {
                            if (!box.recordTimeStr) return;
                            if (!grouped[box.recordTimeStr]) grouped[box.recordTimeStr] = { time: box.recordTimeStr, values: {}, dataItemsByNode: {} };
                            grouped[box.recordTimeStr].dataItemsByNode[nid] = grouped[box.recordTimeStr].dataItemsByNode[nid] || { nodeId: nid, registerItem: [] };
                            (box.data || []).forEach(v => {
                                if (!v.registerName) return;
                                const numeric = v.value !== undefined ? Number(v.value) : Number(v.data);
                                grouped[box.recordTimeStr].values[v.registerName] = roundReadingValue(numeric);
                                grouped[box.recordTimeStr].dataItemsByNode[nid].registerItem.push({
                                    registerId: v.registerId,
                                    registerName: v.registerName,
                                    data: v.data !== undefined ? String(v.data) : String(numeric),
                                    value: numeric,
                                    alarmLevel: v.alarmLevel || 0,
                                    alarmColor: v.alarmColor || '',
                                    alarmInfo: v.alarmInfo || '',
                                    unit: v.unit || '',
                                });
                            });
                        });
                    }
                });

                let inserted = 0;
                const list = Object.values(grouped).sort((a, b) => b.time.localeCompare(a.time));
                list.forEach(item => {
                    const row = {
                        systemCode: rtRes.data?.data?.[0]?.systemCode,
                        deviceAddr: Number(dev.apiConfig.deviceAddr),
                        deviceName: dev.name,
                        lat: dev.lat,
                        lng: dev.lng,
                        dataItem: Object.values(item.dataItemsByNode),
                        timeStamp: parseCloudRecordTime(item.time),
                        recordTimeStr: item.time,
                    };
                    const record = normalizePlatformCloudRow(state, dev, row, 'cloud-history-sync');
                    if (appendPlatformReading(state, record)) inserted += 1;
                });
                if (list.length) {
                    const latest = list[0];
                    const latestRow = {
                        systemCode: rtRes.data?.data?.[0]?.systemCode,
                        deviceAddr: Number(dev.apiConfig.deviceAddr),
                        deviceName: dev.name,
                        lat: dev.lat,
                        lng: dev.lng,
                        dataItem: Object.values(latest.dataItemsByNode),
                        timeStamp: parseCloudRecordTime(latest.time),
                        recordTimeStr: latest.time,
                    };
                    const latestRecord = normalizePlatformCloudRow(state, dev, latestRow, 'cloud-history-sync');
                    const currentRtTs = Number(state.serverRealtime?.[dev.id]?.deviceTimestamp);
                    if (!Number.isFinite(currentRtTs) || latestRecord.deviceTimestamp >= currentRtTs) {
                        updatePlatformRealtime(state, dev, latestRecord, latestRow.dataItem || []);
                    }
                }
                writeState(state);
                return sendJson(200, { ok: true, list: list.map(item => ({ time: item.time, values: item.values })), inserted });
            } finally {
                isSyncInProgress = false;
            }
        }
        if (pathname === '/api/v1/photos/crops') {
            const auth = requireAuth(); if (!auth) return;
            const pr = readPhotoRecords();

            if (req.method === 'GET') {
                return sendJson(200, { ok: true, crops: pr.crops });
            }
            if (req.method === 'POST') {
                const body = await readBody(req);
                if (!body.name) return sendJson(400, { ok: false, msg: 'name required' });
                const crop = {
                    id: safeId('crop'),
                    name: String(body.name).trim(),
                    variety: String(body.variety || '').trim(),
                    locationId: String(body.locationId || '').trim(),
                    locationDesc: String(body.locationDesc || '').trim(),
                    createdAt: new Date().toISOString()
                };
                pr.crops.push(crop);
                writePhotoRecords(pr);
                return sendJson(201, { ok: true, crop });
            }
            if (req.method === 'DELETE') {
                const body = await readBody(req).catch(() => ({}));
                const cropId = String(query.id || body.id || '').trim();
                if (!cropId) return sendJson(400, { ok: false, msg: 'id required' });
                const removedRecords = (pr.records || []).filter(record => record.cropId === cropId);
                removedRecords.forEach(deletePhotoRecordFile);
                pr.crops = (pr.crops || []).filter(crop => crop.id !== cropId);
                pr.records = (pr.records || []).filter(record => record.cropId !== cropId);
                writePhotoRecords(pr);
                return sendJson(200, { ok: true });
            }
        }

        if (pathname === '/api/v1/photos/records' && req.method === 'POST') {
            const auth = requireAuth(); if (!auth) return;
            const body = await readBody(req, 15 * 1024 * 1024); // 15MB limit
            if (!body.cropId || !body.imageBase64) {
                return sendJson(400, { ok: false, msg: 'cropId and imageBase64 required' });
            }
            const pr = readPhotoRecords();
            if (!pr.crops.find(c => c.id === body.cropId)) {
                return sendJson(404, { ok: false, msg: 'crop not found' });
            }

            // Decode and store the uploaded image.
            const imgBuffer = Buffer.from(
                body.imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64'
            );
            const now = body.createdAt ? new Date(body.createdAt) : new Date();
            const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            const dir = path.join(PHOTOS_DIR, yearMonth);
            fs.mkdirSync(dir, { recursive: true });
            const id = safeId('photo');
            const imgPath = path.join(dir, `${id}.jpg`);
            fs.writeFileSync(imgPath, imgBuffer);

            const record = {
                id,
                cropId: body.cropId,
                createdAt: now.toISOString(),
                imagePath: `server-data/photos/${yearMonth}/${id}.jpg`,
                imageUrl: `/api/v1/photos/records/${id}/image`,
                gps: body.gps || null,
                weather: body.weather || null,
                linkedSensors: Array.isArray(body.linkedSensors) ? body.linkedSensors : [],
                userNotes: String(body.userNotes || ''),
                aiAnalysis: null
            };
            pr.records.push(record);
            writePhotoRecords(pr);
            const { imageBase64: _, ...recordWithoutImg } = record; // Do not echo base64 back to the client.
            return sendJson(201, { ok: true, record: recordWithoutImg });
        }

        if (pathname === '/api/v1/photos/records' && req.method === 'GET') {
            const auth = requireAuth(); if (!auth) return;
            const pr = readPhotoRecords();
            let records = pr.records;
            if (query.cropId) records = records.filter(r => r.cropId === query.cropId);
            records = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            return sendJson(200, { ok: true, records });
        }

        if (pathname === '/api/v1/photos/records' && req.method === 'DELETE') {
            const auth = requireAuth(); if (!auth) return;
            const body = await readBody(req).catch(() => ({}));
            const recordId = String(query.id || body.id || '').trim();
            if (!recordId) return sendJson(400, { ok: false, msg: 'id required' });
            const pr = readPhotoRecords();
            const record = (pr.records || []).find(item => item.id === recordId);
            if (record) deletePhotoRecordFile(record);
            pr.records = (pr.records || []).filter(item => item.id !== recordId);
            writePhotoRecords(pr);
            return sendJson(200, { ok: true });
        }

        if (pathname.startsWith('/api/v1/photos/records/') && pathname.endsWith('/image')) {
            const auth = requireAuth(); if (!auth) return;
            const id = pathname.split('/')[5]; // /api/v1/photos/records/{id}/image
            const pr = readPhotoRecords();
            const record = pr.records.find(r => r.id === id);
            if (!record) return sendJson(404, { ok: false, msg: 'not found' });
            const imgPath = path.join(__dirname, record.imagePath);
            if (!fs.existsSync(imgPath)) return sendJson(404, { ok: false, msg: 'file missing' });
            res.writeHead(200, {
                'Content-Type': 'image/jpeg',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'max-age=86400'
            });
            return fs.createReadStream(imgPath).pipe(res);
        }

        if (pathname === '/api/v1/photos/sensor-range' && req.method === 'GET') {
            const auth = requireAuth(); if (!auth) return;
            const { deviceId, startTime, endTime } = query;
            if (!deviceId || !startTime || !endTime) {
                return sendJson(400, { ok: false, msg: 'deviceId, startTime and endTime required' });
            }
            const state = readState();
            const startTs = parseQueryTime(startTime, Number.NaN);
            const endTs = parseQueryTime(endTime, Number.NaN);
            if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) {
                return sendJson(400, { ok: false, msg: 'Invalid time range' });
            }
            const channels = (state.channels || []).filter(c => c.deviceId === deviceId);
            const units = {};
            channels.forEach(c => { units[c.displayName] = c.unit; });
            const readings = (state.sensorReadings || [])
                .filter(r => r && r.deviceId === deviceId)
                .map(r => ({ ...r, _ts: Number(r.ts || r.deviceTimestamp) }))
                .filter(r => Number.isFinite(r._ts) && r._ts >= startTs && r._ts <= endTs)
                .sort((a, b) => a._ts - b._ts)
                .map(r => ({
                    ts: r._ts,
                    snapshotTimeStr: r.recordTimeStr || new Date(r._ts).toISOString(),
                    values: r.externalValues || {},
                    units,
                }));
            return sendJson(200, { ok: true, deviceId, startTime, endTime, readings });
        }

        if (pathname === '/api/v1/photos/sensor-snapshot' && req.method === 'GET') {
            const auth = requireAuth(); if (!auth) return;
            const { deviceId, timestamp } = query;
            if (!deviceId || !timestamp) return sendJson(400, { ok: false, msg: 'deviceId and timestamp required' });
            const state = readState();
            const targetTs = new Date(timestamp).getTime();
            const readings = state.sensorReadings.filter(r => r.deviceId === deviceId);
            if (!readings.length) return sendJson(404, { ok: false, msg: 'no readings for device' });
            const closest = readings.reduce((a, b) =>
                Math.abs(a.ts - targetTs) <= Math.abs(b.ts - targetTs) ? a : b
            );
            const channels = state.channels.filter(c => c.deviceId === deviceId);
            const units = {};
            channels.forEach(c => { units[c.displayName] = c.unit; });
            return sendJson(200, { ok: true,
                deviceId, selectedTimestamp: timestamp,
                snapshotTs: closest.ts,
                snapshotTimeStr: new Date(closest.ts).toISOString(),
                values: closest.externalValues,
                units
            });
        }

        if (pathname === '/api/v1/photos/config') {
            const auth = requireAuth(); if (!auth) return;
            const pr = readPhotoRecords();

            if (req.method === 'GET') {
                // Return masked config values to the frontend.
                return sendJson(200, { ok: true, config: {
                    qweatherKey: pr.config.qweatherKey ? '***' : '',
                    visionApiKey: pr.config.visionApiKey ? '***' : '',
                    visionModel: pr.config.visionModel || 'qwen-vl-plus'
                }});
            }
            if (req.method === 'PUT') {
                const body = await readBody(req);
                if (body.qweatherKey !== undefined && body.qweatherKey !== '***')
                    pr.config.qweatherKey = body.qweatherKey;
                if (body.visionApiKey !== undefined && body.visionApiKey !== '***')
                    pr.config.visionApiKey = body.visionApiKey;
                if (body.visionModel) pr.config.visionModel = body.visionModel;
                writePhotoRecords(pr);
                return sendJson(200, { ok: true });
            }
        }

        if (pathname === '/api/v1/photos/weather' && req.method === 'GET') {
            const auth = requireAuth(); if (!auth) return;
            const { lat, lng } = query;
            if (!lat || !lng) return sendJson(400, { ok: false, msg: 'lat and lng required' });
            const pr = readPhotoRecords();
            if (!pr.config.qweatherKey) return sendJson(503, { ok: false, error: 'weather_api_not_configured' });
            try {
                // QWeather expects location as longitude,latitude.
                const url = `https://devapi.qweather.com/v7/weather/now?location=${lng},${lat}&key=${pr.config.qweatherKey}&lang=zh`;
                const result = await requestJson(url, { method: 'GET' });
                if (result.data.code !== '200') return sendJson(502, { ok: false, error: 'weather_api_error', code: result.data.code });
                const now = result.data.now;
                return sendJson(200, { ok: true, weather: {
                    fetchedAt: new Date().toISOString(),
                    temp: Number(now.temp),
                    humidity: Number(now.humidity),
                    condition: now.text,
                    windSpeed: Number(now.windSpeed),
                    precip: Number(now.precip),
                    source: 'qweather'
                }});
            } catch(e) {
                return sendJson(502, { ok: false, error: 'weather_fetch_failed' });
            }
        }
        if (pathname.startsWith('/proxy')) {
            const targetBase = (req.headers['x-target-base'] || DEFAULT_TARGET_BASE).replace(/\/+$/, '');
            const targetUrl = targetBase + pathname.replace('/proxy', '') + myUrl.search;
            const options = { method: req.method, headers: { ...req.headers } };
            delete options.headers.host;
            delete options.headers['x-target-base'];

            const proxyReq = (targetUrl.startsWith('https') ? https : http).request(targetUrl, options, (pRes) => {
                res.writeHead(pRes.statusCode, pRes.headers);
                pRes.pipe(res, { end: true });
            });
            proxyReq.on('error', (err) => {
                console.error('[Proxy Error]', err.message);
                if (!res.writableEnded) sendJson(502, { ok: false, msg: 'Proxy target unreachable' });
            });
            if (['POST', 'PUT', 'PATCH'].includes(req.method)) req.pipe(proxyReq, { end: true });
            else proxyReq.end();
            return;
        }

        const requested = pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '');
        const resolved = path.resolve(__dirname, requested);
        if (!resolved.startsWith(path.resolve(__dirname))) {
            res.writeHead(403);
            return res.end();
        }
        if (fs.existsSync(resolved) && fs.lstatSync(resolved).isFile()) {
            res.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg' }[path.extname(resolved).toLowerCase()] || 'text/plain; charset=utf-8' });
            return fs.createReadStream(resolved).pipe(res);
        }
        res.writeHead(404);
        res.end();
    } catch (e) {
        console.error('[Request Error]', e);
        if (!res.writableEnded) sendJson(500, { ok: false, msg: e.message });
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] RUNNING ON ${PORT}`);
    console.log(`[AUTH] Default admin: admin / ${DEFAULT_ADMIN_PASSWORD}`);
});
