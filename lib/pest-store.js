// Platform-wide pest / disease / weed library (no tenant: every farm and the agent share one library).
const db = require('./db');

function toEntry(row) {
    return {
        id: row.id,
        type: row.type,
        key: row.key,
        name: row.name,
        aliases: row.aliases || [],
        symptoms: row.symptoms,
        control: row.control,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    };
}

async function list(type = '') {
    const { rows } = type
        ? await db.query('SELECT * FROM pest_library WHERE type = $1', [type])
        : await db.query('SELECT * FROM pest_library');
    return rows.map(toEntry);
}

async function search(keyword, type = '') {
    const params = [`%${keyword}%`];
    let typeClause = '';
    if (type) { params.push(type); typeClause = `AND type = $2`; }
    const { rows } = await db.query(
        `SELECT * FROM pest_library
         WHERE (name ILIKE $1 OR key ILIKE $1 OR symptoms ILIKE $1 OR control ILIKE $1 OR array_to_string(aliases, ' ') ILIKE $1) ${typeClause}
         ORDER BY name`,
        params
    );
    return rows.map(toEntry);
}

async function getByKeys(keys) {
    if (!keys.length) return [];
    const { rows } = await db.query('SELECT * FROM pest_library WHERE key = ANY($1)', [keys]);
    return rows.map(toEntry);
}

// Throws a 409-style error when (type, key) already exists.
async function create({ id, type, key, name, symptoms = '', control = '', aliases = [], updatedBy = null }) {
    try {
        const { rows } = await db.query(
            `INSERT INTO pest_library (id, type, key, name, symptoms, control, aliases, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [id, type, key, name, symptoms, control, aliases, updatedBy]
        );
        return toEntry(rows[0]);
    } catch (error) {
        if (error.code === '23505') {
            const conflict = new Error('key already exists for this type');
            conflict.status = 409;
            throw conflict;
        }
        throw error;
    }
}

async function update(id, fields, updatedBy = null) {
    const { rows } = await db.query(
        `UPDATE pest_library SET
             type = COALESCE($2, type), name = COALESCE($3, name), symptoms = COALESCE($4, symptoms),
             control = COALESCE($5, control), aliases = COALESCE($6, aliases), updated_by = $7, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [id, fields.type ?? null, fields.name ?? null, fields.symptoms ?? null, fields.control ?? null, fields.aliases ?? null, updatedBy]
    );
    return rows[0] ? toEntry(rows[0]) : null;
}

async function remove(id) {
    const { rowCount } = await db.query('DELETE FROM pest_library WHERE id = $1', [id]);
    return rowCount > 0;
}

module.exports = { list, search, getByKeys, create, update, remove };
