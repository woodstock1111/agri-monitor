'use strict';
// 小薯 agent: one entry point for the web site and the mini program, members and guests.
//
// A message goes through, in order:
//   1. identity and rate limits                      (who may talk, how often)
//   2. input normalisation and length cap           (guard.normalizeInput)
//   3. topic / injection check by a small model     (guard.checkInput)
//   4. the model loop; every tool call passes the reference monitor (policy.decide), results are
//      spotlighted (prompts.wrapToolResult), writes are logged for undo (actions.record)
//   5. output check                                  (guard.checkOutput)
//   6. only the user text and the final reply are kept in the session
//
// Dependencies are injected so the module can be tested without a server, a database or a model.

const policy = require('./policy');
const prompts = require('./prompts');
const { normalizeInput, checkOutput } = require('./guard');

const MAX_ITERATIONS = 8;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const IMAGE_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/;
const DEFAULT_IMAGE_QUESTION = '这是什么？帮我看看是什么虫或草，怎么防治。';
// A reply that says something was done although no write ran gets one corrective retry.
const CLAIMS_DONE = /(已|已经)(为您|帮您|帮你|给您|给你)?(完成|标记|创建|新建|添加|安排|修改|更新|改为|改成)/;
const TOOL_LABELS = { create_farm_task: '新建任务', update_farm_task: '修改任务', complete_farm_task: '标记任务' };

function createLimiter({ windowMs, max, now = () => Date.now() }) {
    const buckets = new Map();
    return function allow(key) {
        const t = now();
        if (buckets.size > 20000) for (const [k, b] of buckets) if (t - b.start > windowMs) buckets.delete(k);
        const b = buckets.get(key);
        if (!b || t - b.start > windowMs) { buckets.set(key, { start: t, count: 1 }); return true; }
        b.count += 1;
        return b.count <= max;
    };
}

// Who is talking, and through which client. Members act on their own tenant; guests (WeChat, not bound) only
// get public knowledge. The channel comes from the server-side session (`client`), never from the request body.
function principalFrom(auth) {
    const channel = auth && auth.session && auth.session.client === 'miniprogram' ? 'miniprogram' : 'web';
    if (auth && auth.user) return { kind: 'member', key: 'user:' + auth.user.id, user: auth.user, channel };
    if (auth && auth.guest && auth.guest.openid) return { kind: 'guest', key: 'guest:' + auth.guest.openid, channel: 'miniprogram' };
    return null;
}

function createAgent({ llm, tools, guard, actions, sessions, models, farmContext, log = () => {}, limits = {} }) {
    const allowGuest = createLimiter({ windowMs: 24 * 60 * 60 * 1000, max: limits.guestPerDay || 30 });
    const allowMember = createLimiter({ windowMs: 10 * 60 * 1000, max: limits.memberPer10Min || 60 });

    function seedLegacyHistory(session, history) {
        // Older mini program builds send their own history instead of a session id. It is used as plain text only.
        if (session.history.length || !Array.isArray(history)) return;
        history.slice(-8).forEach(m => {
            const content = normalizeInput(m && m.text).text.slice(0, 500);
            if (content) session.history.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content });
        });
    }

    async function chat({ auth, sessionId, text, image, history, ip }) {
        const principal = principalFrom(auth);
        if (!principal) return { status: 401, body: { ok: false, msg: 'Unauthorized' } };
        const allowed = principal.kind === 'guest' ? allowGuest(principal.key) : allowMember(principal.key);
        if (!allowed) return { status: 429, body: { ok: false, msg: principal.kind === 'guest' ? '今天的提问次数用完了，明天再来吧' : '提问太频繁，请稍后再试' } };

        let imageUrl = '';
        if (image !== undefined && image !== null && image !== '') {
            const value = String(image);
            if (!IMAGE_RE.test(value) || value.length > MAX_IMAGE_BYTES * 1.37) return { status: 400, body: { ok: false, msg: '图片格式不支持或太大' } };
            imageUrl = value;
        }
        const input = normalizeInput(text);
        const session = sessions.open(sessionId, principal.key);
        const reply = (body) => ({ status: 200, body: { ok: true, sessionId: session.id, actions: [], writeResults: [], toolCalls: [], ...body } });
        if (input.tooLong) return reply({ reply: prompts.REFUSAL.tooLong, guarded: 'too_long' });
        if (!input.text && !imageUrl) return { status: 400, body: { ok: false, msg: 'message required' } };
        if (session.busy) return { status: 409, body: { ok: false, msg: '上一条消息还在处理中，请稍候' } };
        seedLegacyHistory(session, history);

        // Accounts with agentDebug on get every step back (shown on the web for troubleshooting).
        const debugLog = principal.user && principal.user.agentDebug === true ? [] : null;
        const withDebug = body => (debugLog ? { ...body, debugLog } : body);
        session.busy = true;
        try {
            const userText = input.text || DEFAULT_IMAGE_QUESTION;
            if (input.text) {
                const previous = [...session.history].reverse().find(m => m.role === 'assistant');
                const verdict = await guard.checkInput(principal, input.text, previous ? previous.content : '');
                if (debugLog) debugLog.push({ iteration: 0, thinking: `输入检查：${verdict.allow ? '通过' : '拦截'}${verdict.reason ? '（' + verdict.reason + '）' : ''}`, toolCalls: [] });
                if (!verdict.allow) {
                    log(`[agent] ${principal.kind} message refused: ${verdict.reason}`);
                    return reply(withDebug({ reply: verdict.reply, guarded: verdict.reason }));
                }
            }
            const context = principal.kind === 'member' ? await farmContext(principal.user) : {};
            const system = prompts.systemPrompt(principal, { ...context, canWrite: policy.canWrite(principal), now: new Date().toISOString() });
            const userContent = imageUrl ? [{ type: 'image_url', image_url: { url: imageUrl } }, { type: 'text', text: userText }] : userText;
            const messages = [{ role: 'system', content: system }, ...session.history, { role: 'user', content: userContent }];
            const toolDefs = policy.toolDefsFor(principal, tools);
            const turn = policy.newTurn({ hasImage: !!imageUrl });
            const nonce = prompts.newNonce();
            const model = imageUrl ? models.vision() : models.text();
            const done = [];
            const toolCalls = [];
            let finalText = '';
            let nudged = false;

            for (let i = 0; i < MAX_ITERATIONS; i += 1) {
                const res = await llm.chat({ model, messages, tools: toolDefs });
                if (!res.ok) return { status: res.status === 503 ? 503 : 502, body: { ok: false, msg: res.error || 'agent failed' } };
                const msg = res.message;
                messages.push(msg);
                const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
                const step = debugLog ? { iteration: i + 1, thinking: String(msg.content || ''), toolCalls: [] } : null;
                if (step) debugLog.push(step);
                if (!calls.length) {
                    finalText = String(msg.content || '');
                    const wrote = done.some(a => a.ok);
                    if (!nudged && policy.canWrite(principal) && !wrote && !turn.tainted && CLAIMS_DONE.test(finalText)) {
                        nudged = true;
                        messages.push({ role: 'user', content: '（系统核对）你的回复说已经执行了操作，但本轮没有成功调用任何修改工具。若用户确实要求修改，请现在调用对应工具；否则如实说明没有执行。' });
                        continue;
                    }
                    break;
                }
                for (const call of calls) {
                    const name = (call.function && call.function.name) || '';
                    let args = {};
                    try {
                        const raw = call.function && call.function.arguments;
                        args = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
                    } catch { args = {}; }
                    const decision = policy.decide(name, principal, turn, tools);
                    let content;
                    let entry = { tool: name, args };
                    if (!decision.allow) {
                        content = JSON.stringify({ error: decision.error });
                        entry.error = decision.error;
                        log(`[agent] denied ${name} for ${principal.kind}: ${decision.error.split(':')[0]}`);
                    } else if (tools.meta(name).kind === 'write') {
                        const { data, change } = await tools.runWrite(name, args, principal.user).catch(e => ({ data: { error: e.message || 'tool failed' } }));
                        let actionId = '';
                        if (change && tools.meta(name).undoable) {
                            actionId = await actions.record({ user: principal.user, tool: name, change, sessionId: session.id, ip }).catch(e => { log(`[agent] action log failed: ${e.message}`); return ''; });
                        }
                        entry = { ...entry, ok: data.ok === true, error: data.error, task: data.task };
                        if (TOOL_LABELS[name]) {
                            done.push({
                                id: actionId, tool: name, label: TOOL_LABELS[name], ok: data.ok === true, undoable: !!actionId, error: data.error,
                                task: data.task ? { id: data.task.id, title: data.task.title, date: data.task.date, status: data.task.status } : null,
                            });
                        }
                        content = JSON.stringify(data);
                    } else {
                        content = await tools.runRead(name, args, principal.user).catch(e => JSON.stringify({ error: e.message || 'tool failed' }));
                    }
                    if (decision.allow) policy.afterCall(name, turn, tools);
                    if (step) step.toolCalls.push({ name, args, result: String(content).slice(0, 500) });
                    toolCalls.push(entry);
                    messages.push({ role: 'tool', tool_call_id: call.id, content: prompts.wrapToolResult(name, content, nonce) });
                }
            }

            const out = checkOutput(finalText, system);
            if (out.blocked) log('[agent] reply withheld: it quoted the system prompt');
            const replyText = out.text || '我暂时没有得到可用结论，请稍后再试或换一种问法。';
            sessions.remember(session, imageUrl ? `[图片] ${userText}` : userText, replyText);
            const writeResults = done.map(a => ({
                tool: a.tool, ok: a.ok, taskId: a.task ? a.task.id : '', title: a.task ? a.task.title : '', date: a.task ? a.task.date : '',
                status: a.task ? a.task.status : '', completed: a.tool === 'complete_farm_task' ? (a.task ? a.task.status === 'done' : undefined) : undefined,
            }));
            return reply(withDebug({ reply: replyText, actions: done, writeResults, toolCalls }));
        } finally {
            session.busy = false;
        }
    }

    async function undo({ auth, actionId, ip }) {
        const principal = principalFrom(auth);
        if (!principal || principal.kind !== 'member') return { status: 401, body: { ok: false, msg: 'Unauthorized' } };
        return actions.undo({ user: principal.user, actionId, ip });
    }

    function clear({ auth, sessionId }) {
        const principal = principalFrom(auth);
        if (principal && sessionId) sessions.close(String(sessionId), principal.key);
    }

    return { chat, undo, clear };
}

module.exports = { createAgent, createLimiter, principalFrom, MAX_ITERATIONS };
