const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createSoilService}=require('../china-soil');
test('soil endpoint validation rejects missing, invalid and foreign coordinates',async()=>{
 const s=createSoilService({directory:'/tmp/nonexistent-agri-soil-fixture'});
 for(const args of [[undefined,'110'],['','110'],['not-a-number','110'],['91','110']])assert.equal((await s.lookup(...args)).status,'invalid_coordinates');
 assert.equal((await s.lookup('49.2','-123')).status,'outside_coverage');
 assert.equal((await s.lookup('20','110')).status,'data_pending');
});
