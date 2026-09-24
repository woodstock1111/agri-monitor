// Hour slots and daily snapshots are defined in Beijing time (UTC+8, no DST).
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// Start of the Beijing-time hour containing `ms`, as an epoch ms value.
function hourSlotStart(ms) {
    return Math.floor((ms + BEIJING_OFFSET_MS) / HOUR_MS) * HOUR_MS - BEIJING_OFFSET_MS;
}

function beijingHour(ms) {
    return new Date(ms + BEIJING_OFFSET_MS).getUTCHours();
}

// "YYYY-MM-DD HH:mm:ss" in Beijing time, the format 0531yun uses for recordTimeStr.
function formatBeijing(ms) {
    const d = new Date(ms + BEIJING_OFFSET_MS);
    const pad = value => String(value).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

// Parses "YYYY-MM-DD HH:mm:ss" (or ISO without zone) as Beijing time; numbers pass through as epoch ms.
function parseBeijing(value) {
    if (value === undefined || value === null || value === '') return NaN;
    if (typeof value === 'number') return value;
    const text = String(value).trim();
    if (/^\d+$/.test(text)) return Number(text);
    if (/[zZ]|[+-]\d\d:?\d\d$/.test(text)) return new Date(text).getTime();
    const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (!match) return NaN;
    const [, y, mo, d, h = '0', mi = '0', s = '0'] = match;
    return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) - BEIJING_OFFSET_MS;
}

module.exports = { HOUR_MS, hourSlotStart, beijingHour, formatBeijing, parseBeijing };
