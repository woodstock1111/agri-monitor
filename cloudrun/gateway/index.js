'use strict';
// WeChat Cloud Hosting gateway for the mini program (docs/auth-design.md, memory: cloudrun-architecture-plan).
// The mini program calls this service with wx.cloud.callContainer, which needs no domain or ICP filing. This process stores
// nothing: it forwards an allow-listed set of API calls to the main server (UPSTREAM_URL) and adds, signed with
// FORWARD_SECRET, the caller's openid (injected by WeChat as x-wx-openid) and real client IP.
const http = require('http');
const https = require('https');

const PORT = Number(process.env.PORT || 80);
const UPSTREAM = new URL(process.env.UPSTREAM_URL || 'http://47.116.46.214');
const SECRET = process.env.FORWARD_SECRET || '';
const MAX_BODY = 10 * 1024 * 1024; // agent chat may carry a photo
const TIMEOUT_MS = 65000;

// Only what the mini program uses. [method, exact path or prefix ending in '/'].
const ALLOW = [
    ['POST', '/api/v1/auth/wechat/gateway-login'],
    ['POST', '/api/v1/auth/wechat/bind'],
    ['DELETE', '/api/v1/auth/wechat/binding'],
    ['POST', '/api/v1/auth/logout'],
    ['GET', '/api/v1/auth/me'],
    ['GET', '/api/v1/harvest/soil'],
    ['GET', '/api/v1/harvest/weather'],
    ['GET', '/api/v1/app-state'],
    ['GET', '/api/v1/device-realtime'],
    ['GET', '/api/v1/device-history'],
    ['GET', '/api/v1/farm-tasks'],
    ['GET', '/api/v1/farm-tasks/calendar'],
    ['POST', '/api/v1/farm-tasks'],
    ['PUT', '/api/v1/farm-tasks/'],
    ['DELETE', '/api/v1/farm-tasks/'],
    ['POST', '/api/v1/agent/chat'],
    ['DELETE', '/api/v1/agent/chat'],
    // When the mini program may change tasks (lib/agent/policy.js CHANNELS), also allow ['POST', '/api/v1/agent/actions/'] for undo.
];

function allowed(method, pathname) {
    return ALLOW.some(([m, p]) => m === method && (p.endsWith('/') ? pathname.startsWith(p) && pathname.length > p.length : pathname === p));
}

function send(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}

function handler(req, res) {
    const url = new URL(req.url, 'http://gateway');
    if (url.pathname === '/' || url.pathname === '/healthz') return send(res, 200, { ok: true, service: 'agri-gateway' });
    if (!SECRET) return send(res, 503, { ok: false, msg: '网关未配置 FORWARD_SECRET。' });
    if (!allowed(req.method, url.pathname)) return send(res, 404, { ok: false, msg: 'Not found' });

    const headers = {
        'content-type': req.headers['content-type'] || 'application/json',
        'x-agri-gateway-secret': SECRET,
        'x-agri-client-ip': String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(),
    };
    if (req.headers.authorization) headers.authorization = req.headers.authorization;
    if (req.headers['user-agent']) headers['user-agent'] = req.headers['user-agent'];
    // Set by WeChat for callContainer requests; a direct public request (if public access were ever enabled) has none.
    const openid = req.headers['x-wx-openid'];
    if (openid && req.headers['x-wx-source']) headers['x-agri-wx-openid'] = String(openid);

    // Read the whole body first and send it with Content-Length: Node does not chunk-encode DELETE bodies, so a streamed
    // DELETE body (callContainer sends "{}") would reach the main server unframed and be rejected as a bad request.
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BODY) {
            if (!res.headersSent) send(res, 413, { ok: false, msg: '内容太大。' });
            req.destroy();
            return;
        }
        chunks.push(chunk);
    });
    req.on('end', () => {
        if (size > MAX_BODY) return;
        const body = Buffer.concat(chunks);
        if (body.length) headers['content-length'] = body.length;
        forward(req.method, url.pathname + url.search, headers, body, res);
    });
}

function forward(method, path, headers, body, res) {
    const client = UPSTREAM.protocol === 'https:' ? https : http;
    const upstream = client.request({
        protocol: UPSTREAM.protocol, hostname: UPSTREAM.hostname, port: UPSTREAM.port || undefined,
        method, path, headers, timeout: TIMEOUT_MS,
    }, up => {
        res.writeHead(up.statusCode || 502, {
            'content-type': up.headers['content-type'] || 'application/json',
            ...(up.headers['retry-after'] ? { 'retry-after': up.headers['retry-after'] } : {}),
        });
        up.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
    upstream.on('error', () => { if (!res.headersSent) send(res, 502, { ok: false, msg: '服务器暂时连不上，请稍后重试。' }); else res.destroy(); });
    upstream.end(body.length ? body : undefined);
}

if (require.main === module) {
    http.createServer(handler).listen(PORT, () => console.log(`[gateway] listening on ${PORT}, upstream ${UPSTREAM.origin}`));
}

module.exports = { handler, allowed };
