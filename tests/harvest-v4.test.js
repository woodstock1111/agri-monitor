const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const m=require('../harvest-model');
// Nutrients high enough that QUEFTS does not dominate, so weather effects stay visible.
const p={lat:20,lng:110,area:10,days:150,ph:6,n:500,p:500,k:1000,budget:0,price:2,base:1000,fertPrice:3,crop:'sweetpotato',date:'2026-04-15',water:'sufficient',drainage:'good',risk:'balanced'};
function weather({days=150,t=26,min=t-6,max=t+6,rain=4,sw=18,et0=3}={}) {
  return {temperature_2m_mean:Array(days).fill(t),temperature_2m_min:Array(days).fill(min),temperature_2m_max:Array(days).fill(max),
    precipitation_sum:Array.isArray(rain)?rain:Array(days).fill(rain),et0_fao_evapotranspiration:Array(days).fill(et0),shortwave_radiation_sum:Array(days).fill(sw)};
}
const fresh=(input,daily)=>m.evaluate(input,daily).best.fresh;

test('identical input gives identical output; the model has no random terms',()=>{
 const a=m.evaluate(p,weather()),b=m.evaluate(p,weather());
 assert.equal(JSON.stringify(a),JSON.stringify(b));
 assert.doesNotMatch(fs.readFileSync(require.resolve('../harvest-model'),'utf8'),/Math\.random/);
});

test('radiation, cold and heat each move yield when nutrients are not limiting',()=>{
 const base=fresh(p,weather());
 assert(m.evaluate(p,weather()).yearly[0].flags.nutrientLimited===false);
 assert(fresh(p,weather({sw:12}))<base*.85,'less light, less growth');
 assert(fresh(p,weather({sw:24}))>base*1.1,'more light, more growth');
 assert(fresh(p,weather({t:16,min:11,max:21}))<base*.8,'cool season');
 assert(fresh(p,weather({t:33,min:27,max:41}))<base*.8,'hot days');
});

test('hot days with cool nights are not averaged into an optimal day',()=>{
 const even=m.simulateSeason(p,weather({t:27,min:24,max:30})),swing=m.simulateSeason(p,weather({t:27,min:14,max:40}));
 assert(swing.temperature.growthIndex<even.temperature.growthIndex);
 assert(swing.temperature.heatDays>0);assert.equal(even.temperature.heatDays,0);
});

test('8 °C minimum is a cold limitation and chilling risk, never reported as frost',()=>{
 const r=m.evaluate(p,weather({t:14,min:8,max:20})),t=r.factors.find(f=>f.id==='temperature');
 assert(t.score<60);assert.equal(t.status,'unfavorable');
 assert.equal(r.simulations[0].temperature.frostRiskDays,0);assert(r.simulations[0].temperature.chillDays>0);
 assert.equal(t.risks.find(x=>x.id==='frost-risk').level,'none');assert.match(t.risks.find(x=>x.id==='chill').text,/不等于霜冻/);
 assert.doesNotMatch(JSON.stringify(t),/已发生霜冻|出现霜冻/);
 const frost=m.evaluate(p,weather({t:6,min:-1,max:13})).factors.find(f=>f.id==='temperature').risks.find(x=>x.id==='frost-risk');
 assert.equal(frost.level,'high');assert.match(frost.text,/不能证明地块实际结霜/);
});

test('sufficient irrigation removes drought but not sustained waterlogging',()=>{
 const dry=m.simulateSeason(p,weather({rain:0}));
 assert.equal(dry.stressDays,0);assert(dry.irrigation>0);
 const wet=m.evaluate({...p,drainage:'poor'},weather({rain:30}));
 assert.equal(wet.simulations[0].stressDays,0);assert(wet.simulations[0].anoxicDays>20);
 assert(wet.factors.find(f=>f.id==='wetness').score<80);
 assert(!wet.factors.some(f=>f.id==='water'),'default irrigation is an assumption, not a scored factor');
});

test('a multi-day waterlogging spell differs from one heavy day that drains in time; water is conserved',()=>{
 const oneDay=Array(150).fill(2);oneDay[60]=150;
 const spell=Array(150).fill(2);for(let i=60;i<66;i++)spell[i]=60;
 const baseline=m.simulateSeason(p,weather({rain:2})),quick=m.simulateSeason({...p,drainage:'good'},weather({rain:oneDay})),slow=m.simulateSeason({...p,drainage:'poor'},weather({rain:spell}));
 for(const s of [baseline,quick,slow]){assert(Math.abs(s.massBalanceError)<1e-6);s.trace.forEach(d=>{assert(d.storage>=-1e-9&&d.storage<=d.capacity+d.excessCapacity+1e-9);assert(d.pond>=0);});}
 assert(quick.longestWet<=1);assert(quick.storageDryKgHa>baseline.storageDryKgHa*.98,'one drained day barely matters');
 assert(slow.longestWet>=4);assert(slow.pondDays>0);assert(slow.storageDryKgHa<baseline.storageDryKgHa*.9);
});

test('water balance closes for every texture and drainage class under heavy rain',()=>{
 const rain=Array.from({length:150},(_,i)=>i%9===0?140:i%4===0?25:0);
 for(const texture of Object.keys(m.textures))for(const drainage of ['good','moderate','poor'])for(const water of ['rain','irrigated','sufficient']){
  const s=m.simulateSeason({...p,texture,drainage,water},weather({rain}));assert(Math.abs(s.massBalanceError)<1e-6,texture+drainage+water);
 }
});

test('cassava keeps growing after its reference thermal time is reached',()=>{
 const c={...p,crop:'cassava',days:300,date:'2026-03-15'},s=m.simulateSeason(c,weather({days:300,t:30,min:25,max:35}));
 const passed=s.trace.findIndex(d=>d.progress>=1);
 assert(passed>0&&passed<280,'reference reached before harvest');
 assert(s.trace[299].storageRoot>s.trace[passed].storageRoot*1.1);
 assert(s.trace.slice(-20).every(d=>d.growth>0));assert.equal(s.stageAtHarvest,'后期（持续生长）');
 const longer=m.simulateSeason({...c,days:330},weather({days:330,t:30,min:25,max:35}));assert(longer.storageDryKgHa>s.storageDryKgHa);
});

test('full and climate-only analyses compute identical climate factors',()=>{
 const seasons=[2019,2020,2021].map((year,i)=>({year,daily:weather({rain:[0,6,20][i],sw:[16,18,20][i]})}));
 const full=m.evaluateEnsemble(p,seasons),climate=m.evaluateClimate(p,seasons);
 assert.equal(full.climateScore,climate.climateScore);
 for(const id of ['temperature','light','wetness'])assert.deepEqual(full.factors.find(f=>f.id===id),climate.factors.find(f=>f.id===id));
});

test('missing data stays unknown: no full marks, no invented nutrients or yield',()=>{
 const climate=m.evaluateClimate(p,[{year:2020,daily:weather()}]);
 assert.equal(climate.factors.find(f=>f.id==='ph').score,null);assert.equal(climate.factors.find(f=>f.id==='nutrients').score,null);
 assert.equal(climate.siteScore,null);assert.equal(climate.best,undefined);assert.equal(climate.yearly,undefined);
 const noRad=weather();delete noRad.shortwave_radiation_sum;
 assert.throws(()=>m.evaluate(p,noRad),/短波辐射/);
 const dark=m.evaluateClimate(p,[{year:2020,daily:noRad}]);
 assert.equal(dark.factors.find(f=>f.id==='light').score,null);assert.equal(dark.climateScore,null);
 const partial=weather();partial.shortwave_radiation_sum[3]=null;assert.throws(()=>m.simulateSeason(p,partial),/不能按理想光照补齐/);
 const noMax=weather();delete noMax.temperature_2m_max;const s=m.simulateSeason(p,noMax);
 assert.equal(s.tmaxEstimated,true);assert.equal(s.temperature.heatDays,null);
});

test('radiation in the wrong unit and misaligned dates are rejected',()=>{
 assert.throws(()=>m.simulateSeason(p,weather({sw:210})),/单位/);
 const s=m.seasonDates('2026-04-15',150,2020),d=weather();d.time=Array.from({length:150},(_,i)=>new Date(Date.parse(s.start)+i*86400000).toISOString().slice(0,10));
 const shifted={...d,time:d.time.map(t=>t.replace('2020-','2019-'))};
 assert.throws(()=>m.extractSeasons(shifted,[s],20));
 const r=m.extractSeasons(d,[s],20);assert.equal(r.included.length,1);
});

test('unknown drainage reports good/moderate/poor scenarios instead of assuming safety',()=>{
 const r=m.evaluate({...p,drainage:'unknown'},weather({rain:12}));
 const s=r.drainageScenarios;assert(s.good.storageDryKgHa>=s.moderate.storageDryKgHa);assert(s.moderate.storageDryKgHa>=s.poor.storageDryKgHa);
 assert(s.poor.storageDryKgHa<s.good.storageDryKgHa);assert.match(r.management.drainageText,/未知/);
 const risks=r.factors.find(f=>f.id==='wetness').risks;assert.match(risks.find(x=>x.id==='river-flood').text,/河流洪水淹没：尚未评估/);
 assert.match(risks.find(x=>x.id==='poor-drainage').text,/如果实际排水较差，模拟产量约低 \d+%/);
});

test('yearly economics: irrigation cost only when priced; profit definition is explicit',()=>{
 const seasons=[2019,2020,2021].map((year,i)=>({year,daily:weather({rain:[0,2,5][i],sw:[16,19,21][i]})}));
 const without=m.evaluateEnsemble(p,seasons),priced=m.evaluateEnsemble({...p,irrigationPrice:.5},seasons);
 assert.equal(without.economics.irrigationCostIncluded,false);assert(without.yearly.every(y=>y.costs.irrigation===null));
 priced.yearly.forEach((y,i)=>{assert(Math.abs(y.costs.irrigation-y.irrigation*10000/15/1000*.5)<1e-9);assert(Math.abs(without.yearly[i].net-y.net-y.costs.irrigation)<1e-6);});
 assert.match(priced.economics.profitDefinition,/灌溉/);
 assert.equal(new Set(without.yearly.map(y=>Math.round(y.fresh))).size,3,'different weather years give different yields');
 assert.match(without.lossMeaning,/不是已校准的未来亏损概率/);
});

test('when nutrients limit every year the similarity is explained rather than hidden',()=>{
 const seasons=[2019,2020,2021].map((year,i)=>({year,daily:weather({sw:[15,18,21][i]})}));
 const r=m.evaluateEnsemble({...p,n:20,p:3,k:20},seasons);
 assert(r.yearly.every(y=>y.flags.nutrientLimited));assert(r.explanations.some(e=>/养分是主要瓶颈/.test(e)));
});

test('no hard yield ceiling: extreme inputs are flagged, not clipped',()=>{
 const bright=m.evaluate(p,weather({sw:30})),mid=m.evaluate(p,weather({sw:24}));
 assert(Math.abs(bright.best.fresh/bright.yearly[0].climateFreshMu-1)<1e-9,'no ceiling between the growth model and the reported yield');
 assert(bright.best.fresh>2400,'the Beta 3 cap of 36 t/ha fresh (2400 kg/mu) no longer applies');
 assert(bright.best.fresh>mid.best.fresh,'more light keeps adding yield instead of hitting a plateau');
 assert.equal(bright.yearly[0].flags.calibrationCapped,false);
 assert.equal(m.evaluate(p,weather({sw:30,days:150})).yearly[0].flags.implausible,bright.best.fresh*15>m.crops.sweetpotato.plausibleFresh);
});

test('planting comparison reports its objective and held-out stability',()=>{
 const years=[2019,2020,2021,2022];
 const windows=[{date:'2026-10-15',seasons:years.map(year=>({year,daily:weather({t:17,min:11,max:23})}))},{date:'2027-05-15',seasons:years.map((year,i)=>({year,daily:weather({sw:17+i})}))}];
 const rank=m.rankPlantingWindows(p,windows);
 assert.equal(rank[0].date,'2027-05-15');assert.match(rank[0].objectiveName,/平均/);
 assert.equal(rank[0].stability.folds,4);assert.equal(rank[0].stability.topShare,1);assert(Number.isFinite(rank[0].p10));
});

test('old-engine calibration packs are refused',()=>{
 const pack={schema:'harvest-calibration-v1',status:'approved',id:'x',engineVersion:'harvest-beta-3.1.0',parameterVersion:'tubers-beta-2026-09-23',validation:{eligibleForReview:true},scope:{crop:'sweetpotato',variety:'generic',bbox:[100,10,120,30]},yieldScale:.9};
 assert.throws(()=>m.validateCalibration(pack,m.normalize(p)),/版本/);
});

test('every parameter declares unit, source, confidence and scope',()=>{
 for(const group of Object.values(m.PARAMETERS))for(const [k,v] of Object.entries(group)){
  assert(v.unit&&v.source&&v.scope,k);assert(['文献/手册','通用默认','假设'].includes(v.confidence),k);
 }
});

test('nutrient score follows the best fertilizer plan; fertilizer need is reported separately',()=>{
 const seasons=[2019,2020,2021].map(year=>({year,daily:weather()}));
 const r=m.evaluateEnsemble({...p,n:15,p:2,k:15,budget:1000,fertPrice:2,maxRate:200},seasons),f=r.factors.find(x=>x.id==='nutrients');
 assert.equal(f.score,Math.round(100*r.nutrientRatio));assert.match(f.evidence,/按较优施肥方案/);
 assert(f.metrics.soilOnlyRatio<r.nutrientRatio,'fertilizer adds to the soil supply');
 assert.equal(r.fertilizerNeed.level,'较多');assert.match(f.risks.find(x=>x.id==='fertilizer-need').text,/施肥需求：较多/);
 const rich=m.evaluateEnsemble({...p,n:500,p:500,k:1000},seasons);assert.equal(rich.fertilizerNeed.level,'较少');
 const need=r.fertilizerNeed;need.gapKgHa.forEach((g,i)=>assert(Math.abs(g-Math.max(0,need.needKgHa[i]-need.supplyKgHa[i]))<1e-9));
 assert(Math.abs(need.perMu.K2O-need.gapKgHa[2]*1.205/15)<1e-9);assert.match(need.note,/不是施肥处方/);
});

test('fertilizer plan is chosen by profit within agronomic caps and budget; tiny gains recommend none',()=>{
 const seasons=[2019,2020,2021].map(year=>({year,daily:weather()}));
 const prices={urea:1.81,sop:3.95,mop:3.33},input={...p,n:60,p:12,k:80,fertPrice:3.49,budget:500,risk:'balanced'};
 const r=m.evaluateEnsemble(input,seasons,{fertilizerPrices:prices}),rec=r.plan;
 assert.equal(rec.id,'rec');assert(rec.products.length>0);
 for(const x of r.fertilizerPlans)assert(rec.objective>=x.objective-1e-9,x.id+' must not beat the recommendation');
 const caps=m.crops.sweetpotato.fertilizerCaps;rec.products.forEach(x=>assert(x.kg<=caps[x.key]+1e-9,x.key+' within cap'));assert(rec.cost<=input.budget+1e-9);
 assert(rec.products.some(x=>x.name==='硫酸钾'));assert(!rec.products.some(x=>x.name==='氯化钾'));
 const price={npk:3.49,...prices};assert(Math.abs(rec.cost-rec.products.reduce((a,x)=>a+x.kg*price[x.key],0))<1e-9);
 rec.years.forEach((y,i)=>{assert(Math.abs(y.net-(y.revenue-y.baseCost-rec.cost-y.harvestCost-(y.irrigationCost??0)))<1e-9);assert.equal(r.yearly[i].costs.fertilizer,rec.cost);});
 const tight=m.evaluateEnsemble({...input,budget:60},seasons,{fertilizerPrices:prices});assert(tight.plan.cost<=60);assert(tight.plan.budgetBound||tight.plan.products.length===0);
 const rich=m.evaluateEnsemble({...input,n:500,p:500,k:1000},seasons,{fertilizerPrices:prices});
 assert.equal(rich.plan.products.length,0);assert.match(rich.plan.name,/不另施肥/);assert.equal(rich.fertilizerPlans.length,1);
 const noPrices=m.evaluateEnsemble(input,seasons);assert.equal(noPrices.plan,null);assert(noPrices.yearly.every((y,i)=>y.fresh===noPrices.best.years[i].fresh));
});
