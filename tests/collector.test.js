const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCollector } = require('../lib/collector');
const { createProvider } = require('../providers/0531yun');
const { parseBeijing, hourSlotStart, formatBeijing } = require('../lib/time');

const quietLog = { log() {}, warn() {} };

function fakeStore() {
    const rows = [];
    const keys = new Set();
    return {
        rows,
        async insertReadings(batch) {
            let inserted = 0;
            batch.forEach(row => {
                const key = `${row.deviceId}|${row.ts}`;
                if (keys.has(key)) return;
                keys.add(key);
                rows.push(row);
                inserted += 1;
            });
            return inserted;
        },
        async latestHourlySlots() { return new Map(); },
    };
}

function setup({ snapshots, clock }) {
    const store = fakeStore();
    const online = {};
    const devices = [
        { id: 'd1', tenantId: 't1', type: 'sensor_soil_api', apiConfig: {} },
        { id: 'd2', tenantId: 't2', type: 'sensor_soil_api', apiConfig: {} },
    ];
    const provider = { async fetchRealtime(devs) { return new Map(devs.map(d => [d.id, snapshots[d.id]])); } };
    const collector = createCollector({
        providers: new Map([['0531yun', provider]]),
        listDevices: () => devices,
        applySnapshot: (dev, snap) => ({ values: { ch: snap.value }, externalValues: { 温度: snap.value } }),
        markOnline: (dev, value) => { online[dev.id] = value; },
        sensorStore: store,
        now: () => clock.now,
        log: quietLog,
    });
    return { store, online, collector };
}

test('stores one row per device per Beijing hour and flags 08:00 / 14:00 snapshots', async () => {
    const clock = { now: parseBeijing('2026-09-23 08:00:01') };
    const snapshots = {
        d1: { online: true, ts: parseBeijing('2026-09-23 07:58:00'), nodes: [], value: 1 },
        d2: { online: false },
    };
    const { store, online, collector } = setup({ snapshots, clock });

    await collector.pollOnce();
    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].isDailySnapshot, true);
    assert.equal(formatBeijing(store.rows[0].slotAt), '2026-09-23 08:00:00');
    assert.equal(online.d2, false, 'offline device is marked offline and not stored');

    // Later polls in the same hour do not store again, even with new data.
    clock.now = parseBeijing('2026-09-23 08:05:01');
    snapshots.d1 = { online: true, ts: parseBeijing('2026-09-23 08:04:00'), nodes: [], value: 2 };
    await collector.pollOnce();
    assert.equal(store.rows.length, 1);

    // Next hour: stored, not a daily snapshot.
    clock.now = parseBeijing('2026-09-23 09:00:01');
    snapshots.d1 = { online: true, ts: parseBeijing('2026-09-23 08:59:00'), nodes: [], value: 3 };
    await collector.pollOnce();
    assert.equal(store.rows.length, 2);
    assert.equal(store.rows[1].isDailySnapshot, false);
    assert.equal(store.rows[1].values.ch, 3);
});

test('stale values are skipped and stored once the device reports again within the hour', async () => {
    const clock = { now: parseBeijing('2026-09-23 10:00:01') };
    const snapshots = { d1: { online: true, ts: parseBeijing('2026-09-23 08:30:00'), nodes: [], value: 1 }, d2: { online: false } };
    const { store, collector } = setup({ snapshots, clock });

    await collector.pollOnce();
    assert.equal(store.rows.length, 0, '90-minute-old value is not stored for 10:00');

    clock.now = parseBeijing('2026-09-23 10:20:01');
    snapshots.d1 = { online: true, ts: parseBeijing('2026-09-23 10:19:00'), nodes: [], value: 5 };
    await collector.pollOnce();
    assert.equal(store.rows.length, 1);
    assert.equal(formatBeijing(store.rows[0].slotAt), '2026-09-23 10:00:00');
});

test('a device that did not report since the last hour produces no duplicate', async () => {
    const clock = { now: parseBeijing('2026-09-23 11:00:01') };
    const snapshots = { d1: { online: true, ts: parseBeijing('2026-09-23 10:40:00'), nodes: [], value: 1 }, d2: { online: false } };
    const { store, collector } = setup({ snapshots, clock });
    await collector.pollOnce();
    clock.now = parseBeijing('2026-09-23 12:00:01'); // new hour, same device timestamp (80 min old -> stale)
    await collector.pollOnce();
    assert.equal(store.rows.length, 1);
});

test('hour slots follow Beijing time', () => {
    assert.equal(formatBeijing(hourSlotStart(parseBeijing('2026-09-23 23:59:59'))), '2026-09-23 23:00:00');
    assert.equal(formatBeijing(hourSlotStart(parseBeijing('2026-09-24 00:00:00'))), '2026-09-24 00:00:00');
});

test('0531yun provider batches realtime per account and takes the record time from history', async () => {
    const calls = [];
    const requestJson = async url => {
        calls.push(url);
        if (url.includes('/api/getToken')) return { status: 200, data: { code: 1000, data: { token: 'tok', expiration: Date.now() / 1000 + 3600 } } };
        if (url.includes('getRealTimeDataByDeviceAddr')) {
            return { status: 200, data: { code: 1000, data: [
                { deviceAddr: 111, deviceStatus: 'online', timeStamp: 0, dataItem: [{ nodeId: 1, registerItem: [{ registerName: '土壤温度', value: 21.5, unit: '℃' }] }] },
                { deviceAddr: 222, deviceStatus: 'offline', timeStamp: 0, dataItem: null },
            ] } };
        }
        if (url.includes('historyList')) {
            return { status: 200, data: { code: 1000, data: [
                { recordTimeStr: '2026-09-23 08:10:00', data: [{ registerName: '土壤温度', value: 21.4, unit: '℃' }] },
                { recordTimeStr: '2026-09-23 08:20:00', data: [{ registerName: '土壤温度', value: 21.6, unit: '℃' }] },
            ] } };
        }
        throw new Error(`unexpected ${url}`);
    };
    const provider = createProvider({ requestJson });
    const config = { loginName: 'acc', password: 'acc', apiUrl: 'http://cloud.example' };
    const results = await provider.fetchRealtime([
        { id: 'a', apiConfig: { ...config, deviceAddr: '111' } },
        { id: 'b', apiConfig: { ...config, deviceAddr: '222' } },
    ]);
    assert.equal(calls.filter(u => u.includes('getToken')).length, 1, 'one token request per account');
    assert.equal(calls.filter(u => u.includes('getRealTimeDataByDeviceAddr')).length, 1, 'one batched realtime request');
    assert.ok(calls.find(u => u.includes('getRealTimeDataByDeviceAddr')).includes(encodeURIComponent('111,222')));
    assert.equal(results.get('b').online, false);
    const a = results.get('a');
    assert.equal(a.online, true);
    assert.equal(a.recordTimeStr, '2026-09-23 08:20:00');
    assert.equal(a.ts, parseBeijing('2026-09-23 08:20:00'));
    assert.equal(a.nodes[0].registerItem[0].value, 21.6);
});
