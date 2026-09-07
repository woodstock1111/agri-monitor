/* Harvest UI: shared by authenticated sidebar and standalone demo. */
(function() {
  'use strict';
  const presets=[{name:'海南 · 海口',lat:20.045,lng:110.198,mean:24,amp:5,rain:4.5},
    {name:'广西 · 南宁',lat:22.82,lng:108.32,mean:22,amp:7,rain:4},
    {name:'山东 · 潍坊',lat:36.71,lng:119.1,mean:13,amp:14,rain:2.3},
    {name:'黑龙江 · 哈尔滨',lat:45.8,lng:126.53,mean:5,amp:21,rain:1.8}];
  let host, map, marker, controller, revision=0, result=null;
  const $=id=>document.getElementById('hv-'+id);
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=(x,d=0)=>Number(x).toLocaleString('zh-CN',{maximumFractionDigits:d});
  function field(id,label,value,min,max,step=1) {
    return `<label>${label}<input id="hv-${id}" name="${id}" type="number" value="${value}" min="${min}" max="${max}" step="${step}" required></label>`;
  }
  let soil=null, soilController=null, soilRevision=0, requestSoil=null;
  function init(locations=[], options={}) {
    requestSoil=options.requestSoil||requestSoil;
    host=document.getElementById('harvest-root');
    if(!host) return;
    if(host.dataset.ready) { syncLocations(locations); setTimeout(()=>map?.invalidateSize(),80); return; }
    host.dataset.ready='1';
    host.innerHTML=`<header class="hv-hero"><div><span class="hv-eyebrow">种之前，先算一笔账</span><h1>AI收成预测</h1><p>选好地点和播种时间，看看种植条件、收成区间与投入回报。</p></div></header>
    <div class="hv-layout"><form id="hv-form" class="hv-panel hv-inputs"><div class="hv-section-title"><b>01</b><h2>选择你的地块</h2></div>
    <label>地点<select id="hv-location"></select></label>
    <div id="hv-map" aria-label="点击地图选择地块"></div><p class="hv-hint">点地图或填写 WGS84 经纬度；地图加载失败时仍可输入。</p>
    <div class="hv-grid">${field('lat','纬度',20.045,-90,90,.0001)}${field('lng','经度',110.198,-180,180,.0001)}</div>
    <label>气象数据<select id="hv-source"><option value="demo" ${requestSoil?'':'selected'}>人工示例 · 立即体验</option><option value="history" ${requestSoil?'selected':''}>读取所选坐标的历史同期天气</option></select></label>
    <div id="hv-demo-config" ${requestSoil?'hidden':''}><label>示例气候情景<select id="hv-climate">${presets.map((p,i)=>`<option value="${i}">${p.name}</option>`).join('')}</select></label><p class="hv-hint">示例模式使用所选情景的人工季节曲线，不代表坐标实测。</p></div>
    <div class="hv-section-title"><b>02</b><h2>准备怎么种</h2></div><div class="hv-grid">
    <label>作物<select id="hv-crop"><option value="sweetpotato">红薯（代理参数）</option><option value="cassava">木薯</option></select></label>
    ${field('area','种植面积（亩）',10,.01,100000,.01)}
    <label>计划播种日<input id="hv-date" type="date" value="${new Date().getFullYear()}-04-15" required></label>
    ${field('days','生育期（天）',150,60,365)}
    <label>供水方式<select id="hv-water"><option value="rain">雨养</option><option value="irrigated">灌溉充足（假设）</option></select></label>
    <label>排水条件<select id="hv-drainage"><option value="good">良好</option><option value="poor">较差 / 易积水</option></select></label></div>
    <div class="hv-section-title"><b>03</b><h2>投入与土壤假设</h2></div><div class="hv-grid">
    ${field('budget','新增肥料预算（元/亩）',250,0,100000,.01)}${field('price','鲜薯售价（元/kg）',2,0,100,.01)}
    ${field('base','基础总成本（元/亩）',1000,0,100000,.01)}
    <label>风险偏好<select id="hv-risk"><option value="cautious">保守 · 按低产情景比较</option><option value="balanced">均衡 · 按中值比较</option></select></label></div>
    <p class="hv-hint">基础成本请包含种苗、人工、租地、灌溉、采收及已有肥料等；金额均为示例，可修改。</p>
    <label>土壤数据来源<select id="hv-soil-mode"><option value="china" ${requestSoil?'selected':''}>中国土壤格网 · 按地点读取</option><option value="manual" ${requestSoil?'':'selected'}>手填 / 示例养分供应</option></select></label>
    <div class="hv-soil-card"><div id="hv-soil-status" class="hv-hint" role="status" aria-live="polite"></div><div id="hv-soil-values"></div><button type="button" id="hv-soil-retry" class="hv-secondary">重新读取国内土壤</button></div>
    <details id="hv-soil-conversion"><summary>表层养分如何用于试算</summary><p class="hv-hint">格网浓度 × 容重 × 0–4.5 cm土层厚度，先换算表层养分存量，再乘以下假设利用比例。只代表表层供养情景，不能替代完整根区标定。</p><div class="hv-grid">${field('fraction-n','氮利用比例（0–1）',.3,0,1,.01)}${field('fraction-p','磷利用比例（0–1）',.2,0,1,.01)}${field('fraction-k','钾利用比例（0–1）',.4,0,1,.01)}</div></details>
    <details><summary>查看 / 调整试算养分与肥料</summary><p class="hv-hint">以下为模型供应量（kg/ha），国内模式根据表层背景值和假设比例换算；手填模式由你输入。不能直接填入 mg/kg 浓度。</p><div class="hv-grid">
    ${field('ph','土壤 pH',6,3,10,'any')}${field('n','有效氮 N（kg/ha）',60,0,500,'any')}${field('p','有效磷 P（kg/ha）',12,0,500,'any')}${field('k','有效钾 K（kg/ha）',80,0,1000,'any')}${field('fertPrice','复合肥单价（元/kg）',3, .01,1000,.01)}</div><p class="hv-hint">候选肥料：15-15-15（N–P₂O₅–K₂O），0–80 kg/亩，步长 5。此用量范围仅用于 demo 比较。</p></details>
    <button class="hv-primary" id="hv-run" type="submit">开始收成试算 <span>→</span></button><p id="hv-status" class="hv-hint" role="status" aria-live="polite">${requestSoil?'等待国内土壤读取后，即可开始试算。':'已选人工示例。点击开始，查看完整结果。'}</p></form>
    <section class="hv-output" id="hv-output" aria-live="polite"><div class="hv-empty hv-panel"><span class="hv-sprout">♧</span><h2>让每一份投入都有依据</h2><p>从左侧选择地点，开始第一次试算。</p><div class="hv-empty-steps"><span>种植适宜性</span><span>鲜薯收成区间</span><span>投入方案比较</span></div><p class="hv-hint">${requestSoil?'自动读取国内土壤，结合历史同期天气进行试算。':'默认示例无需联网；可切换为真实历史天气。'}</p></div></section></div>`;
    syncLocations(locations);
    $('form').addEventListener('submit',run);
    $('form').addEventListener('input',invalidate);
    $('form').addEventListener('change',invalidate);
    $('location').addEventListener('change',()=> {
      const opt=$('location').selectedOptions[0];
      if(!opt.dataset.lat) return;
      $('lat').value=opt.dataset.lat; $('lng').value=opt.dataset.lng;
      if(opt.dataset.preset!==undefined) { $('climate').value=opt.dataset.preset; }
      else { $('source').value='history'; $('demo-config').hidden=true; }
      updateMarker(); loadSoil();
    });
    ['lat','lng'].forEach(id=>$(id).addEventListener('change',()=>{ $('location').value='custom'; $('source').value='history'; $('demo-config').hidden=true; updateMarker(); loadSoil(); }));
    $('source').addEventListener('change',()=>{ $('demo-config').hidden=$('source').value!=='demo'; });
    ['lat','lng'].forEach(id=>$(id).addEventListener('input',clearSoil));
    $('soil-mode').addEventListener('change',()=>{ clearSoil(); loadSoil(); });
    $('soil-retry').addEventListener('click',()=>{ invalidate(); loadSoil(); });
    ['fraction-n','fraction-p','fraction-k'].forEach(id=>$(id).addEventListener('input',()=>{
      if(soil) { try { applySoil(); } catch(err) { $('soil-status').textContent=err.message; } }
    }));
    loadSoil();
    $('crop').addEventListener('change',()=>{ $('days').value=HarvestModel.crops[$('crop').value].days; });
    if(window.L) {
      map=L.map($('map')).setView([20.045,110.198],7);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:18}).addTo(map);
      marker=L.circleMarker([20.045,110.198],{radius:8,color:'#27745c',fillOpacity:.8}).addTo(map);
      map.on('click',e=>{ $('lat').value=e.latlng.lat.toFixed(4); $('lng').value=((e.latlng.lng+540)%360-180).toFixed(4); $('location').value='custom'; $('source').value='history'; $('demo-config').hidden=true; invalidate(); updateMarker(); loadSoil(); });
      setTimeout(()=>map.invalidateSize(),100);
    } else $('map').innerHTML='<p class="hv-hint">地图未加载，可使用上方地点或下方坐标。</p>';
  }
  function clearSoil() {
    soilRevision++; soilController?.abort(); soil=null; $('soil-retry').disabled=false;
    $('soil-values').innerHTML='';
    if($('soil-mode').value==='china') {
      ['ph','n','p','k'].forEach(id=>{$(id).value='';});
      $('soil-status').textContent='地点已变化，请读取该地点的国内土壤数据。';
    }
  }
  function applySoil() {
    const fractions=['fraction-n','fraction-p','fraction-k'].map(id=>$(id).value.trim()===''?NaN:Number($(id).value));
    const values=HarvestModel.soilSupply(soil,fractions);
    ['ph','n','p','k'].forEach(id=>{$(id).value=Number(values[id].toFixed(4));});
    return values;
  }
  async function loadSoil() {
    clearSoil();
    const china=$('soil-mode').value==='china';
    ['ph','n','p','k'].forEach(id=>{ $(id).disabled=china; });
    $('soil-retry').hidden=!china; $('soil-conversion').hidden=!china;
    ['fraction-n','fraction-p','fraction-k'].forEach(id=>$(id).disabled=!china);
    if(!china) {
      const defaults={ph:6,n:60,p:12,k:80};
      Object.entries(defaults).forEach(([id,v])=>{if($(id).value==='')$(id).value=v;});
      $('soil-status').textContent='手填 / 示例模式：未使用国内土壤格网值。'; return;
    }
    if(!requestSoil) { $('soil-status').innerHTML='请在<a href="/?page=harvest">现有网站的 AI收成预测</a>中登录后读取国内土壤。'; return; }
    const lat=$('lat').value.trim(),lng=$('lng').value.trim();
    if(!lat||!lng||!Number.isFinite(Number(lat))||!Number.isFinite(Number(lng))) { $('soil-status').textContent='请输入有效经纬度。';return; }
    if(Number(lat)<17.8||Number(lat)>54||Number(lng)<73||Number(lng)>136) { $('soil-status').textContent='本版仅提供中国数据，此坐标超出土壤数据范围。';return; }
    const token=soilRevision;
    soilController=new AbortController();const currentController=soilController;
    const timeout=setTimeout(()=>currentController.abort(),22000);
    $('soil-status').textContent='正在读取国内土壤背景数据…'; $('soil-retry').disabled=true;
    try {
      const data=await requestSoil(lat,lng,currentController.signal);
      if(token!==soilRevision)return;
      if(!data.ok)throw Error(data.msg||'该点暂无可用土壤数据');
      soil=data;applySoil();
      if(!result && !$('run').disabled) $('status').textContent='国内土壤已就绪，可以开始试算。';
      $('soil-status').textContent='已读取中国土壤格网 · 0–4.5 cm表层 · 约1 km · 1980年代背景';
      $('soil-values').innerHTML='<div class="hv-soil-grid">'+Object.values(data.fields).map(f=>`<div><span>${escape(f.label)}</span><b>${num(f.value,2)} <small>${escape(f.unit)}</small></b></div>`).join('')+'</div><p class="hv-hint">背景值不是实时测土，也不代表完整根区；原始缺失值已过滤，独立质量控制层尚未接入。<a href="https://doi.org/10.11888/Soil.tpdc.270281" target="_blank" rel="noopener">查看国内数据来源</a></p>';
    } catch(err) {
      if(token!==soilRevision)return;
      soil=null;$('soil-status').textContent=err.name==='AbortError'?'土壤读取超时，请重试。':err.message;
    } finally { clearTimeout(timeout);if(token===soilRevision)$('soil-retry').disabled=false; }
  }
  function syncLocations(locations) {
    const select=$('location'), selected=select.value;
    select.innerHTML=presets.map((p,i)=>`<option value="preset-${i}" data-preset="${i}" data-lat="${p.lat}" data-lng="${p.lng}">${p.name} · 示例地点</option>`).join('')+
      locations.filter(l=>Number.isFinite(Number(l.lat))&&Number.isFinite(Number(l.lng))&&Math.abs(Number(l.lat))<=90&&Math.abs(Number(l.lng))<=180).map(l=>`<option value="loc-${escape(l.id)}" data-lat="${Number(l.lat)}" data-lng="${Number(l.lng)}">已有地块 · ${escape(l.name)}</option>`).join('')+'<option value="custom">自定义坐标 / 地图选点</option>';
    if([...select.options].some(o=>o.value===selected)) select.value=selected;
  }
  function updateMarker() {
    const lat=Number($('lat').value),lng=Number($('lng').value);
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180) return;
    marker?.setLatLng([lat,lng]); map?.setView([lat,lng],map.getZoom());
  }
  function invalidate() {
    revision++; controller?.abort(); result=null;
    $('run').disabled=false; $('run').textContent='重新试算 →';
    $('status').textContent='参数已修改，请重新试算。';
    if($('output').querySelector('.hv-result')) $('output').innerHTML='<div class="hv-panel hv-empty"><h2>参数已更新</h2><p>重新试算后查看该地点与投入方案的结果。</p></div>';
  }
  function params() {
    const p={};
    for(const id of ['lat','lng','area','days','ph','n','p','k','budget','price','base','fertPrice']) p[id]=$(id).value.trim()===''?NaN:Number($(id).value);
    for(const id of ['crop','date','water','drainage','risk']) p[id]=$(id).value;
    p.soilOrigin=$('soil-mode').value;
    if(p.soilOrigin==='china') {
      if(!soil)throw Error('国内土壤数据未就绪，请读取成功后再试算，或主动切换手填模式。');
      Object.assign(p,applySoil());
    }
    return HarvestModel.validate(p);
  }
  function historicalDates(p) {
    const start=new Date('2024-'+p.date.slice(5)+'T00:00:00Z');
    const end=new Date(start.getTime()+(p.days-1)*86400000);
    return {start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)};
  }
  function demo(p) {
    const region=presets[Number($('climate').value)],d={temperature_2m_mean:[],temperature_2m_min:[],precipitation_sum:[],et0_fao_evapotranspiration:[]};
    const start=Date.parse(p.date+'T00:00:00Z');
    for(let i=0;i<p.days;i++) {
      const date=new Date(start+i*86400000), day=(date-Date.UTC(date.getUTCFullYear(),0,1))/86400000;
      const wave=Math.cos(2*Math.PI*(day-200)/365.25),t=region.mean+region.amp*wave;
      d.temperature_2m_mean.push(t); d.temperature_2m_min.push(t-7);
      d.precipitation_sum.push(region.rain*(1+.7*wave)); d.et0_fao_evapotranspiration.push(Math.max(1,t*.14));
    }
    return {daily:d,source:'人工示例气候 · '+region.name+'（非坐标实测）'};
  }
  async function run(e) {
    e.preventDefault(); if(!$('form').reportValidity()) return;
    controller?.abort(); controller=new AbortController(); const token=++revision;
    result=null; $('run').disabled=true; $('status').textContent='正在计算…';
    let timeout;
    try {
      const p=params(); let weather;
      if($('source').value==='demo') weather=demo(p);
      else {
        $('status').textContent='正在读取该坐标的 2024 历史同期天气（最长等待 20 秒）…';
        const range=historicalDates(p), query=new URLSearchParams({latitude:p.lat,longitude:p.lng,start_date:range.start,end_date:range.end,daily:'temperature_2m_mean,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration',timezone:'auto',models:'era5'});
        timeout=setTimeout(()=>controller.abort(),20000);
        const response=await fetch('https://archive-api.open-meteo.com/v1/archive?'+query,{signal:controller.signal});
        if(!response.ok) throw Error('历史天气服务暂不可用，请重试或选择人工示例。');
        const data=await response.json();
        weather={daily:data.daily,source:`Open-Meteo / ERA5 · ${range.start} 至 ${range.end} 历史情景`};
      }
      if(token!==revision) return;
      const output=HarvestModel.evaluate(p,weather.daily);
      result={version:'harvest-china-2',generatedAt:new Date().toISOString(),input:p,soil:p.soilOrigin==='china'?soil:null,source:weather.source,daily:weather.daily,output,limitations:'未校准情景；土壤来源随结果附带；价格及养分利用比例为输入假设；范围不是统计置信区间；红薯使用马铃薯代理参数。'};
      render(result); $('status').textContent='试算完成。修改条件后可重新比较。';
    } catch(err) {
      if(token!==revision) return;
      $('status').textContent=err.name==='AbortError'?'天气读取超时，请重试或切换为人工示例。':err.message;
      $('output').innerHTML='<div class="hv-panel hv-empty"><h2>本次试算未完成</h2><p>请查看左侧提示，调整后重试。</p></div>';
    } finally { clearTimeout(timeout); if(token===revision) { $('run').disabled=false; $('run').textContent='重新试算 →'; } }
  }
  function render(r) {
    const p=r.input,o=r.output,b=o.best;
    const label=o.score>=75?'条件较适宜':o.score>=45?'有条件种植':'当前情景不建议种植';
    const tone=o.score>=75?'good':o.score>=45?'watch':'poor';
    const end=new Date(Date.parse(p.date+'T00:00:00Z')+(p.days-1)*86400000).toISOString().slice(0,10);
    const risks=o.factors.filter(f=>f.value<.75);
    $('output').innerHTML=`<div class="hv-result"><div class="hv-source">${escape(r.source)}<br>${r.soil?'土壤：中国格网背景 · 0–4.5 cm表层；供养换算未经本地标定':'土壤：手填 / 示例假设'}</div>
      <article class="hv-verdict hv-${tone}"><div><span class="hv-eyebrow">${escape(o.crop)} · 种植条件初筛</span><h2>${label}</h2><p>${o.frost?'所选气候情景存在霜冻，优先调整播期或更换作物。':risks.length?'优先核实'+risks.map(f=>f.name).join('、')+'，再决定投入。':'气候与输入的土壤条件匹配，下一步请核实地块实测数据。'}</p></div><div class="hv-score"><strong>${o.score}</strong><span>/ 100 · 规则评分</span></div></article>
      ${r.soil?`<article class="hv-panel"><div class="hv-title-row"><h2>这块地的土壤背景</h2><span>中国土壤格网 · 0–4.5 cm</span></div><div class="hv-soil-grid">${Object.values(r.soil.fields).map(f=>`<div><span>${escape(f.label)}</span><b>${num(f.value,2)} <small>${escape(f.unit)}</small></b></div>`).join('')}</div><p class="hv-hint">1980年代背景 · 约1 km · 不是实时测土，不能代表完整根区。<a href="https://doi.org/10.11888/Soil.tpdc.270281" target="_blank" rel="noopener">数据来源</a></p></article>`:''}
      <div class="hv-metrics"><article class="hv-panel"><span>候选最优 · 鲜薯亩产情景</span><strong>${num(b.low)}–${num(b.high)}</strong><small>kg / 亩 · 中值 ${num(b.fresh)}</small></article>
      <article class="hv-panel"><span>全地块预计鲜薯总量</span><strong>${num(b.fresh*p.area/1000,1)}</strong><small>吨 · ${num(p.area,2)} 亩</small></article>
      <article class="hv-panel"><span>预计结余 · 中值</span><strong>¥${num(b.net)}</strong><small>元 / 亩 · 全地块 ¥${num(b.net*p.area)}</small></article></div>
      <article class="hv-panel"><div class="hv-title-row"><h2>为什么适合，哪里受限</h2><span>关键条件取最短板</span></div><div class="hv-factors">${o.factors.map(f=>`<div><div class="hv-title-row"><b>${f.name}</b><span>${Math.round(f.value*100)} / 100</span></div><div class="hv-track"><span style="width:${f.value*100}%"></span></div><p>${f.detail}</p></div>`).join('')}</div></article>
      <article class="hv-panel"><div class="hv-title-row"><h2>多投一点，是否划算？</h2><span>${p.risk==='cautious'?'按低产情景选优':'按中值选优'}</span></div><p class="hv-hint">新增肥料预算 ¥${num(p.budget)} / 亩；所有方案已扣基础成本 ¥${num(p.base)} / 亩。候选范围内比较，非农艺施肥处方。</p>
      <div class="hv-table-wrap"><table><thead><tr><th>方案</th><th>新增复合肥<br>kg/亩</th><th>新增成本<br>元/亩</th><th>鲜薯中值<br>kg/亩</th><th>结余中值<br>元/亩</th></tr></thead><tbody>${o.rows.map((x,i)=>`<tr class="${i===2?'hv-chosen':''}"><td>${x.name}</td><td>${num(x.rate)}</td><td>${num(x.cost)}</td><td>${num(x.fresh)}</td><td>¥${num(x.net)}</td></tr>`).join('')}</tbody></table></div><p class="hv-hint">${b.rate===0?'当前候选中，不新增肥料更划算。':'候选最优相对零新增投入，每亩中值结余变化 ¥'+num(b.net-o.rows[0].net)+'。'} ${b.net<0?'当前价格和成本下预计亏损，先核实销路与成本。':''}</p></article>
      <article class="hv-panel hv-next"><h2>接下来，先做这几件事</h2><p><b>01 · 核实地块</b>　${risks.length?'检查'+risks.map(f=>f.name).join('、')+'，必要时调整播期。':'核实地类、土层深度、排水和病虫害情况。'}</p><p><b>02 · 补充实测</b>　测土并确认本地品种，替换默认土壤与价格假设。</p><p><b>03 · 小面积验证</b>　计划 ${p.date} 播种，${end} 收获；以实际成熟度与天气调整。</p></article>
      <details class="hv-panel hv-method" open><summary>数据与算法说明 · 如何理解这个结果</summary><p>这是未校准的种植情景试算。产量范围为中值上下 ${Math.round(o.spread*100)}% 的敏感性情景（上界受潜在产量约束），不是统计置信区间。历史天气不能代表未来天气；地图点位未做可耕地校验。</p><p>气候上限使用 demo 温度、水量和土壤折减规则，未接入 LINTUL。QUEFTS 计算养分限制干重，再按假设干物质比例 ${HarvestModel.crops[p.crop].dm*100}% 折算鲜重。${p.crop==='sweetpotato'?'红薯采用马铃薯代理浓度参数，干鲜重基准及本地适用性尚待验证。':'木薯参数依据报告引用的 Ezui et al. 2016，仍需本地校准。'}</p><p>来源：<a href="https://github.com/IITA-AKILIMO/akilimo-recommendations" target="_blank" rel="noopener">AKILIMO / QUEFTS</a> · <a href="https://open-meteo.com/en/docs/historical-weather-api" target="_blank" rel="noopener">Open-Meteo 历史天气</a> · ${r.soil?'土壤来源：戴永久、上官微，中国土壤格网（DOI 10.11888/Soil.tpdc.270281），CC BY-NC-SA 4.0。仅表层供养情景，非完整根区。':'土壤为手填 / 示例值。'} 管理、价格与养分利用比例为输入假设。</p><button type="button" class="hv-secondary" id="hv-export">导出本次试算 JSON</button></details></div>`;
    $('export').addEventListener('click',()=> {
      if(!result) return;
      const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));
      const a=document.createElement('a'); a.href=url; a.download='收成试算-'+p.date+'.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
  }
  window.HarvestUI={init};
})();
