'use strict';
// DashScope (OpenAI-compatible) chat client. Never throws: returns { ok, message, status, error }.

const ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

function createLlm({ request, apiKey, timeoutMs = 60000 }) {
    async function chat({ model, messages, tools, maxTokens, temperature, json = false }) {
        const key = typeof apiKey === 'function' ? apiKey() : apiKey;
        if (!key) return { ok: false, status: 503, error: 'vision_api_not_configured' };
        const body = { model, messages, enable_thinking: false };
        if (tools && tools.length) Object.assign(body, { tools, tool_choice: 'auto' });
        if (maxTokens) body.max_tokens = maxTokens;
        if (temperature !== undefined) body.temperature = temperature;
        if (json) body.response_format = { type: 'json_object' };
        try {
            const res = await request(ENDPOINT, {
                method: 'POST',
                timeout: timeoutMs,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            }, JSON.stringify(body));
            if (res.status >= 400) {
                const err = res.data && (res.data.error || res.data);
                return { ok: false, status: res.status, error: (err && (err.message || err.code)) || `HTTP ${res.status}` };
            }
            const message = res.data && res.data.choices && res.data.choices[0] && res.data.choices[0].message;
            return message ? { ok: true, status: res.status, message } : { ok: false, status: res.status, error: 'empty_response' };
        } catch (error) {
            return { ok: false, status: 502, error: error.message || 'request_failed' };
        }
    }
    return { chat };
}

module.exports = { createLlm, ENDPOINT };
