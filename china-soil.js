'use strict';
const fs=require('fs');
const path=require('path');
const {execFile}=require('child_process');
const {promisify}=require('util');
const exec=promisify(execFile);
const SOURCE_URL='https://data.tpdc.ac.cn/en/data/8ba0a731-5b0b-4e2f-8b95-8b29cc3c0f3a/';
function createSoilService({directory=path.join(__dirname,'server-data/china-soil'),python=process.env.SOIL_PYTHON||path.join(__dirname,'.venv-soil/bin/python')}={}) {
  const cache=new Map();let active=0;
  async function lookup(latValue,lngValue) {
    if(typeof latValue!=='string'||typeof lngValue!=='string'||!latValue.trim()||!lngValue.trim()) return {ok:false,status:'invalid_coordinates',msg:'请提供有效的经纬度。'};
    const lat=Number(latValue),lng=Number(lngValue);
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return {ok:false,status:'invalid_coordinates',msg:'经纬度格式或范围无效。'};
    if(lat<17.8||lat>54||lng<73||lng>136)return {ok:false,status:'outside_coverage',msg:'本版仅提供中国土壤数据；该点超出数据范围。'};
    const keys=['AN','AP','AK','PH','BD'];
    if(keys.some(k=>!fs.existsSync(path.join(directory,k+'-surface.nc'))))return {ok:false,status:'data_pending',msg:'国内土壤数据正在准备中。暂时可手填养分进行试算。',sourceUrl:SOURCE_URL};
    if(!fs.existsSync(python))return {ok:false,status:'reader_unavailable',msg:'服务器尚未安装土壤数据读取环境。'};
    const key=lat+','+lng,hit=cache.get(key);
    if(hit&&Date.now()-hit.time<600000)return hit.data;
    if(active>=4)return {ok:false,status:'busy',msg:'土壤查询繁忙，请稍后重试。'};
    active++;
    try {
      const {stdout}=await exec(python,[path.join(__dirname,'scripts/china-soil-query.py'),directory,String(lat),String(lng)],{timeout:20000,maxBuffer:65536});
      const data=JSON.parse(stdout);
      if(data.ok){if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(key,{time:Date.now(),data});}
      return data;
    }catch {return {ok:false,status:'read_error',msg:'土壤数据暂时无法读取，请稍后重试。'};}
    finally {active--;}
  }
  return {lookup};
}
module.exports={createSoilService};
