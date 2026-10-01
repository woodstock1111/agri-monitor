'use strict';
// Every agent write is written to audit_log with the task's fields before and after, so it can be undone.
// Undo is allowed for the same account, within UNDO_WINDOW_MS, once, and only while the task still looks
// exactly as the write left it (tools.revert checks that).

const UNDO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function createActionLog({ db, tools }) {
    async function record({ user, tool, change, sessionId, ip }) {
        const { rows } = await db.query(
            `INSERT INTO audit_log (tenant_id, user_id, action, target_type, target_id, detail, ip)
             VALUES ($1, $2, $3, 'farm_task', $4, $5, $6) RETURNING id`,
            [user.tenantId || null, user.id, 'agent.' + tool, change.taskId, JSON.stringify({ ...change, sessionId, undone: false }), ip || null],
        );
        return String(rows[0].id);
    }

    async function undo({ user, actionId, ip }) {
        if (!/^\d{1,18}$/.test(String(actionId || ''))) return { status: 400, body: { ok: false, msg: '无效的操作编号' } };
        const { rows } = await db.query('SELECT * FROM audit_log WHERE id = $1', [actionId]);
        const row = rows[0];
        if (!row || row.user_id !== user.id || !String(row.action).startsWith('agent.')) return { status: 404, body: { ok: false, msg: '找不到这条操作' } };
        const detail = row.detail || {};
        if (detail.undone) return { status: 409, body: { ok: false, msg: '这条操作已经撤销过了' } };
        if (Date.now() - new Date(row.created_at).getTime() > UNDO_WINDOW_MS) return { status: 409, body: { ok: false, msg: '超过 7 天，不能再撤销' } };
        const result = tools.revert(detail, user);
        if (!result.ok) return { status: 409, body: { ok: false, msg: result.msg } };
        await db.query(`UPDATE audit_log SET detail = detail || '{"undone": true}'::jsonb WHERE id = $1`, [actionId]);
        await db.query(
            `INSERT INTO audit_log (tenant_id, user_id, action, target_type, target_id, detail, ip) VALUES ($1, $2, 'agent.undo', 'farm_task', $3, $4, $5)`,
            [user.tenantId || null, user.id, detail.taskId, JSON.stringify({ actionId: String(actionId) }), ip || null],
        );
        return { status: 200, body: { ok: true, task: result.task } };
    }

    return { record, undo };
}

module.exports = { createActionLog, UNDO_WINDOW_MS };
