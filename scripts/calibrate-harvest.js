#!/usr/bin/env node
'use strict';
// Fit only an overall yield bias. Never auto-promote a candidate to production.
const fs=require('node:fs');
const crypto=require('node:crypto');
const model=require('../harvest-model');
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
function prediction(r,scale=1) {return mean(r.prediction.rawYears.map(y=>Math.min(y.freshKgHa*scale,y.waterLimitKgHa)));}
function metrics(rows,scale) {
  const errors=rows.map(r=>prediction(r,scale)-r.observedFreshKgHa);
  return {n:rows.length,mae:mean(errors.map(Math.abs)),rmse:Math.sqrt(mean(errors.map(e=>e*e))),bias:mean(errors)};
}
function fit(records) {
  if(!Array.isArray(records)||records.length<2)throw Error('需要带train/validation划分的实收记录数组');
  const first=records[0],ids=new Set();
  for(const r of records) {
    if(!r.id||ids.has(r.id)||typeof r.fieldId!=='string'||!r.fieldId.trim())throw Error('记录ID须唯一且必须有地块ID');ids.add(r.id);
    if(!['train','validation'].includes(r.split)||!Number.isInteger(r.seasonYear))throw Error('请明确train/validation和收获季年份');
    if(!['sweetpotato','cassava'].includes(r.crop)||r.crop!==first.crop||r.variety!==first.variety||typeof r.variety!=='string')throw Error('每次只校准同一作物、同一品种分组');
    if(!Number.isFinite(r.lat)||Math.abs(r.lat)>90||!Number.isFinite(r.lng)||Math.abs(r.lng)>180||!Number.isFinite(r.observedFreshKgHa)||r.observedFreshKgHa<0||r.observedFreshKgHa>500000)throw Error('坐标或实收鲜重kg/ha无效');
    const p=r.prediction;
    if(p?.engineVersion!==model.VERSION||p?.parameterVersion!==model.PARAMETER_VERSION||p.calibrationId||p.sourceKind!=='history')throw Error('请使用本模型版本、未校准、真实历史天气的预测记录');
    if(!Array.isArray(p.rawYears)||!p.rawYears.length||p.rawYears.some(y=>!Number.isFinite(y.freshKgHa)||y.freshKgHa<0||!Number.isFinite(y.waterLimitKgHa)||y.waterLimitKgHa<y.freshKgHa))throw Error('预测原始年景记录无效');
    if(!/^\d{4}-\d{2}-\d{2}/.test(p.generatedAt||'')||!/^\d{4}-\d{2}-\d{2}$/.test(r.harvestDate||'')||!Number.isFinite(Date.parse(r.harvestDate))||p.generatedAt.slice(0,10)>r.harvestDate||Number(r.harvestDate.slice(0,4))!==r.seasonYear)throw Error('预测必须在实收前形成；请核对收获日期和季节年份');
  }
  const train=records.filter(r=>r.split==='train'),validation=records.filter(r=>r.split==='validation');
  if(!train.length||!validation.length)throw Error('训练集和验证集都不能为空');
  const fields=new Set(train.map(r=>r.fieldId));
  if(validation.some(r=>fields.has(r.fieldId)))throw Error('训练和验证不能共享地块，防止数据泄漏');
  if(Math.max(...train.map(r=>r.seasonYear))>=Math.min(...validation.map(r=>r.seasonYear)))throw Error('验证年份必须晚于全部训练年份');
  let scale=1,loss=metrics(train,1).mae;
  for(let i=50;i<=150;i++){const candidate=i/100,mae=metrics(train,candidate).mae;if(mae<loss-1e-9){loss=mae;scale=candidate;}}
  const before=metrics(validation,1),after=metrics(validation,scale);
  const eligible=train.length>=10&&validation.length>=5&&fields.size>=3&&new Set(validation.map(r=>r.fieldId)).size>=3&&after.mae<before.mae&&after.rmse<=before.rmse;
  const hash=crypto.createHash('sha256').update(JSON.stringify(records)).digest('hex');
  // Scope is the observed geographic envelope. It must not silently expand to a country.
  return {schema:'harvest-calibration-v1',status:'candidate',id:'yield-bias-'+hash.slice(0,12),engineVersion:model.VERSION,parameterVersion:model.PARAMETER_VERSION,
    createdAt:new Date().toISOString(),scope:{crop:first.crop,variety:first.variety,bbox:[Math.min(...records.map(r=>r.lng)),Math.min(...records.map(r=>r.lat)),Math.max(...records.map(r=>r.lng)),Math.max(...records.map(r=>r.lat))]},yieldScale:scale,
    training:{before:metrics(train,1),after:metrics(train,scale)},validation:{before,after,eligibleForReview:eligible},datasetHash:hash,
    note:'仅校正整体预测偏差，不是生理/养分参数标定。必须人工审核适用区域、样本代表性和独立验证后改为approved；样本门槛不是精度保证。'};
}
if(require.main===module){try{const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('用法: node scripts/calibrate-harvest.js observations.json candidate.json');const candidate=fit(JSON.parse(fs.readFileSync(input,'utf8')));fs.writeFileSync(output,JSON.stringify(candidate,null,2)+'\n');console.log(JSON.stringify(candidate.validation,null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={fit,metrics,prediction};
