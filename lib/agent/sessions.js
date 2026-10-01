'use strict';
// Server-side conversation memory. A session belongs to one caller (account or WeChat guest) and keeps only
// user messages and final assistant replies: tool calls and their results are dropped after each turn
// ("context minimisation"), so data read in one turn cannot steer later turns.

const crypto = require('crypto');

const TTL_MS = 2 * 60 * 60 * 1000;
const MAX_SESSIONS = 5000;
const MAX_MESSAGES = 20;

function createSessionStore({ now = () => Date.now() } = {}) {
    const sessions = new Map();

    function sweep() {
        const t = now();
        for (const [id, s] of sessions) if (!s.busy && t - s.lastAccess > TTL_MS) sessions.delete(id);
        while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    }

    // The caller's session, or a new one when the id is missing, expired or belongs to someone else.
    function open(sessionId, owner) {
        const existing = sessionId ? sessions.get(sessionId) : null;
        if (existing && existing.owner === owner) {
            existing.lastAccess = now();
            return existing;
        }
        if (sessions.size >= MAX_SESSIONS) sweep();
        const session = { id: 'chat_' + crypto.randomBytes(12).toString('hex'), owner, history: [], busy: false, lastAccess: now() };
        sessions.set(session.id, session);
        return session;
    }

    function remember(session, userText, assistantText) {
        session.history.push({ role: 'user', content: userText }, { role: 'assistant', content: assistantText });
        if (session.history.length > MAX_MESSAGES) session.history = session.history.slice(-MAX_MESSAGES);
        session.lastAccess = now();
    }

    function close(sessionId, owner) {
        const s = sessions.get(sessionId);
        if (s && s.owner === owner) sessions.delete(sessionId);
    }

    return { open, remember, close, sweep, size: () => sessions.size };
}

module.exports = { createSessionStore, TTL_MS, MAX_MESSAGES };
