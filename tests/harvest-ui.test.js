const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const M=require('../harvest-model');
test('climate-only result replaces a previous nutrient result without reading absent yield fields',()=>{
 const elements=new Map();
 const document={getElementById(id){if(!elements.has(id))elements.set(id,{innerHTML:'',hidden:true,value:'0',classList:{remove(){}},addEventListener(){}});return elements.get(id);}};
 const window={HarvestModel:M};
 // Expose the real renderer only inside this unit-test sandbox. No browser or live app state.
 vm.runInNewContext(fs.readFileSync(require.resolve('../harvest'),'utf8').replace('window.HarvestUI={init};','window.HarvestUI={init,render};'),{window,document});
 const p={lat:-6,lng:35,area:10,days:150,ph:6,n:60,p:12,k:80,budget:250,price:2,base:1000,fertPrice:3,crop:'sweetpotato',date:'2027-03-15',water:'sufficient',drainage:'good',risk:'cautious',currency:'CNY',soilOrigin:'climate'};
 const daily={temperature_2m_mean:Array(150).fill(26),temperature_2m_min:Array(150).fill(18),precipitation_sum:Array(150).fill(4),et0_fao_evapotranspiration:Array(150).fill(3)};
 const base={input:p,display:{unit:'mu'},weather:{kind:'history',source:'test fixture',requested:1,excluded:[]},fieldId:''};
 window.HarvestUI.render({...base,output:M.evaluate(p,daily)});
 assert.match(elements.get('hv-quick-content').innerHTML,/预计收成/);
 window.HarvestUI.render({...base,output:M.evaluateClimate(p,[{year:2020,daily}])});
 const card=elements.get('hv-quick-content').innerHTML,details=elements.get('hv-output').innerHTML;
 assert.match(card,/养分数据待补充/);assert.doesNotMatch(card,/预计收成/);assert.match(card,/100<small> \/ 100/);
 assert.match(details,/18.0°C/);assert.match(details,/不提示冻害/);assert.equal(elements.get('hv-output').hidden,false);
});
function raceHarness(){
 const elements=new Map(),document={getElementById(id){if(!elements.has(id))elements.set(id,{innerHTML:'',hidden:true,disabled:false,value:'manual',classList:{add(){},remove(){}},addEventListener(){}});return elements.get(id);}};
 const window={HarvestModel:M,innerWidth:1200};
 const source=fs.readFileSync(require.resolve('../harvest'),'utf8').replace('window.HarvestUI={init};',`window.HarvestUI={run,invalidate,setInput(p){params=()=>p;},setWeather(w){weather=w;},breakRender(){render=()=>{throw Error('render failure');};},state(){return {result,stale};}};host={classList:{add(){},remove(){}}};`);
 vm.runInNewContext(source,{window,document,AbortController,setTimeout,clearTimeout});
 const input={lat:20,lng:110,area:10,days:150,ph:6,n:60,p:12,k:80,budget:250,price:2,base:1000,fertPrice:3,crop:'sweetpotato',date:'2027-03-15',water:'sufficient',drainage:'good',risk:'cautious',currency:'CNY',soilOrigin:'manual'};
 const daily={temperature_2m_mean:Array(150).fill(26),temperature_2m_min:Array(150).fill(18),precipitation_sum:Array(150).fill(4),et0_fao_evapotranspiration:Array(150).fill(3)};
 const response={kind:'history',source:'fixture',requested:1,excluded:[],included:[{year:2020,daily}]};
 return {ui:window.HarvestUI,elements,input,response,event:{preventDefault(){}}};
}
test('double submission is ignored; late old-location response cannot overwrite newer result',async()=>{
 const h=raceHarness(),requests=[];h.ui.setInput(h.input);h.ui.setWeather(()=>new Promise(resolve=>requests.push(resolve)));
 const first=h.ui.run(h.event);await h.ui.run(h.event);assert.equal(requests.length,1);
 h.ui.invalidate();h.ui.setInput({...h.input,lat:22});const second=h.ui.run(h.event);assert.equal(requests.length,2);
 requests[1](h.response);await second;assert.equal(h.ui.state().result.input.lat,22);
 requests[0](h.response);await first;assert.equal(h.ui.state().result.input.lat,22);assert.equal(h.ui.state().stale,false);
});
test('failed rerun clears previous result and failed renderer cannot mark output successful',async()=>{
 const h=raceHarness();h.ui.setInput(h.input);h.ui.setWeather(async()=>h.response);await h.ui.run(h.event);assert(h.ui.state().result);
 h.ui.setWeather(async()=>{throw Error('weather failed');});await h.ui.run(h.event);
 assert.equal(h.ui.state().result,null);assert.equal(h.ui.state().stale,true);assert.equal(h.elements.get('hv-output').hidden,true);assert.equal(h.elements.get('hv-run').disabled,false);
 h.ui.setWeather(async()=>h.response);h.ui.breakRender();await h.ui.run(h.event);assert.equal(h.ui.state().result,null);assert.equal(h.ui.state().stale,true);
});
