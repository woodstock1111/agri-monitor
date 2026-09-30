'use strict';
// Password hashing. OWASP (2023+) recommends PBKDF2-HMAC-SHA256 with 600k iterations. New hashes carry their iteration
// count ('pbkdf2-sha256$600000$salt$hash'); legacy 'pbkdf2$salt$hash' hashes (120k) still verify and are upgraded after
// the next successful login (passwordNeedsRehash). Async: runs on the libuv pool, so concurrent logins never block the
// event loop, and at most UV_THREADPOOL_SIZE (default 4) hashes run at once.
const crypto = require('crypto');
const { promisify } = require('util');

const pbkdf2 = promisify(crypto.pbkdf2);
const ITERATIONS = 600000;
const LEGACY_ITERATIONS = 120000;

async function hashPassword(password, iterations = ITERATIONS) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await pbkdf2(String(password), salt, iterations, 32, 'sha256');
    return `pbkdf2-sha256$${iterations}$${salt}$${hash.toString('hex')}`;
}

// Only seeds the default admin in app-state.json before the one-time import into PostgreSQL.
function hashPasswordLegacy(password, salt = crypto.randomBytes(16).toString('hex')) {
    return `pbkdf2$${salt}$${crypto.pbkdf2Sync(String(password), salt, LEGACY_ITERATIONS, 32, 'sha256').toString('hex')}`;
}

function passwordNeedsRehash(encoded) {
    return !String(encoded || '').startsWith(`pbkdf2-sha256$${ITERATIONS}$`);
}

async function verifyPassword(password, encoded) {
    const parts = String(encoded || '').split('$');
    let iterations, salt, expected;
    if (parts[0] === 'pbkdf2' && parts.length === 3) [iterations, salt, expected] = [LEGACY_ITERATIONS, parts[1], parts[2]];
    else if (parts[0] === 'pbkdf2-sha256' && parts.length === 4) [iterations, salt, expected] = [Number(parts[1]), parts[2], parts[3]];
    else return false;
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10000000 || !/^[0-9a-f]{64}$/.test(expected)) return false;
    const actual = await pbkdf2(String(password), salt, iterations, 32, 'sha256');
    return crypto.timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

module.exports = { hashPassword, hashPasswordLegacy, verifyPassword, passwordNeedsRehash, ITERATIONS };
