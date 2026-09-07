const {test}=require('node:test');
const assert=require('node:assert/strict');
const m=require('../harvest-model.js');
const p={lat:20,lng:110,area:10,days:150,ph:6,n:60,p:12,k:80,budget:250,price:2,base:1000,fertPrice:3,crop:'sweetpotato',date:'2026-04-15',water:'rain',drainage:'good',risk:'cautious'};
const weather=(t=26,min=19,rain=5)=>({temperature_2m_mean:Array(p.days).fill(t),temperature_2m_min:Array(p.days).fill(min),precipitation_sum:Array(p.days).fill(rain),et0_fao_evapotranspiration:Array(p.days).fill(3)});
test('QUEFTS finite, nonnegative and bounded for asymmetric nutrients and both crops',()=>{
 for(const crop of Object.values(m.crops)) for(const n of [0,.001,1,50,500]) for(const k of [0,.1,12,500]) for(const w of [0,.001,200,15000]) {
  const y=m.quefts([n,12,k],[0,0,0],w,crop);assert(Number.isFinite(y)&&y>=0&&y<=w);
 }
 assert.equal(m.quefts([0,12,50],[0,0,0],5000),0);
});
test('budget limits incremental costs, including zero budget',()=>{
 const z=m.evaluate({...p,budget:0},weather());assert.equal(z.best.rate,0);assert.equal(z.best.cost,0);
 for(const budget of [1,14,15,80,250]) {const r=m.evaluate({...p,budget},weather());assert(r.best.cost<=budget);assert(r.best.objective>=r.rows[0].objective);}
});
test('area independent per-mu yield and precise dry/fresh conversion',()=>{
 const r=m.evaluate(p,weather()),large=m.evaluate({...p,area:100},weather());assert.equal(r.best.fresh,large.best.fresh);
 const base=m.quefts([p.n,p.p,p.k],[0,0,0],r.wly,m.crops.sweetpotato)/.25/15;
 assert.equal(r.rows[0].fresh,base);assert.equal(r.best.net,r.best.fresh*p.price-p.base-r.best.cost);
});
test('frost, cold, water and drainage materially affect results',()=>{
 const warm=m.evaluate(p,weather());const cold=m.evaluate(p,weather(0,-7));assert.equal(cold.score,0);assert.equal(cold.best.fresh,0);
 assert(m.evaluate({...p,drainage:'poor'},weather()).score<warm.score);
 const dry=m.evaluate(p,weather(26,19,0));assert.equal(dry.best.fresh,0);assert(m.evaluate({...p,water:'irrigated'},weather(26,19,0)).best.fresh>0);
});
test('invalid numeric/date input and incomplete weather rejected',()=>{
 for(const patch of [{lat:91},{lng:NaN},{area:0},{days:0},{days:150.5},{date:'2026-02-30'},{budget:-1},{p:NaN}]) assert.throws(()=>m.evaluate({...p,...patch},weather()));
 const bad=weather();bad.precipitation_sum[0]=null;assert.throws(()=>m.evaluate(p,bad));
 assert.throws(()=>m.evaluate(p,{}));
});
test('zero market value selects zero added fertilizer',()=>{assert.equal(m.evaluate({...p,price:0},weather()).best.rate,0)});
test('domestic soil concentration converts to surface stock with explicit fractions',()=>{
 const data={ok:true,depthCm:[0,4.5],fields:{availableN:{value:100,unit:'mg/kg'},availableP:{value:10,unit:'mg/kg'},availableK:{value:120,unit:'mg/kg'},bulkDensity:{value:1.3},ph:{value:6.5}}};
 const r=m.soilSupply(data,[.3,.2,.4]);
 assert(Math.abs(r.n-17.55)<1e-10);assert(Math.abs(r.p-1.17)<1e-10);assert(Math.abs(r.k-28.08)<1e-10);assert.equal(r.ph,6.5);
 assert.throws(()=>m.soilSupply(data,[1.2,.2,.4]));
 assert.throws(()=>m.soilSupply({...data,fields:{...data.fields,availableP:{value:10,unit:'g/kg'}}},[.3,.2,.4]));
 assert.throws(()=>m.soilSupply({...data,depthCm:[4.5,0]},[.3,.2,.4]));
});
