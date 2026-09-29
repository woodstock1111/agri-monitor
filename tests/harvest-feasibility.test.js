const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const m=require('../harvest-model');
const base={lat:30,lng:115,area:10,days:150,ph:6,n:500,p:500,k:1000,budget:0,price:2,base:1000,fertPrice:3,crop:'sweetpotato',date:'2026-05-01',water:'sufficient',drainage:'good',risk:'balanced'};
// Daily series from a function of the day index: {t, min, max}.
function weather(days,fn=()=>({t:26})) {
  const d={temperature_2m_mean:[],temperature_2m_min:[],temperature_2m_max:[],precipitation_sum:[],et0_fao_evapotranspiration:[],shortwave_radiation_sum:[]};
  for(let i=0;i<days;i++){const x={t:26,sw:18,...fn(i)};d.temperature_2m_mean.push(x.t);d.temperature_2m_min.push(x.min??x.t-6);d.temperature_2m_max.push(x.max??x.t+6);
    d.precipitation_sum.push(3);d.et0_fao_evapotranspiration.push(3);d.shortwave_radiation_sum.push(x.sw);}
  return d;
}
const seasons=(fns,days=150)=>fns.map((fn,i)=>({year:2015+i,daily:weather(days,fn)}));
const warm=()=>({t:26});
// Autumn plan: warm start, then cooling into hard frost before the planned harvest.
const autumn=i=>{const t=27-i*.2;return {t,min:t-6,max:t+6};};

test('warm seasons: supported; relative scores are not used for the verdict',()=>{
 const r=m.evaluateClimate(base,seasons(Array(5).fill(warm)),{weatherKind:'history'});
 assert.equal(r.feasibility.status,'supported');assert.equal(r.feasibility.label,'所选季节条件支持种植');
 assert.deepEqual(r.feasibility.failYears,[]);assert.equal(r.feasibility.passYears.length,5);
});

test('artificial weather and too few seasons give “insufficient data”, never a real-site verdict',()=>{
 const demo=m.evaluateClimate(base,seasons(Array(5).fill(warm)),{weatherKind:'demo'});
 assert.equal(demo.feasibility.status,'insufficient');assert.match(demo.feasibility.reasons[0],/人工天气/);
 const one=m.evaluate(base,weather(150));assert.equal(one.feasibility.status,'insufficient');assert.equal(one.feasibility.label,'数据不足，无法判断');
});

test('a high climate score does not make a too-short season plantable',()=>{
 const r=m.evaluateClimate({...base,days:75},seasons(Array(5).fill(warm),75),{weatherKind:'history'});
 assert(r.climateScore>=85,'relative score looks good');
 assert.equal(r.feasibility.status,'not-recommended');
 assert(r.feasibility.years.every(y=>y.checks.find(c=>c.id==='harvestable').level==='fail'));
});

test('a single ≤0 °C night damages leaves but is not plant death; a hard freeze is',()=>{
 const oneFrost=m.simulateSeason(base,weather(150,i=>i===100?{t:8,min:-1,max:14}:{t:26}));
 assert.equal(oneFrost.plantDeathDay,null);assert(oneFrost.trace[110].lai>0);
 const f=m.seasonFeasibility(m.normalize(base),{...oneFrost,year:2020});
 assert.equal(f.checks.find(c=>c.id==='leaf-frost').level,'marginal');assert(!f.checks.some(c=>c.id==='plant-death'));
 const freeze=m.simulateSeason(base,weather(150,i=>i===100?{t:2,min:-4,max:8}:{t:26}));
 assert.equal(freeze.plantDeathDay,101);assert.equal(freeze.trace[120].lai,0);assert.equal(freeze.trace[120].growth,0);
});

test('frost after bulking flags underground damage as an unmodeled risk that caps the verdict',()=>{
 // Cold nights late in the season, no plant death: roots are not assumed fully saleable.
 const late=i=>i>=120?{t:9,min:0,max:16}:{t:26};
 const r=m.evaluateClimate(base,seasons(Array(5).fill(late)),{weatherKind:'history'});
 assert(r.feasibility.years.every(y=>y.severeUnmodeled));assert.notEqual(r.feasibility.status,'supported');
 assert(r.feasibility.years[0].checks.some(c=>c.id==='underground-cold'&&/不能默认全部可销售/.test(c.text)));
});

test('frost before a harvestable stage: not recommended, with the season and reason reported',()=>{
 const r=m.evaluateClimate({...base,date:'2026-08-01'},seasons(Array(5).fill(autumn)),{weatherKind:'history'});
 assert.equal(r.feasibility.status,'not-recommended');assert.equal(r.feasibility.label,'不建议按当前露地方案种植');
 const y=r.feasibility.years[0];assert.equal(y.verdict,'fail');
 assert(y.checks.some(c=>c.id==='plant-death'&&c.level==='fail'));assert(y.checks.some(c=>c.id==='underground-cold'&&c.level==='unmodeled'));
});

test('one bad year is reported by year and not averaged away',()=>{
 const r=m.evaluateClimate(base,seasons([warm,warm,warm,warm,autumn]),{weatherKind:'history'});
 assert.equal(r.feasibility.status,'risky');assert.deepEqual(r.feasibility.failYears,[2019]);
 assert(r.feasibility.reasons.some(x=>/2019/.test(x)));
});

test('cassava: no fixed maturity, but a short season is not a harvestable commercial crop',()=>{
 const c={...base,crop:'cassava',days:150};
 const r=m.evaluateClimate(c,seasons(Array(5).fill(warm)),{weatherKind:'history'});
 assert.equal(r.feasibility.status,'not-recommended');
 assert.match(r.feasibility.years[0].checks.find(x=>x.id==='harvestable').text,/木薯无固定成熟点/);
 const long=m.evaluateClimate({...c,days:300},seasons(Array(5).fill(warm),300),{weatherKind:'history'});
 assert.equal(long.feasibility.status,'supported');
});

test('the same rules apply at any coordinate',()=>{
 const s=seasons(Array(5).fill(autumn));
 for(const [lat,lng] of [[36.71,119.1],[20.04,110.2],[-6,35],[45,-100]])
  assert.equal(m.evaluateClimate({...base,lat,lng,date:'2026-08-01'},s,{weatherKind:'history'}).feasibility.status,'not-recommended');
});

test('planting windows: feasibility first, then yield; no suitable window is explicit',()=>{
 const years=[2019,2020,2021,2022];
 // The frosty-start window is brighter (higher yield) but fails establishment.
 const bright={date:'2026-03-15',seasons:years.map(year=>({year,daily:weather(150,i=>i<5?{t:6,min:-1,max:12,sw:28}:{t:26,sw:28})}))};
 const ok={date:'2026-05-15',seasons:years.map(year=>({year,daily:weather(150)}))};
 const rank=m.rankPlantingWindows(base,[bright,ok],{weatherKind:'history'});
 assert(rank.find(r=>r.date===bright.date).objective>rank.find(r=>r.date===ok.date).objective);
 assert.equal(rank[0].date,ok.date);assert.equal(rank[0].candidate,true);assert.equal(rank[1].candidate,false);
 const cold={date:'2026-09-15',seasons:years.map(year=>({year,daily:weather(150,autumn)}))};
 const none=m.rankPlantingWindows(base,[cold,bright],{weatherKind:'history'});
 assert(none.every(r=>!r.candidate));assert.notEqual(none[0].feasibility.status,'supported');
});

test('no extension advice without checking the colder season that follows',()=>{
 const r=m.evaluateClimate({...base,days:90},seasons(Array(3).fill(()=>({t:20})),90));
 assert.doesNotMatch(r.harvestStatus.text,/可考虑延长/);assert.match(r.harvestStatus.text,/本结果未检查/);
});

test('UI headline shows the model feasibility, not the score band',()=>{
 const elements=new Map(),document={getElementById(id){if(!elements.has(id))elements.set(id,{innerHTML:'',hidden:true,value:'0',classList:{remove(){}},addEventListener(){}});return elements.get(id);}};
 const window={HarvestModel:m};
 vm.runInNewContext(fs.readFileSync(require.resolve('../harvest'),'utf8').replace('window.HarvestUI={init};','window.HarvestUI={init,render};'),{window,document});
 const input={...m.normalize({...base,days:75}),currency:'CNY',soilOrigin:'manual'};
 const output=m.evaluateEnsemble(input,seasons(Array(5).fill(warm),75),{weatherKind:'history'});
 assert(output.climateScore>=85);
 window.HarvestUI.render({input,output,display:{unit:'mu'},weather:{kind:'history',source:'fixture',requested:5,excluded:[]},fieldId:'',
  planning:{found:false,title:'未找到合适的露地种植窗口',selectedDate:input.date,selectedRole:'相对较好的试验方案，不是推荐种植方案',note:'',ranking:[]}});
 const card=elements.get('hv-quick-content').innerHTML,details=elements.get('hv-output').innerHTML;
 assert.match(card,/不建议按当前露地方案种植/);assert.match(card,/未找到合适的露地种植窗口/);assert.doesNotMatch(card,/生长条件较好|基本可行/);
 assert.match(card,/仅作试验估算/);assert.match(details,/相对较好的试验方案，不是推荐种植方案/);
 assert.match(details,/需要注意的问题/);assert.match(details,/到计划收获时积温不够，薯块可能长不大：5\/5 年/);assert.doesNotMatch(details,/为什么这样判断/);
});
