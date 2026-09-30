const {test}=require('node:test');
const assert=require('node:assert/strict');

// Guests see the built-in demo; a WeChat bound to an account reads that account's plots from the server.
const API=require.resolve('../miniprogram/utils/api.js'),AUTH=require.resolve('../miniprogram/utils/auth.js');
const TOKEN='t'.repeat(43);
const serverState={
  locations:[{id:'loc-a',name:'东区',type:'红薯地',lat:19.53,lng:110.35,area:12,metadata:{plantDate:'2026-03-01'},tenantId:'t1'},{id:'loc-b',name:'西区',lat:0,lng:0,area:0,metadata:{}}],
  devices:[{id:'dev1',name:'土壤1号',type:'sensor_soil_api',locationId:'loc-a',online:true},{id:'cam',name:'摄像头',type:'camera',locationId:'loc-b'}],
  serverRealtime:{dev1:{deviceTimestamp:1000,dataItems:[{registerItem:[{registerName:'温度',value:25.1,unit:'°C',alarmLevel:0},{registerName:'湿度',value:61,unit:'%',alarmLevel:2}]}]}},
};
const tasks=[{id:'k1',title:'浇水',status:'pending',locationId:'loc-a',createdAt:2},{id:'k2',title:'除草',status:'done',locationId:'loc-a',createdAt:1},{id:'k3',title:'别处',status:'pending',createdAt:3}];

function load(user){
  const storage=new Map([['agri_access_token',TOKEN],['agri_current_user',user]]),calls=[];
  global.wx={
    getStorageSync:k=>storage.get(k)??'',setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),
    login:({success})=>success({code:'c'}),
    request:o=>{calls.push(o.url);const path=o.url.replace(/^.*\/api\/v1/,'');
      setTimeout(()=>o.success(path==='/app-state'?{statusCode:200,data:serverState}:path.startsWith('/farm-tasks?')?{statusCode:200,data:{ok:true,tasks}}:{statusCode:404,data:{ok:false,msg:'nope'}}),1);},
  };
  delete require.cache[API];delete require.cache[AUTH];
  require('../miniprogram/utils/config.js').cloud.env=''; // these tests exercise the direct wx.request path
  return {api:require(API),calls};
}

test('a guest sees the demo park and never calls the server',async()=>{
  const {api,calls}=load(null);
  const res=await api.getPlots();
  assert(res.plots.length>=5);assert.equal(res.plots[0].id,'plot-1');
  assert.equal(calls.length,0);
});

test('a bound account sees its own plots, sensors and pending tasks',async()=>{
  const {api,calls}=load({id:'u1',account:'zhang'});
  const {plots}=await api.getPlots();
  assert.deepEqual(plots.map(p=>p.id),['loc-a','loc-b']);
  const a=plots[0];
  assert.deepEqual([a.name,a.crop,a.plantDate,a.area,a.lat,a.unfinishedCount],['东区','红薯地','2026-03-01',12,19.53,1]);
  assert.deepEqual(a.sensor,{online:true,alarmLevel:2,metrics:[{name:'温度',value:25.1,unit:'°C'},{name:'湿度',value:61,unit:'%'}]});
  assert.deepEqual(plots[1].sensor,{online:false,metrics:[],alarmLevel:0});
  assert(Number.isFinite(a.px)&&Number.isFinite(a.size),'laid out on the park canvas');
  assert(calls.every(u=>u.startsWith('http://47.116.46.214/api/v1/')));
  const d=await api.getPlotDetail('loc-a');
  assert.deepEqual(d.tasks.map(t=>t.id),['k1','k2'],'only this plot, pending first');
  assert.deepEqual(d.devices.map(x=>[x.id,x.factors.length]),[['dev1',2]]);
  assert.equal((await api.getPlotDetail('missing')).ok,false);
  await assert.rejects(api.getPlotDetail.call(null,'x').then(()=>api.getDeviceHistory('dev1')),/nope/);
});
