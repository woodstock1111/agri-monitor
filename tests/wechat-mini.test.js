const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createWechatMini,WechatError}=require('../lib/wechat-mini');

const client=(reply,calls=[])=>createWechatMini({appId:'wx_test',secret:'test_secret',request:async(url)=>{calls.push(url);return typeof reply==='function'?reply():{status:200,data:reply};}});

test('exchanges a code for the openid and never returns session_key',async()=>{
  const calls=[];
  const r=await client({openid:'o_1',session_key:'sk',unionid:'u_1'},calls).code2Session('0a1B2c3D4e5F');
  assert.deepEqual(r,{openid:'o_1',unionid:'u_1'});
  const u=new URL(calls[0]);
  assert.equal(u.host,'api.weixin.qq.com');assert.equal(u.pathname,'/sns/jscode2session');
  assert.equal(u.searchParams.get('js_code'),'0a1B2c3D4e5F');assert.equal(u.searchParams.get('grant_type'),'authorization_code');
});

test('WeChat error codes map to statuses the mini program can act on',async()=>{
  for(const [errcode,status] of [[40029,401],[40163,401],[45011,429],[40226,403],[-1,503],[99999,502]]){
    await assert.rejects(client({errcode,errmsg:'x'}).code2Session('0a1B2c3D4e5F'),e=>e instanceof WechatError&&e.status===status&&e.errcode===errcode);
  }
  await assert.rejects(client(()=>{throw new Error('Timeout');}).code2Session('0a1B2c3D4e5F'),e=>e.status===503);
});

test('bad codes are rejected locally; a missing AppSecret is reported, not sent',async()=>{
  const calls=[];
  for(const code of [undefined,'','short','has space in it','a'.repeat(200)])await assert.rejects(client({openid:'o'},calls).code2Session(code),e=>e.status===400);
  assert.equal(calls.length,0);
  const bare=createWechatMini({appId:'',secret:'',request:async()=>{throw new Error('should not be called');}});
  assert.equal(bare.configured(),false);
  await assert.rejects(bare.code2Session('0a1B2c3D4e5F'),e=>e.status===503&&/AppSecret/.test(e.message));
});
