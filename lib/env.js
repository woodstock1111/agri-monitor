const fs = require('fs');
const path = require('path');

// Minimal .env loader (KEY=VALUE per line, # comments). Existing process.env values win,
// so pm2 / shell settings override the file.
function loadEnv(file = path.join(__dirname, '..', '.env')) {
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!match || line.trim().startsWith('#')) continue;
        const [, key, raw] = match;
        const value = raw.replace(/^(['"])(.*)\1$/, '$2');
        if (process.env[key] === undefined) process.env[key] = value;
    }
}

module.exports = { loadEnv };
