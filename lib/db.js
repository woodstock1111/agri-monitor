const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

let pool = null;

function getPool() {
    if (pool) return pool;
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: Number(process.env.DATABASE_POOL_MAX || 10),
        idleTimeoutMillis: 30000,
    });
    pool.on('error', error => console.error('[DB] idle client error:', error.message));
    return pool;
}

function query(text, params) {
    return getPool().query(text, params);
}

async function withTransaction(fn) {
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

// Applies db/migrations/*.sql in filename order, each in its own transaction, once.
async function migrate(log = console.log) {
    await query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied = new Set((await query('SELECT version FROM schema_migrations')).rows.map(row => row.version));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(name => name.endsWith('.sql')).sort();
    for (const file of files) {
        const version = file.replace(/\.sql$/, '');
        if (applied.has(version)) continue;
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        await withTransaction(async client => {
            await client.query(sql);
            await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        });
        log(`[DB] applied migration ${version}`);
    }
}

async function close() {
    if (pool) await pool.end();
    pool = null;
}

module.exports = { getPool, query, withTransaction, migrate, close };
