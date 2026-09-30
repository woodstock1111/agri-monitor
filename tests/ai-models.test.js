const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../lib/ai-models');

test('stored configs holding a replaced default move to the current model; other choices are kept',()=>{
  assert.equal(M.visionModel({visionModel:'qwen-vl-plus'}),M.VISION_MODEL);
  assert.equal(M.visionModel({visionModel:'qwen3-vl-flash'}),M.VISION_MODEL);
  assert.equal(M.textModel({textModel:'qwen-turbo'}),M.TEXT_MODEL);
  assert.equal(M.textModel({}),M.TEXT_MODEL);
  assert.equal(M.textModel({textModel:' qwen3.6-plus '}),'qwen3.6-plus');
});

test('0–1000 corner boxes become pixel [x, y, w, h] for the real image size',()=>{
  // Measured on a 900x1200 photo: a spider mite at [248,429,282,451].
  assert.deepEqual(M.detectionBoxToPixels([248,429,282,451],900,1200),[223,515,31,26]);
  assert.deepEqual(M.detectionBoxToPixels([596,630,482,298],1000,1000),[482,298,114,332],'swapped corners are ordered');
  assert.deepEqual(M.detectionBoxToPixels([-5,0,1200,1000],100,100),[0,0,100,100],'clamped to the image');
  for(const bad of [[1,2,3],[1,1,1,50],['a',1,2,3],null])assert.equal(M.detectionBoxToPixels(bad,100,100),null);
});
