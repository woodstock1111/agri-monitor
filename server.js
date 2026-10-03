require('./lib/env').loadEnv();
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const chinaSoil = require('./china-soil').createSoilService();
const db = require('./lib/db');
const { hashPassword, hashPasswordLegacy, verifyPassword, passwordNeedsRehash } = require('./lib/passwords');
const { createWeatherService, createPgWeatherStore } = require('./lib/harvest-weather');
const harvestWeather = createWeatherService({ store: createPgWeatherStore(db) });
const userStore = require('./lib/user-store').createUserStore(db);
const { createSessionService, createPgSessionStore } = require('./lib/sessions');
const sessions = createSessionService({ store: createPgSessionStore(db) });
const { createWechatMini, WechatError } = require('./lib/wechat-mini');
const wechatMini = createWechatMini();
const { requestJson } = require('./lib/http');
const { createAgent } = require('./lib/agent');
const { createTools } = require('./lib/agent/tools');
const { createGuard } = require('./lib/agent/guard');
const { createLlm } = require('./lib/agent/llm');
const { createSessionStore } = require('./lib/agent/sessions');
const { createActionLog } = require('./lib/agent/actions');
const aiModels = require('./lib/ai-models');
const { parseBeijing } = require('./lib/time');
const sensorStore = require('./lib/sensor-store');
const photoStore = require('./lib/photo-store');
const pestStore = require('./lib/pest-store');
const vision = require('./lib/vision');
const { createCollector } = require('./lib/collector');
const cloud0531 = require('./providers/0531yun').createProvider({ requestJson });
const SENSOR_PROVIDERS = new Map([[cloud0531.id, cloud0531]]);

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'server-data');
const STATE_FILE = path.join(DATA_DIR, 'app-state.json');
const PHOTO_RECORDS_FILE = path.join(DATA_DIR, 'photo-records.json');
const FARM_TASKS_FILE = path.join(DATA_DIR, 'farm-tasks.json');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
const DEFAULT_TARGET_BASE = 'http://www.0531yun.com';
const DEFAULT_TENANT_ID = 'tenant_default';
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123456';
const LIVE_FETCH_MIN_INTERVAL_MS = 30 * 1000;
// Beijing-time hours whose hourly row is flagged as the daily snapshot.
const SNAPSHOT_HOURS = String(process.env.SNAPSHOT_HOURS || '8,14').split(',').map(Number).filter(Number.isInteger);
// Hourly rows per device included in the app-state snapshot (7 days); charts load more via /device-history.
const SNAPSHOT_ROWS_PER_DEVICE = 168;
const CLOUD_POLL_INTERVAL_MS = Number(process.env.CLOUD_POLL_INTERVAL_MS || 5 * 60 * 1000);
const WRITE_DEBOUNCE_MS = 1000;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_IP_FAILURE_LIMIT = 5;
const LOGIN_IP_LOCK_MS = 15 * 60 * 1000;
const LOGIN_ACCOUNT_FAILURE_LIMIT = 10;
const LOGIN_ACCOUNT_LOCK_MS = 10 * 60 * 1000;
const LOGIN_FAILURES = {
    ip: new Map(),
    account: new Map(),
};
const LIVE_FETCHES = new Map();
const HISTORY_SYNCS_IN_PROGRESS = new Set();

let cachedState = null;
let writeTimeout = null;
let isDirty = false;
let isShuttingDown = false;
let isFlushing = false;
let tmpFileCounter = 0;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PHOTOS_DIR, { recursive: true });

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


function safeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

// Requests relayed by the WeChat Cloud Hosting gateway (cloudrun/gateway) carry the caller's openid and IP, signed with a
// shared secret. Anything else claiming those headers is ignored.
const MINI_GATEWAY_SECRET = process.env.MINI_GATEWAY_SECRET || '';
function gatewayTrust(req) {
    if (req.gatewayTrust !== undefined) return req.gatewayTrust;
    const given = Buffer.from(String(req.headers['x-agri-gateway-secret'] || ''));
    const expected = Buffer.from(MINI_GATEWAY_SECRET);
    const ok = expected.length >= 32 && given.length === expected.length && crypto.timingSafeEqual(given, expected);
    req.gatewayTrust = ok ? {
        openid: String(req.headers['x-agri-wx-openid'] || '').trim() || null,
        clientIp: String(req.headers['x-agri-client-ip'] || '').trim() || null,
    } : null;
    return req.gatewayTrust;
}

function realClientIp(req) {
    const relayed = gatewayTrust(req)?.clientIp;
    if (relayed) return relayed;
    const xRealIp = String(req.headers['x-real-ip'] || '').trim();
    if (xRealIp) return xRealIp;
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || req.socket.remoteAddress || 'unknown';
}

function loginAccountKey(account) {
    return String(account || '').trim().toLowerCase();
}

function loginBucket(map, key, now) {
    const current = map.get(key);
    if (current && now - current.windowStart <= LOGIN_FAILURE_WINDOW_MS) return current;
    const lockedUntil = current?.lockedUntil > now ? current.lockedUntil : 0;
    const fresh = { count: 0, windowStart: now, lockedUntil };
    map.set(key, fresh);
    return fresh;
}

function cleanupLoginFailures(now = Date.now()) {
    Object.values(LOGIN_FAILURES).forEach(map => {
        for (const [key, item] of map) {
            const windowExpired = now - item.windowStart > LOGIN_FAILURE_WINDOW_MS;
            const lockExpired = !item.lockedUntil || item.lockedUntil <= now;
            if (windowExpired && lockExpired) map.delete(key);
        }
    });
}

function loginRetryAfterSeconds(ip, account, now = Date.now()) {
    const lockedUntil = Math.max(
        LOGIN_FAILURES.ip.get(ip)?.lockedUntil || 0,
        account ? LOGIN_FAILURES.account.get(account)?.lockedUntil || 0 : 0
    );
    return lockedUntil > now ? Math.max(1, Math.ceil((lockedUntil - now) / 1000)) : 0;
}

function recordLoginFailure(ip, account, now = Date.now()) {
    const ipBucket = loginBucket(LOGIN_FAILURES.ip, ip, now);
    ipBucket.count += 1;
    if (ipBucket.count >= LOGIN_IP_FAILURE_LIMIT) ipBucket.lockedUntil = now + LOGIN_IP_LOCK_MS;

    if (account) {
        const accountBucket = loginBucket(LOGIN_FAILURES.account, account, now);
        accountBucket.count += 1;
        if (accountBucket.count >= LOGIN_ACCOUNT_FAILURE_LIMIT) accountBucket.lockedUntil = now + LOGIN_ACCOUNT_LOCK_MS;
    }
}

function clearLoginFailures(ip, account) {
    LOGIN_FAILURES.ip.delete(ip);
    if (account) LOGIN_FAILURES.account.delete(account);
}


function tenantIdForAccount(account) {
    const slug = String(account || 'tenant').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'tenant';
    return `tenant_${slug}_${crypto.randomBytes(3).toString('hex')}`;
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

    // Accounts live in PostgreSQL (lib/user-store.js). The users/tenants below only seed the one-time import on an empty database.
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
            passwordHash: hashPasswordLegacy(DEFAULT_ADMIN_PASSWORD),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        changed = true;
    }
    state.users.forEach(user => {
        if (!user || user.role === 'platform_admin') return;
        if (!user.tenantId || user.tenantId === DEFAULT_TENANT_ID) {
            const tenantId = tenantIdForAccount(user.account || user.id);
            user.tenantId = tenantId;
            user.updatedAt = new Date().toISOString();
            if (!state.tenants.some(item => item.id === tenantId)) {
                state.tenants.push({
                    id: tenantId,
                    name: user.name || user.account || tenantId,
                    status: 'active',
                    createdAt: new Date().toISOString(),
                });
            }
            changed = true;
        }
    });

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
    // Readings live in PostgreSQL now (backfilled by scripts/backfill-from-json.js before the first start).
    if (state.sensorReadings.length || state.rawIngestPayloads.length || Object.keys(state.history || {}).length) {
        state.sensorReadings = [];
        state.rawIngestPayloads = [];
        state.history = {};
        changed = true;
    }

    ['history', 'serverRealtime', 'realtimeState', 'collector'].forEach(key => {
        if (!state[key] || typeof state[key] !== 'object' || Array.isArray(state[key])) {
            state[key] = {};
            changed = true;
        }
    });
    // Empty realtime entries were written for offline devices before that bug was fixed; drop them.
    ['serverRealtime', 'realtimeState'].forEach(key => {
        Object.entries(state[key]).forEach(([deviceId, entry]) => {
            if (!Object.keys(entry?.values || {}).length) {
                delete state[key][deviceId];
                changed = true;
            }
        });
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

function tmpPathFor(file) {
    tmpFileCounter += 1;
    return `${file}.${process.pid}.${tmpFileCounter}.tmp`;
}

// Write to a temp file, fsync, then rename over the target, so a crash mid-write never leaves a half-written file.
function writeFileAtomicSync(file, text) {
    const tmp = tmpPathFor(file);
    const fd = fs.openSync(tmp, 'w');
    try {
        fs.writeSync(fd, text);
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
}

async function writeFileAtomic(file, text) {
    const tmp = tmpPathFor(file);
    const handle = await fs.promises.open(tmp, 'w');
    try {
        await handle.writeFile(text, 'utf8');
        await handle.sync();
    } finally {
        await handle.close();
    }
    await fs.promises.rename(tmp, file);
}

// An existing but unparseable data file must stop the process: falling back to empty data
// would get written back on the next save and wipe production (restore from server-data backups instead).
function readJsonFileOrExit(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        console.error(`[Storage] FATAL: ${file} is unreadable (${error.message}). Refusing to start so it is not overwritten.`);
        process.exit(1);
    }
}

function readState() {
    if (cachedState) return cachedState;
    const raw = fs.existsSync(STATE_FILE) ? readJsonFileOrExit(STATE_FILE) : emptyState();
    const { state, changed } = normalizeState(raw);
    cachedState = state;
    if (changed) writeState(state);
    return cachedState;
}

async function flushToDisk() {
    writeTimeout = null;
    if (!isDirty || !cachedState || isFlushing) return;
    isDirty = false;
    isFlushing = true;
    try {
        await writeFileAtomic(STATE_FILE, JSON.stringify(cachedState));
        console.log('[Storage] State flushed to disk.');
    } catch (error) {
        console.error('[Storage] flush failed:', error.message);
        isDirty = true;
    } finally {
        isFlushing = false;
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

// Small JSON files live in memory and are mutated in place, then written back atomically.
// Handlers must not hold a copy across an await and write it back later: that is what used to
// drop concurrent updates (e.g. a photo uploaded while an AI annotation of another photo was running).
// Because of the cache, edit these files by hand only while the server is stopped.
function createJsonStore(file, createDefault, normalize) {
    let cache = null;
    return {
        read() {
            if (!cache) cache = normalize(fs.existsSync(file) ? readJsonFileOrExit(file) : createDefault());
            return cache;
        },
        write(data) {
            cache = data;
            writeFileAtomicSync(file, JSON.stringify(data));
        },
    };
}

const farmTaskStore = createJsonStore(FARM_TASKS_FILE, () => ({ tasks: [] }), data => {
    if (!Array.isArray(data.tasks)) data.tasks = [];
    data.tasks.forEach(item => {
        if (item && !item.tenantId) item.tenantId = DEFAULT_TENANT_ID;
    });
    return data;
});

function readFarmTasks() {
    return farmTaskStore.read();
}

function writeFarmTasks(data) {
    farmTaskStore.write(data);
}

function defaultPestLibrary() {
    const createdAt = '2026-04-26T00:00:00.000Z';
    return {
        entries: [
            { id: 'pest_aphid', type: 'pest', key: 'aphid', name: '蚜虫（菜蚜）', symptoms: '群集叶背刺吸汁液，叶片卷曲皱缩', control: '吡虫啉、啶虫脒等喷雾，注意叶背', createdAt, tenantId: DEFAULT_TENANT_ID },
            { id: 'pest_caterpillar', type: 'pest', key: 'caterpillar', name: '菜青虫/毛虫', symptoms: '幼虫啃食叶片，形成孔洞或缺刻', control: '氯虫苯甲酰胺、甲维盐等傍晚喷雾', createdAt, tenantId: DEFAULT_TENANT_ID },
            { id: 'pest_whitefly', type: 'pest', key: 'whitefly', name: '白粉虱', symptoms: '成虫聚集叶背，受害叶片发黄并可诱发煤污', control: '啶虫脒、螺虫乙酯等轮换喷雾', createdAt, tenantId: DEFAULT_TENANT_ID },
            { id: 'pest_mite', type: 'pest', key: 'mite', name: '红蜘蛛/螨虫', symptoms: '叶面出现失绿小斑点，严重时叶片发黄干枯', control: '阿维菌素、螺螨酯等喷雾', createdAt, tenantId: DEFAULT_TENANT_ID },
            { id: 'disease_leaf_spot', type: 'disease', key: 'leaf_spot', name: '叶斑病', symptoms: '叶片出现圆形或不规则褐色病斑', control: '代森锰锌、苯醚甲环唑等喷雾', createdAt, tenantId: DEFAULT_TENANT_ID },
            { id: 'disease_powdery_mildew', type: 'disease', key: 'powdery_mildew', name: '白粉病', symptoms: '叶面出现白色粉状霉层，影响光合作用', control: '醚菌酯、戊唑醇等喷雾', createdAt, tenantId: DEFAULT_TENANT_ID },
            { id: 'disease_downy_mildew', type: 'disease', key: 'downy_mildew', name: '霜霉病', symptoms: '叶面黄斑，叶背可见灰紫色霉层', control: '烯酰吗啉、霜脲氰等喷雾并降低湿度', createdAt, tenantId: DEFAULT_TENANT_ID },
        ],
    };
}

// Seeds the (platform-wide) pest library on a fresh database.
async function seedPestLibraryIfEmpty() {
    if ((await pestStore.list()).length) return;
    for (const entry of defaultPestLibrary().entries) {
        await pestStore.create(entry);
    }
}

function normalizePestLibraryKey(key) {
    let text = String(key || '').trim().toLowerCase();
    text = text.replace(/_/g, '-');
    text = text.replace(/\s*[\(（][^()（）]*[\)）]\s*/g, ' ');
    text = text.split('、')[0];
    text = text.replace(/\s+/g, '-');
    text = text.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
    if (text === 'phaneroptera-sinensis-uvarov') text = 'phaneroptera-sinensis';
    return text;
}

// photo-records.json now only supplies `config` (API keys, model names). Its old crops/records arrays are
// left untouched as a pre-migration backup; crops and photos live in PostgreSQL.
const photoConfigStore = createJsonStore(PHOTO_RECORDS_FILE, () => ({ config: {} }), data => {
    data.config = {
        amapKey: '',
        visionApiKey: '',
        visionModel: aiModels.VISION_MODEL,
        textModel: aiModels.TEXT_MODEL,
        ...(data.config || {}),
    };
    return data;
});

function readPhotoConfig() {
    return photoConfigStore.read().config;
}

function savePhotoConfig() {
    photoConfigStore.write(photoConfigStore.read());
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
        writeFileAtomicSync(STATE_FILE, JSON.stringify(cachedState));
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

// Account + password check shared by web login and WeChat binding, with the existing per-IP / per-account lockout.
// Returns { ok: true, user } or { ok: false, status, headers }.
async function passwordLogin(account, password, clientIp) {
    const accountKey = loginAccountKey(account);
    cleanupLoginFailures();
    const retryAfter = loginRetryAfterSeconds(clientIp, accountKey);
    if (retryAfter > 0) return { ok: false, status: 429, headers: { 'Retry-After': String(retryAfter) } };
    const user = account ? await userStore.getByAccount(account) : null;
    if (!user || user.status === 'disabled' || !(await verifyPassword(password, user.passwordHash))) {
        recordLoginFailure(clientIp, accountKey);
        return { ok: false, status: 401, headers: {} };
    }
    clearLoginFailures(clientIp, accountKey);
    await userStore.recordLogin(user.id);
    if (passwordNeedsRehash(user.passwordHash)) await userStore.setPasswordHash(user.id, await hashPassword(password));
    return { ok: true, user };
}

// Binding tickets: 10 minutes, single use, kept in memory. The client never sees the openid, so it cannot claim someone else's.
const BIND_TICKET_TTL_MS = 10 * 60 * 1000;
const BIND_TICKETS = new Map();
function issueBindTicket({ openid, unionid }) {
    const now = Date.now();
    for (const [id, t] of BIND_TICKETS) if (t.expiresAt <= now) BIND_TICKETS.delete(id);
    const id = crypto.randomBytes(24).toString('base64url');
    BIND_TICKETS.set(id, { id, openid, unionid, expiresAt: now + BIND_TICKET_TTL_MS });
    return id;
}
function takeBindTicket(id) {
    const t = BIND_TICKETS.get(id);
    BIND_TICKETS.delete(id);
    return t && t.expiresAt > Date.now() ? t : null;
}
function restoreBindTicket(t) {
    if (t.expiresAt > Date.now()) BIND_TICKETS.set(t.id, t);
}

function sendWechatError(sendJson, e) {
    if (!(e instanceof WechatError)) throw e;
    return sendJson(e.status, { ok: false, status: 'wechat_error', errcode: e.errcode ?? null, msg: e.message });
}

function userTenantId(user) {
    return user?.tenantId || DEFAULT_TENANT_ID;
}

function canAccessTenantItem(user, item) {
    if (!item) return false;
    if (user?.role === 'platform_admin') return true;
    return !item.tenantId || item.tenantId === userTenantId(user);
}

function scopedTenantRows(user, rows = []) {
    if (user?.role === 'platform_admin') return rows;
    const tenantId = userTenantId(user);
    return rows.filter(item => !item.tenantId || item.tenantId === tenantId);
}

// Tenant filter for PostgreSQL queries: null means "all farms" (platform admins).
function dbTenantId(user) {
    return user?.role === 'platform_admin' ? null : userTenantId(user);
}

function findVisibleDevice(state, user, deviceId) {
    return scopedTenantRows(user, state.devices || []).find(item => item.id === deviceId) || null;
}

async function operationalSnapshot(state, user) {
    const tenantId = user.role === 'platform_admin' ? null : user.tenantId;
    const scoped = rows => tenantId ? rows.filter(item => !item.tenantId || item.tenantId === tenantId) : rows;
    const devices = scoped(state.devices);
    const deviceIds = new Set(devices.map(item => item.id));
    // serverRealtime/realtimeState are keyed by deviceId and carry no tenantId of their own.
    const byVisibleDevice = map => tenantId
        ? Object.fromEntries(Object.entries(map || {}).filter(([deviceId]) => deviceIds.has(deviceId)))
        : (map || {});
    const sensorDeviceIds = devices.filter(item => item.type === 'sensor_soil_api').map(item => item.id);
    const readings = await sensorStore.recentPerDevice({ deviceIds: sensorDeviceIds, tenantId, perDevice: SNAPSHOT_ROWS_PER_DEVICE });
    return {
        locations: scoped(state.locations),
        devices,
        automations: scoped(state.automations),
        autoLog: scoped(state.autoLog),
        // Server-side per-device history moved to PostgreSQL (see sensorReadings / /device-history).
        history: {},
        serverRealtime: byVisibleDevice(state.serverRealtime),
        realtimeState: byVisibleDevice(state.realtimeState),
        channels: scoped(state.channels || []),
        sensorReadings: readings.map(sensorStore.toReading),
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

        // Readings of removed devices stay in PostgreSQL (hidden, recoverable by re-adding the device).
        if (removedIds.length) {
            const removed = new Set(removedIds);
            next.channels = (next.channels || []).filter(item => !removed.has(item.deviceId));
            ['serverRealtime', 'realtimeState'].forEach(key => {
                const bucket = next[key] || {};
                removedIds.forEach(id => delete bucket[id]);
                next[key] = bucket;
            });
        }
    }

    return next;
}

// Any malformed token is simply invalid (401), never a server error.
function verifyToken(token, secret) {
    if (!token || !token.includes('.')) return null;
    const [encoded, sig] = token.split('.');
    const expected = Buffer.from(crypto.createHmac('sha256', secret).update(encoded).digest('base64url'));
    const given = Buffer.from(sig || '');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    let payload;
    try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { return null; }
    if (!payload || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
}

function bearerToken(req) {
    const header = req.headers.authorization || '';
    return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

// Session tokens are 43 base64url characters. Tokens containing '.' are the old signed tokens (8 h lifetime): still
// accepted so a deploy does not sign everyone out. Remove the legacy branch (and verifyToken) in the next release.
async function getAuthUser(req) {
    const token = bearerToken(req);
    const state = readState();
    let userId = null, session = null;
    if (token.includes('.')) userId = verifyToken(token, state.authSecret)?.sub || null;
    else if (token) {
        session = await sessions.validate(token);
        userId = session?.userId || null;
    }
    const user = userId ? await userStore.get(userId) : null;
    // Mini program guest: signed in with WeChat but not bound to an account (public-data APIs only).
    const guest = session && !session.userId && session.openid ? { openid: session.openid } : null;
    return { state, user: user && user.status !== 'disabled' ? user : null, guest, session, token };
}

// Guests are limited per WeChat user; soil lookups start a reader process and weather may call Open-Meteo.
const GUEST_RATE_WINDOW_MS = 10 * 60 * 1000;
const GUEST_RATE_LIMIT = 120;
const GUEST_RATE = new Map();
function allowGuestRequest(openid, now = Date.now()) {
    if (GUEST_RATE.size > 10000) for (const [k, b] of GUEST_RATE) if (now - b.windowStart > GUEST_RATE_WINDOW_MS) GUEST_RATE.delete(k);
    const bucket = GUEST_RATE.get(openid);
    if (!bucket || now - bucket.windowStart > GUEST_RATE_WINDOW_MS) {
        GUEST_RATE.set(openid, { windowStart: now, count: 1 });
        return true;
    }
    bucket.count += 1;
    return bucket.count <= GUEST_RATE_LIMIT;
}

// Memoized per request: the first caller's limit applies, later callers get the same parsed body.
function readBody(req, limit = 1024 * 1024) {
    if (!req.bodyPromise) req.bodyPromise = readBodyOnce(req, limit);
    return req.bodyPromise;
}

function readBodyOnce(req, limit) {
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

function cleanAiJsonContent(value) {
    let text = String(value || '').trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return text;
}

function apiErrorMessage(result, fallback = 'Request failed') {
    const data = result?.data || {};
    const error = data.error && typeof data.error === 'object' ? data.error : null;
    const message = error?.message || data.message || data.msg || (typeof data.error === 'string' ? data.error : '') || fallback;
    const code = error?.code || data.code || data.error_code || '';
    const requestId = data.request_id || data.requestId || '';
    return [code, message, requestId ? `request_id=${requestId}` : ''].filter(Boolean).join(' | ');
}

function httpError(status, message, extra = {}) {
    const error = new Error(message);
    error.status = status;
    Object.assign(error, extra);
    return error;
}

async function fetchWeatherData(amapKey, lat, lng) {
    const key = String(amapKey || '').trim();
    if (!key) throw httpError(503, 'weather_api_not_configured', { error: 'weather_api_not_configured' });
    if (!lat || !lng) throw httpError(400, 'lat and lng required');
    const regeoUrl = `https://restapi.amap.com/v3/geocode/regeo?key=${encodeURIComponent(key)}&location=${encodeURIComponent(`${lng},${lat}`)}&output=json`;
    const regeo = await requestJson(regeoUrl, { method: 'GET' });
    if (regeo.data?.status !== '1') throw httpError(502, 'regeo_api_error', { error: 'regeo_api_error', info: regeo.data?.info });
    const adcode = regeo.data?.regeocode?.addressComponent?.adcode;
    if (!adcode) throw httpError(502, 'adcode_not_found', { error: 'adcode_not_found' });
    const weatherUrl = `https://restapi.amap.com/v3/weather/weatherInfo?key=${encodeURIComponent(key)}&city=${encodeURIComponent(adcode)}&extensions=base&output=json`;
    const result = await requestJson(weatherUrl, { method: 'GET' });
    if (result.data?.status !== '1' || !Array.isArray(result.data.lives) || !result.data.lives[0]) {
        throw httpError(502, 'weather_api_error', { error: 'weather_api_error', info: result.data?.info });
    }
    const now = result.data.lives[0];
    return {
        temp: Number(now.temperature),
        humidity: Number(now.humidity),
        condition: now.weather,
        windPower: String(now.windpower || ''),
        windDirection: String(now.winddirection || ''),
    };
}

async function runPhotoAnnotation(recordId, user, requestBody = {}) {
    const config = readPhotoConfig();
    const record = await photoStore.getRecord(recordId, dbTenantId(user));
    if (!record) throw httpError(404, 'record not found');
    const visionApiKey = String(config.visionApiKey || '').trim();
    const textModel = aiModels.textModel(config);
    if (!visionApiKey) throw httpError(503, 'vision_api_not_configured');

    const crop = (record.cropId && await photoStore.getCrop(record.cropId, null)) || {};
    const weather = record.weather || {};
    const weatherText = [
        weather.condition || '',
        weather.temp !== undefined ? `${weather.temp}°C` : '',
        weather.humidity !== undefined ? `湿度${weather.humidity}%` : '',
        weather.windPower ? `风力${weather.windPower}级` : '',
    ].filter(Boolean).join(' ') || '无';
    const sensorSummary = (record.linkedSensors || []).map(sensor => {
        const snapshots = Array.isArray(sensor.snapshots) ? sensor.snapshots : (sensor.snapshot ? [sensor.snapshot] : []);
        const latest = [...snapshots]
            .filter(Boolean)
            .sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0))
            .slice(-1)[0];
        if (!latest) return null;
        return `${sensor.deviceName || sensor.deviceId}: ${JSON.stringify(latest.values || {})}`;
    }).filter(Boolean).join('\n') || '无';
    const farmNotesText = String(requestBody.farmNotes || '').trim();
    const farmNotesLine = farmNotesText ? `\n农事记录：${farmNotesText}` : '';
    const severityTextMap = ['正常', '轻微', '中等', '严重'];
    const labelLines = [];
    const labels = record.labels || null;
    const libraryEntries = await pestStore.list();
    const pestNameMap = Object.fromEntries(libraryEntries.filter(item => item.type === 'pest').map(item => [item.key, item.name]));
    const diseaseNameMap = Object.fromEntries(libraryEntries.filter(item => item.type === 'disease').map(item => [item.key, item.name]));
    const weedNameMap = Object.fromEntries(libraryEntries.filter(item => item.type === 'weed').map(item => [item.key, item.name]));
    const labelList = value => Array.isArray(value) ? value.filter(Boolean) : (value ? [value] : []);
    if (labels) {
        if (Array.isArray(labels.visual) && labels.visual.length) {
            labelLines.push(`用户观察标签：${labels.visual.join(', ')}`);
        }
        if (labels.growthStage) {
            labelLines.push(`用户判断生长阶段：${labels.growthStage}`);
        }
        if (labels.severity !== null && labels.severity !== undefined) {
            const severity = Number(labels.severity);
            const severityText = Number.isInteger(severity) && severity >= 0 && severity <= 3 ? severityTextMap[severity] : String(labels.severity);
            labelLines.push(`用户判断严重程度：${severityText}(${labels.severity})`);
        }
        if (Array.isArray(labels.actions) && labels.actions.length) {
            const actionText = labels.actions.map(action => {
                const details = [action.name, action.dosage].filter(Boolean).join('，');
                return details ? `${action.type}（${details}）` : action.type;
            }).filter(Boolean).join('、');
            if (actionText) labelLines.push(`用户操作：${actionText}`);
        }
        if (labels.pestDetail) {
            const infestationMap = {
                scattered: '零星发现',
                moderate: '中等扩散',
                severe: '严重爆发',
            };
            const pestParts = [];
            pestParts.push(...labelList(labels.pestDetail.species).map(key => pestNameMap[key] || key));
            if (labels.pestDetail.infestation) {
                pestParts.push(infestationMap[labels.pestDetail.infestation] || labels.pestDetail.infestation);
            }
            if (pestParts.length) labelLines.push(`虫害详情：${pestParts.join('，')}`);
        }
        const diseaseTypes = labelList(labels.diseaseDetail?.types);
        if (diseaseTypes.length) {
            labelLines.push(`病害详情：${diseaseTypes.map(key => diseaseNameMap[key] || key).join('，')}`);
        }
        const weedTypes = labelList(labels.weedDetail?.types);
        if (weedTypes.length) {
            labelLines.push(`杂草详情：${weedTypes.map(key => weedNameMap[key] || key).join('，')}`);
        }
    }
    const labelsLine = labelLines.length ? `\n${labelLines.join('\n')}` : '';
    const detections = Array.isArray(record.aiDetections?.detections) ? record.aiDetections.detections : [];
    const detectionLine = detections.length ? `\nAI 区域检测结果：${detections.map(det => {
        const confidence = Number(det.confidence);
        const confidenceText = Number.isFinite(confidence) ? `(${Math.round(confidence * 100)}%)` : '';
        return `${det.label || 'unknown'}${confidenceText}`;
    }).join(', ')}` : '';
    const userPrompt = `作物：${record.cropName || crop.name || '未知作物'}（品种：${crop.variety || '未知'}）
拍摄时间：${record.createdAt || record.uploadedAt || '无'}
天气：${weatherText}
传感器摘要：${sensorSummary}
农户备注：${record.userNotes || '无'}${farmNotesLine}${labelsLine}${detectionLine}

请输出以下格式的 JSON 标注：
{
  "growthStage": "生长阶段（如苗期/分蘖期/拔节期/抽穗期/灌浆期/成熟期，不确定填null）",
  "symptoms": ["观察到的症状列表，无则空数组"],
  "affectedPart": "受影响部位（如叶片/根部/茎秆/果实，无则null）",
  "possibleCause": "可能原因（如病害/虫害/缺素/浇水过度/干旱，不确定填null）",
  "severity": severity等级数字（0=正常 1=轻微 2=中等 3=严重），
  "actions": ["建议或已执行操作列表，无则空数组"],
  "recommendedActions": ["可执行的农事操作列表，如浇水/施肥/除草，最多5条，无则空数组"],
  "tags": ["关键词标签列表，3个以内"]
}`;
    const body = JSON.stringify({
        model: textModel,
        enable_thinking: false,
        messages: [
            { role: 'system', content: '你是农业数据标注专家，负责将农户的田间观察备注转换为结构化标注数据。只输出 JSON，不要任何其他文字。' },
            { role: 'user', content: userPrompt },
        ],
    });
    const result = await requestJson('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
        method: 'POST',
        timeout: 60000,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${visionApiKey}`,
        },
    }, body);
    const content = result.data?.choices?.[0]?.message?.content || '';
    const cleanedContent = cleanAiJsonContent(content);
    let aiAnalysis;
    try {
        aiAnalysis = JSON.parse(cleanedContent);
    } catch {
        aiAnalysis = content;
    }
    await photoStore.setAiAnalysis(recordId, aiAnalysis);
    return { ok: true, aiAnalysis };
}

function parseQueryTime(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '') return fallback;
    const parsed = parseBeijing(String(value).trim());
    return Number.isFinite(parsed) ? parsed : fallback;
}

function channelKey(name = '', unit = '') {
    const text = `${name}_${unit}`.trim();
    return 'ch_' + crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
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

function roundReadingValue(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return value;
    return Number(value.toFixed(1));
}

// The project directory doubles as the web root, so everything that is not frontend must be refused explicitly:
// dotfiles (.env holds the database password, .git), server-side code and data, manifests and docs.
const PRIVATE_DIRS = new Set(['server-data', 'node_modules', 'lib', 'providers', 'db', 'scripts', 'tests', 'docs', 'pdf', 'design', 'miniprogram', 'miniprogram-design']);
const PRIVATE_FILES = new Set(['server.js', 'china-soil.js', 'clean.js', 'diag-cloud.js', 'package.json', 'package-lock.json']);
const PRIVATE_EXTENSIONS = new Set(['.md', '.py', '.sql', '.sh', '.txt', '.log', '.bak', '.tmp']);

function isPublicStaticPath(requested) {
    const segments = requested.split('/').filter(Boolean);
    if (!segments.length) return true;
    if (segments.some(segment => segment.startsWith('.'))) return false;
    if (PRIVATE_DIRS.has(segments[0])) return false;
    const file = segments[segments.length - 1];
    if (segments.length === 1 && PRIVATE_FILES.has(file)) return false;
    if (/\.bak-\d+$/.test(file)) return false;
    return !PRIVATE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function sensorDevices() {
    return (readState().devices || []).filter(dev => dev.type === 'sensor_soil_api' && dev.apiConfig && SENSOR_PROVIDERS.has(dev.provider || '0531yun'));
}

// Maps a provider snapshot onto channels and the in-memory realtime state (never stored as a reading here).
// Returns { values: {channelKey: n}, externalValues: {vendorName: n} } for the collector's hourly row.
function applySnapshot(dev, snapshot) {
    const state = readState();
    const channelMap = ensurePlatformChannels(state, dev, snapshot.nodes);
    const values = {};
    const externalValues = {};
    snapshot.nodes.forEach(node => {
        (node.registerItem || []).forEach(item => {
            const name = String(item.registerName || '').trim();
            if (!name) return;
            externalValues[name] = roundReadingValue(item.value);
            if (channelMap[name]) values[channelMap[name].key] = roundReadingValue(item.value);
        });
    });
    const receivedAt = Date.now();
    const provider = dev.provider || '0531yun';
    state.realtimeState[dev.id] = {
        ok: true,
        tenantId: dev.tenantId || DEFAULT_TENANT_ID,
        deviceId: dev.id,
        externalDeviceId: String(dev.apiConfig?.deviceAddr || dev.id),
        provider,
        deviceTimestamp: snapshot.ts,
        receivedAt,
        values,
        externalValues,
        source: 'realtime',
    };
    state.serverRealtime[dev.id] = {
        ok: true,
        timestamp: snapshot.ts,
        deviceTimestamp: snapshot.ts,
        recordTimeStr: snapshot.recordTimeStr || null,
        receivedAt,
        values: externalValues,
        channelValues: values,
        dataItems: snapshot.nodes,
    };
    const target = state.devices.find(x => x.id === dev.id);
    if (target) {
        target.online = true;
        target.lastSeenAt = receivedAt;
    }
    writeState(state);
    return { values, externalValues };
}

function markDeviceOnline(dev, online) {
    const current = readState();
    const target = current.devices.find(x => x.id === dev.id);
    if (!target || target.online === online) return;
    target.online = online;
    writeState(current);
}

const collector = createCollector({
    providers: SENSOR_PROVIDERS,
    listDevices: sensorDevices,
    applySnapshot,
    markOnline: markDeviceOnline,
    sensorStore,
    pollIntervalMs: CLOUD_POLL_INTERVAL_MS,
    snapshotHours: SNAPSHOT_HOURS,
});

// Viewers polling with force=true share one cloud request per device, at most once per LIVE_FETCH_MIN_INTERVAL_MS.
// Live values only refresh memory; storage happens on the hourly schedule.
function liveFetchDevice(dev) {
    const entry = LIVE_FETCHES.get(dev.id);
    if (entry?.promise) return entry.promise;
    if (entry && Date.now() - entry.startedAt < LIVE_FETCH_MIN_INTERVAL_MS) return Promise.resolve();
    const next = { startedAt: Date.now(), promise: null };
    next.promise = collector.refreshDevice(dev)
        .catch(error => console.error('[LiveFetch Error]', dev.id, error.message))
        .finally(() => { next.promise = null; });
    LIVE_FETCHES.set(dev.id, next);
    return next.promise;
}

// 小薯 agent. Tools reach data only through these functions; policy, guardrails and undo live in lib/agent.
const agentTools = createTools({
    readState, canAccessTenantItem, scopedTenantRows, userTenantId, dbTenantId, parseQueryTime, safeId,
    sensorStore, photoStore, pestStore, vision, readPhotoConfig, fetchWeatherData, runPhotoAnnotation,
    readFarmTasks, writeFarmTasks,
});
const agentSessions = createSessionStore();
const agentLlm = createLlm({ request: requestJson, apiKey: () => String(readPhotoConfig().visionApiKey || '').trim() });
const agent = createAgent({
    llm: agentLlm,
    tools: agentTools,
    sessions: agentSessions,
    actions: createActionLog({ db, tools: agentTools }),
    guard: createGuard({ llm: agentLlm, model: aiModels.GUARD_MODEL, fallbackModel: aiModels.textModel(readPhotoConfig()), log: console.warn }),
    models: { text: () => aiModels.textModel(readPhotoConfig()), vision: () => aiModels.visionModel(readPhotoConfig()) },
    farmContext: async user => {
        const devices = scopedTenantRows(user, readState().devices || []);
        const crops = await photoStore.listCrops(dbTenantId(user));
        return {
            deviceNames: devices.map(item => `${item.name || item.id}(${item.id})`).join('、') || '暂无设备',
            cropNames: crops.map(item => `${item.name || item.id}(${item.id})`).join('、') || '暂无作物',
        };
    },
    log: console.log,
});

const server = http.createServer(async (req, res) => {
    // Fixed base: the Host header is client-controlled and a malformed one makes new URL() throw.
    const myUrl = new URL(req.url, 'http://localhost');
    const pathname = myUrl.pathname.replace(/\/$/, '');
    const query = Object.fromEntries(myUrl.searchParams);

    const sendJson = (status, obj, extraHeaders = {}) => {
        res.writeHead(status, {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'authorization, content-type, x-target-base',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            ...extraHeaders,
        });
        res.end(JSON.stringify(obj));
    };

    const requireAuth = async () => {
        const auth = await getAuthUser(req);
        if (!auth.user) {
            sendJson(401, { ok: false, msg: 'Unauthorized' });
            return null;
        }
        return auth;
    };

    // Public-data APIs: an account, or a mini program guest (WeChat sign-in without binding), rate limited per WeChat user.
    const requireViewer = async () => {
        const auth = await getAuthUser(req);
        if (auth.user) return auth;
        if (auth.guest) {
            if (allowGuestRequest(auth.guest.openid)) return auth;
            sendJson(429, { ok: false, status: 'busy', msg: '查询太频繁，请稍后再试。' });
            return null;
        }
        sendJson(401, { ok: false, msg: 'Unauthorized' });
        return null;
    };

    const requireAdmin = async () => {
        const auth = await requireAuth();
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

        if (pathname === '/api/v1/harvest/soil' && req.method === 'GET') {
            const auth = await requireViewer(); if (!auth) return;
            const result = await chinaSoil.lookup(query.lat, query.lng);
            const status = result.ok ? 200 : result.status === 'invalid_coordinates' ? 400
                : ['outside_coverage', 'no_data'].includes(result.status) ? 422 : 503;
            return sendJson(status, result);
        }

        if (pathname === '/api/v1/harvest/weather' && req.method === 'GET') {
            const auth = await requireViewer(); if (!auth) return;
            const result = await harvestWeather.lookup(query);
            return sendJson(result.status, result.body);
        }

        if (pathname === '/api/v1/auth/login' && req.method === 'POST') {
            const body = await readBody(req);
            const account = String(body.account || '').trim();
            const result = await passwordLogin(account, String(body.password || ''), realClientIp(req));
            if (!result.ok) return sendJson(result.status, { ok: false, msg: 'Invalid account or password' }, result.headers);
            const { token } = await sessions.create(result.user.id, 'web', { ip: realClientIp(req), userAgent: req.headers['user-agent'] });
            return sendJson(200, { ok: true, accessToken: token, user: publicUser(result.user) });
        }

        if (pathname === '/api/v1/auth/logout' && req.method === 'POST') {
            const token = bearerToken(req);
            if (token && !token.includes('.')) await sessions.revoke(token);
            return sendJson(200, { ok: true });
        }

        if (pathname === '/api/v1/auth/me') {
            const auth = await requireAuth();
            if (!auth) return;
            return sendJson(200, { ok: true, user: publicUser(auth.user), wechat: await userStore.listWechat(auth.user.id) });
        }

        // ---- WeChat mini program (docs/auth-design.md §4.4). Accounts are created by an admin; the mini program binds to one.
        // An unbound WeChat gets a guest session (public-data APIs only), so viewers never have to bind. {bind: true} (the bind
        // page) also returns a single-use bind ticket.
        // Through the Cloud Hosting gateway WeChat has already verified the user; the openid arrives signed, no code needed.
        const wechatGatewayLogin = pathname === '/api/v1/auth/wechat/gateway-login' && req.method === 'POST';
        if ((pathname === '/api/v1/auth/wechat/login' && req.method === 'POST') || wechatGatewayLogin) {
            const body = await readBody(req);
            let who;
            if (wechatGatewayLogin) {
                const trusted = gatewayTrust(req);
                if (!trusted?.openid) return sendJson(401, { ok: false, msg: 'Unauthorized' });
                who = { openid: trusted.openid, unionid: null };
            } else {
                try { who = await wechatMini.code2Session(body.code); }
                catch (e) { return sendWechatError(sendJson, e); }
            }
            const user = await userStore.findByWechat(who.openid);
            if (user && user.status !== 'disabled') {
                const { token } = await sessions.create(user.id, 'miniprogram', { ip: realClientIp(req), userAgent: req.headers['user-agent'] });
                return sendJson(200, { ok: true, accessToken: token, user: publicUser(user) });
            }
            if (user) return sendJson(403, { ok: false, status: 'disabled', msg: '该账号已停用，请联系管理员。' });
            const { token } = await sessions.create(null, 'miniprogram', { openid: who.openid, ip: realClientIp(req), userAgent: req.headers['user-agent'] });
            return sendJson(200, { ok: true, guest: true, accessToken: token, user: null, ...(body.bind === true ? { bindTicket: issueBindTicket(who) } : {}) });
        }

        if (pathname === '/api/v1/auth/wechat/bind' && req.method === 'POST') {
            const body = await readBody(req);
            const ticket = takeBindTicket(String(body.bindTicket || ''));
            if (!ticket) return sendJson(401, { ok: false, status: 'ticket_expired', msg: '绑定已超时，请重新打开小程序再试。' });
            const account = String(body.account || '').trim();
            const result = await passwordLogin(account, String(body.password || ''), realClientIp(req));
            if (!result.ok) {
                restoreBindTicket(ticket); // a wrong password should not force a fresh wx.login
                return sendJson(result.status, { ok: false, status: 'bad_credentials', msg: '账号或密码不对。' }, result.headers);
            }
            const outcome = await userStore.bindWechat(result.user.id, ticket.openid, ticket.unionid);
            if (outcome === 'taken') return sendJson(409, { ok: false, status: 'taken', msg: '这个微信已绑定其他账号，请先在原账号里解绑。' });
            if (outcome === 'limit') return sendJson(409, { ok: false, status: 'limit', msg: '这个账号绑定的微信已达上限（5 个），请先在网页上解绑不用的。' });
            const { token } = await sessions.create(result.user.id, 'miniprogram', { ip: realClientIp(req), userAgent: req.headers['user-agent'] });
            return sendJson(200, { ok: true, accessToken: token, user: publicUser(result.user) });
        }

        // Mini program: unbind this WeChat. The openid comes signed from the gateway, or from a fresh wx.login code, so only
        // the phone holding this WeChat can unbind itself.
        // Web: DELETE with ?id=<binding id> from /auth/me, or no id to unbind all.
        if (pathname === '/api/v1/auth/wechat/binding' && req.method === 'DELETE') {
            const auth = await requireAuth();
            if (!auth) return;
            const gatewayOpenid = gatewayTrust(req)?.openid;
            if (gatewayOpenid || query.code) {
                let openid = gatewayOpenid;
                if (!openid) {
                    try { openid = (await wechatMini.code2Session(query.code)).openid; }
                    catch (e) { return sendWechatError(sendJson, e); }
                }
                await userStore.unbindWechatByOpenid(auth.user.id, openid);
                await sessions.revoke(auth.token);
            } else {
                await userStore.unbindWechat(auth.user.id, query.id || null);
                // Sessions are not tied to an openid, so unbinding from the web signs out every mini program session.
                await sessions.revokeUser(auth.user.id, 'miniprogram');
            }
            return sendJson(200, { ok: true, wechat: await userStore.listWechat(auth.user.id) });
        }

        if (pathname === '/api/v1/users') {
            const auth = await requireAdmin();
            if (!auth) return;
            if (req.method === 'GET') {
                return sendJson(200, { ok: true, users: (await userStore.list()).map(publicUser) });
            }
            if (req.method === 'POST') {
                const body = await readBody(req);
                const account = String(body.account || '').trim();
                const password = String(body.password || '');
                if (!account || !password) return sendJson(400, { ok: false, msg: 'Account and password are required' });
                const role = body.role === 'platform_admin' ? 'platform_admin' : 'tenant_admin';
                const name = String(body.name || account).trim();
                try {
                    const user = await userStore.create({
                        id: safeId('user'),
                        tenantId: body.tenantId || (role === 'platform_admin' ? DEFAULT_TENANT_ID : tenantIdForAccount(account)),
                        tenantName: name,
                        account,
                        name,
                        role,
                        status: body.status === 'disabled' ? 'disabled' : 'active',
                        agentDebug: body.agentDebug === true,
                        passwordHash: await hashPassword(password),
                    });
                    return sendJson(201, { ok: true, user: publicUser(user) });
                } catch (e) {
                    if (e.code === '23505') return sendJson(409, { ok: false, msg: 'Account already exists' });
                    throw e;
                }
            }
        }

        if (pathname.startsWith('/api/v1/users/')) {
            const auth = await requireAdmin();
            if (!auth) return;
            const userId = decodeURIComponent(pathname.split('/').pop());
            const user = await userStore.get(userId);
            if (!user) return sendJson(404, { ok: false, msg: 'User not found' });

            if (req.method === 'PUT') {
                const body = await readBody(req);
                const role = body.role === 'platform_admin' ? 'platform_admin' : 'tenant_admin';
                const status = body.status === 'disabled' ? 'disabled' : 'active';
                const patch = {
                    name: String(body.name || user.name || user.account).trim(),
                    role,
                    status,
                    agentDebug: typeof body.agentDebug === 'boolean' ? body.agentDebug : user.agentDebug === true,
                    tenantId: body.tenantId || user.tenantId || DEFAULT_TENANT_ID,
                    passwordHash: body.password ? await hashPassword(String(body.password)) : null,
                };
                if (user.role === 'platform_admin' && user.status === 'active' && (role !== 'platform_admin' || status === 'disabled')
                    && await userStore.countActiveAdmins() <= 1) {
                    return sendJson(400, { ok: false, msg: 'Cannot demote or disable the last admin' });
                }
                const updated = await userStore.update(user.id, patch);
                // New password, disabled account or changed permissions: every existing session of that user ends.
                if (patch.passwordHash || status !== user.status || role !== user.role || patch.tenantId !== user.tenantId) {
                    await sessions.revokeUser(user.id);
                }
                return sendJson(200, { ok: true, user: publicUser(updated) });
            }

            if (req.method === 'DELETE') {
                if (user.id === auth.user.id) return sendJson(400, { ok: false, msg: 'Cannot delete current user' });
                if (user.role === 'platform_admin' && user.status === 'active' && await userStore.countActiveAdmins() <= 1) {
                    return sendJson(400, { ok: false, msg: 'Cannot delete last admin' });
                }
                await sessions.revokeUser(user.id);
                await userStore.remove(user.id);
                return sendJson(200, { ok: true });
            }
        }

        if (pathname === '/api/v1/app-state') {
            const auth = await requireAuth();
            if (!auth) return;
            if (req.method === 'PUT') {
                const body = await readBody(req, 10 * 1024 * 1024);
                // 安全护栏：拒绝“空客户端”把整库覆盖成空（曾两次导致数据被清空）
                const incomingEmpty = !(Array.isArray(body.locations) && body.locations.length)
                    && !(Array.isArray(body.devices) && body.devices.length)
                    && !(Array.isArray(body.automations) && body.automations.length);
                if (incomingEmpty && ((auth.state.locations || []).length || (auth.state.devices || []).length)) {
                    return sendJson(200, { ok: true, skipped: 'empty-sync-ignored' });
                }
                writeState(mergeOperationalState(auth.state, body, auth.user));
                return sendJson(200, { ok: true });
            }
            return sendJson(200, await operationalSnapshot(auth.state, auth.user));
        }

        if (pathname === '/api/v1/cloud-devices') {
            const auth = await requireAuth();
            if (!auth) return;
            const accessCode = String(query.accessCode || '').trim();
            const apiUrl = String(query.apiUrl || DEFAULT_TARGET_BASE).trim() || DEFAULT_TARGET_BASE;
            if (!accessCode) return sendJson(400, { ok: false, msg: 'accessCode is required' });
            try {
                const list = await cloud0531.listDevices(accessCode, apiUrl);
                const devices = list.map(item => ({
                    ...item,
                    provider: cloud0531.id,
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
            const auth = await requireAuth();
            if (!auth) return;
            const deviceId = String(query.deviceId || '').trim();
            if (!deviceId) return sendJson(400, { ok: false, msg: 'deviceId is required' });
            const dev = findVisibleDevice(auth.state, auth.user, deviceId);
            if (!dev) return sendJson(404, { ok: false, msg: 'Device not found' });

            const force = String(query.force || '').toLowerCase() === 'true';
            if (force && dev.type === 'sensor_soil_api' && dev.apiConfig) {
                await liveFetchDevice(dev);
            }
            const rt = readState().serverRealtime?.[deviceId];
            return sendJson(200, rt || { ok: false, msg: 'No realtime data yet' });
        }

        if (pathname === '/api/v1/device-history') {
            const auth = await requireAuth();
            if (!auth) return;
            const deviceId = String(query.deviceId || '').trim();
            if (!deviceId) return sendJson(400, { ok: false, msg: 'deviceId is required' });
            if (!findVisibleDevice(auth.state, auth.user, deviceId)) return sendJson(404, { ok: false, msg: 'Device not found' });
            const requestedLimit = Number(query.limit);
            // Default covers 30 days of hourly rows, the longest chart range.
            const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(Math.floor(requestedLimit), 5000) : 1000;
            const rows = await sensorStore.deviceHistory({
                deviceId,
                tenantId: dbTenantId(auth.user),
                start: parseQueryTime(query.startTime, NaN),
                end: parseQueryTime(query.endTime, NaN),
                limit,
                order: String(query.order || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc',
            });
            return sendJson(200, { deviceId, rows: rows.map(sensorStore.toHistoryRow) });
        }

        if (pathname === '/api/v1/readings') {
            const auth = await requireAuth();
            if (!auth) return;
            const deviceId = String(query.deviceId || '').trim();
            const limit = Math.min(Number(query.limit) || 500, 5000);
            const visible = scopedTenantRows(auth.user, auth.state.devices || []).map(item => item.id);
            const deviceIds = deviceId ? visible.filter(id => id === deviceId) : visible;
            let rows = (await sensorStore.recentReadings({ deviceIds, tenantId: dbTenantId(auth.user), limit })).map(sensorStore.toReading);
            if (String(query.order || 'desc').toLowerCase() === 'asc') rows = rows.reverse();
            return sendJson(200, { ok: true, rows });
        }

        if (pathname === '/api/v1/cloud-history-sync') {
            const auth = await requireAuth();
            if (!auth) return;
            const { deviceId, startTime, endTime } = query;
            if (!deviceId || !startTime || !endTime) return sendJson(400, { ok: false, msg: 'deviceId, startTime and endTime required' });
            const start = parseQueryTime(startTime, NaN);
            const end = parseQueryTime(endTime, NaN);
            if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return sendJson(400, { ok: false, msg: 'Invalid time range' });
            const dev = findVisibleDevice(auth.state, auth.user, deviceId);
            const provider = dev && SENSOR_PROVIDERS.get(dev.provider || '0531yun');
            if (!dev || !dev.apiConfig || !provider) return sendJson(404, { ok: false, msg: 'Device not found' });
            if (HISTORY_SYNCS_IN_PROGRESS.has(deviceId)) return sendJson(429, { ok: false, msg: 'Sync already in progress' });
            HISTORY_SYNCS_IN_PROGRESS.add(deviceId);
            try {
                const snapshots = await provider.fetchHistory(dev, start, end);
                // Re-check after the cloud requests: the device may have been removed meanwhile.
                if (!findVisibleDevice(readState(), auth.user, deviceId)) return sendJson(404, { ok: false, msg: 'Device not found' });
                const state = readState();
                const rows = snapshots.map(snapshot => {
                    const channelMap = ensurePlatformChannels(state, dev, snapshot.nodes);
                    const values = {};
                    const externalValues = {};
                    snapshot.nodes.forEach(node => (node.registerItem || []).forEach(item => {
                        externalValues[item.registerName] = roundReadingValue(item.value);
                        if (channelMap[item.registerName]) values[channelMap[item.registerName].key] = roundReadingValue(item.value);
                    }));
                    return { snapshot, values, externalValues };
                });
                writeState(state);
                const inserted = await sensorStore.insertReadings(rows.map(({ snapshot, values, externalValues }) => ({
                    tenantId: dev.tenantId || DEFAULT_TENANT_ID,
                    deviceId: dev.id,
                    provider: provider.id,
                    ts: snapshot.ts,
                    kind: 'history_sync',
                    values,
                    externalValues,
                })));
                // A fresh newest record also refreshes the realtime panel (never downgrade to an older one).
                const newest = snapshots[0];
                const currentTs = Number(readState().serverRealtime?.[dev.id]?.deviceTimestamp);
                if (newest && newest.ts >= Date.now() - 2 * CLOUD_POLL_INTERVAL_MS && (!Number.isFinite(currentTs) || newest.ts >= currentTs)) {
                    applySnapshot(dev, newest);
                }
                return sendJson(200, {
                    ok: true,
                    list: rows.map(({ snapshot, externalValues }) => ({ time: snapshot.recordTimeStr, values: externalValues })),
                    inserted,
                });
            } catch (error) {
                return sendJson(502, { ok: false, msg: error.message || 'Cloud request failed' });
            } finally {
                HISTORY_SYNCS_IN_PROGRESS.delete(deviceId);
            }
        }

        if (pathname === '/api/v1/pest-library' && req.method === 'GET') {
            const auth = await requireAuth(); if (!auth) return;
            const type = String(query.type || '').trim();
            const entries = (await pestStore.list(['pest', 'disease', 'weed'].includes(type) ? type : ''))
                .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'));
            return sendJson(200, { ok: true, entries });
        }

        if (pathname === '/api/v1/pest-library/ai-fill' && req.method === 'POST') {
            const auth = await requireAuth(); if (!auth) return;
            const body = await readBody(req).catch(() => ({}));
            const name = String(body.name || '').trim();
            const rawType = String(body.type || '').trim();
            const type = rawType === 'disease' ? 'disease' : (rawType === 'weed' ? 'weed' : 'pest');
            if (!name) return sendJson(400, { ok: false, msg: 'name required' });

            const config = readPhotoConfig();
            const visionApiKey = String(config.visionApiKey || '').trim();
            const textModel = aiModels.textModel(config);
            if (!visionApiKey) return sendJson(503, { ok: false, msg: 'vision_api_not_configured' });

            const userPrompt = type === 'disease'
                ? `病害名称：${name}。请输出以下 JSON：{ "key": "英文标识（kebab-case 格式，如 brown-spot）", "symptoms": "发病症状（1-2句中文描述）", "control": "药剂防治建议（1-2句中文描述）" }`
                : (type === 'weed'
                    ? `杂草名称：${name}。请输出以下 JSON：{ "key": "英文标识（kebab-case 格式，如 cyperus-rotundus）", "symptoms": "识别要点（1-2句中文描述）", "control": "防控建议（1-2句中文描述，可为空）" }`
                    : `害虫名称：${name}。请输出以下 JSON：{ "key": "英文标识（kebab-case 格式，如 striped-flea-beetle）", "symptoms": "为害症状（1-2句中文描述）", "control": "药剂防治建议（1-2句中文描述）" }`);
            const requestBody = JSON.stringify({
                model: textModel,
                enable_thinking: false,
                messages: [
                    { role: 'system', content: '你是农业植保专家，根据用户提供的中文名称，输出该害虫、病害或杂草的结构化信息。只输出 JSON，不要任何其他文字。' },
                    { role: 'user', content: userPrompt },
                ],
            });

            try {
                const result = await requestJson('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
                    method: 'POST',
                    timeout: 60000,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${visionApiKey}`,
                    },
                }, requestBody);
                if (result.status >= 400) throw new Error(apiErrorMessage(result, 'AI fill failed'));
                const content = result.data?.choices?.[0]?.message?.content || '';
                const parsed = JSON.parse(cleanAiJsonContent(content));
                const suggestion = {
                    key: String(parsed.key || '').trim(),
                    symptoms: String(parsed.symptoms || '').trim(),
                    control: String(parsed.control || '').trim(),
                };
                return sendJson(200, { ok: true, suggestion });
            } catch (error) {
                return sendJson(502, { ok: false, msg: error.message || 'AI fill failed' });
            }
        }

        if (pathname === '/api/v1/pest-library' && req.method === 'POST') {
            const auth = await requireAuth(); if (!auth) return;
            if (auth.user.role !== 'platform_admin') return sendJson(403, { ok: false, msg: 'admin only' });
            const body = await readBody(req).catch(() => ({}));
            const type = String(body.type || '').trim();
            const key = String(body.key || '').trim();
            const name = String(body.name || '').trim();
            if (!['pest', 'disease', 'weed'].includes(type) || !key || !name) {
                return sendJson(400, { ok: false, msg: 'type, key and name required' });
            }
            try {
                const entry = await pestStore.create({
                    id: safeId(type),
                    type,
                    key,
                    name,
                    symptoms: String(body.symptoms || ''),
                    control: String(body.control || ''),
                    updatedBy: auth.user.id,
                });
                return sendJson(201, { ok: true, entry });
            } catch (error) {
                if (error.status === 409) return sendJson(409, { ok: false, msg: error.message });
                throw error;
            }
        }


        if (pathname.startsWith('/api/v1/pest-library/') && req.method === 'PUT') {
            const auth = await requireAuth(); if (!auth) return;
            if (auth.user.role !== 'platform_admin') return sendJson(403, { ok: false, msg: 'admin only' });
            const id = pathname.split('/')[4];
            const body = await readBody(req).catch(() => ({}));
            if (body.name !== undefined && !String(body.name || '').trim()) return sendJson(400, { ok: false, msg: 'key and name required' });
            const entry = await pestStore.update(id, {
                type: ['pest', 'disease', 'weed'].includes(String(body.type)) ? String(body.type) : undefined,
                name: body.name !== undefined ? String(body.name).trim() : undefined,
                symptoms: body.symptoms !== undefined ? String(body.symptoms || '') : undefined,
                control: body.control !== undefined ? String(body.control || '') : undefined,
            }, auth.user.id);
            if (!entry) return sendJson(404, { ok: false, msg: 'entry not found' });
            return sendJson(200, { ok: true, entry });
        }

        if (pathname.startsWith('/api/v1/pest-library/') && req.method === 'DELETE') {
            const auth = await requireAuth(); if (!auth) return;
            if (auth.user.role !== 'platform_admin') return sendJson(403, { ok: false, msg: 'admin only' });
            const id = pathname.split('/')[4];
            if (!(await pestStore.remove(id))) return sendJson(404, { ok: false, msg: 'entry not found' });
            return sendJson(200, { ok: true });
        }

        if (pathname === '/api/v1/farm-tasks/calendar' && req.method === 'GET') {
            const auth = await requireAuth(); if (!auth) return;
            const year = Number(query.year);
            const month = Number(query.month);
            if (!Number.isFinite(year) || !Number.isFinite(month)) {
                return sendJson(400, { ok: false, msg: 'year and month required' });
            }
            const prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-`;
            const ft = readFarmTasks();
            const calendar = {};
            scopedTenantRows(auth.user, ft.tasks || []).forEach(task => {
                const date = String(task.date || '');
                if (!date.startsWith(prefix)) return;
                calendar[date] = (calendar[date] || 0) + 1;
            });
            return sendJson(200, { ok: true, calendar });
        }

        if (pathname === '/api/v1/farm-tasks' && req.method === 'GET') {
            const auth = await requireAuth(); if (!auth) return;
            const date = String(query.date || '').trim();
            const ft = readFarmTasks();
            const tasks = scopedTenantRows(auth.user, ft.tasks || [])
                .filter(task => String(task.date || '') === date)
                .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
            return sendJson(200, { ok: true, tasks });
        }

        if (pathname === '/api/v1/farm-tasks' && req.method === 'POST') {
            const auth = await requireAuth(); if (!auth) return;
            const body = await readBody(req);
            const title = String(body.title || '').trim();
            const date = String(body.date || '').trim();
            if (!title || !date) return sendJson(400, { ok: false, msg: 'title and date required' });
            const ft = readFarmTasks();
            const task = {
                id: safeId('task'),
                title,
                category: String(body.category || '').trim(),
                type: body.type === 'ai' ? 'ai' : 'user',
                date,
                status: 'pending',
                completedAt: null,
                aiReason: null,
                createdAt: Date.now(),
                tenantId: userTenantId(auth.user)
            };
            // Optional plot link (mini program plot detail). Only a plot this user can see is accepted.
            const locationId = String(body.locationId || '').trim();
            if (locationId) {
                if (!scopedTenantRows(auth.user, auth.state.locations || []).some(item => item.id === locationId)) {
                    return sendJson(400, { ok: false, msg: 'unknown locationId' });
                }
                task.locationId = locationId;
            }
            ft.tasks.push(task);
            writeFarmTasks(ft);
            return sendJson(201, { ok: true, task });
        }

        if (pathname.startsWith('/api/v1/farm-tasks/') && req.method === 'PUT') {
            const auth = await requireAuth(); if (!auth) return;
            const id = pathname.split('/')[4];
            const body = await readBody(req);
            const ft = readFarmTasks();
            const task = (ft.tasks || []).find(item => item.id === id && canAccessTenantItem(auth.user, item));
            if (!task) return sendJson(404, { ok: false, msg: 'task not found' });
            ['title', 'status', 'completedAt', 'date', 'category', 'createdAt'].forEach(key => {
                if (body[key] !== undefined) task[key] = body[key];
            });
            writeFarmTasks(ft);
            return sendJson(200, { ok: true, task });
        }

        if (pathname.startsWith('/api/v1/farm-tasks/') && req.method === 'DELETE') {
            const auth = await requireAuth(); if (!auth) return;
            const id = pathname.split('/')[4];
            const ft = readFarmTasks();
            const task = (ft.tasks || []).find(item => item.id === id && canAccessTenantItem(auth.user, item));
            if (!task) return sendJson(404, { ok: false, msg: 'task not found' });
            ft.tasks = (ft.tasks || []).filter(item => item.id !== id);
            writeFarmTasks(ft);
            return sendJson(200, { ok: true });
        }

        if (pathname === '/api/v1/photos/crops') {
            const auth = await requireAuth(); if (!auth) return;

            if (req.method === 'GET') {
                return sendJson(200, { ok: true, crops: await photoStore.listCrops(dbTenantId(auth.user)) });
            }
            if (req.method === 'POST') {
                const body = await readBody(req);
                if (!body.name) return sendJson(400, { ok: false, msg: 'name required' });
                const crop = await photoStore.createCrop({
                    id: safeId('crop'),
                    tenantId: userTenantId(auth.user),
                    name: String(body.name).trim(),
                    variety: String(body.variety || '').trim(),
                    locationId: String(body.locationId || '').trim(),
                    locationDesc: String(body.locationDesc || '').trim(),
                    createdBy: auth.user.id,
                });
                return sendJson(201, { ok: true, crop });
            }
            if (req.method === 'DELETE') {
                const body = await readBody(req).catch(() => ({}));
                const cropId = String(query.id || body.id || '').trim();
                if (!cropId) return sendJson(400, { ok: false, msg: 'id required' });
                if (!(await photoStore.deleteCrop(cropId, dbTenantId(auth.user)))) return sendJson(404, { ok: false, msg: 'crop not found' });
                return sendJson(200, { ok: true });
            }
        }

        if (pathname === '/api/v1/photos/records' && req.method === 'POST') {
            const auth = await requireAuth(); if (!auth) return;
            const body = await readBody(req, 15 * 1024 * 1024); // 15MB limit
            if (!body.cropId || !body.imageBase64) {
                return sendJson(400, { ok: false, msg: 'cropId and imageBase64 required' });
            }
            const crop = await photoStore.getCrop(String(body.cropId), dbTenantId(auth.user));
            if (!crop) {
                return sendJson(404, { ok: false, msg: 'crop not found' });
            }

            // Decode and store the uploaded image.
            const imgBuffer = Buffer.from(
                String(body.imageBase64).replace(/^data:image\/\w+;base64,/, ''), 'base64'
            );
            let meta;
            try {
                meta = await sharp(imgBuffer).metadata();
            } catch {
                return sendJson(400, { ok: false, msg: 'invalid image' });
            }
            const uploadedAt = new Date();
            const observedAt = body.createdAt ? new Date(body.createdAt) : null;
            const capturedAt = observedAt && Number.isFinite(observedAt.getTime()) ? observedAt : null;
            const storageDate = capturedAt || uploadedAt;
            const yearMonth = `${storageDate.getFullYear()}-${String(storageDate.getMonth() + 1).padStart(2, '0')}`;
            const dir = path.join(PHOTOS_DIR, yearMonth);
            await fs.promises.mkdir(dir, { recursive: true });
            const id = safeId('photo');
            await fs.promises.writeFile(path.join(dir, `${id}.jpg`), imgBuffer);
            const rotated = (meta.orientation || 1) >= 5;

            const record = await photoStore.createPhoto({
                id,
                tenantId: crop.tenantId,
                cropId: crop.id,
                cropName: crop.name,
                source: 'upload',
                uploadedBy: auth.user.id,
                capturedAt,
                uploadedAt,
                imagePath: `server-data/photos/${yearMonth}/${id}.jpg`,
                width: rotated ? meta.height : meta.width,
                height: rotated ? meta.width : meta.height,
                bytes: imgBuffer.length,
                sha256: crypto.createHash('sha256').update(imgBuffer).digest('hex'),
                gps: body.gps || null,
                weather: body.weather || null,
                linkedSensors: Array.isArray(body.linkedSensors) ? body.linkedSensors : [],
                userNotes: String(body.userNotes || ''),
                farmNotes: String(body.farmNotes || ''),
                labels: body.labels || null,
                annotations: Array.isArray(body.annotations) ? body.annotations : [],
                actor: { userId: auth.user.id },
            });
            return sendJson(201, { ok: true, record });
        }

        if (pathname === '/api/v1/photos/records' && req.method === 'GET') {
            const auth = await requireAuth(); if (!auth) return;
            const records = await photoStore.listPhotos({ tenantId: dbTenantId(auth.user), cropId: query.cropId || null });
            return sendJson(200, { ok: true, records });
        }

        if (pathname === '/api/v1/photos/records' && req.method === 'DELETE') {
            const auth = await requireAuth(); if (!auth) return;
            const body = await readBody(req).catch(() => ({}));
            const recordId = String(query.id || body.id || '').trim();
            if (!recordId) return sendJson(400, { ok: false, msg: 'id required' });
            if (!(await photoStore.softDeletePhoto(recordId, dbTenantId(auth.user)))) return sendJson(404, { ok: false, msg: 'record not found' });
            return sendJson(200, { ok: true });
        }

        if (pathname === '/api/v1/photos/review-queue' && req.method === 'GET') {
            const auth = await requireAdmin(); if (!auth) return;
            return sendJson(200, { ok: true, records: await photoStore.reviewQueue() });
        }

        const photoRecordMatch = pathname.match(/^\/api\/v1\/photos\/records\/([^/]+)(?:\/([a-z-]+))?$/);

        if (photoRecordMatch && !photoRecordMatch[2] && req.method === 'PUT') {
            const auth = await requireAuth(); if (!auth) return;
            const id = decodeURIComponent(photoRecordMatch[1]);
            const body = await readBody(req).catch(() => ({}));
            const record = await photoStore.updatePhoto(id, dbTenantId(auth.user), {
                farmNotes: body.farmNotes,
                labels: body.labels,
                annotations: body.annotations === undefined ? undefined : (Array.isArray(body.annotations) ? body.annotations : []),
            }, { userId: auth.user.id });
            if (!record) return sendJson(404, { ok: false, msg: 'record not found' });
            void embeddingWorker?.tick(); // newly confirmed boxes become identification samples
            return sendJson(200, { ok: true, record });
        }

        if (photoRecordMatch && photoRecordMatch[2] === 'image') {
            const auth = await requireAuth(); if (!auth) return;
            const photo = await photoStore.getPhotoRow(decodeURIComponent(photoRecordMatch[1]), dbTenantId(auth.user));
            if (!photo) return sendJson(404, { ok: false, msg: 'not found' });
            const imgPath = path.join(__dirname, photo.image_path);
            if (!fs.existsSync(imgPath)) return sendJson(404, { ok: false, msg: 'file missing' });
            res.writeHead(200, {
                'Content-Type': 'image/jpeg',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'max-age=86400'
            });
            return fs.createReadStream(imgPath).pipe(res);
        }

        if (photoRecordMatch && photoRecordMatch[2] === 'annotate' && req.method === 'POST') {
            const auth = await requireAuth(); if (!auth) return;
            const requestBody = await readBody(req).catch(() => ({}));
            try {
                const result = await runPhotoAnnotation(decodeURIComponent(photoRecordMatch[1]), auth.user, requestBody);
                return sendJson(200, result);
            } catch (error) {
                return sendJson(error.status || 502, { ok: false, msg: error.message || 'Annotation failed' });
            }
        }

        // 专家审核：只有平台管理员能做。通过 = 给这张照片上所有农户已确认的框盖章；撤销 = 清掉盖章。
        if (photoRecordMatch && photoRecordMatch[2] === 'expert-review' && req.method === 'POST') {
            const auth = await requireAdmin(); if (!auth) return;
            const body = await readBody(req).catch(() => ({}));
            const record = await photoStore.expertReview(decodeURIComponent(photoRecordMatch[1]), body.approve !== false, auth.user.id);
            if (!record) return sendJson(404, { ok: false, msg: 'record not found' });
            void embeddingWorker?.tick();
            return sendJson(200, { ok: true, record });
        }

        if (photoRecordMatch && photoRecordMatch[2] === 'identify' && req.method === 'GET') {
            const auth = await requireAuth(); if (!auth) return;
            const result = JSON.parse(await agentTools.runRead('identify_pest', { recordId: decodeURIComponent(photoRecordMatch[1]) }, auth.user));
            if (result.error) return sendJson(404, { ok: false, msg: result.error });
            return sendJson(200, { ok: true, ...result });
        }

        if (photoRecordMatch && photoRecordMatch[2] === 'detect-regions' && req.method === 'POST') {
            const auth = await requireAuth(); if (!auth) return;
            const id = decodeURIComponent(photoRecordMatch[1]);
            const photo = await photoStore.getPhotoRow(id, dbTenantId(auth.user));
            if (!photo) return sendJson(404, { ok: false, msg: 'record not found' });
            const config = readPhotoConfig();
            const visionApiKey = String(config.visionApiKey || '').trim();
            const visionModel = aiModels.visionModel(config);
            if (!visionApiKey) return sendJson(503, { ok: false, msg: 'vision_api_not_configured' });
            console.log(`[Detect Regions] record=${id} model=${visionModel}`);

            const imgPath = path.join(__dirname, photo.image_path || '');
            if (!fs.existsSync(imgPath)) return sendJson(404, { ok: false, msg: 'file missing' });
            const imageDataUrl = `data:image/jpeg;base64,${(await fs.promises.readFile(imgPath)).toString('base64')}`;
            const allowedLabels = [
                'insect_visible', 'insect_damage', 'leaf_holes', 'leaf_yellowing',
                'leaf_browning', 'leaf_wilting', 'leaf_curling', 'disease_spot', 'white_powder',
                'soil_crack', 'soil_too_wet', 'weed', 'stem_damage'
            ];
            const detectPrompt = `你是农业图像检测专家。请检测照片中所有可见异常区域，并只输出 JSON，不要任何解释文字。

任务要求：
- 输出每个异常区域的 bbox：[x1, y1, x2, y2]，即左上角和右下角，坐标为相对图片宽高的 0–1000 归一化值（左上角是 0,0，右下角是 1000,1000）。
- label 只能从以下标签中选择：${allowedLabels.join(', ')}
- 可选 category 包括 pest、disease、weed、plant_abnormal、soil、other；检测到杂草时 label 使用 weed，category 使用 weed。不要输出具体杂草种类作为 label，具体种类由用户在标签编辑里选择。
- bbox 必须是目标的最小外接矩形，紧贴可见边缘，四周留白尽量小于目标宽高的 5%。
- 只框可直接看见的证据，不要框整片叶子、整株作物、整块田地或推测性的影响范围。
- 如果同一张叶片上有多个分散异常，请输出多个小 bbox，不要用一个大 bbox 包住它们。
- 对于 insect_visible：bbox 只包住虫体本身；如果有多只虫，每只虫单独一个框；不要包含被虫咬过的叶片面积。
- 对于 insect_damage：bbox 只包住清晰可见的咬痕、孔洞边缘或啃食缺口；不要框完整叶片，也不要把多个相距较远的咬痕合并成一个大框。
- 对于 leaf_holes/disease_spot/white_powder：只框可见孔洞、病斑或白粉覆盖区域，避免包含正常叶面。
- 一个区域只标一个最具体的标签，不要对同一位置重复标多个标签。
- 如果无法确定目标边界，请宁可不输出该 detection，也不要输出很大的粗略框。
- confidence 为 0 到 1 的数字。
- note 为简短中文描述。
- 当 label 为 insect_visible 或 insect_damage 时，额外输出 pestGuess 字段；其他 label 不要输出 pestGuess。
- pestGuess 用于害虫种类推测，结构为 { "name": "中文虫种名", "reasoning": "判断依据" }。
- pestGuess.name 请根据图像特征自由输出可能的害虫种类，不限于固定词表；无法判断时填 "未知害虫"。
- pestGuess.reasoning 为 1-2 句中文简短判断依据。
- 如果图片正常或无法确认异常，返回空 detections 数组。

输出格式：
{ "detections": [
  { "label": "insect_visible", "bbox": [x1, y1, x2, y2], "confidence": 0.86, "note": "简短描述", "pestGuess": { "name": "斜纹夜蛾", "reasoning": "判断依据" } },
  { "label": "leaf_holes", "bbox": [x1, y1, x2, y2], "confidence": 0.72, "note": "简短描述" }
] }`;
            const body = JSON.stringify({
                model: visionModel,
                enable_thinking: false,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'image_url', image_url: { url: imageDataUrl } },
                            { type: 'text', text: detectPrompt },
                        ],
                    },
                ],
            });
            try {
                const result = await requestJson('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${visionApiKey}`,
                    },
                }, body);
                if (result.status >= 400) throw new Error(apiErrorMessage(result, 'Region detection failed'));
                const content = result.data?.choices?.[0]?.message?.content || '';
                const cleanedContent = cleanAiJsonContent(content);
                let parsed;
                try {
                    parsed = JSON.parse(cleanedContent);
                } catch {
                    parsed = content;
                }
                if (Array.isArray(parsed?.detections)) {
                    const meta = await sharp(imgPath).metadata();
                    const turned = meta.orientation >= 5; // EXIF 5–8: displayed rotated by 90°
                    const [w, h] = turned ? [meta.height, meta.width] : [meta.width, meta.height];
                    parsed.detections = parsed.detections
                        .map(det => ({ ...det, bbox: aiModels.detectionBoxToPixels(det?.bbox, w, h) }))
                        .filter(det => det.bbox);
                }
                const record = await photoStore.replaceAiDetections(id, dbTenantId(auth.user), parsed, visionModel);
                if (!record) return sendJson(404, { ok: false, msg: 'record not found' });
                const detectionCount = Array.isArray(record.aiDetections?.detections) ? record.aiDetections.detections.length : 0;
                console.log(`[Detect Regions] parsed detections=${detectionCount}`);
                return sendJson(200, { ok: true, aiDetections: record.aiDetections, annotations: record.annotations });
            } catch (error) {
                console.warn(`[Detect Regions] failed record=${id}:`, error.message || error);
                return sendJson(502, { ok: false, msg: error.message || 'Region detection failed' });
            }
        }

        const regionMatch = pathname.match(/^\/api\/v1\/photos\/regions\/(\d+)\/(crop|similar)$/);
        if (regionMatch && req.method === 'GET') {
            const auth = await requireAuth(); if (!auth) return;
            const regionId = regionMatch[1];
            const { rows } = await db.query(
                `SELECT r.id, r.crop_path, r.photo_id FROM photo_regions r JOIN photos p ON p.id = r.photo_id
                 WHERE r.id = $1 AND p.deleted_at IS NULL ${dbTenantId(auth.user) ? 'AND p.tenant_id = $2' : ''}`,
                dbTenantId(auth.user) ? [regionId, dbTenantId(auth.user)] : [regionId]
            );
            const region = rows[0];
            if (!region) return sendJson(404, { ok: false, msg: 'region not found' });
            if (regionMatch[2] === 'crop') {
                const cropPath = region.crop_path && path.join(__dirname, region.crop_path);
                if (!cropPath || !fs.existsSync(cropPath)) return sendJson(404, { ok: false, msg: 'crop not ready' });
                res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=86400' });
                return fs.createReadStream(cropPath).pipe(res);
            }
            // 以图搜图：只在本农场内搜（平台管理员可看全部）
            const limit = Math.min(Math.max(Number(query.limit) || 12, 1), 50);
            return sendJson(200, { ok: true, regionId, results: await vision.similarRegions(regionId, dbTenantId(auth.user), limit) });
        }

        if (pathname === '/api/v1/photos/sensor-range' && req.method === 'GET') {
            const auth = await requireAuth(); if (!auth) return;
            const { deviceId, startTime, endTime } = query;
            if (!deviceId || !startTime || !endTime) {
                return sendJson(400, { ok: false, msg: 'deviceId, startTime and endTime required' });
            }
            const startTs = parseQueryTime(startTime, Number.NaN);
            const endTs = parseQueryTime(endTime, Number.NaN);
            if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) {
                return sendJson(400, { ok: false, msg: 'Invalid time range' });
            }
            const state = readState();
            if (!findVisibleDevice(state, auth.user, deviceId)) return sendJson(404, { ok: false, msg: 'Device not found' });
            const units = {};
            (state.channels || []).filter(c => c.deviceId === deviceId).forEach(c => { units[c.displayName] = c.unit; });
            const rows = await sensorStore.deviceHistory({ deviceId, tenantId: dbTenantId(auth.user), start: startTs, end: endTs, limit: 5000 });
            const readings = rows.map(sensorStore.toHistoryRow).map(r => ({
                ts: r.ts,
                snapshotTimeStr: r.recordTimeStr,
                values: r.values,
                units,
            }));
            return sendJson(200, { ok: true, deviceId, startTime, endTime, readings });
        }

        if (pathname === '/api/v1/photos/sensor-snapshot' && req.method === 'GET') {
            const auth = await requireAuth(); if (!auth) return;
            const { deviceId, timestamp } = query;
            if (!deviceId || !timestamp) return sendJson(400, { ok: false, msg: 'deviceId and timestamp required' });
            const targetTs = parseQueryTime(timestamp, Number.NaN);
            if (!Number.isFinite(targetTs)) return sendJson(400, { ok: false, msg: 'Invalid timestamp' });
            const state = readState();
            if (!findVisibleDevice(state, auth.user, deviceId)) return sendJson(404, { ok: false, msg: 'Device not found' });
            const closest = await sensorStore.closestReading({ deviceId, tenantId: dbTenantId(auth.user), ts: targetTs });
            if (!closest) return sendJson(404, { ok: false, msg: 'no readings for device' });
            const reading = sensorStore.toHistoryRow(closest);
            const units = {};
            (state.channels || []).filter(c => c.deviceId === deviceId).forEach(c => { units[c.displayName] = c.unit; });
            return sendJson(200, { ok: true,
                deviceId, selectedTimestamp: timestamp,
                snapshotTs: reading.ts,
                snapshotTimeStr: new Date(reading.ts).toISOString(),
                values: reading.values,
                units
            });
        }

        if (pathname === '/api/v1/photos/config') {
            const auth = await requireAuth(); if (!auth) return;
            const config = readPhotoConfig();

            if (req.method === 'GET') {
                // Return masked config values to the frontend.
                return sendJson(200, { ok: true, config: {
                    amapKey: (config.amapKey || config.qweatherKey) ? '***' : '',
                    visionApiKey: config.visionApiKey ? '***' : '',
                    visionModel: aiModels.visionModel(config),
                    textModel: aiModels.textModel(config)
                }});
            }
            if (req.method === 'PUT') {
                if (auth.user.role !== 'platform_admin') {
                    return sendJson(403, { ok: false, msg: 'admin only' });
                }
                const body = await readBody(req);
                if (body.amapKey !== undefined && body.amapKey !== '***')
                    config.amapKey = body.amapKey;
                if (body.visionApiKey !== undefined && body.visionApiKey !== '***')
                    config.visionApiKey = body.visionApiKey;
                if (body.visionModel) config.visionModel = body.visionModel;
                if (body.textModel) config.textModel = body.textModel;
                savePhotoConfig();
                return sendJson(200, { ok: true });
            }
        }

        if (pathname === '/api/v1/photos/weather' && req.method === 'GET') {
            const auth = await requireAuth(); if (!auth) return;
            const { lat, lng } = query;
            if (!lat || !lng) return sendJson(400, { ok: false, msg: 'lat and lng required' });
            const config = readPhotoConfig();
            const amapKey = config.amapKey || config.qweatherKey || '';
            if (!amapKey) return sendJson(503, { ok: false, error: 'weather_api_not_configured' });
            try {
                const weather = await fetchWeatherData(amapKey, lat, lng);
                return sendJson(200, { ok: true, weather: {
                    fetchedAt: new Date().toISOString(),
                    ...weather,
                    source: 'amap'
                }});
            } catch(e) {
                return sendJson(e.status || 502, { ok: false, error: e.error || 'weather_fetch_failed', info: e.info });
            }
        }

        // 小薯 (web and mini program, accounts and WeChat guests): see lib/agent/index.js.
        if (pathname === '/api/v1/agent/chat' && req.method === 'POST') {
            const auth = await requireViewer(); if (!auth) return;
            const body = await readBody(req, 8 * 1024 * 1024).catch(() => ({}));
            const result = await agent.chat({
                auth,
                sessionId: String(body.sessionId || ''),
                // The web sends `message`; the mini program sends `text`, an optional `image` and, in older builds, `history`.
                text: body.message !== undefined ? body.message : body.text,
                image: body.image,
                history: body.history,
                ip: realClientIp(req),
            });
            return sendJson(result.status, result.body);
        }

        const agentUndoMatch = pathname.match(/^\/api\/v1\/agent\/actions\/([^/]+)\/undo$/);
        if (agentUndoMatch && req.method === 'POST') {
            const auth = await requireAuth(); if (!auth) return;
            const result = await agent.undo({ auth, actionId: decodeURIComponent(agentUndoMatch[1]), ip: realClientIp(req) });
            return sendJson(result.status, result.body);
        }

        if (pathname === '/api/v1/agent/chat' && req.method === 'DELETE') {
            const auth = await requireViewer(); if (!auth) return;
            const body = await readBody(req).catch(() => ({}));
            agent.clear({ auth, sessionId: body.sessionId });
            return sendJson(200, { ok: true });
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

        if (pathname === '/server-data' || pathname.startsWith('/server-data/')) {
            res.writeHead(403);
            return res.end();
        }
        const requested = pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '');
        if (!isPublicStaticPath(requested)) {
            res.writeHead(404);
            return res.end();
        }
        const resolved = path.resolve(__dirname, requested);
        if (!resolved.startsWith(path.resolve(__dirname))) {
            res.writeHead(403);
            return res.end();
        }
        if (fs.existsSync(resolved) && fs.lstatSync(resolved).isFile()) {
            res.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary' }[path.extname(resolved).toLowerCase()] || 'text/plain; charset=utf-8' });
            return fs.createReadStream(resolved).pipe(res);
        }
        res.writeHead(404);
        res.end();
    } catch (e) {
        console.error('[Request Error]', e);
        if (!res.writableEnded) sendJson(500, { ok: false, msg: e.message });
    }
});

setInterval(() => {
    const now = Date.now();
    agentSessions.sweep();
}, 5 * 60 * 1000);

let embeddingWorker = null;

// Refuses to start when app-state.json still holds readings that were never imported into PostgreSQL:
// normalizeState() drops them from the JSON file on the first save.
async function assertReadingsMigrated() {
    if (!fs.existsSync(STATE_FILE) || process.env.ALLOW_DROP_JSON_READINGS === '1') return;
    const raw = readJsonFileOrExit(STATE_FILE);
    const pending = (raw.sensorReadings || []).filter(item => item && Object.keys(item.values || {}).length).length;
    if (!pending) return;
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM sensor_readings WHERE kind = 'migrated'`);
    if (rows[0].n > 0) return;
    console.error(`[Storage] FATAL: app-state.json still has ${pending} readings that are not in PostgreSQL. `
        + 'Run `node scripts/backfill-from-json.js` first (or set ALLOW_DROP_JSON_READINGS=1 to discard them).');
    process.exit(1);
}

async function start() {
    await db.migrate();
    await assertReadingsMigrated();
    // Load every data file up front so a corrupt file stops startup instead of failing (or being overwritten) later.
    readState();
    const importedUsers = await userStore.importFromState(readState());
    if (importedUsers) console.log(`[AUTH] imported ${importedUsers} accounts from app-state.json into PostgreSQL`);
    const sweepSessions = () => sessions.removeExpired().catch(error => console.error('[AUTH] session cleanup failed:', error.message));
    sweepSessions();
    setInterval(sweepSessions, 3600000).unref();
    readFarmTasks();
    if (!fs.existsSync(PHOTO_RECORDS_FILE)) savePhotoConfig();
    readPhotoConfig();
    await seedPestLibraryIfEmpty();

    server.listen(PORT, '127.0.0.1', () => {
        console.log(`[SERVER] RUNNING ON ${PORT}`);
        console.log(`[AUTH] Default admin: admin / ${DEFAULT_ADMIN_PASSWORD}`);
    });
    collector.start().catch(error => console.error('[Collector] start failed:', error.message));
    vision.configure({
        rootDir: __dirname,
        requestJson,
        getApiKey: () => String(readPhotoConfig().visionApiKey || '').trim(),
    });
    embeddingWorker = vision.startEmbeddingWorker();
}

start().catch(error => {
    console.error('[SERVER] startup failed:', error.message);
    process.exit(1);
});
