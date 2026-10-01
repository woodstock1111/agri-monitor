'use strict';
// DashScope chat models used by the web and the mini program. All calls turn thinking off: qwen3.x models think by
// default, which took ~16 s per photo instead of ~3 s with the same answer.
//
// Chosen 2026-09 after DashScope announced retirements: on real field photos qwen3.7-plus named the pest consistently
// (flash models disagreed) and drew tight boxes with the 0–1000 corner format below.
const VISION_MODEL = 'qwen3.7-plus';
const TEXT_MODEL = 'qwen3.7-plus';
// Small, fast model for the 小薯 input guard (topic + injection check, ~0.4 s). Falls back to TEXT_MODEL on error.
const GUARD_MODEL = process.env.AGENT_GUARD_MODEL || 'qwen3.7-flash';

// Names this app used to save as defaults. A stored config still holding one of them gets the current model, so a
// retirement does not need a manual settings change. Anything else an admin typed is kept as is.
const REPLACED = new Set(['qwen-vl-plus', 'qwen-vl-max', 'qwen3-vl-flash', 'qwen3-vl-plus', 'glm-4v', 'qwen-turbo', 'qwen3-fast']);

function pick(name, current) {
    const value = String(name || '').trim();
    return !value || REPLACED.has(value) ? current : value;
}

const visionModel = config => pick(config && config.visionModel, VISION_MODEL);
const textModel = config => pick(config && config.textModel, TEXT_MODEL);

// Region detection asks for [x1, y1, x2, y2] on a 0–1000 grid, the format qwen3.x vision models return reliably.
// Stored and drawn boxes are [x, y, width, height] in image pixels.
function detectionBoxToPixels(bbox, width, height) {
    if (!Array.isArray(bbox) || bbox.length !== 4) return null;
    const v = bbox.map(n => Math.min(1000, Math.max(0, Number(n))));
    if (!v.every(Number.isFinite) || !(width > 0) || !(height > 0)) return null;
    const [x1, x2] = v[0] <= v[2] ? [v[0], v[2]] : [v[2], v[0]];
    const [y1, y2] = v[1] <= v[3] ? [v[1], v[3]] : [v[3], v[1]];
    if (x2 === x1 || y2 === y1) return null;
    const sx = width / 1000, sy = height / 1000;
    return [Math.round(x1 * sx), Math.round(y1 * sy), Math.round((x2 - x1) * sx), Math.round((y2 - y1) * sy)];
}

module.exports = { VISION_MODEL, TEXT_MODEL, GUARD_MODEL, visionModel, textModel, detectionBoxToPixels };
