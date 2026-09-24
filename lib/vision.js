// Region crops, embeddings and similarity-based identification.
//
// Only detection-box crops are embedded (never whole photos): a pest is usually a small part of the frame.
// Identification votes over confirmed regions from ALL farms — pest appearance does not depend on the field, and
// the result only exposes species keys and scores, never another farm's photos.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const db = require('./db');
const photoStore = require('./photo-store');

const EMBEDDING_DIM = 1024;
const CROP_MAX_SIDE = 512;
const CROP_PADDING = 0.1; // grow each box by 10% per side so the crop keeps a little context
const SAMPLE_WEIGHT = { expert: 1.0, farmer: 0.5 };
// Samples less similar than this do not vote: with few samples, one weak match would otherwise read as "100%".
const MIN_SIMILARITY = Number(process.env.IDENTIFY_MIN_SIMILARITY || 0.6);
const EMBED_URL = 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding';

function embeddingModel() {
    return process.env.EMBEDDING_MODEL || 'qwen3-vl-embedding';
}

// Writes the crop for a region to server-data/crops/<YYYY-MM>/<regionId>.jpg and returns its project-relative path.
async function cropRegion(rootDir, region) {
    const source = path.join(rootDir, region.image_path);
    const image = sharp(source).rotate();
    const meta = await image.metadata();
    const width = meta.autoOrient?.width || meta.width;
    const height = meta.autoOrient?.height || meta.height;
    const [x, y, w, h] = region.bbox;
    const padX = Math.round(w * CROP_PADDING);
    const padY = Math.round(h * CROP_PADDING);
    const left = Math.max(0, Math.min(width - 1, x - padX));
    const top = Math.max(0, Math.min(height - 1, y - padY));
    const cropW = Math.max(1, Math.min(width - left, w + padX * 2));
    const cropH = Math.max(1, Math.min(height - top, h + padY * 2));
    const month = new Date(region.created_at || Date.now()).toISOString().slice(0, 7);
    const relative = path.join('server-data', 'crops', month, `${region.id}.jpg`);
    fs.mkdirSync(path.join(rootDir, path.dirname(relative)), { recursive: true });
    await image
        .extract({ left, top, width: cropW, height: cropH })
        .resize(CROP_MAX_SIDE, CROP_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toFile(path.join(rootDir, relative));
    return relative;
}

async function embedImage(requestJson, apiKey, jpegBuffer) {
    const model = embeddingModel();
    const body = {
        model,
        input: { contents: [{ image: `data:image/jpeg;base64,${jpegBuffer.toString('base64')}` }] },
    };
    if (model !== 'multimodal-embedding-v1') body.parameters = { dimension: EMBEDDING_DIM };
    const result = await requestJson(EMBED_URL, {
        method: 'POST',
        timeout: 30000,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    }, JSON.stringify(body));
    const vector = result.data?.output?.embeddings?.[0]?.embedding;
    if (result.status >= 400 || !Array.isArray(vector)) {
        throw new Error(result.data?.message || result.data?.code || `embedding request failed (${result.status})`);
    }
    if (vector.length !== EMBEDDING_DIM) throw new Error(`unexpected embedding size ${vector.length}`);
    return vector;
}

// Set once at startup by the server: where images live, the HTTP client and the DashScope key source.
const runtime = { rootDir: null, requestJson: null, getApiKey: () => '', log: console };

function configure(options) {
    Object.assign(runtime, options);
}

async function embedRegion(region) {
    const apiKey = runtime.getApiKey();
    if (!apiKey) throw new Error('vision_api_not_configured');
    let cropPath = region.crop_path;
    if (!cropPath || !fs.existsSync(path.join(runtime.rootDir, cropPath))) {
        cropPath = await cropRegion(runtime.rootDir, region);
        await photoStore.setRegionCropPath(region.id, cropPath);
    }
    const vector = await embedImage(runtime.requestJson, apiKey, fs.readFileSync(path.join(runtime.rootDir, cropPath)));
    await photoStore.saveEmbedding(region.id, embeddingModel(), region.tenant_id, vector);
}

async function embedAll(regions) {
    for (const region of regions) {
        try {
            await embedRegion(region);
        } catch (error) {
            runtime.log.warn(`[Embedding] region=${region.id} failed:`, error.message);
            await photoStore.recordEmbeddingFailure(region.id, error.message);
        }
    }
}

// On-demand: embeds the photo's (or the region's) not-yet-embedded boxes before identifying / searching.
async function ensureEmbedded(target) {
    if (!runtime.getApiKey()) return;
    await embedAll(await photoStore.unembeddedRegions(embeddingModel(), target));
}

// Background worker: embeds confirmed regions (the samples) that have no embedding for the current model yet.
function startEmbeddingWorker({ intervalMs = 20000, batchSize = 5 } = {}) {
    let running = false;
    const tick = async () => {
        if (running || !runtime.getApiKey()) return;
        running = true;
        try {
            await embedAll(await photoStore.regionsNeedingEmbedding(embeddingModel(), batchSize));
        } catch (error) {
            runtime.log.warn('[Embedding] worker error:', error.message);
        } finally {
            running = false;
        }
    };
    const timer = setInterval(() => { void tick(); }, intervalMs);
    timer.unref?.();
    return { tick, stop: () => clearInterval(timer) };
}

// Confirmed sample regions nearest to `regionId`, from every farm. Excludes regions of the same photo.
async function nearestSamples(regionId, k = 10) {
    const model = embeddingModel();
    return db.withTransaction(async client => {
        // Filtered HNSW scans return at most ef_search candidates before filtering; widen it.
        await client.query('SET LOCAL hnsw.ef_search = 200');
        const { rows } = await client.query(
            `WITH q AS (
                 SELECT e.embedding, r.photo_id FROM region_embeddings e JOIN photo_regions r ON r.id = e.region_id
                 WHERE e.region_id = $1 AND e.model = $2
             )
             SELECT r.id, r.photo_id, r.tenant_id, r.label, r.category,
                    COALESCE(r.expert_library_key, r.library_key) AS library_key,
                    r.expert_status, r.farmer_status,
                    1 - (e.embedding <=> q.embedding) AS similarity
             FROM q, region_embeddings e
             JOIN photo_regions r ON r.id = e.region_id
             JOIN photos p ON p.id = r.photo_id
             WHERE e.model = $2 AND r.photo_id <> q.photo_id AND p.deleted_at IS NULL
               AND COALESCE(r.expert_library_key, r.library_key) IS NOT NULL
               AND (r.expert_status = 'confirmed' OR (r.farmer_status = 'confirmed' AND r.expert_status <> 'rejected'))
             ORDER BY e.embedding <=> q.embedding
             LIMIT $3`,
            [regionId, model, k]
        );
        return rows;
    });
}

// Weighted vote over the nearest confirmed samples -> [{ libraryKey, score, confidence, samples }], best first.
function voteOnSamples(samples, minSimilarity = MIN_SIMILARITY) {
    const tally = new Map();
    let total = 0;
    samples.filter(sample => Number(sample.similarity) >= minSimilarity).forEach(sample => {
        const weight = sample.expert_status === 'confirmed' ? SAMPLE_WEIGHT.expert : SAMPLE_WEIGHT.farmer;
        const score = Math.max(0, Number(sample.similarity)) * weight;
        total += score;
        const entry = tally.get(sample.library_key) || { libraryKey: sample.library_key, score: 0, samples: 0, bestSimilarity: 0 };
        entry.score += score;
        entry.samples += 1;
        entry.bestSimilarity = Math.max(entry.bestSimilarity, Number(sample.similarity));
        tally.set(sample.library_key, entry);
    });
    return [...tally.values()]
        .map(entry => ({ ...entry, confidence: total > 0 ? entry.score / total : 0 }))
        .sort((a, b) => b.score - a.score);
}

// Candidate species for each embedded issue region of a photo. Returns only keys/scores, never other farms' data.
async function identifyPhoto(photoId, { k = 10, top = 3 } = {}) {
    await ensureEmbedded({ photoId });
    const { rows: regions } = await db.query(
        `SELECT r.id, r.label, r.category, r.bbox, r.ai_guess, COALESCE(r.expert_library_key, r.library_key) AS library_key,
                EXISTS (SELECT 1 FROM region_embeddings e WHERE e.region_id = r.id AND e.model = $2) AS embedded
         FROM photo_regions r WHERE r.photo_id = $1 AND r.category = ANY($3) ORDER BY r.seq, r.id`,
        [photoId, embeddingModel(), photoStore.EMBED_CATEGORIES]
    );
    const results = [];
    for (const region of regions) {
        const candidates = region.embedded ? voteOnSamples(await nearestSamples(region.id, k)).slice(0, top) : [];
        results.push({
            regionId: String(region.id),
            label: region.label,
            category: region.category,
            bbox: region.bbox,
            confirmedKey: region.library_key,
            aiGuess: region.ai_guess,
            embedded: region.embedded,
            candidates: candidates.map(c => ({
                libraryKey: c.libraryKey,
                confidence: Number(c.confidence.toFixed(3)),
                bestSimilarity: Number(c.bestSimilarity.toFixed(3)),
                samples: c.samples,
            })),
        });
    }
    return results;
}

// Image search inside one farm (tenantId null = all farms, platform admins only): nearest regions of any status.
async function similarRegions(regionId, tenantId, k = 12) {
    await ensureEmbedded({ regionId });
    const model = embeddingModel();
    return db.withTransaction(async client => {
        await client.query('SET LOCAL hnsw.ef_search = 200');
        const params = [regionId, model, k];
        let tenantFilter = '';
        if (tenantId) { params.push(tenantId); tenantFilter = `AND e.tenant_id = $${params.length}`; }
        const { rows } = await client.query(
            `WITH q AS (SELECT embedding FROM region_embeddings WHERE region_id = $1 AND model = $2)
             SELECT r.id, r.photo_id, r.label, r.bbox, COALESCE(r.expert_library_key, r.library_key) AS library_key,
                    p.captured_at, p.uploaded_at, p.crop_name, 1 - (e.embedding <=> q.embedding) AS similarity
             FROM q, region_embeddings e
             JOIN photo_regions r ON r.id = e.region_id
             JOIN photos p ON p.id = r.photo_id
             WHERE e.model = $2 AND e.region_id <> $1 AND p.deleted_at IS NULL ${tenantFilter}
             ORDER BY e.embedding <=> q.embedding
             LIMIT $3`,
            params
        );
        return rows.map(row => ({
            regionId: String(row.id),
            photoId: row.photo_id,
            imageUrl: `/api/v1/photos/records/${row.photo_id}/image`,
            cropUrl: `/api/v1/photos/regions/${row.id}/crop`,
            label: row.label,
            bbox: row.bbox,
            libraryKey: row.library_key,
            cropName: row.crop_name,
            capturedAt: (row.captured_at || row.uploaded_at)?.toISOString?.() || null,
            similarity: Number(Number(row.similarity).toFixed(3)),
        }));
    });
}

module.exports = {
    EMBEDDING_DIM,
    MIN_SIMILARITY,
    embeddingModel,
    configure,
    cropRegion,
    embedImage,
    ensureEmbedded,
    startEmbeddingWorker,
    nearestSamples,
    voteOnSamples,
    identifyPhoto,
    similarRegions,
};
