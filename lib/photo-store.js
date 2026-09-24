// Crops, photos and photo regions in PostgreSQL.
//
// The frontend still speaks the old photo-record JSON shape: `aiDetections.detections[]` (addressed by index) and
// `annotations[]` (the boxes the user drew or confirmed). Both are rebuilt from `photo_regions` on read, and
// `annotations` sent back by the frontend are synced into `photo_regions` on write:
//   - AI regions keep their detection order in `seq` (>= 0); confirmed AI regions whose detection run was replaced
//     are kept with seq = -1 so confirmed samples are never lost.
//   - annotation.source 'ai_confirmed' -> the AI region with the same label and bbox is marked confirmed.
//   - annotation.source 'human'        -> a region with detector 'human', matched by annotation id (client_id).
// Saving annotations records farmer_* confirmation; expert_* is only set by the explicit expertReview step.
const db = require('./db');

const LABEL_CATEGORY = {
    insect_visible: 'pest',
    insect_damage: 'pest',
    leaf_holes: 'pest',
    disease_spot: 'disease',
    white_powder: 'disease',
    leaf_yellowing: 'plant_abnormal',
    leaf_browning: 'plant_abnormal',
    leaf_wilting: 'plant_abnormal',
    leaf_curling: 'plant_abnormal',
    stem_damage: 'plant_abnormal',
    weed: 'weed',
    soil_crack: 'soil',
    soil_too_wet: 'soil',
};
const CATEGORIES = new Set(['pest', 'disease', 'weed', 'plant_abnormal', 'soil', 'other']);
const ISSUE_CATEGORIES = ['pest', 'disease', 'weed', 'plant_abnormal'];
// Regions in these categories get an embedding and can serve as identification samples.
const EMBED_CATEGORIES = ['pest', 'disease', 'weed'];

function categoryFor(label, suggested) {
    if (LABEL_CATEGORY[label]) return LABEL_CATEGORY[label];
    return CATEGORIES.has(suggested) ? suggested : 'other';
}

function normalizeBbox(bbox) {
    const [x, y, w, h] = (Array.isArray(bbox) ? bbox : []).map(Number);
    if (![x, y, w, h].every(Number.isFinite)) return null;
    const nx = w < 0 ? x + w : x;
    const ny = h < 0 ? y + h : y;
    return [Math.round(nx), Math.round(ny), Math.round(Math.abs(w)), Math.round(Math.abs(h))];
}

function bboxEquals(a, b) {
    const boxA = normalizeBbox(a);
    const boxB = normalizeBbox(b);
    return !!boxA && !!boxB && boxA.every((value, idx) => Math.abs(value - boxB[idx]) <= 2);
}

const iso = value => (value instanceof Date ? value.toISOString() : value ?? null);
const effectiveKey = region => region.expert_library_key || region.library_key || null;
const isConfirmed = region => region.farmer_status === 'confirmed' || region.expert_status === 'confirmed';

function toCrop(row) {
    return {
        id: row.id,
        name: row.name,
        variety: row.variety,
        locationId: row.location_id,
        locationDesc: row.location_desc,
        createdAt: iso(row.created_at),
        tenantId: row.tenant_id,
    };
}

function toAnnotation(region) {
    return {
        id: region.client_id || `reg_${region.id}`,
        type: 'bbox',
        label: region.label,
        bbox: region.bbox,
        source: region.detector === 'human' ? 'human' : 'ai_confirmed',
        libraryKey: effectiveKey(region),
        regionId: String(region.id),
        farmerStatus: region.farmer_status,
        expertStatus: region.expert_status,
        createdAt: iso(region.farmer_at || region.expert_at || region.created_at),
    };
}

function toDetection(region) {
    return {
        label: region.label,
        bbox: region.bbox,
        confidence: region.confidence,
        note: region.note || '',
        category: region.category,
        ...(region.ai_guess ? { pestGuess: region.ai_guess } : {}),
        regionId: String(region.id),
        libraryKey: effectiveKey(region),
    };
}

function toRecord(photo, regions = []) {
    const aiRegions = regions.filter(r => r.detector !== 'human' && r.seq >= 0).sort((a, b) => a.seq - b.seq);
    const raw = photo.ai_detections_raw;
    let aiDetections = null;
    if (typeof raw === 'string') {
        aiDetections = raw;
    } else if (raw || aiRegions.length) {
        const { detections, ...rest } = raw && typeof raw === 'object' ? raw : {};
        aiDetections = { ...rest, detections: aiRegions.map(toDetection) };
    }
    return {
        id: photo.id,
        cropId: photo.crop_id,
        cropName: photo.crop_name,
        source: photo.source,
        deviceId: photo.device_id,
        uploadedAt: iso(photo.uploaded_at),
        createdAt: iso(photo.captured_at),
        imagePath: photo.image_path,
        imageUrl: `/api/v1/photos/records/${photo.id}/image`,
        width: photo.width,
        height: photo.height,
        hasIssue: photo.has_issue,
        gps: photo.gps,
        weather: photo.weather,
        linkedSensors: photo.linked_sensors || [],
        userNotes: photo.user_notes,
        farmNotes: photo.farm_notes,
        labels: photo.labels,
        aiDetections,
        annotations: regions
            .filter(r => r.detector === 'human' || isConfirmed(r))
            .sort((a, b) => Number(a.id) - Number(b.id))
            .map(toAnnotation),
        aiAnalysis: photo.ai_analysis,
        tenantId: photo.tenant_id,
        review: {
            pending: regions.filter(r => r.farmer_status === 'confirmed' && r.expert_status !== 'confirmed').length,
            approved: regions.filter(r => r.expert_status === 'confirmed').length,
        },
    };
}

function tenantClause(params, tenantId, column = 'tenant_id') {
    if (!tenantId) return '';
    params.push(tenantId);
    return `AND ${column} = $${params.length}`;
}

async function regionsFor(photoIds, client = db) {
    if (!photoIds.length) return new Map();
    const { rows } = await client.query('SELECT * FROM photo_regions WHERE photo_id = ANY($1) ORDER BY id', [photoIds]);
    const byPhoto = new Map();
    rows.forEach(row => {
        if (!byPhoto.has(row.photo_id)) byPhoto.set(row.photo_id, []);
        byPhoto.get(row.photo_id).push(row);
    });
    return byPhoto;
}

// ------------------------------------------------------------------ crops

async function listCrops(tenantId) {
    const params = [];
    const { rows } = await db.query(
        `SELECT * FROM crops WHERE deleted_at IS NULL ${tenantClause(params, tenantId)} ORDER BY created_at`,
        params
    );
    return rows.map(toCrop);
}

async function getCrop(id, tenantId) {
    const params = [id];
    const { rows } = await db.query(
        `SELECT * FROM crops WHERE id = $1 AND deleted_at IS NULL ${tenantClause(params, tenantId)}`,
        params
    );
    return rows[0] ? toCrop(rows[0]) : null;
}

async function createCrop({ id, tenantId, name, variety = '', locationId = '', locationDesc = '', createdBy = null }) {
    const { rows } = await db.query(
        `INSERT INTO crops (id, tenant_id, name, variety, location_id, location_desc, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [id, tenantId, name, variety, locationId, locationDesc, createdBy]
    );
    return toCrop(rows[0]);
}

// Soft-deletes the crop and its photos (image files are kept until a cleanup job removes them).
async function deleteCrop(id, tenantId) {
    return db.withTransaction(async client => {
        const params = [id];
        const { rowCount } = await client.query(
            `UPDATE crops SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL ${tenantClause(params, tenantId)}`,
            params
        );
        if (!rowCount) return false;
        await client.query('UPDATE photos SET deleted_at = now() WHERE crop_id = $1 AND deleted_at IS NULL', [id]);
        return true;
    });
}

// ------------------------------------------------------------------ photos

async function listPhotos({ tenantId, cropId = null, limit = null }) {
    const params = [];
    let where = `deleted_at IS NULL ${tenantClause(params, tenantId)}`;
    if (cropId) { params.push(cropId); where += ` AND crop_id = $${params.length}`; }
    let limitClause = '';
    if (limit) { params.push(limit); limitClause = `LIMIT $${params.length}`; }
    const { rows } = await db.query(
        `SELECT * FROM photos WHERE ${where} ORDER BY COALESCE(captured_at, uploaded_at) DESC ${limitClause}`,
        params
    );
    const regions = await regionsFor(rows.map(row => row.id));
    return rows.map(row => toRecord(row, regions.get(row.id) || []));
}

async function getPhotoRow(id, tenantId, client = db) {
    const params = [id];
    const { rows } = await client.query(
        `SELECT * FROM photos WHERE id = $1 AND deleted_at IS NULL ${tenantClause(params, tenantId)}`,
        params
    );
    return rows[0] || null;
}

async function getRecord(id, tenantId, client = db) {
    const photo = await getPhotoRow(id, tenantId, client);
    if (!photo) return null;
    const regions = await regionsFor([id], client);
    return toRecord(photo, regions.get(id) || []);
}

async function createPhoto(p) {
    await db.query(
        `INSERT INTO photos (id, tenant_id, crop_id, crop_name, source, device_id, uploaded_by, captured_at, uploaded_at,
             image_path, width, height, bytes, sha256, gps, weather, linked_sensors, user_notes, farm_notes, labels)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
        [
            p.id, p.tenantId, p.cropId, p.cropName || '', p.source || 'upload', p.deviceId || null, p.uploadedBy || null,
            p.capturedAt || null, p.uploadedAt || new Date(), p.imagePath, p.width ?? null, p.height ?? null, p.bytes ?? null,
            p.sha256 || null, JSON.stringify(p.gps ?? null), JSON.stringify(p.weather ?? null), JSON.stringify(p.linkedSensors || []),
            p.userNotes || '', p.farmNotes || '', JSON.stringify(p.labels ?? null),
        ]
    );
    if (Array.isArray(p.annotations) && p.annotations.length) {
        await syncAnnotations(p.id, null, p.annotations, p.actor || { userId: p.uploadedBy, expert: false });
    }
    return getRecord(p.id, null);
}

async function softDeletePhoto(id, tenantId) {
    const params = [id];
    const { rowCount } = await db.query(
        `UPDATE photos SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL ${tenantClause(params, tenantId)}`,
        params
    );
    return rowCount > 0;
}

async function refreshHasIssue(photoId, client) {
    await client.query(
        `UPDATE photos p SET has_issue = CASE
             WHEN EXISTS (SELECT 1 FROM photo_regions r WHERE r.photo_id = p.id AND r.category = ANY($2)) THEN true
             WHEN p.ai_detections_raw IS NOT NULL THEN false
             ELSE NULL END
         WHERE p.id = $1`,
        [photoId, ISSUE_CATEGORIES]
    );
}

// Saving annotations always records the farmer-level confirmation (whoever saves, including admins).
// Expert approval is a separate, explicit step (expertReview) that stamps the boxes as they are at that moment;
// any later change to a box (species, position, removal) drops its expert approval so it returns to the review queue.
const EXPERT_RESET = `expert_status = 'pending', expert_by = NULL, expert_at = NULL, expert_library_key = NULL`;

async function syncAnnotations(photoId, tenantId, annotations, actor, client = null) {
    const run = async tx => {
        const photo = await getPhotoRow(photoId, tenantId, tx);
        if (!photo) return false;
        const { rows: regions } = await tx.query('SELECT * FROM photo_regions WHERE photo_id = $1 FOR UPDATE', [photoId]);
        const touched = new Set();

        const confirm = async (region, ann, moved = false) => {
            const libraryKey = ann.libraryKey === undefined ? effectiveKey(region) : (ann.libraryKey || null);
            const changed = moved || libraryKey !== effectiveKey(region);
            const confirmedAt = ann.createdAt && Number.isFinite(new Date(ann.createdAt).getTime()) ? new Date(ann.createdAt) : null;
            await tx.query(
                `UPDATE photo_regions SET farmer_status = 'confirmed', farmer_by = COALESCE(farmer_by, $2),
                     farmer_at = COALESCE(farmer_at, $5, now()), library_key = $3, client_id = COALESCE($4, client_id)
                     ${changed ? `, ${EXPERT_RESET}` : ''}
                 WHERE id = $1`,
                [region.id, actor.userId || null, libraryKey, ann.id || null, confirmedAt]
            );
            touched.add(region.id);
        };

        for (const ann of Array.isArray(annotations) ? annotations : []) {
            const bbox = normalizeBbox(ann?.bbox);
            if (!bbox || !ann.label) continue;
            if (ann.source === 'ai_confirmed') {
                const region = regions.find(r => r.detector !== 'human' && !touched.has(r.id)
                    && ((ann.id && r.client_id === ann.id) || (r.label === ann.label && bboxEquals(r.bbox, bbox))));
                if (region) { await confirm(region, ann); continue; }
            }
            const existing = regions.find(r => r.detector === 'human' && ann.id && r.client_id === ann.id);
            if (existing) {
                const moved = !bboxEquals(existing.bbox, bbox) || existing.label !== ann.label;
                if (moved) {
                    await tx.query(
                        `UPDATE photo_regions SET bbox = $2, label = $3, category = $4, crop_path = NULL, embed_attempts = 0, embed_error = NULL WHERE id = $1`,
                        [existing.id, bbox, ann.label, categoryFor(ann.label)]
                    );
                    await tx.query('DELETE FROM region_embeddings WHERE region_id = $1', [existing.id]);
                }
                await confirm(existing, ann, moved);
                continue;
            }
            // New box drawn by a person (or an ai_confirmed box whose AI region no longer exists).
            const { rows } = await tx.query(
                `INSERT INTO photo_regions (photo_id, tenant_id, seq, client_id, bbox, label, category, detector)
                 VALUES ($1, $2, -1, $3, $4, $5, $6, $7) RETURNING *`,
                [photoId, photo.tenant_id, ann.id || null, bbox, ann.label, categoryFor(ann.label), ann.source === 'ai_confirmed' ? 'qwen-vl' : 'human']
            );
            await confirm(rows[0], ann);
        }

        for (const region of regions) {
            if (touched.has(region.id)) continue;
            if (region.detector === 'human' || region.seq < 0) {
                // Removed hand-drawn box, or an AI box from an earlier detection run that is no longer confirmed.
                await tx.query('DELETE FROM photo_regions WHERE id = $1', [region.id]);
            } else if (isConfirmed(region)) {
                await tx.query(
                    `UPDATE photo_regions SET farmer_status = 'pending', farmer_by = NULL, farmer_at = NULL, library_key = NULL,
                         client_id = NULL, ${EXPERT_RESET} WHERE id = $1`,
                    [region.id]
                );
            }
        }
        await refreshHasIssue(photoId, tx);
        return true;
    };
    return client ? run(client) : db.withTransaction(run);
}

// Platform-admin review of a whole photo: approve stamps every farmer-confirmed box (with its current species);
// revoke clears the stamps.
async function expertReview(photoId, approve, userId) {
    return db.withTransaction(async client => {
        const photo = await getPhotoRow(photoId, null, client);
        if (!photo) return null;
        if (approve) {
            await client.query(
                `UPDATE photo_regions SET expert_status = 'confirmed', expert_by = $2, expert_at = now(), expert_library_key = library_key
                 WHERE photo_id = $1 AND farmer_status = 'confirmed'`,
                [photoId, userId]
            );
        } else {
            await client.query(`UPDATE photo_regions SET ${EXPERT_RESET} WHERE photo_id = $1`, [photoId]);
        }
        return getRecord(photoId, null, client);
    });
}

// Photos from every farm with farmer-confirmed boxes not yet approved by an expert, newest first.
async function reviewQueue(limit = 100) {
    const { rows } = await db.query(
        `SELECT p.* FROM photos p
         WHERE p.deleted_at IS NULL AND EXISTS (
             SELECT 1 FROM photo_regions r WHERE r.photo_id = p.id AND r.farmer_status = 'confirmed' AND r.expert_status <> 'confirmed')
         ORDER BY COALESCE(p.captured_at, p.uploaded_at) DESC LIMIT $1`,
        [limit]
    );
    const regions = await regionsFor(rows.map(row => row.id));
    return rows.map(row => toRecord(row, regions.get(row.id) || []));
}

async function updatePhoto(id, tenantId, { farmNotes, labels, annotations }, actor) {
    return db.withTransaction(async client => {
        const photo = await getPhotoRow(id, tenantId, client);
        if (!photo) return null;
        if (farmNotes !== undefined || labels !== undefined) {
            await client.query(
                `UPDATE photos SET farm_notes = COALESCE($2, farm_notes), labels = CASE WHEN $3::boolean THEN $4::jsonb ELSE labels END WHERE id = $1`,
                [id, farmNotes === undefined ? null : String(farmNotes || ''), labels !== undefined, JSON.stringify(labels ?? null)]
            );
        }
        if (annotations !== undefined) await syncAnnotations(id, tenantId, annotations, actor, client);
        return getRecord(id, tenantId, client);
    });
}

async function setAiAnalysis(id, analysis) {
    await db.query('UPDATE photos SET ai_analysis = $2 WHERE id = $1', [id, JSON.stringify(analysis ?? null)]);
}

// Replaces the AI detection run. Unconfirmed AI regions are dropped; confirmed ones are kept as orphans (seq = -1).
// `raw` is the parsed model output (object) or the unparseable text (string).
async function replaceAiDetections(id, tenantId, raw, model) {
    return db.withTransaction(async client => {
        const photo = await getPhotoRow(id, tenantId, client);
        if (!photo) return null;
        await client.query(
            `DELETE FROM photo_regions WHERE photo_id = $1 AND detector <> 'human' AND farmer_status <> 'confirmed' AND expert_status <> 'confirmed'`,
            [id]
        );
        await client.query(`UPDATE photo_regions SET seq = -1 WHERE photo_id = $1 AND detector <> 'human'`, [id]);
        const detections = raw && typeof raw === 'object' && Array.isArray(raw.detections) ? raw.detections : [];
        let seq = 0;
        for (const det of detections) {
            const bbox = normalizeBbox(det?.bbox);
            if (!bbox || !det.label) continue;
            const confidence = Number(det.confidence);
            await client.query(
                `INSERT INTO photo_regions (photo_id, tenant_id, seq, bbox, label, category, detector, detector_model, confidence, ai_guess, note)
                 VALUES ($1, $2, $3, $4, $5, $6, 'qwen-vl', $7, $8, $9, $10)`,
                [
                    id, photo.tenant_id, seq, bbox, String(det.label), categoryFor(String(det.label), det.category), model,
                    Number.isFinite(confidence) ? confidence : null,
                    det.pestGuess && typeof det.pestGuess === 'object' ? JSON.stringify(det.pestGuess) : null,
                    det.note ? String(det.note) : null,
                ]
            );
            seq += 1;
        }
        await client.query('UPDATE photos SET ai_detections_raw = $2 WHERE id = $1', [id, JSON.stringify(raw ?? null)]);
        await refreshHasIssue(id, client);
        return getRecord(id, tenantId, client);
    });
}

// ------------------------------------------------------------------ embedding work queue

// Background queue: only confirmed regions are embedded ahead of time (they are the identification samples).
// Unconfirmed AI boxes are embedded on demand when someone identifies / searches that photo.
async function regionsNeedingEmbedding(model, limit = 5, maxAttempts = 5) {
    const { rows } = await db.query(
        `SELECT r.*, p.image_path, p.width, p.height FROM photo_regions r
         JOIN photos p ON p.id = r.photo_id
         WHERE p.deleted_at IS NULL AND r.category = ANY($1) AND r.embed_attempts < $3
           AND (r.farmer_status = 'confirmed' OR r.expert_status = 'confirmed')
           AND NOT EXISTS (SELECT 1 FROM region_embeddings e WHERE e.region_id = r.id AND e.model = $2)
         ORDER BY r.id LIMIT $4`,
        [EMBED_CATEGORIES, model, maxAttempts, limit]
    );
    return rows;
}

// Embeddable regions of one photo (or one region) still missing an embedding, confirmed or not.
async function unembeddedRegions(model, { photoId = null, regionId = null }) {
    const { rows } = await db.query(
        `SELECT r.*, p.image_path, p.width, p.height FROM photo_regions r
         JOIN photos p ON p.id = r.photo_id
         WHERE p.deleted_at IS NULL AND r.category = ANY($1)
           AND ($3::text IS NULL OR r.photo_id = $3) AND ($4::bigint IS NULL OR r.id = $4)
           AND NOT EXISTS (SELECT 1 FROM region_embeddings e WHERE e.region_id = r.id AND e.model = $2)
         ORDER BY r.id LIMIT 20`,
        [EMBED_CATEGORIES, model, photoId, regionId]
    );
    return rows;
}

async function setRegionCropPath(regionId, cropPath) {
    await db.query('UPDATE photo_regions SET crop_path = $2 WHERE id = $1', [regionId, cropPath]);
}

async function recordEmbeddingFailure(regionId, message) {
    await db.query('UPDATE photo_regions SET embed_attempts = embed_attempts + 1, embed_error = $2 WHERE id = $1', [regionId, String(message).slice(0, 500)]);
}

async function saveEmbedding(regionId, model, tenantId, vector) {
    await db.query(
        `INSERT INTO region_embeddings (region_id, model, tenant_id, embedding) VALUES ($1, $2, $3, $4)
         ON CONFLICT (region_id, model) DO UPDATE SET embedding = EXCLUDED.embedding, created_at = now()`,
        [regionId, model, tenantId, `[${vector.join(',')}]`]
    );
    await db.query('UPDATE photo_regions SET embed_error = NULL WHERE id = $1', [regionId]);
}

module.exports = {
    LABEL_CATEGORY,
    EMBED_CATEGORIES,
    categoryFor,
    normalizeBbox,
    bboxEquals,
    toRecord,
    listCrops,
    getCrop,
    createCrop,
    deleteCrop,
    listPhotos,
    getPhotoRow,
    getRecord,
    createPhoto,
    softDeletePhoto,
    updatePhoto,
    syncAnnotations,
    expertReview,
    reviewQueue,
    setAiAnalysis,
    replaceAiDetections,
    regionsNeedingEmbedding,
    unembeddedRegions,
    setRegionCropPath,
    recordEmbeddingFailure,
    saveEmbedding,
};
