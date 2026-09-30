'use strict';
// Historical daily weather for harvest prediction, proxied from Open-Meteo's ERA5 archive (free, no key; non-commercial terms).
// The mini program cannot call third-party domains until they are whitelisted, so it goes through this server.
// Each point-year is stored in PostgreSQL (harvest_weather_years) the first time it is fetched; later requests read the
// stored years and only fetch what is missing. Identical requests in flight share one lookup.
const { requestJson } = require('./http');

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const SOURCE = 'Open-Meteo / ERA5';
const VARIABLES = ['temperature_2m_mean', 'temperature_2m_min', 'temperature_2m_max', 'precipitation_sum', 'et0_fao_evapotranspiration', 'shortwave_radiation_sum'];
const YEAR_START = /^(\d{4})-01-01$/;
const YEAR_END = /^(\d{4})-12-31$/;
const MAX_YEARS = 32;
const PRELIMINARY_REFRESH_MS = 7 * 24 * 3600000;

const round4 = x => Math.round(x * 10000) / 10000;

// A stored year is final once fetched after 1 April of the next year; before that ERA5T values may still be revised.
function usable(row, now) {
    const fetched = new Date(row.fetchedAt).getTime();
    return fetched >= Date.UTC(row.year + 1, 3, 1) || now - fetched < PRELIMINARY_REFRESH_MS;
}

function splitYears(daily) {
    const years = new Map();
    daily.time.forEach((day, i) => {
        const year = Number(day.slice(0, 4));
        if (!years.has(year)) years.set(year, { time: [], ...Object.fromEntries(VARIABLES.map(k => [k, []])) });
        const d = years.get(year);
        d.time.push(day);
        VARIABLES.forEach(k => d[k].push(daily[k] ? daily[k][i] ?? null : null));
    });
    return years;
}

function joinYears(years) {
    const daily = { time: [], ...Object.fromEntries(VARIABLES.map(k => [k, []])) };
    for (const d of years) {
        daily.time.push(...d.time);
        VARIABLES.forEach(k => daily[k].push(...d[k]));
    }
    return daily;
}

// PostgreSQL store; db is lib/db (query).
function createPgWeatherStore(db) {
    return {
        async getYears(lat, lng, from, to) {
            const { rows } = await db.query(
                'SELECT year, daily, fetched_at FROM harvest_weather_years WHERE lat = $1 AND lng = $2 AND year BETWEEN $3 AND $4',
                [lat, lng, from, to]);
            return rows.map(r => ({ year: r.year, daily: r.daily, fetchedAt: r.fetched_at }));
        },
        async putYears(lat, lng, source, years) {
            for (const { year, daily } of years) {
                await db.query(
                    `INSERT INTO harvest_weather_years (lat, lng, year, source, daily) VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (lat, lng, year) DO UPDATE SET source = EXCLUDED.source, daily = EXCLUDED.daily, fetched_at = now()`,
                    [lat, lng, year, source, JSON.stringify(daily)]);
            }
        },
    };
}

function createWeatherService({ store, request = requestJson, timeoutMs = 40000, today = () => new Date().toISOString().slice(0, 10), now = () => Date.now(), log = console.error } = {}) {
    const pending = new Map();

    function parse(query) {
        const lat = Number(query.lat), lng = Number(query.lng), start = String(query.start || ''), end = String(query.end || '');
        if (!String(query.lat || '').trim() || !String(query.lng || '').trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            return { error: '请提供有效的经纬度。' };
        }
        const a = YEAR_START.exec(start), b = YEAR_END.exec(end);
        if (!a || !b) return { error: '日期需为整年：开始 YYYY-01-01，结束 YYYY-12-31。' };
        const from = Number(a[1]), to = Number(b[1]);
        if (from < 1940 || end >= today() || from > to) return { error: '年份需在 1940 年到去年之间，且开始不晚于结束。' };
        if (to - from + 1 > MAX_YEARS) return { error: `一次最多读取 ${MAX_YEARS} 年。` };
        return { lat: round4(lat), lng: round4(lng), from, to };
    }

    async function fetchUpstream(lat, lng, from, to) {
        const url = `${ARCHIVE_URL}?latitude=${lat}&longitude=${lng}&start_date=${from}-01-01&end_date=${to}-12-31&daily=${VARIABLES.join(',')}&timezone=auto&models=era5`;
        const res = await request(url, { method: 'GET', timeout: timeoutMs });
        const daily = res.data && res.data.daily;
        if (res.status < 200 || res.status >= 300 || !daily || !Array.isArray(daily.time)) throw new Error('upstream status ' + res.status);
        return splitYears(daily);
    }

    async function resolve({ lat, lng, from, to }) {
        let stored = [];
        if (store) {
            try { stored = await store.getYears(lat, lng, from, to); } catch (e) { log('[harvest-weather] read failed:', e.message); }
        }
        const t = now(), byYear = new Map(stored.filter(r => usable(r, t)).map(r => [r.year, r.daily]));
        const missing = [];
        for (let y = from; y <= to; y++) if (!byYear.has(y)) missing.push(y);
        if (missing.length) {
            let fetched;
            try {
                fetched = await fetchUpstream(lat, lng, missing[0], missing[missing.length - 1]);
            } catch (e) {
                return { status: 502, body: { ok: false, status: 'upstream_error', msg: '历史天气服务暂不可用，请稍后重试。' } };
            }
            const fresh = missing.filter(y => fetched.has(y)).map(y => ({ year: y, daily: fetched.get(y) }));
            fresh.forEach(r => byYear.set(r.year, r.daily));
            if (store && fresh.length) {
                try { await store.putYears(lat, lng, SOURCE, fresh); } catch (e) { log('[harvest-weather] write failed:', e.message); }
            }
        }
        const years = [];
        for (let y = from; y <= to; y++) if (byYear.has(y)) years.push(byYear.get(y));
        return { status: 200, body: { ok: true, source: SOURCE, lat, lng, fromStore: to - from + 1 - missing.length, daily: joinYears(years) } };
    }

    async function lookup(query) {
        const q = parse(query || {});
        if (q.error) return { status: 400, body: { ok: false, status: 'invalid_request', msg: q.error } };
        const key = [q.lat, q.lng, q.from, q.to].join(',');
        if (pending.has(key)) return pending.get(key);
        const promise = resolve(q).finally(() => pending.delete(key));
        pending.set(key, promise);
        return promise;
    }

    return { lookup };
}

module.exports = { createWeatherService, createPgWeatherStore, VARIABLES };
