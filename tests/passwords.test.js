const {test}=require('node:test');
const assert=require('node:assert/strict');
const {hashPassword,hashPasswordLegacy,verifyPassword,passwordNeedsRehash,ITERATIONS}=require('../lib/passwords');

test('new hashes use 600k iterations, verify, and do not need rehashing',async()=>{
  const h=await hashPassword('老张的密码');
  assert.match(h,new RegExp(`^pbkdf2-sha256\\$${ITERATIONS}\\$[0-9a-f]{32}\\$[0-9a-f]{64}$`));
  assert.equal(await verifyPassword('老张的密码',h),true);
  assert.equal(await verifyPassword('wrong',h),false);
  assert.equal(passwordNeedsRehash(h),false);
  assert.notEqual(await hashPassword('same'),await hashPassword('same'),'salted');
});

test('legacy 120k hashes from app-state.json still verify and are flagged for upgrade',async()=>{
  const legacy=hashPasswordLegacy('admin123456');
  assert.match(legacy,/^pbkdf2\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.equal(await verifyPassword('admin123456',legacy),true);
  assert.equal(await verifyPassword('admin12345',legacy),false);
  assert.equal(passwordNeedsRehash(legacy),true);
  assert.equal(passwordNeedsRehash(await hashPassword('x',1000)),true,'weaker iteration count is upgraded too');
});

test('garbage hashes never verify and never throw',async()=>{
  for(const h of [null,'','plain','pbkdf2$a','pbkdf2-sha256$abc$aa$'+'0'.repeat(64),'pbkdf2-sha256$99999999$aa$'+'0'.repeat(64),'pbkdf2$aa$zz'])
    assert.equal(await verifyPassword('x',h),false,String(h));
});
