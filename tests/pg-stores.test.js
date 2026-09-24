// Integration tests for the PostgreSQL stores. Run against a throwaway database:
//   TEST_DATABASE_URL=postgres://agri:agri_dev@localhost:5432/agri_test node --test tests/pg-stores.test.js
// Skipped when TEST_DATABASE_URL is not set. The schema is dropped and recreated on every run.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const url = process.env.TEST_DATABASE_URL;
const skip = !url && 'TEST_DATABASE_URL not set';
if (url) process.env.DATABASE_URL = url;

const db = require('../lib/db');
const photoStore = require('../lib/photo-store');
const vision = require('../lib/vision');

const T1 = 'tenant_a';
const T2 = 'tenant_b';
const farmer = { userId: 'user_farmer' };

function unitVector(seed) {
    const v = Array.from({ length: vision.EMBEDDING_DIM }, (_, i) => Math.sin(seed * 31 + i * 0.7) + (i === seed ? 5 : 0));
    const norm = Math.hypot(...v);
    return v.map(x => x / norm);
}

async function newPhoto(id, tenantId, cropId = 'crop_1') {
    return photoStore.createPhoto({ id, tenantId, cropId, cropName: '木薯', imagePath: `server-data/photos/${id}.jpg`, uploadedBy: 'u' });
}

before(async () => {
    if (skip) return;
    await db.query(`DROP TABLE IF EXISTS audit_log, farm_tasks, channels, devices, locations, users, tenants,
        region_embeddings, photo_regions, photos, crops, pest_library, sensor_readings, schema_migrations CASCADE`);
    await db.migrate(() => {});
    await photoStore.createCrop({ id: 'crop_1', tenantId: T1, name: '木薯' });
    await photoStore.createCrop({ id: 'crop_2', tenantId: T2, name: '红薯' });
});

after(async () => { await db.close(); });

test('AI detections keep their order and rebuild the legacy shape', { skip }, async () => {
    await newPhoto('p1', T1);
    const raw = { detections: [
        { label: 'insect_visible', bbox: [10, 10, 50, 40], confidence: 0.9, pestGuess: { name: '斜纹夜蛾', reasoning: 'x' } },
        { label: 'soil_crack', bbox: [100, 100, 20, 20], confidence: 0.5 },
    ] };
    const record = await photoStore.replaceAiDetections('p1', T1, raw, 'qwen3-vl-flash');
    assert.equal(record.aiDetections.detections.length, 2);
    assert.equal(record.aiDetections.detections[0].label, 'insect_visible');
    assert.deepEqual(record.aiDetections.detections[0].pestGuess, { name: '斜纹夜蛾', reasoning: 'x' });
    assert.equal(record.aiDetections.detections[0].category, 'pest');
    assert.deepEqual(record.annotations, []);
    assert.equal(record.hasIssue, true);
});

test('other tenants cannot read or edit a photo', { skip }, async () => {
    assert.equal(await photoStore.getRecord('p1', T2), null);
    assert.equal(await photoStore.updatePhoto('p1', T2, { farmNotes: 'x' }, farmer), null);
    assert.ok(await photoStore.getRecord('p1', null)); // platform admin
});

test('farmer confirms an AI box with a species, draws a box, then removes both', { skip }, async () => {
    let record = await photoStore.getRecord('p1', T1);
    const det = record.aiDetections.detections[0];
    record = await photoStore.updatePhoto('p1', T1, { annotations: [
        { id: 'ann_ai', source: 'ai_confirmed', label: det.label, bbox: det.bbox, libraryKey: 'spodoptera-litura' },
        { id: 'ann_h1', source: 'human', label: 'leaf_holes', bbox: [200, 200, 30, 30], libraryKey: 'spodoptera-litura' },
    ] }, farmer);
    assert.equal(record.annotations.length, 2);
    const ai = record.annotations.find(a => a.id === 'ann_ai');
    assert.equal(ai.source, 'ai_confirmed');
    assert.equal(ai.libraryKey, 'spodoptera-litura');
    assert.equal(ai.farmerStatus, 'confirmed');
    // Detection list (index-addressed) is unchanged by confirming.
    assert.equal(record.aiDetections.detections.length, 2);

    // Changing only the species keeps the region, updates the key.
    record = await photoStore.updatePhoto('p1', T1, { annotations: record.annotations.map(a => ({ ...a, libraryKey: a.id === 'ann_h1' ? 'aphid' : a.libraryKey })) }, farmer);
    assert.equal(record.annotations.find(a => a.id === 'ann_h1').libraryKey, 'aphid');

    record = await photoStore.updatePhoto('p1', T1, { annotations: [] }, farmer);
    assert.deepEqual(record.annotations, []);
    assert.equal(record.aiDetections.detections.length, 2, 'unconfirming keeps the AI detection');
});

test('expert review stamps confirmed boxes; any later change sends a box back to the queue', { skip }, async () => {
    let record = await photoStore.getRecord('p1', T1);
    const det = record.aiDetections.detections[0];
    // An admin saving annotations is a normal (farmer-level) confirmation, not an expert approval.
    record = await photoStore.updatePhoto('p1', null, { annotations: [
        { id: 'ann_ex', source: 'ai_confirmed', label: det.label, bbox: det.bbox, libraryKey: 'locust' },
        { id: 'ann_h2', source: 'human', label: 'leaf_holes', bbox: [300, 300, 20, 20], libraryKey: 'locust' },
    ] }, { userId: 'user_admin' });
    assert.ok(record.annotations.every(a => a.farmerStatus === 'confirmed' && a.expertStatus === 'pending'));
    assert.deepEqual(record.review, { pending: 2, approved: 0 });
    assert.ok((await photoStore.reviewQueue()).some(r => r.id === 'p1'));

    record = await photoStore.expertReview('p1', true, 'user_admin');
    assert.ok(record.annotations.every(a => a.expertStatus === 'confirmed'));
    assert.deepEqual(record.review, { pending: 0, approved: 2 });
    assert.ok(!(await photoStore.reviewQueue()).some(r => r.id === 'p1'), 'approved photo leaves the queue');

    // Re-saving unchanged keeps the approval; changing one species sends only that box back.
    record = await photoStore.updatePhoto('p1', T1, { annotations: record.annotations }, farmer);
    assert.deepEqual(record.review, { pending: 0, approved: 2 });
    record = await photoStore.updatePhoto('p1', T1, { annotations: record.annotations.map(a => a.id === 'ann_h2' ? { ...a, libraryKey: 'aphid' } : a) }, farmer);
    assert.equal(record.annotations.find(a => a.id === 'ann_h2').expertStatus, 'pending');
    assert.equal(record.annotations.find(a => a.id === 'ann_ex').expertStatus, 'confirmed');
    assert.ok((await photoStore.reviewQueue()).some(r => r.id === 'p1'));

    // Re-running detection keeps confirmed boxes (as annotations) and replaces the detection list.
    record = await photoStore.replaceAiDetections('p1', T1, { detections: [{ label: 'weed', bbox: [5, 5, 5, 5] }] }, 'qwen3-vl-flash');
    assert.equal(record.aiDetections.detections.length, 1);
    assert.equal(record.aiDetections.detections[0].label, 'weed');
    assert.equal(record.annotations.find(a => a.id === 'ann_ex').libraryKey, 'locust');

    // Revoke clears every stamp.
    record = await photoStore.expertReview('p1', false, 'user_admin');
    assert.equal(record.review.approved, 0);

    // Removing a box drops it entirely, approval included.
    record = await photoStore.updatePhoto('p1', T1, { annotations: record.annotations.filter(a => a.id !== 'ann_ex') }, farmer);
    assert.ok(!record.annotations.some(a => a.id === 'ann_ex'));
});

test('unparseable model output is returned as the raw string', { skip }, async () => {
    await newPhoto('p_raw', T1);
    const record = await photoStore.replaceAiDetections('p_raw', T1, 'sorry, cannot parse', 'm');
    assert.equal(record.aiDetections, 'sorry, cannot parse');
    assert.equal(record.hasIssue, false);
});

test('similarity vote uses confirmed samples from every farm and weights experts higher', { skip }, async () => {
    const model = vision.embeddingModel();
    const regionOf = async (photoId, tenantId, label, key, reviewed) => {
        await newPhoto(photoId, tenantId, tenantId === T1 ? 'crop_1' : 'crop_2');
        const rec = await photoStore.updatePhoto(photoId, tenantId, {
            annotations: [{ id: `ann_${photoId}`, source: 'human', label, bbox: [0, 0, 10, 10], libraryKey: key }],
        }, farmer);
        if (reviewed) await photoStore.expertReview(photoId, true, 'user_admin');
        return rec.annotations[0].regionId;
    };
    // Samples: two farmer-confirmed "aphid" (farm B) near seed 1, one expert "locust" (farm A) near seed 1.
    const s1 = await regionOf('s1', T2, 'insect_visible', 'aphid', false);
    const s2 = await regionOf('s2', T2, 'insect_visible', 'aphid', false);
    const s3 = await regionOf('s3', T1, 'insect_visible', 'locust', true);
    const s4 = await regionOf('s4', T1, 'insect_visible', 'whitefly', false); // far away
    await photoStore.saveEmbedding(s1, model, T2, unitVector(1));
    await photoStore.saveEmbedding(s2, model, T2, unitVector(1));
    await photoStore.saveEmbedding(s3, model, T1, unitVector(1));
    await photoStore.saveEmbedding(s4, model, T1, unitVector(400));

    // Query: a new unconfirmed AI region in farm A.
    await newPhoto('q1', T1);
    await photoStore.replaceAiDetections('q1', T1, { detections: [{ label: 'insect_visible', bbox: [1, 1, 9, 9] }] }, 'm');
    const [queryRegion] = (await db.query(`SELECT id FROM photo_regions WHERE photo_id = 'q1'`)).rows;
    await photoStore.saveEmbedding(queryRegion.id, model, T1, unitVector(1));

    const [result] = await vision.identifyPhoto('q1', { k: 10 });
    assert.equal(result.embedded, true);
    const keys = result.candidates.map(c => c.libraryKey);
    assert.ok(keys.includes('aphid'), 'farm B samples are used for farm A');
    assert.ok(keys.includes('locust'));
    const aphid = result.candidates.find(c => c.libraryKey === 'aphid');
    const locust = result.candidates.find(c => c.libraryKey === 'locust');
    assert.equal(aphid.samples, 2);
    // 2 x 0.5 (farmers) vs 1 x 1.0 (expert): equal weight at equal similarity.
    assert.ok(Math.abs(aphid.confidence - locust.confidence) < 0.05);
    assert.notEqual(result.candidates[0].libraryKey, 'whitefly', 'a distant sample does not win');
    assert.ok(!('photoId' in result.candidates[0]), 'no cross-farm photo ids are exposed');

    // Image search is farm-scoped.
    const sameFarm = await vision.similarRegions(queryRegion.id, T1);
    assert.ok(sameFarm.every(r => ['s3', 's4'].includes(r.photoId)));
    assert.equal(sameFarm[0].photoId, 's3');
});

test('background embedding queue only picks confirmed pest/disease/weed regions without an embedding', { skip }, async () => {
    const pending = await photoStore.regionsNeedingEmbedding(vision.embeddingModel(), 50);
    assert.ok(pending.length > 0);
    assert.ok(pending.every(r => ['pest', 'disease', 'weed'].includes(r.category)));
    assert.ok(pending.every(r => r.farmer_status === 'confirmed' || r.expert_status === 'confirmed'), 'unconfirmed AI boxes wait for on-demand embedding');
    const onDemand = await photoStore.unembeddedRegions(vision.embeddingModel(), { photoId: 'p1' });
    assert.ok(onDemand.some(r => r.farmer_status === 'pending' && r.expert_status === 'pending'), 'on-demand lookup includes unconfirmed boxes');
    const embedded = new Set((await db.query('SELECT region_id FROM region_embeddings')).rows.map(r => String(r.region_id)));
    assert.ok(pending.every(r => !embedded.has(String(r.id))));
});

test('deleting a crop hides its photos', { skip }, async () => {
    assert.equal(await photoStore.deleteCrop('crop_2', T1), false, 'foreign crop');
    assert.equal(await photoStore.deleteCrop('crop_2', T2), true);
    assert.equal(await photoStore.getRecord('s1', T2), null);
    assert.equal((await photoStore.listPhotos({ tenantId: T2 })).length, 0);
});
