/* Harvest Beta UI; isolated from the platform's storage and collector modules. */
(function(){
  'use strict';
  const M=window.HarvestModel;
  const presets=[['海南 · 海口',20.045,110.198],['山东 · 潍坊',36.71,119.1],['广西 · 南宁（武鸣）',23.16,108.27],['尼日利亚 · 示例区域',8,8],['坦桑尼亚 · 示例区域',-6,35],['泰国 · 示例区域',15,101],['越南 · 示例区域',12,108]];
  const $=id=>document.getElementById('hv-'+id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=(x,d=0)=>Number.isFinite(x)?x.toLocaleString('zh-CN',{maximumFractionDigits:d}):'—';
  let host,map,marker,requestSoil,soil=null,soilController,soilLoading,weatherController,revision=0,soilRevision=0,result=null,stale=false,calibration=null,mapExpanded=false,unit='mu',autoClimate=false,soilError='',soilKey='',soilLoadingKey='',nutrientOrigin=null;
  // soilKey: point the loaded soil belongs to. nutrientOrigin: {kind:'soil',key} when ph/N/P/K were filled from a point's soil,
  // {kind:'user'} when typed. Values filled from one point's soil must never be reused for another point.
  const NUTRIENT_DEFAULTS={ph:6,n:60,p:12,k:80};
  const weatherCache=new Map();
  // Rough CNY reference for pumped/delivered irrigation water (water fee + pumping power); flagged as an example, not a local tariff.
  const IRRIGATION_EXAMPLE_CNY=0.5;let irrigationPriceTouched=false;
  function input(id,label,value,min,max,step='any') {return `<label>${label}<input id="hv-${id}" type="number" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;}
  function number(id){return $(id).value.trim()===''?NaN:Number($(id).value);}
  function pointKey(lat=number('lat'),lng=number('lng')){return Number.isFinite(lat)&&Number.isFinite(lng)?lat+','+lng:'';}
  function per(){return unit==='ha'?'公顷':'亩';}
  const motion=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';
  let view={f:1,label:'亩'}; // unit of the result being shown; fixed when rendered
  function factor(){return unit==='ha'?15:1;}
  function status(text){$('status').textContent=text;if($('quick-status'))$('quick-status').textContent=text;}
  function soilStatus(text){$('soil-status').textContent=text;$('soil-summary').textContent=text;}
  function syncLocations(locations){
    const previous=$('location').value;
    const own=locations.filter(l=>l.lat!==''&&l.lng!==''&&l.lat!=null&&l.lng!=null&&Number.isFinite(Number(l.lat))&&Number.isFinite(Number(l.lng))&&Math.abs(l.lat)<=90&&Math.abs(l.lng)<=180&&!(Number(l.lat)===0&&Number(l.lng)===0));
    $('location').innerHTML=(own.length?`<optgroup label="我的地块">${own.map(l=>`<option value="loc-${esc(l.id)}" data-lat="${Number(l.lat)}" data-lng="${Number(l.lng)}">${esc(l.name)}</option>`).join('')}</optgroup>`:'')+
      `<optgroup label="示例区域">${presets.map((p,i)=>`<option value="preset-${i}" data-lat="${p[1]}" data-lng="${p[2]}">${p[0]}</option>`).join('')}</optgroup><option value="custom">地图选点 / 自定义坐标</option>`;
    $('location').value=[...$('location').options].some(o=>o.value===previous)?previous:'preset-0';
  }
  function init(locations=[],options={}){
    if(options.requestSoil)requestSoil=options.requestSoil;
    host=document.getElementById('harvest-root');if(!host)return;
    if(host.dataset.ready==='3'){syncLocations(locations);setTimeout(()=>map?.invalidateSize(),80);return;}
    host.dataset.ready='3';
    host.innerHTML=`<header class="hv-hero"><div><p class="hv-eyebrow">种植决策 · 从一块地开始</p><h1>AI收成预测 <span class="hv-beta">Beta</span></h1><p>比较不同年景下的收成与投入，找出真正限制这块地的因素。</p></div><div class="hv-model-note">红薯 / 木薯<br><small>多年气候 × 每日水分 × 养分限制</small></div></header>
    <section class="hv-panel hv-crop-panel" aria-labelledby="hv-crop-title"><div class="hv-title-row"><div class="hv-step-title"><span class="hv-step">01</span><h2 id="hv-crop-title">先确认作物与品种</h2></div><span class="hv-beta">当前计算假设</span></div><div class="hv-grid">    <label>作物<select id="hv-crop" form="hv-form"><option value="sweetpotato">红薯 · Beta</option><option value="cassava">木薯 · Beta</option></select></label>
    <label>品种（可暂不填）<input id="hv-variety" form="hv-form" placeholder="未填写使用通用参数" maxlength="80"></label></div><p id="hv-crop-note" class="hv-hint" aria-live="polite"></p></section>
    <div class="hv-workbench"><section class="hv-panel hv-map-panel" aria-labelledby="hv-map-title"><div class="hv-map-toolbar"><div><span class="hv-step">02</span><h2 id="hv-map-title">先把地选准</h2></div><button type="button" id="hv-map-expand" class="hv-secondary" aria-expanded="false">展开地图 ↗</button></div>
    <div class="hv-location-row"><label>地块或示例区域<select id="hv-location"></select></label>${input('lat','纬度 · WGS84',20.045,-90,90)}${input('lng','经度 · WGS84',110.198,-180,180)}</div>
    <div id="hv-map" aria-label="点击地图选择位置；也可以在上方输入经纬度"></div><div class="hv-map-footer"><span id="hv-point">20.0450° N · 110.1980° E</span><span>点击地图或拖动标记 · 展开后可滚轮缩放 · 地图不代表可耕地证明</span></div></section>
    <aside class="hv-action-col" aria-label="开始分析"><div class="hv-step-title"><span class="hv-step">03</span><h2>开始分析</h2></div><button id="hv-quick-run" class="hv-primary hv-run-big" type="button"><span>分析这个位置</span><small>选好地块后点这里 ↓</small></button><div class="hv-loading-track"><i></i></div><p id="hv-quick-status" role="status" class="hv-hint">默认红薯 · 150天 · 自动比较种植时间 · 按及时灌溉计算</p><div class="hv-soil-summary"><p id="hv-soil-summary" role="status"></p><button id="hv-use-local-soil" type="button" class="hv-text-button">读取内置国内土壤 ↻</button></div><button type="button" id="hv-open-settings" class="hv-settings-big"><span>调整种植条件 ↓</span><small>种植日期、土壤养分、供水、售价与成本</small></button></aside></div>
    <div class="hv-layout"><details id="hv-settings" class="hv-settings"><summary><span>种植条件与投入设置</span><small>日期、土壤、预算 · 点击展开</small></summary><form id="hv-form" class="hv-panel hv-inputs" novalidate>
    <div class="hv-section-title"><h2>准备怎么种</h2></div><div class="hv-grid">

    <label>面积单位<select id="hv-unit"><option value="mu">亩</option><option value="ha">公顷 ha</option></select></label>${input('area','种植面积',10,.001,100000)}
    <label>种植时间怎么选<select id="hv-date-mode"><option value="auto">自动比较当地种植时间 · Beta</option><option value="manual">使用我填写的日期</option></select></label><label>种植 / 移栽日期<input id="hv-date" type="date" value="${new Date().toISOString().slice(0,10)}"></label>${input('days','计划生育期（天）',150,60,365,1)}</div>

    <label>天气来源<select id="hv-source"><option value="history" selected>真实历史天气 · 全球坐标</option><option value="demo">人工天气情景 · 只看界面，不判断能否种</option></select></label>
    <label>比较多少个历史生长季<select id="hv-years"><option value="5">最近5个完整生长季</option><option value="10" selected>最近10个完整生长季</option><option value="20">最近20个完整生长季</option></select></label>
    <div class="hv-section-title"><h2>土壤与供水</h2></div>
    <label>养分数据<select id="hv-soil-mode"><option value="china" ${requestSoil?'selected':''}>读取国内表层格网 · Beta</option><option value="manual" ${requestSoil?'':'selected'}>手填整季养分供应 · Beta</option><option value="climate">只有天气 · 先看气候和水分条件</option></select></label>
    <div class="hv-soil-card"><p id="hv-soil-status" role="status" aria-live="polite"></p><div id="hv-soil-values"></div><button type="button" id="hv-soil-retry" class="hv-text-button">重新读取土壤</button></div>
    <div class="hv-grid"><label>土壤质地<select id="hv-texture"><option value="loam">壤土 · 假设</option><option value="sandy">砂质土 · 假设</option><option value="clay">黏质土 · 假设</option></select></label>
    <label>供水方式<select id="hv-water"><option value="sufficient" selected>水源充足 · 缺水时及时适量浇水</option><option value="irrigated">浇水有限 · 按实际水量计算</option><option value="rain">只靠下雨 · 不额外浇水</option></select></label>
    <label>排水<select id="hv-drainage"><option value="unknown" selected>不确定 · 按一般计算</option><option value="good">良好 · 高垄、沟渠通畅</option><option value="moderate">一般</option><option value="poor">较差 / 易积水</option></select></label>${input('irrigationLimit','本季可补灌水量（mm）',300,0,3000)}<label>灌溉费 / 立方米到田水（默认为参考值，可改或清空）<input id="hv-irrigationPrice" type="number" min="0" max="1000" step="any" value="${IRRIGATION_EXAMPLE_CNY}" placeholder="留空＝不计入，不是0元"></label><label class="hv-check"><input id="hv-irrigationInBase" type="checkbox"><span>基础成本已包含灌溉费（不再单独扣除）</span></label></div>
    <p class="hv-hint">默认按及时灌溉计算，不把缺水当作限制；灌溉费默认 ${IRRIGATION_EXAMPLE_CNY} 元/立方米，是国内水费加抽水电费的粗略参考（常见约 0.2–1 元，取决于水源、扬程和电价），请改为当地实际；换成其他币种时会清空。浇水不会消除连续降雨造成的过湿和积水。排水不确定时会同时给出良好/一般/较差情景。模型未接入地势、河网和洪水资料，河流洪水淹没尚未评估。</p><details><summary>土壤与生长专业设置</summary><p class="hv-hint">持水参数暂由质地估计。以下根深和初始含水比例为假设，可据实调整。养分必须是整季可吸收供应，不可直接填化验浓度 mg/kg。</p><div class="hv-grid">
    ${input('rootDepth','有效根区深度（m）',1,.15,2)}${input('initialWater','初始可用水比例（0–1）',.6,0,1)}${input('irrigationDailyMax','单日补灌上限（mm）',15,0,100)}${input('ph','pH',6,3,10)}
    ${input('n','N 供应（kg/ha）',60,0,500)}${input('p','P 供应（kg/ha）',12,0,500)}${input('k','K 供应（kg/ha）',80,0,1000)}</div>
    <div id="hv-soil-conversion"><p class="hv-hint">国内格网只测了0–4.5cm表层；按0–20cm耕层估算（假设表层浓度代表整个耕层）：浓度×容重×20cm×以下假设利用比例。</p><div class="hv-grid">${input('fraction-n','N 假设利用比例',.3,0,1)}${input('fraction-p','P 假设利用比例',.2,0,1)}${input('fraction-k','K 假设利用比例',.4,0,1)}</div></div></details>
    <details id="hv-economics" open><summary>投入与收益条件</summary><label>币种（切换不会自动换汇）<select id="hv-currency">${['CNY','USD','THB','VND','IDR','NGN','KES','TZS','GHS'].map(c=>`<option>${c}</option>`).join('')}</select></label>
    <div class="hv-grid">${input('budget','新增肥料预算 / <span class="hv-per">亩</span>',500,0,100000000)}${input('price','鲜薯售价 / kg',2,0,1000000)}${input('base','基础成本 / <span class="hv-per">亩</span>',1000,0,100000000)}${input('marketable','商品率（0–1）',.85,0,1)}${input('harvestCost','随产量增加的费用 / kg',0,0,100)}${input('fertPrice','复合肥单价 / kg（默认 2026年9月基准价）',3.49,.0001,1000000)}</div>
    <p class="hv-hint">金额均按所选币种输入。默认价格与成本只是示例；基础成本应包含种苗、人工、地租和已有肥料等费用；灌溉费在“土壤与供水”里按模拟补灌量另计（若基础成本已含灌溉费请勾选，避免重复），留空则不计入；漏填的费用不会自动扣除。采收运输费若另填，请勿重复计入。</p>
    <label>比较偏好<select id="hv-risk"><option value="cautious">稳妥一些 · 优先看较差年份的利润</option><option value="balanced">看平均表现 · 比较多年平均利润</option></select></label></details>
    <div class="hv-submit"><button id="hv-run" type="submit" class="hv-primary">开始分析 →</button><p id="hv-status" class="hv-hint" role="status" aria-live="polite">选好地块与条件后即可开始。</p></div></form></details>
    <section class="hv-quick-panel" id="hv-quick-panel" aria-label="地块分析"><div class="hv-quick-top"><span class="hv-live-dot"></span><span>地块分析</span><span class="hv-beta">BETA</span></div><div id="hv-quick-content"><div class="hv-quick-main"><h2>选好位置，看看这片土地的可能</h2><p>在地图上点一个位置，再点“分析这个位置”。会结合多年天气、每日水分与土壤条件，给出能不能种、预计收成和收益。</p></div></div></section>
    <section id="hv-output" hidden class="hv-output" aria-live="polite"><div class="hv-panel hv-empty"><span class="hv-eyebrow">先看条件，再决定投入</span><h2>同一块地，比较不同年景</h2><p>逐日计算水分和生长，再比较养分与预算限制。结果会告诉你哪里缺数据，以及下一步应该补什么。</p><div class="hv-empty-steps"><span>气候与水分</span><span>产量情景</span><span>投入回报</span></div><p class="hv-hint">Beta参数尚未完成地区验证。没有养分数据也可以先做气候初筛。</p></div></section></div>`;
    syncLocations(locations);cropNote();
    $('use-local-soil').hidden=!requestSoil;
    $('use-local-soil').addEventListener('click',()=>{autoClimate=false;$('soil-mode').value='china';invalidate();loadSoil();});
    $('quick-run').addEventListener('click',()=>$('form').requestSubmit());
    $('open-settings').addEventListener('click',()=>{$('settings').open=true;$('settings').scrollIntoView({behavior:motion(),block:'start'});});
    $('form').addEventListener('submit',run);
    $('form').addEventListener('input',invalidate);$('form').addEventListener('change',invalidate);
    $('location').addEventListener('change',()=>{const o=$('location').selectedOptions[0];if(!o.dataset.lat)return;$('lat').value=o.dataset.lat;$('lng').value=o.dataset.lng;pointChanged();});
    ['lat','lng'].forEach(id=>{$(id).addEventListener('input',()=>{invalidate();clearSoil();});$(id).addEventListener('change',()=>{$('location').value='custom';pointChanged();});});
    ['crop','variety'].forEach(id=>$(id).addEventListener('input',invalidate));
    $('variety').addEventListener('change',invalidate);
    $('date').addEventListener('change',()=>{$('date-mode').value='manual';});
    $('crop').addEventListener('change',()=>{$('days').value=M.crops[$('crop').value].days;$('rootDepth').value=M.crops[$('crop').value].rootDepth;cropNote();invalidate();});
    $('unit').addEventListener('change',changeUnit);
    $('irrigationPrice').addEventListener('input',()=>{irrigationPriceTouched=true;});
    $('currency').addEventListener('change',()=>{if(!irrigationPriceTouched)$('irrigationPrice').value=$('currency').value==='CNY'?IRRIGATION_EXAMPLE_CNY:'';});
    $('soil-mode').addEventListener('change',()=>{autoClimate=false;loadSoil();});$('soil-retry').addEventListener('click',()=>{invalidate();loadSoil();});
    ['fraction-n','fraction-p','fraction-k'].forEach(id=>$(id).addEventListener('input',()=>{if(soil)try{applySoil();}catch(e){$('soil-status').textContent=e.message;}}));
    ['ph','n','p','k'].forEach(id=>$(id).addEventListener('input',()=>{nutrientOrigin={kind:'user'};}));
    $('water').addEventListener('change',()=>{$('irrigationLimit').disabled=$('water').value!=='irrigated';$('irrigationDailyMax').disabled=$('water').value!=='irrigated';});$('irrigationLimit').disabled=true;$('irrigationDailyMax').disabled=true;
    $('map-expand').addEventListener('click',()=>expandMap(!mapExpanded));
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mapExpanded)expandMap(false);});
    if(window.L){
      // Same Amap basemap as the dashboard. Amap draws in GCJ-02, so points are converted on the way in and out;
      // the inputs, soil lookup and model all stay in WGS84.
      map=L.map($('map'),{scrollWheelZoom:false}).setView(toMap(20.045,110.198),9);
      map.attributionControl.setPrefix(false);
      L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',{subdomains:'1234',attribution:'© 高德地图',maxZoom:18,keepBuffer:4}).addTo(map);
      marker=L.marker(toMap(20.045,110.198),{draggable:true,icon:L.divIcon({className:'hv-pin',html:'<span></span>',iconSize:[28,28],iconAnchor:[14,14]})}).addTo(map);
      const pick=latlng=>{const [lat,lng]=fromMap(latlng.lat,(((latlng.lng+540)%360)-180));$('lat').value=lat.toFixed(5);$('lng').value=lng.toFixed(5);$('location').value='custom';pointChanged(false);};
      map.on('click',e=>pick(e.latlng));marker.on('dragend',()=>pick(marker.getLatLng()));
    }else $('map').innerHTML='<div class="hv-map-fallback">地图暂时未加载，仍可在上方选择地区或输入坐标。</div>';
    loadSoil();
  }
  function cropNote(){$('crop-note').textContent='参数均未做地区标定。填写品种名用于记录，不会自动生成该品种的已验证参数。';}
  // WGS84 <-> GCJ-02 (the offset Chinese basemaps apply). Outside mainland China both are the same.
  function gcjOffset(lat,lng){
    const a=6378245,ee=0.00669342162296594323,x=lng-105,y=lat-35;
    let dLat=-100+2*x+3*y+0.2*y*y+0.1*x*y+0.2*Math.sqrt(Math.abs(x))+(20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3+(20*Math.sin(y*Math.PI)+40*Math.sin(y/3*Math.PI))*2/3+(160*Math.sin(y/12*Math.PI)+320*Math.sin(y*Math.PI/30))*2/3;
    let dLng=300+x+2*y+0.1*x*x+0.1*x*y+0.1*Math.sqrt(Math.abs(x))+(20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3+(20*Math.sin(x*Math.PI)+40*Math.sin(x/3*Math.PI))*2/3+(150*Math.sin(x/12*Math.PI)+300*Math.sin(x/30*Math.PI))*2/3;
    const rad=lat/180*Math.PI,magic=1-ee*Math.sin(rad)**2,sq=Math.sqrt(magic);
    return [dLat*180/((a*(1-ee))/(magic*sq)*Math.PI),dLng*180/(a/sq*Math.cos(rad)*Math.PI)];
  }
  function outsideChina(lat,lng){return lng<72.004||lng>137.8347||lat<0.8293||lat>55.8271;}
  function toMap(lat,lng){if(outsideChina(lat,lng))return [lat,lng];const [dy,dx]=gcjOffset(lat,lng);return [lat+dy,lng+dx];}
  function fromMap(lat,lng){if(outsideChina(lat,lng))return [lat,lng];let w=[lat,lng];for(let i=0;i<3;i++){const g=toMap(w[0],w[1]);w=[w[0]-(g[0]-lat),w[1]-(g[1]-lng)];}return w;}
  function expandMap(expand){mapExpanded=expand;host.classList.toggle('hv-map-expanded',expand);$('map-expand').textContent=expand?'收起地图 · Esc':'展开地图 ↗';$('map-expand').setAttribute('aria-expanded',String(expand));if(map){expand?map.scrollWheelZoom.enable():map.scrollWheelZoom.disable();setTimeout(()=>map.invalidateSize(),80);}if(!expand)$('map-expand').focus();}
  function pointChanged(recenter=true){
    invalidate();const lat=number('lat'),lng=number('lng');
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180||(lat===0&&lng===0)){clearSoil();status('请输入有效经纬度');return;}
    marker?.setLatLng(toMap(lat,lng));if(recenter)map?.setView(toMap(lat,lng),9);
    $('point').textContent=`${lat.toFixed(5)}, ${lng.toFixed(5)} · WGS84`;
    let reset='';if(nutrientOrigin?.kind==='soil'&&nutrientOrigin.key!==pointKey(lat,lng)){Object.entries(NUTRIENT_DEFAULTS).forEach(([id,v])=>$(id).value=v);nutrientOrigin=null;reset='手填养分已恢复为示例值（原数值来自上一个地点的土壤），请按当前地块核对。';}
    const domestic=lat>=17.8&&lat<=54&&lng>=73&&lng<=136;
    if($('soil-mode').value==='china'&&!domestic){autoClimate=true;$('soil-mode').value='climate';status('此点超出国内格网范围，已切换为气候初筛；回到国内会自动读取土壤。');}
    else if(autoClimate&&domestic){autoClimate=false;$('soil-mode').value='china';}
    loadSoil();if(reset&&$('soil-mode').value==='manual')soilStatus(reset);
  }
  function changeUnit(){const next=$('unit').value;if(next===unit)return;const ratio=next==='ha'?15:1/15;
    ['budget','base'].forEach(id=>{if(Number.isFinite(number(id)))$(id).value=Number((number(id)*ratio).toFixed(6));});
    $('area').value=Number((number('area')/ratio).toFixed(6));unit=next;host.querySelectorAll('.hv-per').forEach(e=>e.textContent=per());invalidate();}
  function clearSoil(){soilRevision++;soilController?.abort();soil=null;soilKey='';soilLoadingKey='';soilError='';$('soil-values').innerHTML='';if($('soil-mode').value==='china')soilStatus('等待当前地点土壤数据。');}
  function applySoil(){if(!soil)throw Error(soilError||'土壤尚未就绪，请点击读取内置国内土壤重试。');if(soilKey!==pointKey())throw Error('土壤数据属于上一个地点，请等待当前地点读取完成后再分析。');const v=M.soilSupply(soil,['fraction-n','fraction-p','fraction-k'].map(number));['ph','n','p','k'].forEach(id=>$(id).value=v[id]);nutrientOrigin={kind:'soil',key:soilKey};return v;}
  function loadSoil(){soilLoading=loadSoilImpl();return soilLoading;}
  async function loadSoilImpl(){
    clearSoil();const mode=$('soil-mode').value,china=mode==='china',manual=mode==='manual';
    ['ph','n','p','k'].forEach(id=>$(id).disabled=!manual);$('soil-retry').hidden=!china;$('soil-retry').disabled=false;$('soil-conversion').hidden=!china;$('economics').hidden=mode==='climate';
    if(!china){
      soilStatus(manual?'手填养分模式：当前数值需自行核对，可点击上方按钮恢复内置国内土壤。':autoClimate?'此点在国内格网范围外；仅分析气候。回到国内将自动读取内置土壤。':'当前仅分析气候；国内地点可点击上方按钮读取内置土壤。');
      return;
    }
    if(!requestSoil){soilError='当前独立预览未连接土壤接口，请到主网站的AI收成预测中读取内置数据。';soilStatus(soilError);return;}
    const lat=number('lat'),lng=number('lng');if(!Number.isFinite(lat)||!Number.isFinite(lng)){ soilStatus('请先填写有效经纬度');return;}
    const key=pointKey(lat,lng),token=soilRevision,controller=new AbortController();soilController=controller;soilLoadingKey=key;const timer=setTimeout(()=>controller.abort(),22000);
    soilStatus('正在读取内置国内土壤…');$('soil-retry').disabled=true;
    try{const data=await requestSoil(String(lat),String(lng),controller.signal);if(token!==soilRevision)return;if(!data.ok)throw Error(data.msg||'此点暂无土壤数据');soil=data;soilKey=key;applySoil();
      const nearby=data.nearest?`已使用附近约 ${num(data.nearest.distanceKm,1)} km 处的数据（原点位没有土壤值，可能是城区或水面）`:'';
      soilStatus((nearby?nearby+' · ':'内置土壤已就绪 · ')+'pH '+num(data.fields.ph.value,2)+' · 氮 '+num(data.fields.availableN.value,1)+' / 磷 '+num(data.fields.availableP.value,1)+' / 钾 '+num(data.fields.availableK.value,1)+' mg/kg（表层背景）');
      $('soil-values').innerHTML='<div class="hv-soil-grid">'+Object.values(data.fields).map(f=>`<div><span>${esc(f.label)}</span><b>${num(f.value,2)} <small>${esc(f.unit)}</small></b></div>`).join('')+'</div>'+(nearby?`<p class="hv-hint hv-nearby">📍 ${esc(nearby)}。</p>`:'')+'<p class="hv-hint">约1km背景值，不是实时测土。</p>';
    }catch(e){if(token===soilRevision){soil=null;soilError=e.name==='AbortError'?'土壤读取超时，请点击读取内置土壤重试。':e.message;soilStatus(soilError);}}
    finally{clearTimeout(timer);if(token===soilRevision){soilLoadingKey='';$('soil-retry').disabled=false;}}
  }
  function invalidate(){host.classList.remove('hv-is-running');$('quick-run').disabled=false;$('quick-run').innerHTML='<span>更新这个位置</span><small>条件已修改，点这里重新分析 ↓</small>';if(result){$('output').hidden=true;$('quick-content').classList.remove('hv-is-stale');$('quick-content').className='';$('quick-content').innerHTML='<h2>等待重新分析</h2><p>地点或条件已修改，请点击下方按钮查看新结果。</p>';}revision++;weatherController?.abort();stale=true;$('run').disabled=false;$('run').textContent='更新分析 →';status('条件已修改，请重新计算。');const banner=$('stale');if(banner)banner.hidden=false;['export','record','trace-year','trace-day'].forEach(id=>{if($(id))$(id).disabled=true;});}
  function params(){
    const p={};for(const id of ['lat','lng','area','days','ph','n','p','k','budget','price','base','fertPrice','rootDepth','initialWater','irrigationLimit','irrigationDailyMax','marketable','harvestCost'])p[id]=number(id);
    for(const id of ['crop','date','water','drainage','risk','texture','currency'])p[id]=$(id).value;
    p.irrigationPrice=$('irrigationPrice').value.trim()===''?null:number('irrigationPrice');p.irrigationInBase=!!$('irrigationInBase').checked;p.irrigationPriceOrigin=irrigationPriceTouched?'user':'example';
    p.variety=$('variety').value.trim()||'generic';p.soilOrigin=$('soil-mode').value;
    if(unit==='ha'){p.area*=15;['budget','base'].forEach(k=>p[k]/=15);}
    if(p.lat===0&&p.lng===0)throw Error('请输入有效经纬度（0, 0 表示未填位置）');
    if(p.soilOrigin==='china')Object.assign(p,applySoil());
    if(p.soilOrigin==='climate')Object.assign(p,{n:0,p:0,k:0,ph:6,price:0,base:0,budget:0,fertPrice:1,marketable:1,harvestCost:0,existingRate:0,maxRate:0,fertilizer:[0,0,0]});
    return M.normalize(p);
  }
  function artificial(p,season){
    let seed=(season.year*7919+Math.round((p.lat+90)*100))>>>0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const daily={time:[],temperature_2m_mean:[],temperature_2m_min:[],temperature_2m_max:[],precipitation_sum:[],et0_fao_evapotranspiration:[],shortwave_radiation_sum:[]};
    for(let i=0;i<p.days;i++){const date=new Date(Date.parse(season.start)+i*86400000),day=(date-Date.UTC(date.getUTCFullYear(),0,1))/86400000;
      const wave=Math.cos(2*Math.PI*(day-(p.lat<0?18:200))/365.25),t=27-Math.abs(p.lat)*.3+Math.min(18,Math.abs(p.lat)*.32)*wave+(random()-.5)*4;
      const range=8+random()*4,ra=M.extraterrestrialRadiation(p.lat,day+1);daily.time.push(date.toISOString().slice(0,10));
      daily.temperature_2m_mean.push(t);daily.temperature_2m_min.push(t-range/2);daily.temperature_2m_max.push(t+range/2);daily.precipitation_sum.push(random()<.35?random()*25:0);daily.et0_fao_evapotranspiration.push(Math.max(.5,t*.14));daily.shortwave_radiation_sum.push(ra*(.3+.45*random()));}
    return {...season,daily};
  }
  async function weather(p,signal,planning=false){
    const today=new Date().toISOString().slice(0,10),reference=p.date<today?p.date:today,year=Number(reference.slice(0,4)),count=Number($('years').value);
    const seasons=planning?Array.from({length:count},(_,i)=>M.seasonDates(p.date,p.days,year-count-1+i)):M.historicalSeasons(p.date,p.days,count),kind=$('source').value;
    if(kind==='demo')return {kind,source:'人工天气情景 · 不代表实测或预测',included:seasons.map(s=>artificial(p,s)),excluded:[],requested:seasons.length};
    const start=(year-count-1)+'-01-01',end=(year-1)+'-12-31';
    const key=JSON.stringify([p.lat,p.lng,start,end]);
    let cached=weatherCache.get(key);
    if(!cached||Date.now()-cached.at>6*3600000){
      const query=new URLSearchParams({latitude:p.lat,longitude:p.lng,start_date:start,end_date:end,daily:'temperature_2m_mean,temperature_2m_min,temperature_2m_max,precipitation_sum,et0_fao_evapotranspiration,shortwave_radiation_sum',timezone:'auto',models:'era5'});
      const response=await fetch('https://archive-api.open-meteo.com/v1/archive?'+query,{signal});if(!response.ok)throw Error('历史天气服务暂不可用；可重试，或明确切换人工情景。');
      const data=await response.json();const checked=M.extractSeasons(data.daily,seasons,p.lat);if(checked.included.length<3)throw Error('完整历史天气不足，请稍后重试。');if(signal.aborted)throw new DOMException('已取消','AbortError');cached={at:Date.now(),daily:data.daily};if(weatherCache.size>=8)weatherCache.delete(weatherCache.keys().next().value);weatherCache.set(key,cached);
    }
    const extracted=M.extractSeasons(cached.daily,seasons,p.lat);if(extracted.included.length<3)throw Error('完整历史生长季不足3个，请调整年段或重试。');
    return {kind,source:'Open-Meteo / ERA5 · 完整历史生长季',...extracted,requested:seasons.length};
  }
  async function run(event){
    event.preventDefault();if($('run').disabled)return;invalidate();const token=++revision;weatherController?.abort();const controller=new AbortController();weatherController=controller;
    $('run').disabled=true;$('quick-run').disabled=true;host.classList.add('hv-is-running');$('quick-content').className='';$('quick-content').innerHTML='<div class="hv-quick-main"><h2>正在分析…</h2><p>正在读取多年天气并逐日计算，通常需要几秒到十几秒。</p></div>';$('quick-panel')?.scrollIntoView?.({behavior:motion(),block:'start'});status('正在读取多年天气并逐日计算…');const timer=setTimeout(()=>controller.abort(),45000);
    try{
      if($('soil-mode').value==='china'&&(!soil||soilKey!==pointKey())){if(soilLoadingKey!==pointKey())loadSoil();await soilLoading;if(token!==revision)return;}
      const p=params(),usedSoil=p.soilOrigin==='china'?soil:null;if(calibration)M.validateCalibration(calibration,p);
      let planning=null,w;
      if($('date-mode').value==='auto'){
        const today=new Date().toISOString().slice(0,10),year=Number(today.slice(0,4)),windows=[];
        status('正在比较12个月的候选播期，保持供水和生育期相同…');
        for(let month=1;month<=12;month++){
          const suffix='-'+String(month).padStart(2,'0')+'-15';let date=year+suffix;if(date<today)date=(year+1)+suffix;
          const climate=await weather({...p,date},controller.signal,true);if(token!==revision)return;
          windows.push({date,seasons:climate.included,weather:climate});
        }
        const ranking=M.rankPlantingWindows(p,windows,{weatherKind:$('source').value}),chosen=windows.find(w=>w.date===ranking[0].date),found=ranking[0].feasibility.status==='supported';
        p.date=chosen.date;w={...chosen.weather,included:chosen.weather.included.filter(s=>ranking[0].years.includes(s.year)),excluded:[...chosen.weather.excluded,...chosen.weather.included.filter(s=>!ranking[0].years.includes(s.year)).map(s=>({year:s.year,reason:'播期比较统一年份'}))]};$('date').value=p.date;
        planning={method:'monthly-feasibility-first-beta-v3',ranking,selectedDate:p.date,found,
          title:found?'已找到通过可行性检查的播期':'未找到合适的露地种植窗口',
          selectedRole:found?'通过可行性检查的候选中平均产量较高的播期':'相对较好的试验方案，不是推荐种植方案',
          note:'12个月中每月15日的粗筛：相同供水、排水、生育期和历史年份。先逐年检查成活、连续适温、低温冻害和可收获条件，只对通过的候选按“平均气候限制产量（养分前）”排序；这是平均值目标，不是风险最优，并做逐年留出检验。未评估台风、病害、轮作和季节价格。'};
      }else w=await weather(p,controller.signal);
      if(token!==revision)return;
      const output=p.soilOrigin==='climate'?M.evaluateClimate(p,w.included,{weatherKind:w.kind}):M.evaluateEnsemble(p,w.included,{calibration,fertilizerPrices:p.currency==='CNY'?{urea:FERT_REF.prices.urea[1],sop:FERT_REF.prices.sop[1],mop:FERT_REF.prices.mop[1]}:undefined,weatherKind:w.kind});
      const nextResult={schema:'harvest-result-v3',generatedAt:new Date().toISOString(),input:p,display:{unit,currency:p.currency},fieldId:$('location').value==='custom'?'':$('location').value,
        soil:usedSoil,weather:{...w},output,calibration,planning};render(nextResult);result=nextResult;stale=false;{const panel=$('quick-panel'),top=panel?.getBoundingClientRect?.().top;if(Number.isFinite(top)&&(top<-10||top>window.innerHeight*.4))panel.scrollIntoView({behavior:motion(),block:'start'});}status('分析完成。Beta结果可用于情景比较，实际精度仍需田间验证。');
    }catch(e){if(token!==revision)return;stale=true;result=null;$('output').hidden=true;$('quick-content').innerHTML='<h2>本次分析未完成</h2><p>请根据下方提示重试，当前没有可用的新结果。</p>';status(e.name==='AbortError'?'天气读取超时，请重试。':e.message);if(!result)$('output').innerHTML='<div class="hv-panel hv-empty"><h2>还差一点信息</h2><p>'+esc(e.message)+'</p><p>展开种植条件，补齐提示信息后重试。</p></div>';}
    finally{clearTimeout(timer);if(token===revision){$('run').disabled=false;$('run').textContent='重新分析 →';$('quick-run').disabled=false;$('quick-run').innerHTML='<span>重新分析这个位置</span><small>结果在下方 ↓</small>';host.classList.remove('hv-is-running');}}
  }
  function download(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  // One bar per historical weather year, same planting plan. Labels carry the value, unit, average and extremes
  // so the chart reads on its own.
  const yearSpread=b=>{const v=b.years.map(y=>y.fresh),m=v.reduce((a,x)=>a+x,0)/v.length;return m>0?(Math.max(...v)-Math.min(...v))/m:0;};
  // One bar per historical year: yield of the shown plan. Only drawn when years actually differ.
  function yieldChart(o,f){
    const plan=o.plan||o.best,rows=plan.years,n=rows.length,width=600,base=150,span=112,gap=width/n;
    const max=Math.max(1,...rows.map(r=>r.fresh)),min=Math.min(...rows.map(r=>r.fresh)),avg=rows.reduce((a,r)=>a+r.fresh,0)/n;
    const hi=rows.findIndex(r=>r.fresh===max),lo=rows.findIndex(r=>r.fresh===min),short=v=>{const x=v*f;return x>=10000?num(x/1000,1)+'k':num(x);};
    const bars=rows.map((r,i)=>{
      const h=r.fresh/max*span,x=i*gap+gap*.18,w=gap*.64,cx=i*gap+gap/2,tone=i===hi?'#3f7d62':i===lo?'#d98a5b':'#8fb3a0',tag=i===hi?'最好':i===lo?'最差':'';
      return `<g><rect x="${x}" y="${base-h}" width="${w}" height="${h}" rx="4" fill="${tone}"><title>${r.year} 年：${num(r.fresh*f)} kg/${view.label}</title></rect>`+
        `<text x="${cx}" y="${base-h-6}" text-anchor="middle" class="hv-bar-val">${short(r.fresh)}</text>`+(tag?`<text x="${cx}" y="${base-h-19}" text-anchor="middle" class="hv-bar-tag" fill="${tone}">${tag}</text>`:'')+
        `<text x="${cx}" y="${base+18}" text-anchor="middle">${r.year}</text></g>`;
    }).join('');
    return `<p class="hv-chart-legend">每根柱子：这一年的天气、同一套种植和施肥方案下的鲜薯产量（kg/${view.label}）· 平均 ${num(avg*f)} · <b style="color:#3f7d62">最好 ${rows[hi].year}</b> · <b style="color:#c07a4f">最差 ${rows[lo].year}</b></p>`+
      `<svg class="hv-chart" viewBox="0 0 ${width} 176" role="img" aria-label="不同历史年份的鲜薯产量"><line x1="0" y1="${base}" x2="${width}" y2="${base}" stroke="#d7e2d8"/>${bars}</svg>`;
  }


  function scoreText(s){return s===null||s===undefined?'—':String(s);}
  function scoreLabel(s){return s===null||s===undefined?'数据不足':s>=85?'较好':s>=60?'需注意限制':'有明显限制';}
  function assumptionStrip(o,p){ // uses view (unit of the rendered result)
    const m=o.management,irr=o.diagnostics.irrigation;
    return `<div class="hv-assumptions" role="note"><span><b>品种</b>${m.variety==='generic'?'未指定 · 通用Beta参数':esc(m.variety)+' · 仍用通用参数'}</span><span><b>供水</b>${esc(m.waterText)}${p.water==='sufficient'?' · 平均补灌约 '+num(irr*2/3*view.f,1)+' 立方米/'+view.label:''}</span>${o.fertilizerNeed?`<span><b>施肥</b>需求${esc(o.fertilizerNeed.level)}${o.fertilizerNeed.main?' · 主要缺'+esc(o.fertilizerNeed.main):''}${(()=>{const rec=o.plan;return rec?(rec.products.length?' · 建议施'+rec.products.map(x=>esc(x.name)+' '+num(x.kg*view.f)+' kg').join('、')+'/'+view.label:' · 施肥增收不明显'):'';})()}</span>`:''}</div>`;
  }
  function factorList(o,p,f){
    const dm=M.crops[p.crop].dm,fresh=x=>x/dm/15*f;
    const items=o.factors.map(x=>`<div class="hv-factor hv-st-${x.status}"><div class="hv-factor-label"><b>${esc(x.name)}</b><span class="hv-chip">${esc(x.statusText)}${x.score===null?'':' · '+x.score+' / 100'}</span></div><div class="hv-track"><i style="width:${x.score===null?0:Math.max(0,Math.min(100,x.score))}%"></i></div><p>${esc(x.evidence)}</p>${x.risks.map(k=>`<p class="hv-risk hv-risk-${esc(k.level)}">${esc(k.text)}</p>`).join('')}${x.assumption?'<p class="hv-factor-source">含假设</p>':''}</div>`).join('');
    return `<div class="hv-factors">${items}</div>`;
  }
  function yearlyTable(o,p,f){
    const dm=M.crops[p.crop].dm,rows=o.yieldAvailable?o.yearly:o.simulations.map(s=>({year:s.year,meanT:s.weather.meanT,meanTmax:s.weather.meanTmax,radiation:s.weather.radiation,rain:s.rain,irrigation:s.irrigation,anoxicDays:s.anoxicDays,chillDays:s.temperature.chillDays,frostRiskDays:s.temperature.frostRiskDays,stageAtHarvest:s.stageAtHarvest,climateFreshMu:s.storageDryKgHa===null?null:s.storageDryKgHa/dm/15}));
    const flag=y=>!y.flags?'':[y.flags.nutrientLimited&&'养分限制',y.flags.calibrationCapped&&'校准截断',y.flags.implausible&&'超出合理性检查'].filter(Boolean).join('、')||'—';
    return `<div class="hv-table-wrap"><table class="hv-yearly"><thead><tr><th>年份</th><th>平均/最高温 ℃</th><th>辐射 MJ/m²</th><th>降雨 mm</th><th>补灌 m³/${view.label}</th><th>过湿天</th><th>冷害/冻害风险天</th><th>收获时阶段</th><th>气候限制产量</th>${o.yieldAvailable?`<th>最终产量</th><th>收入</th><th>成本</th><th>利润</th><th>说明</th>`:''}</tr></thead><tbody>${rows.map(y=>{
      const cost=y.costs?y.costs.base+y.costs.fertilizer+y.costs.harvest+(y.costs.irrigation??0):null;
      return `<tr><td>${y.year}</td><td>${num(y.meanT,1)} / ${num(y.meanTmax,1)}</td><td>${num(y.radiation)}</td><td>${num(y.rain)}</td><td>${num(y.irrigation*2/3*view.f,1)}</td><td>${num(y.anoxicDays)}</td><td>${num(y.chillDays)} / ${num(y.frostRiskDays)}</td><td>${esc(y.stageAtHarvest)}</td><td>${num(y.climateFreshMu*f)}</td>${o.yieldAvailable?`<td>${num(y.fresh*f)}</td><td>${num(y.revenue*f)}</td><td>${num(cost*f)}</td><td>${num(y.net*f)}</td><td>${esc(flag(y))}</td>`:''}</tr>`;}).join('')}</tbody></table></div>`;
  }

  // Top-of-page money summary; the cost breakdown and fertilizer options sit further down (costPanel).
  function profitPanel(o,p,f,label,b,supported){
    const cur=esc(p.currency),avg=k=>b.years.reduce((a,y)=>a+(y[k]??0),0)/b.years.length,revenue=avg('revenue'),cost=revenue-b.net;
    return `<article class="hv-panel hv-profit"><div class="hv-title-row"><h2>预计能赚多少钱</h2><span>${cur} · 平均每${label}</span></div>
    ${supported?'':'<p class="hv-water-callout">未通过可行性检查：以下金额仅作试验估算。</p>'}
    <div class="hv-profit-grid"><div><span>平均利润 / ${label}</span><b>${num(b.net*f)}</b></div><div><span>较差年份利润 / ${label}</span><b>${num(b.netLow*f)}</b></div><div><span>平均收入 / ${label}</span><b>${num(revenue*f)}</b></div><div><span>平均成本 / ${label}</span><b>${num(cost*f)}</b></div><div><span>保本售价</span><b>${b.breakEvenPrice===null?'无法计算':num(b.breakEvenPrice,2)+' '+cur+'/kg'}</b></div></div>
    ${o.count>1&&yearSpread(b)<.03?`<p class="hv-hint">各历史年景的产量基本相同（相差不到 3%）：这块地主要受养分限制，天气好坏的差别被养分供应抹平了，所以不单独画年景图。</p>`:''}
    <p class="hv-hint">${num(b.lossShare*100)}% 的所选历史年景会亏损（${esc(o.lossMeaning)}）。价格和成本默认值只是示例，成本明细见下方。</p></article>`;
  }
  // Rough 2026 fertilizer reference (CNY, wholesale benchmark prices on 2026-09-11; farm-gate prices are usually higher).
  const FERT_REF={date:'2026-09-11',prices:{urea:['尿素（含氮46%）',1.81],npk:['复合肥 15-15-15',3.49],sop:['硫酸钾（K₂O 50%）',3.95],mop:['氯化钾（K₂O 60%，进口）',3.33]},
    practice:{
      sweetpotato:{items:[['npk',50,75],['sop',10,15]],text:'红薯常用：基肥硫酸钾型复合肥 50–75 kg/亩，膨大期追硫酸钾 10–15 kg/亩；红薯忌氯，不宜用氯化钾'},
      cassava:{items:[['urea',25,25],['npk',60,60],['mop',15,15]],text:'木薯常用：尿素约 25 kg、三元复合肥约 60 kg、氯化钾约 15 kg/亩（基肥＋追肥）'}}};
  function practiceFertCost(crop){const ref=FERT_REF.practice[crop],price=k=>FERT_REF.prices[k][1];return [ref.items.reduce((a,[k,l])=>a+l*price(k),0),ref.items.reduce((a,[k,,h])=>a+h*price(k),0)];}
  function costPanel(o,p,f,label,rows,b){
    if(!o.yieldAvailable)return '';
    const cur=esc(p.currency),w=o.water,need=o.fertilizerNeed,avg=k=>b.years.reduce((a,y)=>a+(y[k]??0),0)/b.years.length;
    const water=w.deducted?avg('irrigationCost'):null,harvest=avg('harvestCost'),total=p.base+b.cost+harvest+(water??0);
    const cell=(name,v,note)=>`<div><span>${name}</span><b>${v}</b><small>${note}</small></div>`;
    const ref=FERT_REF.practice[p.crop],price=k=>FERT_REF.prices[k][1];
    const [lo,hi]=practiceFertCost(p.crop);
    const refRange=p.currency!=='CNY'?'参考价为人民币，当前币种不适用':Math.round(lo)===Math.round(hi)?`约 ${num(lo*f)} 元/${label}`:`约 ${num(lo*f)}–${num(hi*f)} 元/${label}`;
    return `<article class="hv-panel hv-cost"><div class="hv-title-row"><h2>预计成本</h2><span>${cur} · 平均每${label}</span></div>
    <div class="hv-profit-grid">${cell('基础成本 / '+label,num(p.base*f),'种苗、人工、地租等')}${cell('肥料 / '+label,num(b.cost*f),o.plan?(b.products.length?esc(b.name.replace(/（.*/,''))+'：'+b.products.map(x=>esc(x.name)+' '+num(x.kg*f)+' kg').join('、'):'土壤供应基本够，不另施肥'):b.rate>0?`较优方案新增 ${num(b.rate*f,1)} kg`:'当前方案不新增肥料')}${cell('灌溉用水 / '+label,water===null?(w.inBase?'已含在基础成本':'未计入'):num(water*f),w.inBase?'已勾选含在基础成本，不再单独扣':w.priceOrigin==='example'?`按参考单价 ${w.unitPrice} 元/立方米`:w.priced?'按填写单价':'未填写单价，不是0元')}${cell('采收运输 / '+label,num(harvest*f),'按产量计')}${cell('合计 / '+label,num(total*f),'以上各项之和')}</div>
    ${need?`<p class="hv-need hv-need-${need.level==='较多'?'high':need.level==='中等'?'mid':'low'}"><b>施肥需求：${esc(need.level)}</b>${esc(need.summary)}。${(()=>{const rec=o.plan;return rec?`<br><b>推荐施肥</b>${rec.products.length?rec.products.map(x=>esc(x.name)+' 约 '+num(x.kg*f)+' kg').join('、')+'/'+label+`，约 ${num(rec.cost*f)} 元/${label}。`:'不另施肥：模型算得施肥增收不明显。'}`:'';})()}<br>${esc(need.note)}。</p>`:''}
    <details open><summary>比较不同施肥量</summary>${o.plan?`<div class="hv-table-wrap"><table><thead><tr><th>方案</th><th>用肥 / ${label}</th><th>肥料费</th><th>产量 kg</th><th>平均利润</th><th>较差年份利润</th></tr></thead><tbody>${o.fertilizerPlans.map(x=>`<tr class="${x.id===b.id?'hv-chosen':''}"><td>${esc(x.name)}</td><td>${x.products.length?x.products.map(y=>esc(y.name)+' '+num(y.kg*f)).join('、'):'—'}</td><td>${num(x.cost*f)}</td><td>${num(x.fresh*f)}</td><td>${num(x.net*f)}</td><td>${num(x.netLow*f)}</td></tr>`).join('')}</tbody></table></div><p class="hv-hint">推荐怎么选：在“常见用量上限”和“肥料预算”之内，逐步加复合肥、尿素或钾肥，哪一步多赚得最多就加哪一步，直到再加也不多赚（按${p.risk==='cautious'?'较差年份利润':'平均利润'}比较）。施肥比不施肥多赚不到 3%（或每${label}不到 30 元）时，推荐不另施肥。上限来自当地常见用量，超过上限即使模型显示更赚也不推荐。不是施肥处方。</p><p class="hv-hint">${esc(o.economics.profitDefinition)}。</p>`:`<div class="hv-table-wrap"><table><thead><tr><th>方案</th><th>新增肥料 kg</th><th>新增肥料费</th><th>产量 kg</th><th>平均利润</th><th>较差年份利润</th></tr></thead><tbody>${rows.map(x=>`<tr class="${x.rate===b.rate?'hv-chosen':''}"><td>${x.rate===0?'不新增肥料':x.name}${x.rate===b.rate?' · 较优':''}</td><td>${num(x.rate*f,1)}</td><td>${num(x.cost*f)}</td><td>${num(x.fresh*f)}</td><td>${num(x.net*f)}</td><td>${num(x.netLow*f)}</td></tr>`).join('')}</tbody></table></div><p class="hv-hint">比较候选用量，不是施肥处方。${esc(o.economics.profitDefinition)}。</p>`}</details>
    <details><summary>常用肥料与 2026 年参考价</summary><p class="hv-hint">${esc(ref.text)}，按下面的价格${refRange}。</p>
    <div class="hv-table-wrap"><table><thead><tr><th>肥料</th><th>参考价 元/kg</th></tr></thead><tbody>${Object.values(FERT_REF.prices).map(([n,v])=>`<tr><td>${esc(n)}</td><td>${num(v,2)}</td></tr>`).join('')}</tbody></table></div>
    <p class="hv-hint">价格为 ${FERT_REF.date} 的市场基准价，农户实际买价通常更高，请按当地报价修改“肥料单价”。</p></details></article>`;
  }
  // Renders a finished result. The model output is read-only here.
  const FEAS_CLASS={supported:'ok',risky:'warn','not-recommended':'bad',insufficient:'unknown'};
  const VERDICT_TEXT={pass:'满足',marginal:'边缘',unmodeled:'有未建模风险',fail:'不满足'};
  // Plain-language wording for each per-season check (display only; the checks themselves come from the model).
  const CHECK_PLAIN={establishment:'种下后头几周气温偏低，苗可能长不好','warm-window':'适合生长的暖和天数不够','plant-death':'收获前会遇到严重低温，植株可能冻死',
    'leaf-frost':'有霜冻风险，叶子可能受冻','underground-cold':'薯块在地里可能受冻或变质（模型没有算这部分损失）',harvestable:'到计划收获时积温不够，薯块可能长不大'};
  // Shown only when something needs attention; when every season passes, the verdict on the right says enough.
  function feasibilityPanel(o,r){
    const F=o.feasibility,plan=r.planning;
    if(F.status==='supported'&&(!plan||plan.found))return '';
    const issues=Object.keys(CHECK_PLAIN).map(id=>{const hit=F.years.filter(y=>y.checks.some(c=>c.id===id&&c.level!=='pass'));return hit.length?{id,text:CHECK_PLAIN[id],years:hit.map(y=>y.year),early:id==='plant-death'&&hit.some(y=>y.checks.some(c=>c.id===id&&c.level==='marginal'))}:null;}).filter(Boolean);
    const wet=F.reasons.find(x=>/过湿与排水/.test(x));
    const items=[...issues.map(x=>`${x.text}${x.early?'，有的年份需要提前收获':''}：${x.years.length}/${F.years.length} 年（${x.years.slice(0,5).join('、')}${x.years.length>5?' 等':''}）`),...(wet?['雨水多、排水差时，地里容易长期过湿']:[]),...(F.status==='insufficient'?F.reasons:[])];
    const planHtml=plan&&!plan.found?`<p class="hv-plan hv-feas-bad">自动比较了 12 个月的种植时间，没有找到合适的露地种植窗口。当前显示的 ${esc(plan.selectedDate)} 只是相对较好的试验方案，不是推荐种植方案。</p>`:'';
    const rows=F.years.map(y=>`<tr><td>${y.year}</td><td class="hv-v-${esc(y.verdict)}">${esc(VERDICT_TEXT[y.verdict])}</td><td>${y.checks.filter(c=>c.level!=='pass').map(c=>'<b>'+esc(c.name)+'</b> '+esc(c.text)).join('<br>')||'均满足'}</td></tr>`).join('');
    return `<article class="hv-panel hv-feasibility hv-feas-${FEAS_CLASS[F.status]}"><div class="hv-title-row"><h2>需要注意的问题</h2></div>${planHtml}<ul>${items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>${F.status==='insufficient'?'':`<details><summary>每年的详细检查</summary><div class="hv-table-wrap"><table class="hv-feas-years"><thead><tr><th>年份</th><th>结论</th><th>原因</th></tr></thead><tbody>${rows}</tbody></table></div><p class="hv-hint">${esc(F.basis)} 汇总规则（Beta）：${esc(F.policy)}。</p></details>`}</article>`;
  }
  function render(r){
    const o=r.output,p=r.input,f=r.display.unit==='ha'?15:1,area=p.area/f,label=r.display.unit==='ha'?'公顷':'亩',b=o.plan||o.best;view={f,label};
    // The headline comes only from the model's season-by-season feasibility, never from relative-yield scores.
    const F=o.feasibility,supported=F.status==='supported',plan=r.planning;
    const headline=F.label,detail=(plan&&!plan.found?'未找到合适的露地种植窗口；当前为相对较好的试验方案。':'')+(F.reasons[0]||'');
    const yieldText=!o.yieldAvailable?'—':o.count>1&&num(b.low*f)!==num(b.high*f)?num(b.low*f)+'–'+num(b.high*f):num(b.fresh*f);
    const scoreBox=(name,s,note)=>`<div><span>${name}</span><strong>${scoreText(s)}<small> / 100</small></strong><span>${scoreLabel(s)} · ${note}</span></div>`;
    $('output').hidden=false;$('quick-content').className='hv-feas-'+FEAS_CLASS[F.status];
    $('quick-content').innerHTML=`<div class="hv-quick-main"><span class="hv-eyebrow">${esc(o.crop)} · ${num(p.area/f,2)} ${label} · Beta</span><h2 class="hv-feas-title hv-feas-${FEAS_CLASS[F.status]}">${esc(headline)}</h2><p>${esc(detail)}</p>${r.weather.kind==='demo'?'<button type="button" id="hv-use-history" class="hv-secondary">改用真实历史天气重新分析</button>':''}${assumptionStrip(o,p)}<p class="hv-quick-footnote">${p.date} 移栽 · ${p.days}天 · ${num(p.lat,4)}, ${num(p.lng,4)}${r.planning?' · 已比较12个播期':''}</p>${o.yieldAvailable&&!supported?'<p class="hv-quick-footnote">未通过可行性检查：产量和利润仅作试验估算。</p>':''}<button type="button" id="hv-view-details" class="hv-text-button">查看完整分析 ↓</button></div><div class="hv-quick-metrics">${scoreBox('气候条件分',o.climateScore,'解释指标，不决定能否种')}${o.yieldAvailable?`<div><span>预计收成 · kg/${label}</span><strong>${yieldText}</strong><small>平均 ${num(b.fresh*f)}</small></div><div><span>可出售 · kg/${label}</span><strong>${num(b.saleable*f)}</strong><small>商品率 ${num(p.marketable*100)}%</small></div><div><span>估算平均利润 · ${esc(p.currency)}/${label}</span><strong>${num(b.net*f)}</strong><small>较差年份 ${num(b.netLow*f)}</small></div>`:'<p>养分数据待补充，暂不生成产量和收益。</p>'}</div>`;
    $('view-details').addEventListener('click',()=>$('output').scrollIntoView({behavior:motion(),block:'start'}));
    $('use-history')?.addEventListener('click',()=>{$('source').value='history';invalidate();$('form').requestSubmit();});
    const rows=o.yieldAvailable?[...new Map(o.rows.map(x=>[x.rate,x])).values()]:[];
    const top=plan?.ranking?.[0];
    $('output').innerHTML=`<div class="hv-result"><div id="hv-stale" class="hv-stale" hidden>输入已改变。以下为上次结果，请重新计算后使用或导出。</div>
    <div class="hv-source">${r.weather.kind==='demo'?'人工天气情景 · 不代表实测或预测':'历史天气'} · ${o.yearRange[0]}–${o.yearRange.at(-1)} · ${o.count}/${r.weather.requested} 个完整情景${r.weather.excluded.length?' · 已排除 '+r.weather.excluded.map(x=>esc(x.year+(x.reason?'（'+x.reason+'）':''))).join('、'):''}<br>${r.soil?'土壤：国内0–4.5cm表层背景值，按0–20cm耕层和假设利用比例换算供应':p.soilOrigin==='manual'?'养分：手填供应，非自动测土':'养分与pH：未提供'} · 土壤持水与排水能力：质地估计</div>
    ${o.yieldAvailable?`${profitPanel(o,p,f,label,b,supported)}${costPanel(o,p,f,label,rows,b)}`:''}
    ${feasibilityPanel(o,r)}
    ${o.yieldAvailable?`
    ${o.count>1&&yearSpread(b)>=.03?`<article class="hv-panel"><div class="hv-title-row"><h2>如果遇上不同年景</h2><span>同一套种植方案</span></div>${yieldChart(o,f)}<p class="hv-hint">${esc(o.rangeMeaning)}。${r.weather.kind==='demo'?'这里是人工年景，不用于实际准确率判断。':'不包含全部模型、病虫害与价格不确定性。'}</p></article>`:''}`:''}
    <article class="hv-panel"><div class="hv-title-row"><h2>是什么限制了生长</h2><span>按机制拆开看</span></div>${factorList(o,p,f)}</article>
    <article class="hv-panel"><div class="hv-title-row"><h2>逐年结果</h2><span>每行一个历史年景</span></div>${yearlyTable(o,p,f)}<p class="hv-hint">产量单位 kg鲜薯/${label}；“气候限制产量”只含温度、光照、过湿与pH前的生长计算${o.yieldAvailable?'，“最终产量”再经养分限制':''}。冷害天＝日最低温低于阈值；冻害风险天＝日最低气温≤0℃，不代表实际结霜。${o.yieldAvailable?esc(o.economics.sameAssumptions)+'；'+esc(o.economics.irrigationNote)+'。':''}</p></article>
    ${waterPanel(o,p)}

    <article class="hv-panel hv-method"><details><summary>这次怎么算 · 版本</summary><p>逐日计算温度、光照、水分和养分对生长的影响，比较同一块地在不同历史年景下的收成、投入与收益。这是简化的 Beta 实现，参数尚未做地区验证。</p><p>${plan?esc(plan.note)+(top?` 选中 ${esc(top.date)}：${esc(top.objectiveName)} ${num(top.objective*f)}，较差年份(P10) ${num(top.p10*f)}；逐年留出检验中 ${num(top.stability.topShare*100)}% 的情况仍排第一。`:''):'按指定日期模拟，不作为整个地区全年适宜性结论。'}</p><p>${o.assumptions.map(esc).join('；')}。</p><p>算法 ${esc(o.version)} · 参数 ${esc(o.parameterVersion)} · ${o.calibrationId?'校准 '+esc(o.calibrationId):'未应用地区校准'}</p></details><button type="button" id="hv-export" class="hv-secondary">导出完整分析 JSON ↓</button></article>
    ${o.yieldAvailable?`<article class="hv-panel"><details><summary>收获后：记录实际结果，让模型逐步变准</summary><p class="hv-hint">导出一条实收记录，之后与其他地块合并做独立验证。文件仅保存到你的电脑，本次不上传生产数据库。</p><div class="hv-grid"><label>稳定的地块ID<input id="hv-field-id" value="${esc(r.fieldId)}" placeholder="同一地块每季使用相同ID"></label><label>实际收获日期<input id="hv-harvest-date" type="date"></label>${input('actual-area','实际收获面积（'+label+'）',area,.001,100000)}${input('actual-weight','实际鲜薯总重量（kg）','',0,100000000)}</div><button type="button" id="hv-record" class="hv-secondary">导出实收记录</button><p id="hv-record-status" role="status" class="hv-hint"></p></details></article>`:''}</div>`;
    $('trace-year').addEventListener('change',()=>waterChart(o.simulations[Number($('trace-year').value)],o.water));waterChart(o.simulations[0],o.water);
    $('export').addEventListener('click',()=>{if(!stale)download('收成分析-'+p.date+'.json',result);});
    $('record')?.addEventListener('click',()=>recordActual(r));
  }
  // Water view: reads simulateSeason.trace only; selecting a year or day never re-runs the model or refetches weather.
  function waterPanel(o,p){
    return `<article class="hv-panel hv-water-panel"><div class="hv-title-row"><h2>土壤剩余可用水与浇水需求</h2><label class="hv-inline-label">历史年景<select id="hv-trace-year">${o.simulations.map((s,i)=>`<option value="${i}">${s.year}</option>`).join('')}</select></label></div>
    <p class="hv-hint">所选历史天气情景的逐日模拟值，不是今天的实测含水量。可用水比例的分母是当天根区的有效容量（田间持水量−萎蔫点）；根系加深时容量会变大，所以曲线变化不全是下雨或浇水造成的。</p>
    <div id="hv-water-chart"></div>
    <label class="hv-day-picker">查看某一天（可拖动、点图或用方向键）<input id="hv-trace-day" type="range" min="1" max="${o.simulations[0].trace.length}" step="1" value="1"></label>
    <div id="hv-water-day" class="hv-water-day" aria-live="polite"></div>
    <details><summary>土壤和排水怎样影响用水</summary><p class="hv-hint">质地决定根区能存多少可用水：砂土存得少、补灌更频繁，黏土存得多但排水慢、更容易过湿。排水条件决定多余的水多快离开根区。补灌只补到田间持水量，不会补出积水；超过田间持水量的水记为“过湿暂存水”，持续过湿会减慢生长。这些机制已经体现在补灌量和过湿天数里，不另加“土地费用”。自然深层排水不是水泵排水，不按它收费；施肥量不进入水量账，本版也不按降雨自动追加补肥费用。</p></details></article>`;
  }
  function waterChart(s,water){
    const t=s.trace,n=t.length,W=600,L=44,R=590,x=i=>L+i/Math.max(1,n-1)*(R-L),topY=v=>118-v*100;
    const flows=Math.max(1,...t.map(d=>Math.max(d.rain,d.irrigation,d.pond+d.excess)));
    const subH=64,subBase=216,y2=v=>subBase-v/flows*subH,bw=Math.max(1,(R-L)/n*.8);
    const line=t.map((d,i)=>`${x(i).toFixed(1)},${topY(d.availableFraction).toFixed(1)}`).join(' ');
    const bars=(k,cls,dx)=>t.map((d,i)=>d[k]>0?`<rect class="${cls}" x="${(x(i)+dx-bw/2).toFixed(1)}" y="${y2(d[k]).toFixed(1)}" width="${bw.toFixed(1)}" height="${(subBase-y2(d[k])).toFixed(1)}"/>`:'').join('');
    const wet=t.map((d,i)=>`${x(i).toFixed(1)},${y2(d.pond+d.excess).toFixed(1)}`).join(' ');
    const ks=water?.years?.find(y=>y.year===s.year);
    $('water-chart').innerHTML=`<div class="hv-water-summary">${s.stressDays?`<span>明显缺水 <b>${s.stressDays} 天</b></span>`:''}<span>本季模拟补灌 <b>${num(s.irrigation,0)} mm · ${num(s.irrigation*2/3*view.f,1)} 立方米/${view.label}</b></span><span>过湿缺氧 <b>${s.anoxicDays} 天</b>（最长连续 ${s.longestWet} 天）</span><span>地表积水 <b>${s.pondDays} 天</b></span>${ks&&ks.costPerMu!==null?`<span>灌溉费 <b>${num(ks.costPerMu*view.f)} ${esc(water.currency)}/${view.label}</b></span>`:''}</div>
    <svg class="hv-chart hv-water-svg" id="hv-water-svg" viewBox="0 0 ${W} 240" role="img" aria-label="${s.year}年景：上图为根区可用水比例（0–100%），下图为每日降雨、补灌（mm）和过湿暂存水加地表积水（mm）">
      <text x="${L-6}" y="${topY(1)+4}" text-anchor="end">100%</text><text x="${L-6}" y="${topY(.5)+4}" text-anchor="end">50%</text><text x="${L-6}" y="${topY(0)+4}" text-anchor="end">0%</text>
      <line class="hv-grid-line" x1="${L}" y1="${topY(1)}" x2="${R}" y2="${topY(1)}"/><line class="hv-grid-line" x1="${L}" y1="${topY(.5)}" x2="${R}" y2="${topY(.5)}"/><line class="hv-axis" x1="${L}" y1="${topY(0)}" x2="${R}" y2="${topY(0)}"/>
      <text x="${L}" y="12">根区可用水比例（%）</text>
      <polyline class="hv-water-line" points="${line}"/>
      <text x="${L}" y="${subBase-subH-6}">每日水量（mm，刻度最大 ${num(flows,0)} mm）</text>
      <line class="hv-axis" x1="${L}" y1="${subBase}" x2="${R}" y2="${subBase}"/><text x="${L-6}" y="${subBase-subH+4}" text-anchor="end">${num(flows,0)}</text><text x="${L-6}" y="${subBase+4}" text-anchor="end">0</text>
      ${bars('rain','hv-bar-rain',-bw/4)}${bars('irrigation','hv-bar-irr',bw/4)}<polyline class="hv-wet-line" points="${wet}"/>
      <line id="hv-water-cursor" class="hv-cursor" x1="${L}" y1="14" x2="${L}" y2="${subBase}"/>
      <text x="${L}" y="236">种植</text><text x="${R}" y="236" text-anchor="end">第${n}天</text></svg>
    <p class="hv-chart-legend"><span class="hv-key hv-key-water"></span>根区可用水比例<span class="hv-key hv-key-rain"></span>降雨 mm<span class="hv-key hv-key-irr"></span>补灌 mm<span class="hv-key hv-key-wet"></span>过湿暂存水＋地表积水 mm</p>`;
    const slider=$('trace-day');slider.max=n;if(Number(slider.value)>n)slider.value=n;
    const show=i=>{const d=t[i];slider.value=i+1;const c=$('water-cursor');if(c?.setAttribute){c.setAttribute('x1',x(i));c.setAttribute('x2',x(i));}
      $('water-day').innerHTML=`<b>${esc(d.date)} · 第${d.day}天 · ${esc(d.stage)}</b><div class="hv-day-grid"><span>根区剩余可用水<b>${num(d.available,1)} / ${num(d.capacity,1)} mm（${num(d.availableFraction*100)}%）</b></span><span>当日补灌<b>${num(d.irrigation,1)} mm · ${num(d.irrigation*2/3*view.f,2)} 立方米/${view.label}</b></span><span>过湿暂存水（超出田间持水量）<b>${num(d.excess,1)} mm</b></span><span>地表积水<b>${num(d.pond,1)} mm</b></span><span>根区深度<b>${num(d.rootDepth,2)} m</b></span></div><p class="hv-hint">当日水量账：新根层带入 ${num(d.newRootWater,1)} ＋ 降雨 ${num(d.rain,1)} ＋ 补灌 ${num(d.irrigation,1)} − 蒸散 ${num(d.et,1)} − 径流 ${num(d.runoff,1)} − 深层排水 ${num(d.drainage,1)} mm ＝ 土壤水与地表积水的当日变化。</p>`;};
    slider.oninput=()=>{const v=Number(slider.value);if(Number.isFinite(v))show(Math.min(n-1,Math.max(0,v-1)));};
    const svg=$('water-svg');
    if(svg&&svg.getBoundingClientRect){const pick=e=>{const r=svg.getBoundingClientRect(),vx=(e.clientX-r.left)/r.width*W;show(Math.max(0,Math.min(n-1,Math.round((vx-L)/(R-L)*(n-1)))));};
      svg.addEventListener('pointerdown',pick);svg.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'||e.buttons)pick(e);});}
    const current=Number(slider.value);show(Number.isFinite(current)?Math.min(n-1,Math.max(0,current-1)):0);
  }
  function recordActual(r){try{
    if(stale)throw Error('请先重新计算');if(r.weather.kind!=='history')throw Error('人工天气情景不能作为校准样本，请使用真实历史天气分析。');if(r.output.calibrationId)throw Error('校准工具需要未校准的原始预测，请移除校准包后重新生成。');
    const fieldId=$('field-id').value.trim(),harvestDate=$('harvest-date').value,actualArea=number('actual-area'),weight=number('actual-weight');
    if(!fieldId||!harvestDate||harvestDate<r.generatedAt.slice(0,10)||harvestDate>new Date().toISOString().slice(0,10))throw Error('填写地块ID和真实收获日期；预测必须在收获前形成。历史预测可从先前导出的JSON整理记录。');
    if(!Number.isFinite(actualArea)||actualArea<=0||!Number.isFinite(weight)||weight<0)throw Error('请填写有效面积和总重量');
    const ha=actualArea/(r.display.unit==='ha'?1:15);
    const record={schema:'harvest-observation-v1',id:globalThis.crypto?.randomUUID?.()||'harvest-'+Date.now(),fieldId,split:'unassigned',seasonYear:Number(harvestDate.slice(0,4)),harvestDate,crop:r.input.crop,variety:r.input.variety,lat:r.input.lat,lng:r.input.lng,observedFreshKgHa:weight/ha,
      prediction:{engineVersion:r.output.version,parameterVersion:r.output.parameterVersion,generatedAt:r.generatedAt,calibrationId:null,sourceKind:r.weather.kind,rawYears:(r.output.plan||r.output.best).years.map((y,i)=>({year:y.year,freshKgHa:y.rawFresh*15,waterLimitKgHa:r.output.simulations[i].wly/M.crops[r.input.crop].dm}))},analysis:r};
    download('实收记录-'+fieldId.replace(/[^\w\u4e00-\u9fff-]/g,'_')+'.json',record);$('record-status').textContent='已导出。合并样本并分配训练/验证集后，运行校准工具。';
  }catch(e){$('record-status').textContent=e.message;}}
  window.HarvestUI={init};
})();
