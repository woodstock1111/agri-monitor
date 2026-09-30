'use strict';
// Server-side sessions (docs/auth-design.md §4.2, after The Copenhagen Book / Lucia):
// - the token is 32 random bytes (base64url); the database keeps only sha256(token), so a leaked table holds no usable tokens;
// - sessions last 7 days on the web and 30 days in the mini program, and are extended when less than half the time is left
//   (the only write on the request path);
// - validation is cached in memory for up to 60 s; revoking clears the cache in this process;
// - a mini program guest session has no account, only the WeChat openid (public-data APIs only).
const crypto = require('crypto');

const DAY = 24 * 3600000;
const TTL = { web: 7 * DAY, miniprogram: 30 * DAY };
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');

function createPgSessionStore(db) {
    return {
        async insert(s) {
            await db.query('INSERT INTO sessions (id, user_id, wechat_openid, client, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                [s.id, s.userId, s.openid, s.client, new Date(s.expiresAt), s.ip, s.userAgent]);
        },
        async get(id) {
            const { rows } = await db.query('SELECT user_id, wechat_openid, client, expires_at FROM sessions WHERE id = $1', [id]);
            const r = rows[0];
            return r ? { userId: r.user_id, openid: r.wechat_openid, client: r.client, expiresAt: r.expires_at.getTime() } : null;
        },
        async extend(id, expiresAt) {
            await db.query('UPDATE sessions SET expires_at = $2 WHERE id = $1', [id, new Date(expiresAt)]);
        },
        async remove(id) {
            await db.query('DELETE FROM sessions WHERE id = $1', [id]);
        },
        async removeUser(userId, client = null) {
            if (client) await db.query('DELETE FROM sessions WHERE user_id = $1 AND client = $2', [userId, client]);
            else await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
        },
        async removeExpired() {
            const { rowCount } = await db.query('DELETE FROM sessions WHERE expires_at < now()');
            return rowCount;
        },
    };
}

function createSessionService({ store, now = () => Date.now(), cacheMs = 60000, maxCache = 10000 } = {}) {
    const cache = new Map(); // id -> { userId, client, expiresAt, cachedAt }

    function remember(id, s) {
        if (cache.size >= maxCache) cache.delete(cache.keys().next().value);
        cache.set(id, { ...s, cachedAt: now() });
    }

    return {
        // userId null + openid: a mini program guest.
        async create(userId, client, { ip = null, userAgent = null, openid = null } = {}) {
            if (!TTL[client]) throw new Error('unknown client ' + client);
            if (!userId && !(openid && client === 'miniprogram')) throw new Error('a session needs an account or a mini program openid');
            const token = crypto.randomBytes(32).toString('base64url');
            const s = { id: hashToken(token), userId: userId || null, openid: openid || null, client, expiresAt: now() + TTL[client], ip,
                userAgent: userAgent ? String(userAgent).slice(0, 300) : null };
            await store.insert(s);
            return { token, expiresAt: s.expiresAt };
        },
        // Returns { userId, openid, client, expiresAt } or null (userId is null for a guest). Malformed tokens are rejected without touching the database.
        async validate(token) {
            if (typeof token !== 'string' || !TOKEN.test(token)) return null;
            const id = hashToken(token), t = now();
            let s = cache.get(id);
            if (!s || t - s.cachedAt > cacheMs) {
                s = await store.get(id);
                if (!s) { cache.delete(id); return null; }
                remember(id, s);
            }
            if (s.expiresAt <= t) { cache.delete(id); return null; }
            const ttl = TTL[s.client];
            if (s.expiresAt - t < ttl / 2) {
                const expiresAt = t + ttl;
                await store.extend(id, expiresAt);
                s = { ...s, expiresAt };
                remember(id, s);
            }
            return { userId: s.userId, openid: s.openid || null, client: s.client, expiresAt: s.expiresAt };
        },
        async revoke(token) {
            if (typeof token !== 'string' || !TOKEN.test(token)) return;
            const id = hashToken(token);
            cache.delete(id);
            await store.remove(id);
        },
        // Password change, disable, role change, unbinding: every session of the user (optionally one client type).
        async revokeUser(userId, client = null) {
            for (const [id, s] of cache) if (s.userId === userId && (!client || s.client === client)) cache.delete(id);
            await store.removeUser(userId, client);
        },
        removeExpired: () => store.removeExpired(),
    };
}

module.exports = { createSessionService, createPgSessionStore, hashToken, TTL };
