const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');

// Fake main server that echoes what it received; the gateway forwards to it.
let upstream,gateway,seen=[];
const SECRET='s'.repeat(40);
before(async()=>{
  upstream=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{seen.push({method:req.method,url:req.url,headers:req.headers,body});
    res.writeHead(req.url.startsWith('/api/v1/auth/wechat/bind')?401:200,{'content-type':'application/json','retry-after':'7'});res.end(JSON.stringify({ok:true,echo:req.url}));});});
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  process.env.UPSTREAM_URL=`http://127.0.0.1:${upstream.address().port}`;process.env.FORWARD_SECRET=SECRET;
  delete require.cache[require.resolve('../cloudrun/gateway/index.js')];
  const {handler}=require('../cloudrun/gateway/index.js');
  gateway=http.createServer(handler);await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
});
after(()=>{upstream.close();gateway.close();});

function call(method,path,{headers={},body}={}){
  return new Promise((resolve,reject)=>{
    if(body)headers={...headers,'content-length':Buffer.byteLength(body)};
    const req=http.request({host:'127.0.0.1',port:gateway.address().port,method,path,headers},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:d?JSON.parse(d):null}));});
    req.on('error',reject);if(body)req.write(body);req.end();
  });
}

test('forwards allow-listed calls with the signed openid and the real client IP; strips spoofed gateway headers',async()=>{
  seen=[];
  const r=await call('GET','/api/v1/harvest/weather?lat=1&lng=2&start=2020-01-01&end=2020-12-31',{headers:{
    'x-wx-openid':'o_real','x-wx-source':'miniprogram','x-forwarded-for':'203.0.113.9, 10.0.0.1',authorization:'Bearer abc',
    'x-agri-gateway-secret':'forged','x-agri-wx-openid':'o_forged','x-agri-client-ip':'1.1.1.1'}});
  assert.equal(r.status,200);assert.equal(r.body.echo,'/api/v1/harvest/weather?lat=1&lng=2&start=2020-01-01&end=2020-12-31');
  const h=seen[0].headers;
  assert.equal(h['x-agri-gateway-secret'],SECRET);assert.equal(h['x-agri-wx-openid'],'o_real');assert.equal(h['x-agri-client-ip'],'203.0.113.9');
  assert.equal(h.authorization,'Bearer abc');assert.equal(h['x-wx-openid'],undefined,'raw WeChat headers are not passed on');
});

test('without x-wx-source the openid is not vouched for',async()=>{
  seen=[];
  await call('GET','/api/v1/auth/me',{headers:{'x-wx-openid':'o_direct'}});
  assert.equal(seen[0].headers['x-agri-wx-openid'],undefined);
});

test('bodies, statuses and Retry-After pass through',async()=>{
  seen=[];
  const r=await call('POST','/api/v1/auth/wechat/bind',{headers:{'content-type':'application/json'},body:JSON.stringify({account:'zhang'})});
  assert.equal(r.status,401);assert.equal(r.headers['retry-after'],'7');assert.equal(seen[0].body,'{"account":"zhang"}');
});

test('a DELETE with a JSON body (callContainer sends "{}") arrives framed and intact',async()=>{
  seen=[];
  const r=await call('DELETE','/api/v1/farm-tasks/task_1',{headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(r.status,200);assert.equal(seen[0].method,'DELETE');assert.equal(seen[0].body,'{}');assert.equal(seen[0].headers['content-length'],'2');
});

test('anything outside the allow-list never reaches the main server',async()=>{
  seen=[];
  for(const [m,p] of [['GET','/api/v1/users'],['PUT','/api/v1/app-state'],['POST','/api/v1/auth/login'],['GET','/server-data/app-state.json'],['DELETE','/api/v1/farm-tasks/'],['GET','/api/v1/harvest/weatherX']]){
    assert.equal((await call(m,p)).status,404,m+' '+p);
  }
  assert.equal(seen.length,0);
  assert.equal((await call('GET','/')).status,200,'health check');
});
