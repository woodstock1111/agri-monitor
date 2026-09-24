require('../lib/env').loadEnv();
const db = require('../lib/db');

db.migrate()
    .then(() => console.log('[DB] schema up to date'))
    .catch(error => { console.error('[DB] migration failed:', error.message); process.exitCode = 1; })
    .finally(() => db.close());
