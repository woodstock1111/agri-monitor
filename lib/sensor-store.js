// Sensor readings in PostgreSQL. Rows are returned in the legacy JSON shapes the frontend already consumes.
const db = require('./db');
const { formatBeijing } = require('./time');

const INSERT_CHUNK = 500;

// Legacy `source` values the frontend has seen before; new kinds map onto them.
const KIND_TO_SOURCE = { hourly: 'cloud-poll', history_sync: 'cloud-history-sync', migrated: 'migrated' };

function toMs(value) {
    return value instanceof Date ? value.getTime() : Number(value);
}

// Shape of /device-history rows and app-state `history` entries.
function toHistoryRow(row) {
    const ts = toMs(row.ts);
    return {
        ts,
        deviceTimestamp: ts,
        recordTimeStr: formatBeijing(ts),
        receivedAt: toMs(row.received_at),
        values: row.external_values || {},
        channelValues: row.values || {},
        readingId: String(row.id),
        source: KIND_TO_SOURCE[row.kind] || row.kind,
        isDailySnapshot: row.is_daily_snapshot === true,
    };
}

// Shape of legacy `sensorReadings` entries (/readings, app-state snapshot).
function toReading(row) {
    const ts = toMs(row.ts);
    return {
        id: String(row.id),
        tenantId: row.tenant_id,
        deviceId: row.device_id,
        externalDeviceId: row.device_id,
        provider: row.provider,
        source: KIND_TO_SOURCE[row.kind] || row.kind,
        ts,
        deviceTimestamp: ts,
        recordTimeStr: formatBeijing(ts),
        receivedAt: toMs(row.received_at),
        values: row.values || {},
        externalValues: row.external_values || {},
        isDailySnapshot: row.is_daily_snapshot === true,
    };
}

// rows: [{ tenantId, deviceId, provider, ts, slotAt, isDailySnapshot, kind, values, externalValues }]
// A (device_id, ts) pair is one measurement: a second row for it merges its values into the stored row
// (0531yun history can return the same record time split across nodes). Returns inserted + changed rows.
// Merges rows that share (deviceId, ts) — one INSERT ... ON CONFLICT DO UPDATE cannot touch the same row twice.
function mergeSameMeasurement(rows) {
    const merged = new Map();
    rows.forEach(row => {
        const key = `${row.deviceId}|${Number(row.ts)}`;
        const existing = merged.get(key);
        if (!existing) {
            merged.set(key, { ...row, values: { ...(row.values || {}) }, externalValues: { ...(row.externalValues || {}) } });
            return;
        }
        Object.assign(existing.values, row.values || {});
        Object.assign(existing.externalValues, row.externalValues || {});
    });
    return [...merged.values()];
}

async function insertReadings(inputRows, client = null) {
    let inserted = 0;
    const rows = mergeSameMeasurement(inputRows);
    const run = client ? client.query.bind(client) : db.query;
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        const chunk = rows.slice(i, i + INSERT_CHUNK);
        const result = await run(
            `INSERT INTO sensor_readings (tenant_id, device_id, provider, ts, slot_at, is_daily_snapshot, kind, "values", external_values)
             SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[], $5::timestamptz[], $6::boolean[], $7::text[], $8::jsonb[], $9::jsonb[])
             ON CONFLICT (device_id, ts) DO UPDATE SET
                 "values" = sensor_readings."values" || EXCLUDED."values",
                 external_values = sensor_readings.external_values || EXCLUDED.external_values
             WHERE NOT (sensor_readings."values" @> EXCLUDED."values" AND sensor_readings.external_values @> EXCLUDED.external_values)`,
            [
                chunk.map(r => r.tenantId),
                chunk.map(r => r.deviceId),
                chunk.map(r => r.provider),
                chunk.map(r => new Date(r.ts)),
                chunk.map(r => (r.slotAt ? new Date(r.slotAt) : null)),
                chunk.map(r => r.isDailySnapshot === true),
                chunk.map(r => r.kind),
                chunk.map(r => JSON.stringify(r.values || {})),
                chunk.map(r => JSON.stringify(r.externalValues || {})),
            ]
        );
        inserted += result.rowCount;
    }
    return inserted;
}

// deviceId -> epoch ms of the latest stored hourly slot (so a restart does not store the same hour twice).
async function latestHourlySlots() {
    const { rows } = await db.query(`SELECT device_id, max(slot_at) AS slot FROM sensor_readings WHERE kind = 'hourly' GROUP BY device_id`);
    return new Map(rows.map(row => [row.device_id, toMs(row.slot)]));
}

// tenantId: null for platform admins (no tenant filter); deleted/foreign devices are filtered by the caller's device list.
async function deviceHistory({ deviceId, tenantId, start = null, end = null, limit = 1000, order = 'asc' }) {
    const params = [deviceId, limit];
    const where = ['device_id = $1'];
    if (tenantId) { params.push(tenantId); where.push(`tenant_id = $${params.length}`); }
    if (Number.isFinite(start)) { params.push(new Date(start)); where.push(`ts >= $${params.length}`); }
    if (Number.isFinite(end)) { params.push(new Date(end)); where.push(`ts <= $${params.length}`); }
    const { rows } = await db.query(
        `SELECT * FROM (SELECT * FROM sensor_readings WHERE ${where.join(' AND ')} ORDER BY ts DESC LIMIT $2) newest ORDER BY ts ${order === 'desc' ? 'DESC' : 'ASC'}`,
        params
    );
    return rows;
}

async function recentReadings({ deviceIds, tenantId, limit = 500 }) {
    if (!deviceIds.length) return [];
    const params = [deviceIds, limit];
    let tenantClause = '';
    if (tenantId) { params.push(tenantId); tenantClause = `AND tenant_id = $${params.length}`; }
    const { rows } = await db.query(
        `SELECT * FROM sensor_readings WHERE device_id = ANY($1) ${tenantClause} ORDER BY ts DESC LIMIT $2`,
        params
    );
    return rows;
}

// Last `perDevice` rows for each device, oldest first within a device.
async function recentPerDevice({ deviceIds, tenantId, perDevice }) {
    if (!deviceIds.length) return [];
    const params = [deviceIds, perDevice];
    let tenantClause = '';
    if (tenantId) { params.push(tenantId); tenantClause = `AND r.tenant_id = $${params.length}`; }
    const { rows } = await db.query(
        `SELECT r.* FROM unnest($1::text[]) AS d(device_id)
         CROSS JOIN LATERAL (
             SELECT * FROM sensor_readings r WHERE r.device_id = d.device_id ${tenantClause} ORDER BY r.ts DESC LIMIT $2
         ) r
         ORDER BY r.device_id, r.ts`,
        params
    );
    return rows;
}

async function closestReading({ deviceId, tenantId, ts }) {
    const params = [deviceId, new Date(ts)];
    let tenantClause = '';
    if (tenantId) { params.push(tenantId); tenantClause = `AND tenant_id = $${params.length}`; }
    const { rows } = await db.query(
        `(SELECT * FROM sensor_readings WHERE device_id = $1 ${tenantClause} AND ts <= $2 ORDER BY ts DESC LIMIT 1)
         UNION ALL
         (SELECT * FROM sensor_readings WHERE device_id = $1 ${tenantClause} AND ts > $2 ORDER BY ts ASC LIMIT 1)`,
        params
    );
    return rows.sort((a, b) => Math.abs(toMs(a.ts) - ts) - Math.abs(toMs(b.ts) - ts))[0] || null;
}

module.exports = {
    toHistoryRow,
    toReading,
    insertReadings,
    latestHourlySlots,
    deviceHistory,
    recentReadings,
    recentPerDevice,
    closestReading,
};
