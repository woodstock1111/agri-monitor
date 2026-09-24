const {test}=require('node:test');
const assert=require('node:assert/strict');
const m=require('../harvest-model');
const {fit}=require('../scripts/calibrate-harvest');
const p={lat:20,lng:110,area:10,days:150,ph:6,n:60,p:12,k:80,budget:250,price:2,base:1000,fertPrice:3,crop:'sweetpotato',date:'2026-04-15',water:'rain',drainage:'good',risk:'cautious'};
const weather=(rain=4,t=26)=>({temperature_2m_mean:Array(150).fill(t),temperature_2m_min:Array(150).fill(t-7),precipitation_sum:Array(150).fill(rain),et0_fao_evapotranspiration:Array(150).fill(3)});
test('equal seasonal rainfall does not hide a 140-day dry spell',()=>{
 const wet=m.simulateSeason(p,weather()),burst=weather();burst.precipitation_sum=Array.from({length:150},(_,i)=>i<10?60:0);
 const drought=m.simulateSeason(p,burst);assert.equal(wet.rain,drought.rain);assert(drought.wly<wet.wly*.6);assert(drought.longestDry>90);
});
test('daily water mass is conserved, including root expansion and capped irrigation',()=>{
 for(const texture of ['sandy','loam','clay'])for(const water of ['rain','irrigated']){
 const d=weather();d.precipitation_sum=d.precipitation_sum.map((_,i)=>i%13===0?120:0);
 const r=m.simulateSeason({...p,texture,water,irrigationLimit:37,irrigationDailyMax:4},d);
 assert(Math.abs(r.massBalanceError)<1e-7);assert(r.irrigation<=37+1e-8);
 r.trace.forEach(day=>{assert(day.storage>=0&&day.storage<=day.capacity);assert(day.irrigation<=4);assert(day.et>=0);});
 }
});
test('empty initial storage and no inflow cannot create evapotranspiration or growth',()=>{
 const r=m.simulateSeason({...p,initialWater:0},weather(0));assert.equal(r.et,0);assert.equal(r.wly,0);
});
test('scheduled irrigation is counted and does not invoke automatic unlimited watering',()=>{
 const irrigation=Array(150).fill(0);irrigation[25]=15;
 const r=m.simulateSeason({...p,water:'irrigated',irrigation},weather(0));assert.equal(r.irrigation,15);
});
test('cold seasons do not reach thermal maturity and nutrient absence is visible',()=>{
 const warm=m.evaluate(p,weather()),cold=m.evaluate(p,weather(4,14));assert(cold.diagnostics.maturity<warm.diagnostics.maturity);assert(cold.wly<warm.wly);
 const empty=m.evaluate({...p,n:0,p:0,k:0,budget:0},weather());assert.equal(empty.best.fresh,0);assert.equal(empty.score,0);assert(empty.climateScore>0);
});
test('ensemble bounds are actual scenario quantiles, single scenario has no fabricated spread',()=>{
 const one=m.evaluate(p,weather());assert.equal(one.best.low,one.best.high);
 const seasons=[{year:2020,daily:weather(0)},{year:2021,daily:weather(2)},{year:2022,daily:weather(5)}],r=m.evaluateEnsemble(p,seasons);
 assert.equal(r.best.low,m.quantile(r.best.years.map(y=>y.fresh),.1));assert.equal(r.best.high,m.quantile(r.best.years.map(y=>y.fresh),.9));
 assert.equal(r.best.objective,m.quantile(r.best.years.map(y=>y.net),.1));assert(r.best.cost<=p.budget);
 assert.throws(()=>m.evaluateEnsemble(p,[seasons[0],seasons[0]]));
});
test('currency/price scaling preserves optimal physical dose; marketable fraction affects revenue',()=>{
 const a=m.evaluate(p,weather()),b=m.evaluate({...p,price:200,base:100000,budget:25000,fertPrice:300},weather());
 assert.equal(a.best.rate,b.best.rate);assert(Math.abs(b.best.net-100*a.best.net)<1e-6);
 const unsellable=m.evaluate({...p,marketable:0},weather());assert.equal(unsellable.best.rate,0);assert.equal(unsellable.best.breakEvenPrice,null);
});
test('historical windows avoid future and retrospective leakage; leap days and crossing years are explicit',()=>{
 const years=m.historicalSeasons('2026-11-01',300,10,'2026-09-23');assert.equal(years.length,10);assert(years.every(s=>s.end<='2025-12-31'));assert.equal(years.at(-1).year,2024);
 assert(m.historicalSeasons('2020-04-01',150,5,'2026-09-23').every(s=>s.end<'2020-01-01'));
 assert.equal(m.seasonDates('2024-02-29',150,2023).start,'2023-02-28');assert.equal(m.seasonDates('2024-02-29',150,2023).adjusted,true);
});
test('incomplete seasons are excluded explicitly, not filled with zeros',()=>{
 const dates=[m.seasonDates('2026-04-15',150,2020),m.seasonDates('2026-04-15',150,2021)];
 const d=weather();d.time=Array.from({length:150},(_,i)=>new Date(Date.parse(dates[0].start)+i*86400000).toISOString().slice(0,10));
 const r=m.extractSeasons(d,dates);assert.equal(r.included.length,1);assert.equal(r.excluded[0].year,2021);
 d.precipitation_sum[2]=null;assert.throws(()=>m.extractSeasons(d,dates));
});
test('climate-only result has no invented nutrient yield or financial recommendation',()=>{
 const r=m.evaluateClimate(p,[{year:2020,daily:weather()}]);assert.equal(r.yieldAvailable,false);assert.equal(r.best,undefined);assert.equal(r.score,undefined);
});
test('invalid soil, fertilizer and water inputs fail closed',()=>{
 for(const patch of [{fieldCapacity:.1,wiltingPoint:.2},{fertilizer:[80,80,0]},{initialWater:NaN},{rootDepth:0},{irrigation:[1]},{marketable:2}])assert.throws(()=>m.evaluate({...p,...patch},weather()));
 assert.throws(()=>m.quefts([1,2],[0,0,0],300));
});
function rows(){return Array.from({length:18},(_,i)=>({id:'r'+i,fieldId:'field'+i,split:i<12?'train':'validation',seasonYear:i<12?2023:2024,harvestDate:i<12?'2023-10-01':'2024-10-01',lat:20+i*.01,lng:110+i*.01,crop:'sweetpotato',variety:'generic',observedFreshKgHa:8000,
 prediction:{engineVersion:m.VERSION,parameterVersion:m.PARAMETER_VERSION,sourceKind:'history',calibrationId:null,generatedAt:i<12?'2023-04-01T00:00:00Z':'2024-04-01T00:00:00Z',rawYears:[{freshKgHa:10000,waterLimitKgHa:15000}]}}));}
test('calibration fits training only, reports held-out results, never self-approves',()=>{
 const r=rows(),pack=fit(r);assert.equal(pack.yieldScale,.8);assert.equal(pack.status,'candidate');assert.equal(pack.validation.after.mae,0);assert.equal(pack.validation.eligibleForReview,true);
 r.filter(x=>x.split==='validation').forEach(x=>x.observedFreshKgHa=15000);const bad=fit(r);assert.equal(bad.yieldScale,.8);assert.equal(bad.validation.eligibleForReview,false);
 assert.throws(()=>m.validateCalibration(pack,p));
 const approved={...pack,status:'approved'};assert.equal(m.validateCalibration(approved,p),.8);
 assert.throws(()=>m.validateCalibration(approved,{...p,lat:40}));assert.throws(()=>m.validateCalibration(approved,{...p,crop:'cassava'}));
});
test('calibration rejects plot/year leakage, mixed versions, synthetic weather and reused calibrated predictions',()=>{
 for(const mutate of [r=>r[12].fieldId=r[0].fieldId,r=>r[12].seasonYear=2023,r=>r[0].prediction.engineVersion='old',r=>r[0].prediction.sourceKind='demo',r=>r[0].prediction.calibrationId='previous']) {const r=rows();mutate(r);assert.throws(()=>fit(r));}
});
