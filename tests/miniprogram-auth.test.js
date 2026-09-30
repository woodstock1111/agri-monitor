const {test}=require('node:test');
const assert=require('node:assert/strict');

const AUTH=require.resolve('../miniprogram/utils/auth.js');
const TOKEN='t'.repeat(43);

// Minimal wx: storage, wx.login and wx.request answered by `server(url, options)`; network replies arrive asynchronously.
function fakeWx(server){
  const storage=new Map(),log={logins:0,requests:[]};
  global.wx={
    getStorageSync:k=>storage.get(k)??'',setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),
    login:({success})=>{log.logins++;setTimeout(()=>success({code:'code'+log.logins}),5);},
    request:o=>{log.requests.push({url:o.url,method:o.method||'GET',auth:o.header&&o.header.Authorization,data:o.data});setTimeout(()=>o.success(server(o.url,o)),5);},
  };
  delete require.cache[AUTH];
  require('../miniprogram/utils/config.js').cloud.env=''; // direct mode unless a test opts into Cloud Hosting
  return {auth:require(AUTH),storage,log};
}
const loginOk={statusCode:200,data:{ok:true,accessToken:TOKEN,user:{id:'u1'}}};

test('concurrent requests share one wx.login, then carry the session token',async()=>{
  const {auth,log}=fakeWx(url=>url.endsWith('/auth/wechat/login')?loginOk:{statusCode:200,data:{ok:true}});
  const res=await Promise.all([1,2,3].map(i=>auth.request({path:'/harvest/soil?i='+i})));
  assert.equal(log.logins,1);
  assert.deepEqual(res.map(r=>r.statusCode),[200,200,200]);
  const api=log.requests.filter(r=>r.url.includes('/harvest/'));
  assert.equal(api.length,3);assert(api.every(r=>r.auth==='Bearer '+TOKEN));
  assert.match(api[0].url,/^http:\/\/47\.116\.46\.214\/api\/v1\/harvest\/soil\?i=/);
});

test('a 401 triggers one fresh login and one retry, never a loop',async()=>{
  let apiCalls=0;
  const {auth,storage,log}=fakeWx(url=>{if(url.endsWith('/auth/wechat/login'))return loginOk;apiCalls++;return {statusCode:401,data:{ok:false}};});
  storage.set('agri_access_token','stale'.padEnd(43,'x'));
  const res=await auth.request({path:'/harvest/weather'});
  assert.equal(res.statusCode,401);assert.equal(apiCalls,2);assert.equal(log.logins,1);
});

test('an unbound WeChat is a guest and uses the API right away; binding later swaps in the account token',async()=>{
  const GUEST='g'.repeat(43);
  const {auth,storage,log}=fakeWx((url,o)=>{
    if(url.endsWith('/auth/wechat/login'))return {statusCode:200,data:{ok:true,guest:true,accessToken:GUEST,user:null,...(o.data.bind?{bindTicket:'ticket1'}:{})}};
    if(url.endsWith('/auth/wechat/bind'))return o.data.password==='right'?loginOk:{statusCode:401,data:{ok:false,status:'bad_credentials',msg:'账号或密码不对。'}};
    return {statusCode:200,data:{ok:true}};
  });
  assert.equal((await auth.request({path:'/harvest/soil'})).statusCode,200);
  assert.equal(log.requests.at(-1).auth,'Bearer '+GUEST);assert.equal(log.requests[0].data.bind,false,'viewers never ask for a bind ticket');
  assert.equal(auth.currentUser(),null);
  const r=await auth.loginWithWechat({bind:true});
  assert.deepEqual([r.guest,r.bindTicket],[true,'ticket1']);
  const wrong=await auth.bind('ticket1','zhang','wrong');
  assert.deepEqual([wrong.ok,wrong.status,wrong.msg],[false,'bad_credentials','账号或密码不对。']);
  assert.equal(storage.get('agri_access_token'),GUEST,'a failed bind keeps the guest session');
  const ok=await auth.bind('ticket1','zhang','right');
  assert.equal(ok.ok,true);assert.equal(storage.get('agri_access_token'),TOKEN);
});

test('logout tells the server and clears the token; unbind sends a fresh code',async()=>{
  const {auth,storage,log}=fakeWx(()=>({statusCode:200,data:{ok:true}}));
  storage.set('agri_access_token',TOKEN);
  await auth.logout();
  assert.equal(log.requests.at(-1).method,'POST');assert.match(log.requests.at(-1).url,/\/auth\/logout$/);
  assert.equal(storage.get('agri_access_token'),undefined);
  storage.set('agri_access_token',TOKEN);
  await auth.logout({unbind:true});
  assert.equal(log.requests.at(-1).method,'DELETE');assert.match(log.requests.at(-1).url,/\/auth\/wechat\/binding\?code=code1$/);
});

test('with a Cloud Hosting env, calls go through callContainer and sign in without wx.login',async()=>{
  const {auth,log}=fakeWx(()=>{throw new Error('wx.request must not be used');});
  const config=require('../miniprogram/utils/config.js');
  const container=[];let inits=0;
  global.wx.cloud={init:()=>{inits++;},callContainer:o=>{container.push(o);setTimeout(()=>o.success(o.path.endsWith('/auth/wechat/gateway-login')?loginOk:{statusCode:200,data:{ok:true}}),5);}};
  config.cloud.env='prod-test';
  try{
    await Promise.all([auth.request({path:'/harvest/soil'}),auth.request({path:'/harvest/weather'})]);
    assert.equal(log.logins,0,'no wx.login: WeChat vouches for the user');
    assert.equal(inits,1);
    assert.deepEqual(container.map(c=>c.path),['/api/v1/auth/wechat/gateway-login','/api/v1/harvest/soil','/api/v1/harvest/weather']);
    assert(container.every(c=>c.header['X-WX-SERVICE']==='agri-gateway'&&c.config.env==='prod-test'));
    assert.equal(container[1].header.Authorization,'Bearer '+TOKEN);
    await auth.logout({unbind:true});
    assert.deepEqual([container.at(-1).method,container.at(-1).path],['DELETE','/api/v1/auth/wechat/binding']);
  }finally{config.cloud.env='';} // later tests reset it anyway
});
