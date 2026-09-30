'use strict';
// Accounts, farms (tenants) and WeChat bindings in PostgreSQL. Returns users in the shape the server has always used:
// { id, tenantId, account, name, role: 'platform_admin' | 'tenant_admin', status, agentDebug, passwordHash, ... }.
// The DB keeps role as platform_role/farm_role (001_init.sql); the mapping lives only here.
const crypto = require('crypto');

const MAX_WECHAT_PER_USER = 5;

function rowToUser(r) {
    if (!r) return null;
    return {
        id: r.id,
        tenantId: r.tenant_id,
        account: r.account,
        name: r.name,
        role: r.platform_role === 'admin' ? 'platform_admin' : 'tenant_admin',
        status: r.status,
        agentDebug: r.agent_debug,
        passwordHash: r.password_hash,
        phone: r.phone,
        lastLoginAt: r.last_login_at ? r.last_login_at.toISOString() : null,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
    };
}

function roleColumns(role) {
    return role === 'platform_admin' ? { platform: 'admin', farm: 'owner' } : { platform: null, farm: 'owner' };
}

function createUserStore(db) {
    async function ensureTenant(client, id, name) {
        await client.query('INSERT INTO tenants (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [id, name || id]);
    }

    return {
        async list() {
            const { rows } = await db.query('SELECT * FROM users ORDER BY created_at, id');
            return rows.map(rowToUser);
        },
        async get(id) {
            const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
            return rowToUser(rows[0]);
        },
        async getByAccount(account) {
            const { rows } = await db.query('SELECT * FROM users WHERE account = $1', [account]);
            return rowToUser(rows[0]);
        },
        // Creates the farm too when it does not exist yet. Throws { code: '23505' } when the account is taken.
        async create(user) {
            return db.withTransaction(async client => {
                await ensureTenant(client, user.tenantId, user.tenantName || user.name);
                const r = roleColumns(user.role);
                const { rows } = await client.query(
                    `INSERT INTO users (id, tenant_id, account, name, password_hash, farm_role, platform_role, status, agent_debug)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
                    [user.id, user.tenantId, user.account, user.name, user.passwordHash, r.farm, r.platform, user.status, !!user.agentDebug]);
                return rowToUser(rows[0]);
            });
        },
        async update(id, patch) {
            return db.withTransaction(async client => {
                if (patch.tenantId) await ensureTenant(client, patch.tenantId, patch.name);
                const r = patch.role ? roleColumns(patch.role) : null;
                const { rows } = await client.query(
                    `UPDATE users SET
                        name = COALESCE($2, name), tenant_id = COALESCE($3, tenant_id),
                        platform_role = CASE WHEN $4::boolean THEN $5 ELSE platform_role END,
                        status = COALESCE($6, status), agent_debug = COALESCE($7, agent_debug),
                        password_hash = COALESCE($8, password_hash), updated_at = now()
                     WHERE id = $1 RETURNING *`,
                    [id, patch.name ?? null, patch.tenantId ?? null, !!r, r ? r.platform : null, patch.status ?? null,
                        patch.agentDebug ?? null, patch.passwordHash ?? null]);
                return rowToUser(rows[0]);
            });
        },
        async remove(id) {
            await db.query('DELETE FROM users WHERE id = $1', [id]);
        },
        async countActiveAdmins() {
            const { rows } = await db.query(`SELECT count(*)::int AS n FROM users WHERE platform_role = 'admin' AND status = 'active'`);
            return rows[0].n;
        },
        async recordLogin(id) {
            await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [id]);
        },
        // Password upgrade after a successful login; never touches updated_at semantics beyond the hash.
        async setPasswordHash(id, passwordHash) {
            await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, passwordHash]);
        },

        // ---- WeChat mini program bindings
        async findByWechat(openid) {
            const { rows } = await db.query(
                `SELECT u.* FROM user_identities i JOIN users u ON u.id = i.user_id
                 WHERE i.provider = 'wechat_mini' AND i.provider_uid = $1`, [openid]);
            if (!rows[0]) return null;
            await db.query(`UPDATE user_identities SET last_used_at = now() WHERE provider = 'wechat_mini' AND provider_uid = $1`, [openid]);
            return rowToUser(rows[0]);
        },
        async listWechat(userId) {
            const { rows } = await db.query(
                `SELECT id, created_at, last_used_at FROM user_identities WHERE user_id = $1 AND provider = 'wechat_mini' ORDER BY created_at`, [userId]);
            return rows.map(r => ({ id: r.id, createdAt: r.created_at.toISOString(), lastUsedAt: r.last_used_at ? r.last_used_at.toISOString() : null }));
        },
        // Returns 'bound' | 'already_yours' | 'taken' (another account has this WeChat) | 'limit'.
        // The unique constraint settles concurrent binds of the same WeChat; the per-user limit is checked under a row lock.
        async bindWechat(userId, openid, unionid = null) {
            return db.withTransaction(async client => {
                await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
                const { rows: existing } = await client.query(
                    `SELECT user_id FROM user_identities WHERE provider = 'wechat_mini' AND provider_uid = $1`, [openid]);
                if (existing[0]) return existing[0].user_id === userId ? 'already_yours' : 'taken';
                const { rows: count } = await client.query(
                    `SELECT count(*)::int AS n FROM user_identities WHERE user_id = $1 AND provider = 'wechat_mini'`, [userId]);
                if (count[0].n >= MAX_WECHAT_PER_USER) return 'limit';
                const { rowCount } = await client.query(
                    `INSERT INTO user_identities (id, user_id, provider, provider_uid, unionid, last_used_at)
                     VALUES ($1, $2, 'wechat_mini', $3, $4, now()) ON CONFLICT (provider, provider_uid) DO NOTHING`,
                    [`ident_${crypto.randomBytes(8).toString('hex')}`, userId, openid, unionid]);
                return rowCount ? 'bound' : 'taken';
            });
        },
        async unbindWechat(userId, identityId = null) {
            const { rowCount } = identityId
                ? await db.query(`DELETE FROM user_identities WHERE user_id = $1 AND provider = 'wechat_mini' AND id = $2`, [userId, identityId])
                : await db.query(`DELETE FROM user_identities WHERE user_id = $1 AND provider = 'wechat_mini'`, [userId]);
            return rowCount;
        },
        async unbindWechatByOpenid(userId, openid) {
            const { rowCount } = await db.query(
                `DELETE FROM user_identities WHERE user_id = $1 AND provider = 'wechat_mini' AND provider_uid = $2`, [userId, openid]);
            return rowCount;
        },

        // One-time import of app-state.json accounts. Runs only while the users table is empty, so an account deleted
        // later in PostgreSQL is never resurrected from the old file.
        async importFromState(state) {
            return db.withTransaction(async client => {
                await client.query('LOCK TABLE users IN EXCLUSIVE MODE');
                const { rows } = await client.query('SELECT count(*)::int AS n FROM users');
                if (rows[0].n > 0) return 0;
                for (const t of state.tenants || []) await ensureTenant(client, t.id, t.name);
                let imported = 0;
                for (const u of state.users || []) {
                    if (!u || !u.id || !u.account || !u.passwordHash) continue;
                    await ensureTenant(client, u.tenantId, u.name || u.account);
                    const r = roleColumns(u.role);
                    await client.query(
                        `INSERT INTO users (id, tenant_id, account, name, password_hash, farm_role, platform_role, status, agent_debug,
                             last_login_at, created_at, updated_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::timestamptz, now()), COALESCE($12::timestamptz, now()))`,
                        [u.id, u.tenantId, u.account, u.name || u.account, u.passwordHash, r.farm, r.platform,
                            u.status === 'disabled' ? 'disabled' : 'active', u.agentDebug === true,
                            u.lastLoginAt || null, u.createdAt || null, u.updatedAt || null]);
                    imported++;
                }
                return imported;
            });
        },
    };
}

module.exports = { createUserStore, MAX_WECHAT_PER_USER };
