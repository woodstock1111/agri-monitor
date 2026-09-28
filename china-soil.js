'use strict';
const fs=require('fs');
const path=require('path');
const {execFile}=require('child_process');
const exec=require('util').promisify(execFile);
const SOURCE_URL='https://data.tpdc.ac.cn/en/data/8ba0a731-5b0b-4e2f-8b95-8b29cc3c0f3a/';
function createSoilService({directory=path.join(__dirname,'server-data/china-soil'),python=process.env.SOIL_PYTHON||path.join(__dirname,'.venv-soil/bin/python'),execute=exec,maxActive=4,maxQueued=32,queueTimeoutMs=10000,readTimeoutMs=10000}={}) {
  for(const n of [maxActive,maxQueued,queueTimeoutMs,readTimeoutMs])if(!Number.isInteger(n)||n<1)throw Error('Invalid soil concurrency configuration');
  const cache=new Map(),pending=new Map(),queue=[];let active=0;
  const busy=()=>({ok:false,status:'busy',retryAfterSeconds:2,msg:'土壤查询较多，请稍后重试。'});
  function drain(){
    while(active<maxActive&&queue.length){
      const job=queue.shift();clearTimeout(job.timer);active++;
      (async()=>{
        try{
          const {stdout}=await execute(python,[path.join(__dirname,'scripts/china-soil-query.py'),directory,String(job.lat),String(job.lng)],{timeout:readTimeoutMs,maxBuffer:65536,killSignal:'SIGKILL'});
          const data=JSON.parse(stdout);
          if(typeof data.ok!=='boolean')throw Error('Invalid soil response');
          if(data.ok||data.status==='no_data'){
            if(cache.size>=256)cache.delete(cache.keys().next().value);
            cache.set(job.key,{expires:Date.now()+(data.ok?600000:30000),data});
          }
          job.resolve(data);
        }catch {job.resolve({ok:false,status:'read_error',msg:'土壤读取失败或超时，请重试。'});}
        finally{active--;pending.delete(job.key);drain();}
      })();
    }
  }
  async function lookup(latValue,lngValue){
    if(typeof latValue!=='string'||typeof lngValue!=='string'||!latValue.trim()||!lngValue.trim())return {ok:false,status:'invalid_coordinates',msg:'请提供有效的经纬度。'};
    const lat=Number(latValue),lng=Number(lngValue);
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return {ok:false,status:'invalid_coordinates',msg:'经纬度格式或范围无效。'};
    if(lat<17.8||lat>54||lng<73||lng>136)return {ok:false,status:'outside_coverage',msg:'本版仅提供中国土壤数据；该点超出数据范围。'};
    if(['AN','AP','AK','PH','BD'].some(k=>!fs.existsSync(path.join(directory,k+'-surface.nc'))))return {ok:false,status:'data_pending',msg:'国内土壤数据正在准备中。暂时可手填养分进行试算。',sourceUrl:SOURCE_URL};
    if(!fs.existsSync(python))return {ok:false,status:'reader_unavailable',msg:'服务器尚未安装土壤数据读取环境。'};
    const key=lat+','+lng,hit=cache.get(key);
    if(hit&&Date.now()<hit.expires)return hit.data;
    if(pending.has(key))return pending.get(key);
    if(active>=maxActive&&queue.length>=maxQueued)return busy();
    let resolve;const promise=new Promise(r=>{resolve=r;});pending.set(key,promise);
    const job={key,lat,lng,resolve};
    job.timer=setTimeout(()=>{const i=queue.indexOf(job);if(i<0)return;queue.splice(i,1);pending.delete(key);resolve(busy());},queueTimeoutMs);
    queue.push(job);drain();return promise;
  }
  return {lookup};
}
module.exports={createSoilService};
