const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createWeatherService,VARIABLES}=require('../lib/harvest-weather');

const today=()=>'2026-09-29';
const NOW=Date.parse('2026-09-29T00:00:00Z');
const good={lat:'19.53112',lng:'110.351',start:'2015-01-01',end:'2025-12-31'};

function archive(start,end){
  const d={time:[]};VARIABLES.forEach(k=>d[k]=[]);
  for(let t=Date.parse(start);t<=Date.parse(end);t+=86400000){const day=new Date(t).toISOString().slice(0,10);d.time.push(day);VARIABLES.forEach((k,i)=>d[k].push(Number(day.slice(0,4))+i/10));}
  return d;
}
function upstream(){
  const calls=[];
  const request=async(url)=>{calls.push(url);await new Promise(r=>setTimeout(r,5));const q=new URL(url).searchParams;return {status:200,data:{daily:archive(q.get('start_date'),q.get('end_date'))}};};
  return {request,calls};
}
function memoryStore(){
  const rows=new Map(),key=(lat,lng,y)=>[lat,lng,y].join(',');
  return {rows,
    async getYears(lat,lng,from,to){const out=[];for(let y=from;y<=to;y++){const r=rows.get(key(lat,lng,y));if(r)out.push({year:y,...r});}return out;},
    async putYears(lat,lng,source,years){years.forEach(({year,daily})=>rows.set(key(lat,lng,year),{daily,fetchedAt:new Date(NOW)}));}};
}
const service=(o={})=>createWeatherService({today,now:()=>NOW,log:()=>{},...o});

test('first request fetches the whole range and stores one row per year; the second is served from the store',async()=>{
  const {request,calls}=upstream(),store=memoryStore(),s=service({request,store});
  const a=await s.lookup(good);
  assert.equal(a.status,200);assert.equal(a.body.fromStore,0);assert.equal(store.rows.size,11);
  assert.equal(a.body.daily.time.length,4018);assert.equal(a.body.daily.time[0],'2015-01-01');assert.equal(a.body.daily.time.at(-1),'2025-12-31');
  const u=new URL(calls[0]);
  assert.equal(u.host,'archive-api.open-meteo.com');assert.equal(u.searchParams.get('latitude'),'19.5311');assert.equal(u.searchParams.get('models'),'era5');
  assert.equal(u.searchParams.get('daily').split(',').length,6);
  const b=await s.lookup(good);
  assert.equal(calls.length,1);assert.equal(b.body.fromStore,11);assert.deepEqual(b.body.daily,a.body.daily);
});

test('only missing years are fetched when the range grows',async()=>{
  const {request,calls}=upstream(),store=memoryStore(),s=service({request,store});
  await s.lookup({...good,start:'2020-01-01'});
  const r=await s.lookup(good);
  assert.equal(calls.length,2);
  const u=new URL(calls[1]);assert.equal(u.searchParams.get('start_date'),'2015-01-01');assert.equal(u.searchParams.get('end_date'),'2019-12-31');
  assert.equal(r.body.fromStore,6);assert.equal(r.body.daily.time.length,4018);
});

test('a recent year fetched before April of the next year is refreshed after a week',async()=>{
  const {request,calls}=upstream(),store=memoryStore();
  await store.putYears(19.5311,110.351,'x',[{year:2025,daily:archive('2025-01-01','2025-12-31')}]);
  store.rows.get('19.5311,110.351,2025').fetchedAt=new Date('2026-01-10T00:00:00Z');
  await service({request,store}).lookup({...good,start:'2025-01-01'});
  assert.equal(calls.length,1,'preliminary ERA5T year refetched');
  store.rows.get('19.5311,110.351,2025').fetchedAt=new Date('2026-04-02T00:00:00Z');
  await service({request,store}).lookup({...good,start:'2025-01-01'});
  assert.equal(calls.length,1,'final year kept');
});

test('identical requests in flight share one lookup',async()=>{
  const {request,calls}=upstream(),s=service({request,store:memoryStore()});
  const [a,b]=await Promise.all([s.lookup(good),s.lookup(good)]);
  assert.equal(calls.length,1);assert.equal(a,b);
});

test('a broken database does not break the answer',async()=>{
  const {request,calls}=upstream();
  const s=service({request,store:{getYears:async()=>{throw new Error('down');},putYears:async()=>{throw new Error('down');}}});
  const r=await s.lookup(good);
  assert.equal(r.status,200);assert.equal(r.body.daily.time.length,4018);assert.equal(calls.length,1);
});

test('rejects bad input before calling upstream',async()=>{
  const {request,calls}=upstream(),s=service({request,store:memoryStore()});
  for(const q of [{...good,lat:''},{...good,lat:'91'},{...good,lng:'abc'},{...good,start:'2015-01-02'},{...good,end:'2025-12-30'},{...good,start:'1939-01-01'},
    {...good,end:'2026-12-31'},{...good,start:'2020-01-01',end:'2019-12-31'},{...good,start:'1980-01-01'}]){
    const r=await s.lookup(q);assert.equal(r.status,400,JSON.stringify(q));assert.equal(r.body.ok,false);
  }
  assert.equal(calls.length,0);
});

test('upstream failures are reported and nothing is stored',async()=>{
  let n=0;const store=memoryStore(),s=service({store,request:async()=>{n++;if(n===1)throw new Error('Timeout');return {status:500,data:{}};}});
  assert.equal((await s.lookup(good)).status,502);
  assert.equal((await s.lookup(good)).status,502);
  assert.equal(n,2);assert.equal(store.rows.size,0);
});
