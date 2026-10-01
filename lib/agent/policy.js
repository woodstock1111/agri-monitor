'use strict';
// Reference monitor for tool calls. The model can only *ask* for a tool; this code decides whether the call runs,
// so a manipulated model can never exceed what the caller could do themselves.
//
// Rules (after Meta's "Agents Rule of Two" and the capability/taint designs of CaMeL/FIDES):
//   1. Least privilege — a role only ever sees and may call its own tool list.
//   2. Guests never write and never see farm data.
//   3. Taint — once a turn has taken in content the caller did not write (shared or external tool results, an
//      uploaded image), no write runs for the rest of that turn. Untrusted text can then influence words, not data.
//   4. Bounded writes — at most MAX_WRITES_PER_TURN per turn; every write is logged and can be undone.
//   5. Channels — what each client may do, whoever is signed in. To let the mini program change tasks later,
//      set its `write` to true (and show the actions/undo there, as the web does).

const ROLE_TOOLS = {
    guest: ['search_pest_library', 'get_pest_library'],
    member: [
        'get_sensor_latest', 'get_sensor_history', 'get_photo_records', 'get_pest_library', 'search_pest_library',
        'identify_pest', 'get_weather', 'get_farm_tasks', 'get_crops', 'analyze_photo',
        'create_farm_task', 'update_farm_task', 'complete_farm_task',
    ],
};
const MAX_WRITES_PER_TURN = 10;
const CHANNELS = {
    web: { write: true },
    miniprogram: { write: false },
};
const canWrite = principal => principal.kind === 'member' && !!(CHANNELS[principal.channel] || {}).write;

// Per-turn state the policy reads and updates.
function newTurn({ hasImage = false } = {}) {
    return { tainted: hasImage, taintSource: hasImage ? 'image' : '', writes: 0 };
}

function toolDefsFor(principal, tools) {
    const allowed = new Set(ROLE_TOOLS[principal.kind] || []);
    return tools.defs.filter(def => allowed.has(def.function.name) && (tools.meta(def.function.name).kind !== 'write' || canWrite(principal)));
}

// Decide one call. Returns { allow: true } or { allow: false, error } where error is shown to the model.
function decide(name, principal, turn, tools) {
    const meta = tools.meta(name);
    if (!meta || !(ROLE_TOOLS[principal.kind] || []).includes(name)) {
        return { allow: false, error: 'tool_not_allowed: 当前身份不能使用这个工具' };
    }
    if (meta.kind === 'write') {
        if (principal.kind !== 'member') return { allow: false, error: 'write_not_allowed: 游客不能修改数据' };
        if (!canWrite(principal)) return { allow: false, error: 'write_not_allowed: 这个客户端暂不支持修改任务，请到网页版操作' };
        if (turn.tainted) {
            return { allow: false, error: `blocked_after_untrusted_content: 本轮已读取${turn.taintSource === 'image' ? '图片' : '外部资料'}，为安全起见本轮不修改任务。请告诉用户：如需修改，请再单独发一条指令。` };
        }
        if (turn.writes >= MAX_WRITES_PER_TURN) return { allow: false, error: 'too_many_writes: 一次最多修改 10 条任务' };
    }
    return { allow: true };
}

// Record what a finished call means for the rest of the turn.
function afterCall(name, turn, tools) {
    const meta = tools.meta(name);
    if (!meta) return;
    if (meta.kind === 'write') turn.writes += 1;
    if (meta.trust !== 'own' && !turn.tainted) {
        turn.tainted = true;
        turn.taintSource = name;
    }
}

module.exports = { ROLE_TOOLS, CHANNELS, MAX_WRITES_PER_TURN, canWrite, newTurn, toolDefsFor, decide, afterCall };
