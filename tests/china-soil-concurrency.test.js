const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createSoilService}=require('../china-soil');
function fixture(t,options){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'soil-queue-'));for(const k of ['AN','AP','AK','PH','BD'])fs.writeFileSync(path.join(directory,k+'-surface.nc'),'');t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return createSoilService({directory,python:process.execPath,...options});}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('100 simultaneous callers at one point share one read and then use cache',async t=>{
 let reads=0;const s=fixture(t,{execute:async()=>{reads++;await pause(10);return {stdout:JSON.stringify({ok:true,cell:{lat:20,lng:110}})};}});
 const results=await Promise.all(Array.from({length:100},()=>s.lookup('20.0','110')));
 assert(results.every(x=>x.ok));assert.equal(reads,1);await s.lookup('20','110.0');assert.equal(reads,1);
});
test('100 distinct callers stay within four readers and bounded queue without mixing coordinates',async t=>{
 let active=0,peak=0,reads=0;const s=fixture(t,{execute:async(_cmd,args)=>{reads++;active++;peak=Math.max(peak,active);await pause(5);active--;return{stdout:JSON.stringify({ok:true,cell:{lat:Number(args[2]),lng:Number(args[3])}})};}});
 const results=await Promise.all(Array.from({length:100},(_,i)=>s.lookup(String(20+i/1000),'110')));
 assert.equal(peak,4);assert.equal(reads,36);assert.equal(results.filter(x=>x.status==='busy').length,64);
 results.forEach((r,i)=>{if(r.ok)assert.equal(r.cell.lat,20+i/1000);});
 assert((await s.lookup('21','110')).ok);
});
test('queue timeout releases pending entry; failures do not poison retries',async t=>{
 let release,reads=0;const s=fixture(t,{maxActive:1,maxQueued:1,queueTimeoutMs:10,execute:async()=>{reads++;if(reads===1)await new Promise(r=>release=r);if(reads===2)throw Error('reader timeout');return{stdout:'{"ok":true}'};}});
 const first=s.lookup('20','110'),queued=s.lookup('21','110');assert.equal((await queued).status,'busy');release();assert((await first).ok);
 assert.equal((await s.lookup('21','110')).status,'read_error');assert((await s.lookup('21','110')).ok);
});
test('no-data results are shared and briefly cached; malformed reader output is retryable',async t=>{
 let reads=0;const s=fixture(t,{execute:async()=>({stdout:++reads===1?'broken':JSON.stringify({ok:false,status:'no_data'})})});
 assert.equal((await s.lookup('20','110')).status,'read_error');assert.equal((await s.lookup('20','110')).status,'no_data');assert.equal((await s.lookup('20','110')).status,'no_data');assert.equal(reads,2);
});
