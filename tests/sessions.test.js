const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createSessionService,hashToken,TTL}=require('../lib/sessions');

function memoryStore(){
  const rows=new Map(),calls={get:0,extend:0};
  return {rows,calls,
    async insert(s){rows.set(s.id,{userId:s.userId,openid:s.openid,client:s.client,expiresAt:s.expiresAt});},
    async get(id){calls.get++;const r=rows.get(id);return r?{...r}:null;},
    async extend(id,expiresAt){calls.extend++;const r=rows.get(id);if(r)r.expiresAt=expiresAt;},
    async remove(id){rows.delete(id);},
    async removeUser(userId,client){for(const [id,r] of rows)if(r.userId===userId&&(!client||r.client===client))rows.delete(id);},
    async removeExpired(){return 0;}};
}
function setup(){let t=Date.parse('2026-09-29T00:00:00Z');const store=memoryStore();const clock={now:()=>t,advance:ms=>{t+=ms;}};return {store,clock,s:createSessionService({store,now:clock.now})};}

test('tokens are random 256-bit strings and only their hash is stored',async()=>{
  const {s,store}=setup();
  const a=await s.create('u1','web'),b=await s.create('u1','web');
  assert.match(a.token,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(a.token,b.token);
  assert(store.rows.has(hashToken(a.token)));assert(![...store.rows.keys()].includes(a.token));
  assert.deepEqual(await s.validate(a.token),{userId:'u1',openid:null,client:'web',expiresAt:a.expiresAt});
});

test('malformed, unknown and old signed tokens are rejected without a database read',async()=>{
  const {s,store}=setup();
  for(const t of ['',null,'abc','x.y.z','a'.repeat(44),'a'.repeat(42)+'!'])assert.equal(await s.validate(t),null);
  assert.equal(store.calls.get,0);
  assert.equal(await s.validate('a'.repeat(43)),null);assert.equal(store.calls.get,1);
});

test('web sessions last 7 days, mini program 30; used sessions are extended once past half-life',async()=>{
  const {s,store,clock}=setup();
  const web=await s.create('u1','web'),mini=await s.create('u1','miniprogram');
  clock.advance(3*86400000);
  await s.validate(web.token);assert.equal(store.calls.extend,0,'more than half left: no write');
  clock.advance(1.5*86400000);
  const renewed=await s.validate(web.token);
  assert.equal(store.calls.extend,1);assert.equal(renewed.expiresAt,clock.now()+TTL.web);
  clock.advance(8*86400000);
  assert.equal(await s.validate(web.token),null,'unused for longer than the lifetime');
  assert.ok(await s.validate(mini.token),'mini program session still valid after 12.5 days');
});

test('validation is cached for 60 s, then read again',async()=>{
  const {s,store,clock}=setup();
  const a=await s.create('u1','web');
  await s.validate(a.token);await s.validate(a.token);assert.equal(store.calls.get,1);
  clock.advance(61000);await s.validate(a.token);assert.equal(store.calls.get,2);
});

test('logout ends one session; revoking a user ends all of them (or one client type) immediately',async()=>{
  const {s}=setup();
  const w1=await s.create('u1','web'),w2=await s.create('u1','web'),m=await s.create('u1','miniprogram'),other=await s.create('u2','web');
  for(const t of [w1,w2,m,other])await s.validate(t.token); // warm the cache
  await s.revoke(w1.token);
  assert.equal(await s.validate(w1.token),null);assert.ok(await s.validate(w2.token));
  await s.revokeUser('u1','miniprogram');
  assert.equal(await s.validate(m.token),null);assert.ok(await s.validate(w2.token));
  await s.revokeUser('u1');
  assert.equal(await s.validate(w2.token),null);assert.ok(await s.validate(other.token));
});

test('a mini program guest session carries only the openid; guests are never web sessions',async()=>{
  const {s}=setup();
  const g=await s.create(null,'miniprogram',{openid:'o_guest'});
  assert.deepEqual(await s.validate(g.token),{userId:null,openid:'o_guest',client:'miniprogram',expiresAt:g.expiresAt});
  await assert.rejects(s.create(null,'web',{openid:'o_guest'}));
  await assert.rejects(s.create(null,'miniprogram'));
});
