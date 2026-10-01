const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const sync=require('../scripts/sync-miniprogram-harvest');
const H=require('../miniprogram/utils/harvest');

// Open-Meteo archive shaped daily series: warm, humid tropics (Haikou-like), deterministic.
function archive(start,end){
  const daily={time:[],temperature_2m_mean:[],temperature_2m_min:[],temperature_2m_max:[],precipitation_sum:[],et0_fao_evapotranspiration:[],shortwave_radiation_sum:[]};
  for(let t=Date.parse(start);t<=Date.parse(end);t+=86400000){
    const d=new Date(t),doy=(t-Date.UTC(d.getUTCFullYear(),0,1))/86400000,mean=25+4*Math.cos(2*Math.PI*(doy-200)/365);
    daily.time.push(d.toISOString().slice(0,10));daily.temperature_2m_mean.push(mean);daily.temperature_2m_min.push(mean-4);daily.temperature_2m_max.push(mean+5);
    daily.precipitation_sum.push(doy%6===0?(d.getUTCFullYear()%3+1)*12:0);daily.et0_fao_evapotranspiration.push(3.5);daily.shortwave_radiation_sum.push(15+(d.getUTCFullYear()%4));
  }
  return daily;
}
function fakeRequest(){
  const calls=[];
  const request=async({path})=>{calls.push(path);const q=new URL(path,'http://server').searchParams;return {statusCode:200,data:{ok:true,daily:archive(q.get('start'),q.get('end'))}};};
  return {request,calls};
}
const form={lat:19.531,lng:110.351,area:18,days:150,crop:'sweetpotato',date:'2027-03-15',dateMode:'manual',water:'sufficient',drainage:'unknown',texture:'loam',
  soilMode:'manual',price:2,base:1000,budget:500,...H.NUTRIENT_DEFAULTS};

test('the mini program carries an up-to-date copy of harvest-model.js',()=>{
  assert.equal(fs.readFileSync(sync.target,'utf8'),sync.expected(),'run: node scripts/sync-miniprogram-harvest.js');
});

test('manual date: one weather request, yield view is small enough to setData',async()=>{
  const {request,calls}=fakeRequest();
  const result=await H.analyze(form,null,{request});
  assert.equal(calls.length,1);
  assert.equal(result.output.yieldAvailable,true);
  const view=H.buildView(result);
  assert(JSON.stringify(view).length<20000,'view stays small');
  assert(view.yieldText&&view.net&&view.costs.length===5);
  assert(['ok','warn','bad','unknown'].includes(view.tone));
  assert(view.factors.every(f=>f.width>=0&&f.width<=100));
});

test('auto planting date compares 12 months with a single cached weather download',async()=>{
  const {request,calls}=fakeRequest();
  const result=await H.analyze({...form,dateMode:'auto',lat:20.1},null,{request});
  assert.equal(calls.length,1);
  assert.equal(result.planning.ranking.length,12);
  assert.equal(result.input.date,result.planning.selectedDate);
});

test('climate-only mode reports feasibility without yield or money',async()=>{
  const {request}=fakeRequest();
  const view=H.buildView(await H.analyze({...form,soilMode:'climate',lat:20.2},null,{request}));
  assert.equal(view.yieldAvailable,false);
  assert.equal(view.net,undefined);
  assert(view.headline);
});

test('china soil mode refuses to run without soil, and soil lookup maps 401 to a plain message',async()=>{
  await assert.rejects(H.analyze({...form,soilMode:'china'},null,{request:fakeRequest().request}),/土壤尚未就绪/);
  const soil=await H.fetchSoil(19.5,110.3,async()=>({statusCode:401,data:{ok:false,msg:'Unauthorized'}}));
  assert.equal(soil.ok,false);assert.match(soil.msg,/登录已失效/);
  const down=await H.fetchSoil(19.5,110.3,async()=>{throw new Error('fail');});
  assert.equal(down.ok,false);
});

test('weather goes through our server; a lost login is reported plainly',async()=>{
  const {request,calls}=fakeRequest();
  await H.analyze({...form,lat:20.3},null,{request});
  assert.match(calls[0],/^\/harvest\/weather\?lat=20\.3&lng=110\.351&start=\d{4}-01-01&end=\d{4}-12-31$/);
  await assert.rejects(H.analyze({...form,lat:20.4},null,{request:async()=>({statusCode:401,data:{ok:false}})}),/登录已失效/);
});

test('number formatting does not depend on Intl',()=>{
  assert.equal(H.num(1234567.891,1),'1,234,567.9');assert.equal(H.num(-1500),'-1,500');assert.equal(H.num(2.50,2),'2.5');assert.equal(H.num(-0.2),'0');assert.equal(H.num(NaN),'—');
});

test('a plot without a location (0, 0 or empty) is refused before any request',async()=>{
  const {request,calls}=fakeRequest();
  await assert.rejects(H.analyze({...form,lat:0,lng:0},null,{request}),/有位置的地块/);
  await assert.rejects(H.analyze({...form,lat:NaN,lng:NaN},null,{request}),/有位置的地块/);
  assert.equal(calls.length,0);
});
