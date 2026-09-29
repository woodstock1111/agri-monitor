const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const m=require('../harvest-model');
const p={lat:20,lng:110,area:12,days:150,ph:6,n:500,p:500,k:1000,budget:0,price:2,base:1000,fertPrice:3,crop:'sweetpotato',date:'2026-05-01',water:'sufficient',drainage:'moderate',risk:'balanced'};
function weather(rain) {
  return {time:Array.from({length:150},(_,i)=>new Date(Date.parse('2020-05-01')+i*86400000).toISOString().slice(0,10)),
    temperature_2m_mean:Array(150).fill(26),temperature_2m_min:Array(150).fill(20),temperature_2m_max:Array(150).fill(32),shortwave_radiation_sum:Array(150).fill(18),
    precipitation_sum:Array.from({length:150},(_,i)=>rain(i)),et0_fao_evapotranspiration:Array(150).fill(4)};
}
const seasons=[2019,2020,2021].map((year,k)=>({year,daily:weather(i=>[0,i%7===0?20:0,i%3===0?45:2][k])}));
const close=(a,b,msg)=>assert(Math.abs(a-b)<1e-6,msg+': '+a+' vs '+b);

test('daily water account closes and daily irrigation adds up to the season total',()=>{
 for(const s of seasons){
  const r=m.simulateSeason({...p,texture:'clay',drainage:'poor'},s.daily);let prev=null;
  r.trace.forEach(d=>{
   assert(d.available>=0&&d.available<=d.capacity+1e-9);assert(d.availableFraction>=0&&d.availableFraction<=1);
   close(d.excess,Math.max(0,d.storage-d.capacity),'excess');close(d.available+d.excess,d.storage,'available + excess = soil water');
   if(prev)close(prev.storage+prev.pond+d.newRootWater+d.rain+d.irrigation-d.runoff-d.drainage-d.et,d.storage+d.pond,'day '+d.day);
   prev=d;
  });
  close(r.trace.reduce((a,d)=>a+d.irrigation,0),r.irrigation,'irrigation');close(r.trace.reduce((a,d)=>a+d.newRootWater,0)>0?1:0,1,'root growth adds water');
  assert(Math.abs(r.massBalanceError)<1e-6);
 }
});

test('irrigation cost: unit conversion, reference mean and null price are explicit',()=>{
 const none=m.evaluateEnsemble(p,seasons).water,zero=m.evaluateEnsemble({...p,irrigationPrice:0},seasons).water,priced=m.evaluateEnsemble({...p,irrigationPrice:.8},seasons).water;
 assert.equal(none.priced,false);assert(none.years.every(y=>y.costPerMu===null&&y.deltaCostPerMu===null));assert.match(none.status,/不是0元/);
 assert.equal(zero.priced,true);assert(zero.years.every(y=>y.costPerMu===0));
 priced.years.forEach(y=>{close(y.m3PerMu,y.irrigationMm*10000/15/1000,'m3/mu');close(y.costPerMu,y.m3PerMu*.8,'cost');});
 close(priced.conversions.m3PerMmPerMu*15,priced.conversions.m3PerMmPerHa,'mu→ha');
 close(priced.years.reduce((a,y)=>a+y.deltaCostPerMu,0),0,'deltas vs mean');close(priced.reference.costPerMu,priced.years.reduce((a,y)=>a+y.costPerMu,0)/3,'reference');
 assert.equal(priced.reference.label,'相对所选历史年景平均值');
 assert(priced.years[0].irrigationMm>priced.years[2].irrigationMm,'the dry year needs more water');assert(priced.years[0].deltaCostPerMu>0);
});

test('irrigation is deducted from profit exactly once, or not at all when already in the base cost',()=>{
 const none=m.evaluateEnsemble(p,seasons),priced=m.evaluateEnsemble({...p,irrigationPrice:.8},seasons),inBase=m.evaluateEnsemble({...p,irrigationPrice:.8,irrigationInBase:true},seasons);
 priced.yearly.forEach((y,i)=>{
  const c=y.costs;close(y.net,y.revenue-c.base-c.fertilizer-c.harvest-c.irrigation,'net');
  close(none.yearly[i].net-y.net,priced.water.years[i].costPerMu,'difference is one irrigation charge');
  assert.equal(inBase.yearly[i].costs.irrigation,null);close(inBase.yearly[i].net,none.yearly[i].net,'already in base');
 });
 assert.equal(inBase.water.deducted,false);assert.match(inBase.water.status,/已包含在基础成本/);assert.match(priced.economics.profitDefinition,/灌溉费/);
 assert.doesNotMatch(inBase.economics.profitDefinition,/灌溉费（模拟/);
});

test('climate-only analysis shows water use and cost without yield or profit',()=>{
 const r=m.evaluateClimate({...p,irrigationPrice:.8},seasons);
 assert.equal(r.yieldAvailable,false);assert.equal(r.best,undefined);assert.equal(r.water.years.length,3);assert(r.water.years[0].costPerMu>0);
});

function ui(){
 const elements=new Map(),document={getElementById(id){if(!elements.has(id))elements.set(id,{innerHTML:'',hidden:true,value:'',classList:{add(){},remove(){}},addEventListener(){}});return elements.get(id);}};
 let calls=0;const counted=new Proxy(m,{get(t,k){const v=t[k];return typeof v==='function'?(...a)=>{calls++;return v(...a);}:v;}});
 const window={HarvestModel:counted};
 vm.runInNewContext(fs.readFileSync(require.resolve('../harvest'),'utf8').replace('window.HarvestUI={init};','window.HarvestUI={init,render};'),{window,document});
 return {elements,render:window.HarvestUI.render,calls:()=>calls,reset(){calls=0;}};
}
const view=(output,unit='mu')=>({input:{...m.normalize(p),currency:'CNY',soilOrigin:'manual'},output,display:{unit},weather:{kind:'history',source:'fixture',requested:3,excluded:[]},fieldId:''});

test('water panel: day selection reads the stored trace only; unpriced cost reads “未计入”',()=>{
 const h=ui(),output=m.evaluateEnsemble(p,seasons);h.render(view(output));
 const html=h.elements.get('hv-output').innerHTML;
 assert.match(html,/土壤剩余可用水与浇水需求/);assert.match(html,/<h2>预计成本<\/h2>/);assert.match(html,/<span>灌溉用水 \/ 亩<\/span><b>未计入<\/b>/);assert.match(html,/不是今天的实测/);
 assert.doesNotMatch(html,/不同年景的用水与成本/);assert.doesNotMatch(html,/水分.{0,6}100 \/ 100/);
 h.reset();const slider=h.elements.get('hv-trace-day');slider.value='40';slider.oninput();
 assert.equal(h.calls(),0,'no model call when picking a day');
 const day=h.elements.get('hv-water-day').innerHTML,d=output.simulations[0].trace[39];
 assert.match(day,new RegExp(d.date));assert.match(day,/根区剩余可用水/);assert.match(day,/过湿暂存水/);assert.match(day,/地表积水/);assert.match(day,/新根层带入/);
 const chart=h.elements.get('hv-water-chart').innerHTML;assert.match(chart,/根区可用水比例（%）/);assert.match(chart,/每日水量（mm，刻度最大/);
});

test('cost card: average water and fertilizer cost per unit only; costs sit below profit',()=>{
 const h=ui(),output=m.evaluateEnsemble({...p,irrigationPrice:.8,budget:500,n:30,p:5,k:30},seasons,{fertilizerPrices:{urea:1.81,sop:3.95,mop:3.33}});
 h.render(view(output,'ha'));const html=h.elements.get('hv-output').innerHTML,b=output.plan;
 const n=x=>x.toLocaleString('zh-CN',{maximumFractionDigits:0});
 const water=b.years.reduce((a,y)=>a+y.irrigationCost,0)/b.years.length;
 assert(html.includes(`<span>灌溉用水 / 公顷</span><b>${n(water*15)}</b>`),'per-hectare water cost');
 assert(html.includes(`<span>肥料 / 公顷</span><b>${n(b.cost*15)}</b>`),'per-hectare fertilizer cost');
 assert.doesNotMatch(html,/整块地/);assert.doesNotMatch(h.elements.get('hv-quick-content').innerHTML,/整块地/);
 assert(html.indexOf('预计能赚多少钱')<html.indexOf('<h2>预计成本</h2>'));assert(html.indexOf('<h2>预计成本</h2>')<html.indexOf('是什么限制了生长'));assert.doesNotMatch(html,/为什么这样判断|需要注意的问题/,'nothing to flag when every season passes');
 assert.match(html,/推荐施肥/);assert.match(html,/2026 年参考价/);assert.match(html,/红薯忌氯/);
 assert(html.indexOf('<details open><summary>比较不同施肥量')<html.indexOf('<details><summary>常用肥料与 2026 年参考价'));
 const card=h.elements.get('hv-quick-content').innerHTML;assert.match(card,/<b>施肥<\/b>需求/);assert.match(card,/建议施/);assert.doesNotMatch(html,/hv-verdict/);
 assert.doesNotMatch(html,/如果遇上不同年景/);assert.match(html,/各历史年景的产量基本相同/);assert.doesNotMatch(html,/天气能支撑的产量/);
});

test('year-by-year chart appears only when yields actually differ between years',()=>{
 const h=ui(),varied=[2019,2020,2021].map((year,i)=>({year,daily:{...weather(()=>2),shortwave_radiation_sum:Array(150).fill([14,18,22][i])}}));
 const output=m.evaluateEnsemble({...p,n:500,p:500,k:1000},varied,{fertilizerPrices:{urea:1.81,sop:3.95,mop:3.33}});
 h.render(view(output));const html=h.elements.get('hv-output').innerHTML;
 assert.match(html,/如果遇上不同年景/);assert.match(html,/最好 2021/);assert.match(html,/最差 2019/);assert.doesNotMatch(html,/各历史年景的产量基本相同/);
});
