#!/usr/bin/env node
'use strict';
// Year-by-year diagnostics for the harvest model: weather drivers, growth, caps and economics.
// Usage: node scripts/diagnose-harvest.js weather.json [date=2026-04-15] [crop=sweetpotato] [drainage=unknown] [json]
// weather.json is an Open-Meteo archive response with the six daily variables used by the web page.
const fs=require('node:fs');
const m=require('../harvest-model');
function diagnose(data,{date='2026-04-15',crop='sweetpotato',drainage='unknown',years=10,asOf='2026-09-28',overrides={}}={}) {
  const days=m.crops[crop].days,seasons=m.historicalSeasons(date,days,years,asOf);
  const {included,excluded}=m.extractSeasons(data.daily,seasons,data.latitude);
  const p={lat:data.latitude,lng:data.longitude,area:10,days,ph:6,n:60,p:12,k:80,budget:250,price:2,base:1000,fertPrice:3,crop,date,water:'sufficient',drainage,risk:'cautious',...overrides};
  const r=m.evaluateEnsemble(p,included);
  return {input:p,excluded,climateScore:r.climateScore,siteScore:r.siteScore,factors:r.factors.map(f=>({id:f.id,score:f.score,status:f.status})),explanations:r.explanations,
    rows:r.yearly.map(y=>({year:y.year,meanT:y.meanT,meanTmax:y.meanTmax,minTmin:y.minTmin,radiation:y.radiation,rain:y.rain,irrigation:y.irrigation,chillDays:y.chillDays,frostRiskDays:y.frostRiskDays,heatDays:y.heatDays,
      anoxicDays:y.anoxicDays,longestWet:y.longestWet,stage:y.stageAtHarvest,progress:y.progress,laiMax:y.laiMax,biomassKgHa:y.biomassKgHa,storageDryKgHa:y.storageDryKgHa,hi:y.harvestIndex,
      climateFreshMu:y.climateFreshMu,phFreshMu:y.phFreshMu,freshMu:y.fresh,saleableMu:y.saleable,revenue:y.revenue,costs:y.costs,net:y.net,flags:y.flags}))};
}
function print(d) {
  const f=(x,n=0,w=6)=>(x===null||x===undefined||!Number.isFinite(x)?'—':x.toFixed(n)).padStart(w);
  console.log(`${d.input.crop} ${d.input.date} lat ${d.input.lat} lng ${d.input.lng} drainage=${d.input.drainage} · climate ${d.climateScore} · site ${d.siteScore}`);
  console.log('factors',d.factors.map(x=>x.id+':'+x.score).join(' '));
  console.log('  year  Tavg  Tmax  Tmin  SW_MJ  rain   irr chill frost heat anox wetRun stage%  LAI  biomass storDM  clim/mu  pH/mu  fresh/mu  revenue    cost     net  caps');
  for(const r of d.rows){const cost=r.costs.base+r.costs.fertilizer+r.costs.harvest+(r.costs.irrigation??0);
    console.log(' ',r.year,f(r.meanT,1),f(r.meanTmax,1),f(r.minTmin,1),f(r.radiation,0,6),f(r.rain,0,5),f(r.irrigation,0,5),f(r.chillDays,0,5),f(r.frostRiskDays,0,5),f(r.heatDays,0,4),f(r.anoxicDays,0,4),f(r.longestWet,0,6),f(r.progress*100,0,6),f(r.laiMax,1,4),f(r.biomassKgHa,0,8),f(r.storageDryKgHa,0,6),f(r.climateFreshMu,0,8),f(r.phFreshMu,0,6),f(r.freshMu,0,9),f(r.revenue,0,8),f(cost,0,7),f(r.net,0,7),
      [r.flags.nutrientLimited&&'NUTRIENT',r.flags.calibrationCapped&&'CALIB-CAP',r.flags.implausible&&'IMPLAUSIBLE'].filter(Boolean).join(','));}
  d.explanations.forEach(e=>console.log('  →',e));
}
if(require.main===module){const [file,date,crop,drainage,json]=process.argv.slice(2);if(!file){console.error('用法: node scripts/diagnose-harvest.js weather.json [date] [crop] [drainage] [json]');process.exit(1);}
  const d=diagnose(JSON.parse(fs.readFileSync(file,'utf8')),{date,crop,drainage});json?console.log(JSON.stringify(d,null,2)):print(d);}
module.exports={diagnose};
