// Sensor collection schedule.
//   - Every POLL_INTERVAL (default 5 min, aligned to the wall clock so one poll lands on each full hour):
//     fetch realtime values for every sensor device and update the in-memory realtime state only.
//   - Once per Beijing-time hour: store each device's latest value in sensor_readings (kind 'hourly').
//     08:00 and 14:00 rows are flagged is_daily_snapshot.
//   - A device whose latest value is older than STALE_MS is skipped for that poll; if it comes back within the
//     same hour, a later poll stores that hour.
const { HOUR_MS, hourSlotStart, beijingHour } = require('./time');

const STALE_MS = 70 * 60 * 1000;

function createCollector({
    providers,          // Map providerId -> provider
    listDevices,        // () => sensor devices to poll (from app-state)
    applySnapshot,      // (dev, snapshot) => { values, externalValues } — updates in-memory realtime state
    markOnline,         // (dev, online) => void
    sensorStore,
    pollIntervalMs = 5 * 60 * 1000,
    snapshotHours = [8, 14],
    now = () => Date.now(),
    log = console,
}) {
    const storedSlots = new Map(); // deviceId -> slot start (ms) already stored
    let timer = null;
    let running = false;

    const providerFor = dev => providers.get(dev.provider || '0531yun');

    async function fetchSnapshots(devices) {
        const byProvider = new Map();
        devices.forEach(dev => {
            const provider = providerFor(dev);
            if (!provider) return;
            if (!byProvider.has(provider)) byProvider.set(provider, []);
            byProvider.get(provider).push(dev);
        });
        const merged = new Map();
        for (const [provider, devs] of byProvider) {
            const results = await provider.fetchRealtime(devs);
            results.forEach((value, key) => merged.set(key, value));
        }
        return merged;
    }

    // Applies fetched snapshots to the realtime state; returns [{ dev, snapshot, applied }] for devices with data.
    function applyResults(devices, results) {
        const fresh = [];
        devices.forEach(dev => {
            const result = results.get(dev.id);
            if (!result) return;
            if (result.error) {
                log.warn(`[Collector] ${dev.id}: ${result.error}`);
                return;
            }
            if (!result.online || !result.nodes) {
                markOnline(dev, false);
                return;
            }
            fresh.push({ dev, snapshot: result, applied: applySnapshot(dev, result) });
        });
        return fresh;
    }

    async function storeHourly(fresh) {
        const at = now();
        const slot = hourSlotStart(at);
        const rows = [];
        const slotDevices = [];
        fresh.forEach(({ dev, snapshot, applied }) => {
            if (storedSlots.get(dev.id) === slot) return;
            if (at - snapshot.ts > STALE_MS) return;
            rows.push({
                tenantId: dev.tenantId,
                deviceId: dev.id,
                provider: dev.provider || '0531yun',
                ts: snapshot.ts,
                slotAt: slot,
                isDailySnapshot: snapshotHours.includes(beijingHour(slot)),
                kind: 'hourly',
                values: applied.values,
                externalValues: applied.externalValues,
            });
            slotDevices.push(dev.id);
        });
        if (!rows.length) return 0;
        const inserted = await sensorStore.insertReadings(rows);
        // A duplicate (device did not report since last hour) also counts as handled for this slot.
        slotDevices.forEach(id => storedSlots.set(id, slot));
        return inserted;
    }

    async function pollOnce() {
        if (running) return;
        running = true;
        try {
            const devices = listDevices();
            if (!devices.length) return;
            const results = await fetchSnapshots(devices);
            const fresh = applyResults(devices, results);
            const inserted = await storeHourly(fresh);
            if (inserted) log.log(`[Collector] stored ${inserted} hourly reading(s)`);
        } catch (error) {
            log.warn('[Collector] poll failed:', error.message);
        } finally {
            running = false;
        }
    }

    // Realtime refresh for a viewer (force=true): memory only, never stored.
    async function refreshDevice(dev) {
        const results = await fetchSnapshots([dev]);
        applyResults([dev], results);
    }

    function scheduleNext() {
        const at = now();
        const delay = pollIntervalMs - (at % pollIntervalMs) + 1000; // 1s past the boundary
        timer = setTimeout(async () => {
            await pollOnce();
            scheduleNext();
        }, delay);
        timer.unref?.();
    }

    async function start() {
        const slots = await sensorStore.latestHourlySlots();
        slots.forEach((slot, deviceId) => storedSlots.set(deviceId, slot));
        await pollOnce();
        scheduleNext();
    }

    function stop() {
        if (timer) clearTimeout(timer);
        timer = null;
    }

    return { start, stop, pollOnce, refreshDevice, storedSlots, HOUR_MS };
}

module.exports = { createCollector, STALE_MS };
