'use strict';
// Input and output guardrails.
//   normalizeInput — strips characters used to hide instructions (zero-width, bidi overrides, control chars),
//                    applies NFKC so look-alike full-width text reads as plain text, and enforces a length cap.
//   createGuard    — asks a small, fast model whether the message is on topic for the caller's role and whether
//                    it is a jailbreak / injection attempt. Guests fail closed if the check errors; members fail open
//                    (they are authenticated, and tool policy still applies).
//   checkOutput    — strips reasoning tags, refuses replies that quote the system prompt, caps length.
// A provider such as Alibaba Cloud AI Guardrails can replace `classify` without touching the agent.

const { REFUSAL, classifierPrompt, newNonce } = require('./prompts');

const MAX_INPUT_CHARS = 500;
const MAX_OUTPUT_CHARS = 1500;
const HIDDEN = /[​-‏‪-‮⁠-⁯﻿­]/g;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

function normalizeInput(raw) {
    const text = String(raw ?? '')
        .normalize('NFKC')
        .replace(HIDDEN, '')
        .replace(CONTROL, '')
        .replace(/\r\n?/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return { text, tooLong: text.length > MAX_INPUT_CHARS };
}

function parseVerdict(content) {
    const match = String(content || '').match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
        const v = JSON.parse(match[0]);
        if (v.topic !== 'in' && v.topic !== 'out') return null;
        return { topic: v.topic, attack: v.attack === true };
    } catch {
        return null;
    }
}

function createGuard({ llm, model, fallbackModel, log = () => {} }) {
    async function classify(role, text, previousReply = '') {
        const nonce = newNonce();
        const messages = [
            { role: 'system', content: classifierPrompt(role) },
            { role: 'user', content: `<context nonce="${nonce}">${String(previousReply).slice(0, 400)}</context>\n<message nonce="${nonce}">${text}</message>` },
        ];
        for (const m of [model, fallbackModel].filter(Boolean)) {
            const res = await llm.chat({ model: m, messages, maxTokens: 30, temperature: 0, json: true });
            const verdict = res.ok ? parseVerdict(res.message.content) : null;
            if (verdict) return verdict;
            log(`[agent-guard] ${m} gave no verdict (${res.status || ''} ${res.error || ''})`);
        }
        return null;
    }

    // Returns { allow: true } or { allow: false, reply, reason }.
    async function checkInput(principal, text, previousReply) {
        const verdict = await classify(principal.kind, text, previousReply).catch(() => null);
        if (!verdict) {
            if (principal.kind === 'guest') return { allow: false, reply: REFUSAL.unavailable, reason: 'guard_unavailable' };
            return { allow: true, reason: 'guard_unavailable' };
        }
        if (verdict.attack) return { allow: false, reply: REFUSAL.attack, reason: 'attack' };
        if (verdict.topic === 'out') return { allow: false, reply: REFUSAL[principal.kind] || REFUSAL.member, reason: 'off_topic' };
        return { allow: true };
    }

    return { classify, checkInput };
}

// Any line of the system prompt long enough to be distinctive must not appear in a reply.
function leaksPrompt(reply, systemPrompt) {
    const compact = s => s.replace(/\s+/g, '');
    const body = compact(reply);
    return String(systemPrompt || '').split('\n').map(line => compact(line)).filter(line => line.length >= 24).some(line => body.includes(line));
}

function checkOutput(reply, systemPrompt) {
    let text = String(reply || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (leaksPrompt(text, systemPrompt)) return { text: REFUSAL.attack, blocked: true };
    if (text.length > MAX_OUTPUT_CHARS) text = text.slice(0, MAX_OUTPUT_CHARS) + '…';
    return { text, blocked: false };
}

module.exports = { MAX_INPUT_CHARS, normalizeInput, parseVerdict, createGuard, checkOutput, leaksPrompt };
