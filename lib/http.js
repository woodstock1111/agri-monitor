const http = require('http');
const https = require('https');

// Some vendor APIs wrap JSON in stray bytes (BOM, trailing garbage), so the body is trimmed to the outermost {...} / [...].
function requestJson(targetUrl, options, bodyStr = null) {
    return new Promise((resolve, reject) => {
        const client = targetUrl.startsWith('https') ? https : http;
        const req = client.request(targetUrl, { ...options, timeout: options.timeout || 15000 }, (res) => {
            res.setEncoding('utf8');
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const cleaned = data.trim().replace(/^﻿/, '').replace(/^[^{[]+/, '').replace(/[^}\]]+$/, '');
                    if (!cleaned) throw new Error('Empty');
                    resolve({ status: res.statusCode, data: JSON.parse(cleaned) });
                } catch (e) { reject(new Error('Invalid JSON')); }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

module.exports = { requestJson };
