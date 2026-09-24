// One-time import of the JSON data files into PostgreSQL. Safe to re-run: existing rows are skipped.
//
//   node scripts/backfill-from-json.js --dry-run            # counts only, writes nothing
//   node scripts/backfill-from-json.js                      # import from ./server-data
//   node scripts/backfill-from-json.js --data-dir /path/to/server-data
//
// Run it with the server STOPPED: the server clears readings out of app-state.json on its first save.
// Imports: non-empty sensor readings (kind 'migrated'; the ~61k empty offline readings are dropped),
// pest library, crops, photos (+ AI detections and annotations as photo_regions).
require('../lib/env').loadEnv();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const db = require('../lib/db');
const sensorStore = require('../lib/sensor-store');
const photoStore = require('../lib/photo-store');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dataDirArg = args.indexOf('--data-dir');
const DATA_DIR = path.resolve(dataDirArg >= 0 ? args[dataDirArg + 1] : path.join(__dirname, '..', 'server-data'));
const ROOT_DIR = path.dirname(DATA_DIR);
const DEFAULT_TENANT_ID = 'tenant_default';

function readJson(name, fallback) {
    const file = path.join(DATA_DIR, name);
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const asList = value => (Array.isArray(value) ? value.filter(Boolean) : (value ? [value] : []));

async function importReadings(state, summary) {
    const deviceTenant = new Map((state.devices || []).map(dev => [dev.id, dev.tenantId || DEFAULT_TENANT_ID]));
    const all = state.sensorReadings || [];
    const rows = all
        .filter(item => item && item.deviceId && Object.keys(item.values || {}).length && Number.isFinite(Number(item.deviceTimestamp)))
        .map(item => ({
            tenantId: item.tenantId || deviceTenant.get(item.deviceId) || DEFAULT_TENANT_ID,
            deviceId: item.deviceId,
            provider: item.provider || '0531yun',
            ts: Number(item.deviceTimestamp),
            kind: 'migrated',
            values: item.values || {},
            externalValues: item.externalValues || {},
        }));
    summary.readings = { inJson: all.length, empty: all.length - rows.length, toImport: rows.length, inserted: 0 };
    if (!dryRun) summary.readings.inserted = await sensorStore.insertReadings(rows);
}

async function importPestLibrary(library, summary) {
    const entries = library.entries || [];
    const seen = new Set();
    const duplicates = [];
    let inserted = 0;
    for (const entry of entries) {
        if (!entry?.type || !entry.key || !entry.name) continue;
        const key = `${entry.type}|${entry.key}`;
        if (seen.has(key)) { duplicates.push(`${entry.type}:${entry.key} (${entry.name})`); continue; }
        seen.add(key);
        if (dryRun) continue;
        const result = await db.query(
            `INSERT INTO pest_library (id, type, key, name, symptoms, control, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now())) ON CONFLICT DO NOTHING`,
            [entry.id, entry.type, entry.key, entry.name, entry.symptoms || '', entry.control || '', entry.createdAt || null]
        );
        inserted += result.rowCount;
    }
    summary.pestLibrary = { inJson: entries.length, duplicatesSkipped: duplicates, inserted };
}

async function importCrops(photoData, summary) {
    let inserted = 0;
    for (const crop of photoData.crops || []) {
        if (!crop?.id || dryRun) continue;
        const result = await db.query(
            `INSERT INTO crops (id, tenant_id, name, variety, location_id, location_desc, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now())) ON CONFLICT DO NOTHING`,
            [crop.id, crop.tenantId || DEFAULT_TENANT_ID, crop.name || '', crop.variety || '', crop.locationId || '', crop.locationDesc || '', crop.createdAt || null]
        );
        inserted += result.rowCount;
    }
    summary.crops = { inJson: (photoData.crops || []).length, inserted };
}

async function fileInfo(imagePath) {
    const file = path.join(ROOT_DIR, imagePath || '');
    if (!imagePath || !fs.existsSync(file)) return null;
    const buffer = fs.readFileSync(file);
    const meta = await sharp(buffer).metadata().catch(() => ({}));
    const rotated = (meta.orientation || 1) >= 5;
    return {
        width: rotated ? meta.height : meta.width,
        height: rotated ? meta.width : meta.height,
        bytes: buffer.length,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    };
}

async function importPhotos(photoData, summary) {
    const cropIds = new Set((photoData.crops || []).map(crop => crop.id));
    const stats = { inJson: (photoData.records || []).length, inserted: 0, alreadyPresent: 0, missingFile: 0, orphanCrop: 0, aiRegions: 0, annotations: 0, speciesInferred: 0 };
    for (const record of photoData.records || []) {
        if (!record?.id || !record.imagePath) continue;
        const info = await fileInfo(record.imagePath);
        if (!info) stats.missingFile += 1;
        if (record.cropId && !cropIds.has(record.cropId)) stats.orphanCrop += 1;
        const detections = record.aiDetections && typeof record.aiDetections === 'object' ? asList(record.aiDetections.detections) : [];
        stats.aiRegions += detections.length;
        stats.annotations += asList(record.annotations).length;
        if (dryRun) continue;
        if ((await db.query('SELECT 1 FROM photos WHERE id = $1', [record.id])).rowCount) { stats.alreadyPresent += 1; continue; }

        const tenantId = record.tenantId || DEFAULT_TENANT_ID;
        await photoStore.createPhoto({
            id: record.id,
            tenantId,
            cropId: record.cropId && cropIds.has(record.cropId) ? record.cropId : null,
            cropName: record.cropName || '',
            source: record.source || 'upload',
            capturedAt: record.createdAt || null,
            uploadedAt: record.uploadedAt || record.createdAt || new Date(),
            imagePath: record.imagePath,
            ...(info || {}),
            gps: record.gps ?? null,
            weather: record.weather ?? null,
            linkedSensors: asList(record.linkedSensors),
            userNotes: record.userNotes || '',
            farmNotes: record.farmNotes || '',
            labels: record.labels ?? null,
        });
        if (record.aiDetections !== null && record.aiDetections !== undefined) {
            await photoStore.replaceAiDetections(record.id, null, record.aiDetections, 'legacy');
        }
        if (asList(record.annotations).length) {
            await photoStore.syncAnnotations(record.id, null, asList(record.annotations), { userId: null, expert: false });
        }
        if (record.analysis || record.aiAnalysis) await photoStore.setAiAnalysis(record.id, record.aiAnalysis ?? record.analysis);

        // Species were recorded per photo; when a category has exactly one species, apply it to that category's boxes.
        const labels = record.labels || {};
        const perCategory = {
            pest: asList(labels.pestDetail?.species),
            disease: asList(labels.diseaseDetail?.types),
            weed: asList(labels.weedDetail?.types),
        };
        for (const [category, keys] of Object.entries(perCategory)) {
            if (keys.length !== 1) continue;
            const result = await db.query(
                'UPDATE photo_regions SET library_key = $3 WHERE photo_id = $1 AND category = $2 AND library_key IS NULL',
                [record.id, category, String(keys[0])]
            );
            stats.speciesInferred += result.rowCount;
        }
        stats.inserted += 1;
    }
    summary.photos = stats;
}

async function main() {
    console.log(`[Backfill] data dir: ${DATA_DIR}${dryRun ? '  (DRY RUN — nothing is written)' : ''}`);
    await db.migrate();
    const state = readJson('app-state.json', {});
    const photoData = readJson('photo-records.json', {});
    const library = readJson('pest-library.json', { entries: [] });
    const summary = {};
    await importPestLibrary(library, summary);
    await importCrops(photoData, summary);
    await importPhotos(photoData, summary);
    await importReadings(state, summary);
    console.log(JSON.stringify(summary, null, 2));
}

main()
    .catch(error => { console.error('[Backfill] failed:', error); process.exitCode = 1; })
    .finally(() => db.close());
