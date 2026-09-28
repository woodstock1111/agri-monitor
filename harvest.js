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
  function input(id,label,value,min,max,step='any') {return `<label>${label}<input id="hv-${id}" type="number" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;}
  function number(id){return $(id).value.trim()===''?NaN:Number($(id).value);}
  function pointKey(lat=number('lat'),lng=number('lng')){return Number.isFinite(lat)&&Number.isFinite(lng)?lat+','+lng:'';}
  function per(){return unit==='ha'?'公顷':'亩';}
  function factor(){return unit==='ha'?15:1;}
  function status(text){$('status').textContent=text;if($('quick-status'))$('quick-status').textContent=text;}
  function soilStatus(text){$('soil-status').textContent=text;$('soil-summary').textContent=text;}
  function syncLocations(locations){
    const previous=$('location').value;
    const own=locations.filter(l=>l.lat!==''&&l.lng!==''&&l.lat!=null&&l.lng!=null&&Number.isFinite(Number(l.lat))&&Number.isFinite(Number(l.lng))&&Math.abs(l.lat)<=90&&Math.abs(l.lng)<=180);
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
    <section class="hv-panel hv-crop-panel" aria-labelledby="hv-crop-title"><div class="hv-title-row"><h2 id="hv-crop-title">先确认作物与品种</h2><span class="hv-beta">当前计算假设</span></div><div class="hv-grid">    <label>作物<select id="hv-crop" form="hv-form"><option value="sweetpotato">红薯 · Beta</option><option value="cassava">木薯 · Beta</option></select></label>
    <label>品种（可暂不填）<input id="hv-variety" form="hv-form" placeholder="未填写使用通用参数" maxlength="80"></label></div><p id="hv-crop-note" class="hv-hint" aria-live="polite"></p></section>
    <div class="hv-workbench"><section class="hv-panel hv-map-panel" aria-labelledby="hv-map-title"><div class="hv-map-toolbar"><div><span class="hv-step">01</span><h2 id="hv-map-title">先把地选准</h2></div><button type="button" id="hv-map-expand" class="hv-secondary" aria-expanded="false">展开地图 ↗</button></div>
    <div class="hv-location-row"><label>地块或示例区域<select id="hv-location"></select></label>${input('lat','纬度 · WGS84',20.045,-90,90)}${input('lng','经度 · WGS84',110.198,-180,180)}</div>
    <div id="hv-map" aria-label="点击地图选择位置；也可以在上方输入经纬度"></div><div class="hv-map-footer"><span id="hv-point">20.0450° N · 110.1980° E</span><span>点击地图或拖动标记 · 展开后可滚轮缩放 · 地图不代表可耕地证明</span></div></section>
    <aside class="hv-quick-panel"><div class="hv-quick-top"><span class="hv-live-dot"></span><span>地块分析</span><span class="hv-beta">BETA</span></div><div id="hv-quick-content"><span class="hv-eyebrow">从地图上的一个点开始</span><h2>选好位置，<br>看看这片土地的可能。</h2><p>结合多年天气、每日水分与土壤条件，比较不同年景下的收成。</p><div class="hv-quick-placeholder"><span>01 选地</span><span>02 分析</span><span>03 比较</span></div></div><div class="hv-quick-bottom"><div class="hv-soil-summary"><p id="hv-soil-summary" role="status"></p><button id="hv-use-local-soil" type="button" class="hv-text-button">读取内置国内土壤 ↻</button></div><button id="hv-quick-run" class="hv-primary" type="button"><span>分析这个位置</span><span>↗</span></button><div class="hv-loading-track"><i></i></div><p id="hv-quick-status" role="status" class="hv-hint">默认红薯 · 150天 · 自动比较种植时间 · 水源充足，及时浇水</p><button type="button" id="hv-open-settings" class="hv-text-button">调整种植条件 ↓</button></div></aside></div>
    <div class="hv-layout"><details id="hv-settings" class="hv-settings"><summary><span>种植条件与投入设置</span><small>日期、土壤、预算 · 点击展开</small></summary><form id="hv-form" class="hv-panel hv-inputs" novalidate>
    <div class="hv-section-title"><span class="hv-step">02</span><h2>准备怎么种</h2></div><div class="hv-grid">

    <label>面积单位<select id="hv-unit"><option value="mu">亩</option><option value="ha">公顷 ha</option></select></label>${input('area','种植面积',10,.001,100000)}
    <label>种植时间怎么选<select id="hv-date-mode"><option value="auto">自动比较当地种植时间 · Beta</option><option value="manual">使用我填写的日期</option></select></label><label>种植 / 移栽日期<input id="hv-date" type="date" value="${new Date().toISOString().slice(0,10)}"></label>${input('days','计划生育期（天）',150,60,365,1)}</div>

    <label>天气来源<select id="hv-source"><option value="history" ${requestSoil?'selected':''}>真实历史天气 · 全球坐标</option><option value="demo" ${requestSoil?'':'selected'}>人工天气情景 · 离线体验</option></select></label>
    <label>比较多少个历史生长季<select id="hv-years"><option value="5">最近5个完整生长季</option><option value="10" selected>最近10个完整生长季</option><option value="20">最近20个完整生长季</option></select></label>
    <div class="hv-section-title"><span class="hv-step">03</span><h2>土壤与供水</h2></div>
    <label>养分数据<select id="hv-soil-mode"><option value="china" ${requestSoil?'selected':''}>读取国内表层格网 · Beta</option><option value="manual" ${requestSoil?'':'selected'}>手填整季养分供应 · Beta</option><option value="climate">只有天气 · 先看气候和水分条件</option></select></label>
    <div class="hv-soil-card"><p id="hv-soil-status" role="status" aria-live="polite"></p><div id="hv-soil-values"></div><button type="button" id="hv-soil-retry" class="hv-text-button">重新读取土壤</button></div>
    <div class="hv-grid"><label>土壤质地<select id="hv-texture"><option value="loam">壤土 · 假设</option><option value="sandy">砂质土 · 假设</option><option value="clay">黏质土 · 假设</option></select></label>
    <label>供水方式<select id="hv-water"><option value="sufficient" selected>水源充足 · 缺水时及时适量浇水</option><option value="irrigated">浇水有限 · 按实际水量计算</option><option value="rain">只靠下雨 · 不额外浇水</option></select></label>
    <label>排水<select id="hv-drainage"><option value="good">排水良好 · 默认假设，请核实</option><option value="poor">较差 / 易积水</option></select></label>${input('irrigationLimit','本季可补灌水量（mm）',300,0,3000)}</div>
    <p class="hv-hint">默认假设水源充足，缺水时及时适量浇水，不因缺水扣分。浇水不会消除暴雨和积水风险：请据实选择排水条件。模型尚未接入地势、河流水位和排水设施，不能预测洪水淹没。</p><details><summary>土壤与生长专业设置</summary><p class="hv-hint">持水参数暂由质地估计。以下根深和初始含水比例为假设，可据实调整。养分必须是整季可吸收供应，不可直接填化验浓度 mg/kg。</p><div class="hv-grid">
    ${input('rootDepth','有效根区深度（m）',1,.15,2)}${input('initialWater','初始可用水比例（0–1）',.6,0,1)}${input('irrigationDailyMax','单日补灌上限（mm）',15,0,100)}${input('ph','pH',6,3,10)}
    ${input('n','N 供应（kg/ha）',60,0,500)}${input('p','P 供应（kg/ha）',12,0,500)}${input('k','K 供应（kg/ha）',80,0,1000)}</div>
    <div id="hv-soil-conversion"><p class="hv-hint">国内格网仅0–4.5cm表层：浓度×容重×厚度×以下假设比例；不外推到完整根区。</p><div class="hv-grid">${input('fraction-n','N 假设利用比例',.3,0,1)}${input('fraction-p','P 假设利用比例',.2,0,1)}${input('fraction-k','K 假设利用比例',.4,0,1)}</div></div></details>
    <details id="hv-economics" open><summary>投入与收益条件</summary><label>币种（切换不会自动换汇）<select id="hv-currency">${['CNY','USD','THB','VND','IDR','NGN','KES','TZS','GHS'].map(c=>`<option>${c}</option>`).join('')}</select></label>
    <div class="hv-grid">${input('budget','新增肥料预算 / <span class="hv-per">亩</span>',250,0,100000000)}${input('price','鲜薯售价 / kg',2,0,1000000)}${input('base','基础成本 / <span class="hv-per">亩</span>',1000,0,100000000)}${input('marketable','商品率（0–1）',.85,0,1)}${input('harvestCost','随产量增加的费用 / kg',0,0,100)}${input('fertPrice','肥料单价 / kg',3,.0001,1000000)}</div>
    <p class="hv-hint">金额均按所选币种输入。默认价格与成本只是示例；基础成本应包含种苗、人工、地租、浇水水电和已有肥料等费用；漏填的费用不会自动扣除。采收运输费若另填，请勿重复计入。</p>
    <label>比较偏好<select id="hv-risk"><option value="cautious">稳妥一些 · 优先看较差年份的利润</option><option value="balanced">看平均表现 · 比较多年平均利润</option></select></label>
    <details><summary>肥料配方与用量范围</summary><div class="hv-grid">${input('fert-n','N（%）',15,0,100)}${input('fert-p','P₂O₅（%）',15,0,100)}${input('fert-k','K₂O（%）',15,0,100)}${input('existingRate','已施同配方肥料 kg / <span class="hv-per">亩</span>',0,0,4500)}${input('maxRate','新增量上限 kg / <span class="hv-per">亩</span>',80,0,4500)}</div><p class="hv-hint">比较候选用量，不是农艺处方；已有肥料按同配方估计，未模拟施肥时间与有机肥释放。</p></details></details>
    <details><summary>地区校准包</summary><p class="hv-hint">只接受与当前版本、地区和品种一致且已审核的JSON校准包。没有包时使用Beta通用参数。</p><input id="hv-calibration" type="file" accept="application/json,.json" aria-label="导入已审核校准包"><p id="hv-calibration-status" class="hv-hint">未应用地区校准。</p><button type="button" id="hv-calibration-clear" class="hv-text-button">移除校准包</button></details>
    <div class="hv-submit"><button id="hv-run" type="submit" class="hv-primary">开始分析 →</button><p id="hv-status" class="hv-hint" role="status" aria-live="polite">选好地块与条件后即可开始。</p></div></form></details>
    <section id="hv-output" hidden class="hv-output" aria-live="polite"><div class="hv-panel hv-empty"><span class="hv-eyebrow">先看条件，再决定投入</span><h2>同一块地，比较不同年景</h2><p>逐日计算水分和生长，再比较养分与预算限制。结果会告诉你哪里缺数据，以及下一步应该补什么。</p><div class="hv-empty-steps"><span>气候与水分</span><span>产量情景</span><span>投入回报</span></div><p class="hv-hint">Beta参数尚未完成地区验证。没有养分数据也可以先做气候初筛。</p></div></section></div>`;
    syncLocations(locations);cropNote();
    $('use-local-soil').hidden=!requestSoil;
    $('use-local-soil').addEventListener('click',()=>{autoClimate=false;$('soil-mode').value='china';invalidate();loadSoil();});
    $('quick-run').addEventListener('click',()=>$('form').requestSubmit());
    $('open-settings').addEventListener('click',()=>{$('settings').open=true;$('settings').scrollIntoView({behavior:'smooth',block:'start'});});
    $('form').addEventListener('submit',run);
    $('form').addEventListener('input',invalidate);$('form').addEventListener('change',invalidate);
    $('location').addEventListener('change',()=>{const o=$('location').selectedOptions[0];if(!o.dataset.lat)return;$('lat').value=o.dataset.lat;$('lng').value=o.dataset.lng;pointChanged();});
    ['lat','lng'].forEach(id=>{$(id).addEventListener('input',()=>{invalidate();clearSoil();});$(id).addEventListener('change',()=>{$('location').value='custom';pointChanged();});});
    ['crop','variety'].forEach(id=>$(id).addEventListener('input',invalidate));
    $('variety').addEventListener('change',invalidate);
    $('date').addEventListener('change',()=>{$('date-mode').value='manual';});
    $('crop').addEventListener('change',()=>{$('days').value=M.crops[$('crop').value].days;$('rootDepth').value=M.crops[$('crop').value].rootDepth;cropNote();invalidate();});
    $('unit').addEventListener('change',changeUnit);
    $('soil-mode').addEventListener('change',()=>{autoClimate=false;loadSoil();});$('soil-retry').addEventListener('click',()=>{invalidate();loadSoil();});
    ['fraction-n','fraction-p','fraction-k'].forEach(id=>$(id).addEventListener('input',()=>{if(soil)try{applySoil();}catch(e){$('soil-status').textContent=e.message;}}));
    ['ph','n','p','k'].forEach(id=>$(id).addEventListener('input',()=>{nutrientOrigin={kind:'user'};}));
    $('water').addEventListener('change',()=>{$('irrigationLimit').disabled=$('water').value!=='irrigated';$('irrigationDailyMax').disabled=$('water').value!=='irrigated';});$('irrigationLimit').disabled=true;$('irrigationDailyMax').disabled=true;
    $('calibration').addEventListener('change',async()=>{calibration=null;const file=$('calibration').files[0];await Promise.resolve();const token=revision;if(!file)return;try{if(file.size>1000000)throw Error('校准包超过1MB');const raw=await file.text();if(token!==revision||$('calibration').files[0]!==file)return;const pack=JSON.parse(raw);M.validateCalibration(pack,params());calibration=pack;$('calibration-status').textContent='已加载 '+pack.id+'；计算时再次核对适用范围。';}catch(e){if(token===revision)$('calibration-status').textContent=e.message;}});
    $('calibration-clear').addEventListener('click',()=>{calibration=null;$('calibration').value='';$('calibration-status').textContent='未应用地区校准。';invalidate();});
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
  function cropNote(){$('crop-note').textContent=M.crops[$('crop').value].parameterSource+'。填写品种名用于记录，不会自动生成该品种的已验证参数。';}
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
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180){clearSoil();status('请输入有效经纬度');return;}
    marker?.setLatLng(toMap(lat,lng));if(recenter)map?.setView(toMap(lat,lng),9);
    $('point').textContent=`${lat.toFixed(5)}, ${lng.toFixed(5)} · WGS84`;
    let reset='';if(nutrientOrigin?.kind==='soil'&&nutrientOrigin.key!==pointKey(lat,lng)){Object.entries(NUTRIENT_DEFAULTS).forEach(([id,v])=>$(id).value=v);nutrientOrigin=null;reset='手填养分已恢复为示例值（原数值来自上一个地点的土壤），请按当前地块核对。';}
    const domestic=lat>=17.8&&lat<=54&&lng>=73&&lng<=136;
    if($('soil-mode').value==='china'&&!domestic){autoClimate=true;$('soil-mode').value='climate';status('此点超出国内格网范围，已切换为气候初筛；回到国内会自动读取土壤。');}
    else if(autoClimate&&domestic){autoClimate=false;$('soil-mode').value='china';}
    loadSoil();if(reset&&$('soil-mode').value==='manual')soilStatus(reset);
  }
  function changeUnit(){const next=$('unit').value;if(next===unit)return;const ratio=next==='ha'?15:1/15;
    ['budget','base','existingRate','maxRate'].forEach(id=>{if(Number.isFinite(number(id)))$(id).value=Number((number(id)*ratio).toFixed(6));});
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
      $('soil-values').innerHTML='<div class="hv-soil-grid">'+Object.values(data.fields).map(f=>`<div><span>${esc(f.label)}</span><b>${num(f.value,2)} <small>${esc(f.unit)}</small></b></div>`).join('')+'</div>'+(nearby?`<p class="hv-hint hv-nearby">📍 ${esc(nearby)}。</p>`:'')+'<p class="hv-hint">约1km背景值，不是实时测土。<a href="https://doi.org/10.11888/Soil.tpdc.270281" target="_blank" rel="noopener">来源</a></p>';
    }catch(e){if(token===soilRevision){soil=null;soilError=e.name==='AbortError'?'土壤读取超时，请点击读取内置土壤重试。':e.message;soilStatus(soilError);}}
    finally{clearTimeout(timer);if(token===soilRevision){soilLoadingKey='';$('soil-retry').disabled=false;}}
  }
  function invalidate(){host.classList.remove('hv-is-running');$('quick-run').disabled=false;$('quick-run').innerHTML='<span>更新这个位置</span><span>↗</span>';if(result){$('output').hidden=true;$('quick-content').classList.remove('hv-is-stale');$('quick-content').innerHTML='<h2>等待重新分析</h2><p>地点或条件已修改，请点击下方按钮查看新结果。</p>';}revision++;weatherController?.abort();stale=true;$('run').disabled=false;$('run').textContent='更新分析 →';status('条件已修改，请重新计算。');const banner=$('stale');if(banner)banner.hidden=false;['export','record','trace-year'].forEach(id=>{if($(id))$(id).disabled=true;});}
  function params(){
    const p={};for(const id of ['lat','lng','area','days','ph','n','p','k','budget','price','base','fertPrice','rootDepth','initialWater','irrigationLimit','irrigationDailyMax','marketable','harvestCost','existingRate','maxRate'])p[id]=number(id);
    for(const id of ['crop','date','water','drainage','risk','texture','currency'])p[id]=$(id).value;
    p.variety=$('variety').value.trim()||'generic';p.soilOrigin=$('soil-mode').value;p.fertilizer=['fert-n','fert-p','fert-k'].map(number);
    if(unit==='ha'){p.area*=15;['budget','base','existingRate','maxRate'].forEach(k=>p[k]/=15);}
    if(p.soilOrigin==='china')Object.assign(p,applySoil());
    if(p.soilOrigin==='climate')Object.assign(p,{n:0,p:0,k:0,ph:6,price:0,base:0,budget:0,fertPrice:1,marketable:1,harvestCost:0,existingRate:0,maxRate:0,fertilizer:[0,0,0]});
    return M.normalize(p);
  }
  function artificial(p,season){
    let seed=(season.year*7919+Math.round((p.lat+90)*100))>>>0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const daily={temperature_2m_mean:[],temperature_2m_min:[],precipitation_sum:[],et0_fao_evapotranspiration:[],shortwave_radiation_sum:[]};
    for(let i=0;i<p.days;i++){const date=new Date(Date.parse(season.start)+i*86400000),day=(date-Date.UTC(date.getUTCFullYear(),0,1))/86400000;
      const wave=Math.cos(2*Math.PI*(day-(p.lat<0?18:200))/365.25),t=27-Math.abs(p.lat)*.3+Math.min(18,Math.abs(p.lat)*.32)*wave+(random()-.5)*4;
      daily.temperature_2m_mean.push(t);daily.temperature_2m_min.push(t-5-random()*3);daily.precipitation_sum.push(random()<.35?random()*25:0);daily.et0_fao_evapotranspiration.push(Math.max(.5,t*.14));daily.shortwave_radiation_sum.push(Math.max(3,17+wave*5+(random()-.5)*8));}
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
      const query=new URLSearchParams({latitude:p.lat,longitude:p.lng,start_date:start,end_date:end,daily:'temperature_2m_mean,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration,shortwave_radiation_sum',timezone:'auto',models:'era5'});
      const response=await fetch('https://archive-api.open-meteo.com/v1/archive?'+query,{signal});if(!response.ok)throw Error('历史天气服务暂不可用；可重试，或明确切换人工情景。');
      const data=await response.json();const checked=M.extractSeasons(data.daily,seasons);if(checked.included.length<3)throw Error('完整历史天气不足，请稍后重试。');if(signal.aborted)throw new DOMException('已取消','AbortError');cached={at:Date.now(),daily:data.daily};if(weatherCache.size>=8)weatherCache.delete(weatherCache.keys().next().value);weatherCache.set(key,cached);
    }
    const extracted=M.extractSeasons(cached.daily,seasons);if(extracted.included.length<3)throw Error('完整历史生长季不足3个，请调整年段或重试。');
    return {kind,source:'Open-Meteo / ERA5 · 完整历史生长季',...extracted,requested:seasons.length};
  }
  async function run(event){
    event.preventDefault();if($('run').disabled)return;invalidate();const token=++revision;weatherController?.abort();const controller=new AbortController();weatherController=controller;
    $('run').disabled=true;$('quick-run').disabled=true;host.classList.add('hv-is-running');status('正在读取多年天气并逐日计算…');const timer=setTimeout(()=>controller.abort(),45000);
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
        const ranking=M.rankPlantingWindows(p,windows),chosen=windows.find(w=>w.date===ranking[0].date);
        p.date=chosen.date;w={...chosen.weather,included:chosen.weather.included.filter(s=>ranking[0].years.includes(s.year)),excluded:[...chosen.weather.excluded,...chosen.weather.included.filter(s=>!ranking[0].years.includes(s.year)).map(s=>({year:s.year,reason:'播期比较统一年份'}))]};$('date').value=p.date;
        planning={method:'monthly-climate-beta-v1',ranking,selectedDate:p.date,note:'12个月中每月15日的粗筛；同样的供水、生育期和历史年份，按平均水热限制生长量排序，非农艺最优或已验证产量。未评估台风、病害、轮作和市场季节价格。'};
      }else w=await weather(p,controller.signal);
      if(token!==revision)return;
      const output=p.soilOrigin==='climate'?M.evaluateClimate(p,w.included):M.evaluateEnsemble(p,w.included,{calibration});
      const nextResult={schema:'harvest-result-v3',generatedAt:new Date().toISOString(),input:p,display:{unit,currency:p.currency},fieldId:$('location').value==='custom'?'':$('location').value,
        soil:usedSoil,weather:{...w},output,calibration,planning};render(nextResult);result=nextResult;stale=false;status('分析完成。Beta结果可用于情景比较，实际精度仍需田间验证。');
      if(window.innerWidth<800)$('quick-content').scrollIntoView({behavior:'smooth',block:'start'});
    }catch(e){if(token!==revision)return;stale=true;result=null;$('output').hidden=true;$('quick-content').innerHTML='<h2>本次分析未完成</h2><p>请根据下方提示重试，当前没有可用的新结果。</p>';status(e.name==='AbortError'?'天气读取超时，请重试。':e.message);if(!result)$('output').innerHTML='<div class="hv-panel hv-empty"><h2>还差一点信息</h2><p>'+esc(e.message)+'</p><p>展开种植条件，补齐提示信息后重试。</p></div>';}
    finally{clearTimeout(timer);if(token===revision){$('run').disabled=false;$('run').textContent='重新分析 →';$('quick-run').disabled=false;$('quick-run').innerHTML='<span>重新分析这个位置</span><span>↗</span>';host.classList.remove('hv-is-running');}}
  }
  function download(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  // One bar per historical weather year, same planting plan. Labels carry the value, unit, average and extremes
  // so the chart reads on its own.
  function yieldChart(o,f){
    if(!o.yieldAvailable)return '';
    const values=o.best.years,n=values.length,width=600,top=34,base=150,span=base-top,gap=width/n;
    const max=Math.max(1,...values.map(y=>y.fresh)),min=Math.min(...values.map(y=>y.fresh));
    const avg=values.reduce((a,y)=>a+y.fresh,0)/n,avgY=base-avg/max*span;
    const flat=max>0&&(max-min)/max<0.03;
    const hi=values.findIndex(y=>y.fresh===max),lo=values.findIndex(y=>y.fresh===min);
    const short=v=>{const x=v*f;return x>=10000?num(x/1000,1)+'k':num(x);};
    const bars=values.map((y,i)=>{
      const h=y.fresh/max*span,x=i*gap+gap*.18,w=gap*.64,cx=i*gap+gap/2;
      const tone=flat?'#8fb3a0':i===hi?'#3f7d62':i===lo?'#d98a5b':'#8fb3a0';
      const tag=flat?'':i===hi?'最好':i===lo?'最差':'';
      return `<g><rect x="${x}" y="${base-h}" width="${w}" height="${h}" rx="4" fill="${tone}"><title>${y.year} 年天气：${num(y.fresh*f)} kg/${per()}</title></rect>`+
        `<text x="${cx}" y="${base-h-6}" text-anchor="middle" class="hv-bar-val">${short(y.fresh)}</text>`+
        (tag?`<text x="${cx}" y="${base-h-19}" text-anchor="middle" class="hv-bar-tag" fill="${tone}">${tag}</text>`:'')+
        `<text x="${cx}" y="${base+18}" text-anchor="middle">${y.year}</text></g>`;
    }).join('');
    return `<p class="hv-chart-legend"><span class="hv-key" style="background:#8fb3a0"></span>每根柱子：用这一年的真实天气、同一套种植方案重算的鲜薯产量（kg/${per()}）`+
      `<span class="hv-key hv-key-line"></span>平均 ${num(avg*f)}${flat?'':` · <b style="color:#3f7d62">最好 ${values[hi].year}</b> · <b style="color:#c07a4f">最差 ${values[lo].year}</b>`}</p>`+
      `<svg class="hv-chart" viewBox="0 0 ${width} 176" role="img" aria-label="不同历史天气年份下的鲜薯产量，平均 ${num(avg*f)} kg/${per()}">`+
      `<line x1="0" y1="${base}" x2="${width}" y2="${base}" stroke="#d7e2d8"/>`+
      `<line x1="0" y1="${avgY}" x2="${width}" y2="${avgY}" stroke="#35584a" stroke-width="1.2" stroke-dasharray="5 5" opacity=".45"/>${bars}</svg>`+
      (flat?'<p class="hv-hint">这几年天气对这块地影响很小，各年产量几乎一样；限制产量的主要是下面的因素。</p>':'');
  }
  function render(r){
    const o=r.output,p=r.input,f=r.display.unit==='ha'?15:1,area=p.area/f,label=r.display.unit==='ha'?'公顷':'亩',b=o.best;
    if(p.water==='sufficient')o.factors=o.factors.map(x=>x.name==='逐日水分'?{...x,name:'浇水条件',detail:'按水源充足、缺水时及时适量浇水计算'}:x);
    const capped=o.yieldAvailable&&b.low>=M.crops[p.crop].potential/15*.995;
    const yieldText=!o.yieldAvailable?'—':capped?'约 '+num(b.fresh*f)+'（模型上限）':num(b.low*f)+'–'+num(b.high*f);
    const risks=o.factors.filter(x=>x.value<.7),headline=risks.length?'重点关注：'+risks.map(x=>x.name).join('、'):'按当前种植时间和供水条件，气候与水分较合适';
    $('output').hidden=false;$('quick-content').classList.remove('hv-is-stale');
    $('quick-content').innerHTML=`<span class="hv-eyebrow">${esc(o.crop)} · ${num(p.area/f,2)} ${label}</span><h2>${risks.length?'这套方案有需要注意的地方':'这套方案的生长条件较好'}</h2><p>${esc(headline)}</p><p class="hv-quick-footnote">${num(p.lat,4)}, ${num(p.lng,4)} · 当前分析坐标<br>${p.date} 移栽 · ${p.days}天 · ${p.water==='sufficient'?'水源充足，及时浇水':p.water==='rain'?'只靠下雨':'按实际水量浇水'}<br>${r.planning?'已比较12个种植时间 · Beta参考':'按指定日期计算，不代表全年种植条件'}</p><div class="hv-quick-metrics"><div><span>当前种植方案的条件</span><strong>${o.climateScore}<small> / 100</small></strong><span>${o.climateScore>=80?'较好':o.climateScore>=60?'需注意限制':'有明显限制'} · 模型参考分，非成功率</span></div>${o.yieldAvailable?`<div><span>预计收成 · kg/${label}</span><strong>${yieldText}</strong></div><div><span>估算平均利润 · ${esc(p.currency)}/${label}</span><strong>${num(b.net*f)}</strong></div>`:'<p>养分数据待补充，暂不生成产量和收益。</p>'}</div><p class="hv-quick-footnote">${capped?'已达到暂定产量上限，模型暂不能区分这些年份的收成差异；不代表稳产保证。<br>':''}${o.yieldAvailable?'利润＝卖薯收入－已填成本。默认价格和成本只是示例，请改成当地实际值。<br>':''}${r.weather.kind==='demo'?'人工天气情景':'历史天气情景'} · ${o.count}个生长季<br>Beta通用参数，未做当地精度验证</p><button type="button" id="hv-view-details" class="hv-text-button">查看完整分析 ↓</button>`;
    $('view-details').addEventListener('click',()=>$('output').scrollIntoView({behavior:'smooth',block:'start'}));
    const rows=o.yieldAvailable?[...new Map(o.rows.map(x=>[x.rate,x])).values()]:[];
    $('output').innerHTML=`<div class="hv-result"><div id="hv-stale" class="hv-stale" hidden>输入已改变。以下为上次结果，请重新计算后使用或导出。</div>
    <article class="hv-verdict"><div><span class="hv-eyebrow">${esc(o.crop)} · ${num(area,2)} ${label} · Beta</span><h2>${headline}</h2><p>${o.yieldAvailable?'气候、水分和养分分别评估。数据不足与参数误差仍会影响收成。':'本次仅做气候初筛。补充养分数据后，再计算产量与收益。'}</p></div><span class="hv-condition">${o.climateScore}<small>当前方案条件<br>参考指标，非成功率</small></span></article>
    <div class="hv-source">${esc(r.weather.source)} · ${o.yearRange[0]}–${o.yearRange.at(-1)} · ${o.count}/${r.weather.requested} 个完整情景${r.weather.excluded.length?' · 已排除 '+r.weather.excluded.map(x=>x.year).join('、'):''}<br>${r.soil?'土壤：国内0–4.5cm表层背景，假设比例换算供应':p.soilOrigin==='manual'?'养分：手填供应，非自动测土':'养分：未提供'} · 土壤持水量：质地估计</div>
    ${o.yieldAvailable?`<div class="hv-metrics"><article class="hv-panel"><span>预计收成范围 · 不同年份天气</span><strong>${yieldText}</strong><small>kg/${label} · 平均 ${num(b.fresh*f)}</small></article><article class="hv-panel"><span>这块地预计可出售的薯</span><strong>${num(b.saleable*p.area/1000,1)}</strong><small>吨 · 商品率 ${num(p.marketable*100)}%</small></article><article class="hv-panel"><span>估算平均利润</span><strong>${num(b.net*f)}</strong><small>${esc(p.currency)}/${label} · 较差年份 ${num(b.netLow*f)}</small></article></div>
    <article class="hv-panel"><div class="hv-title-row"><h2>如果遇上不同年景</h2><span>同一套种植方案</span></div>${yieldChart(o,f)}<p class="hv-hint">${esc(o.rangeMeaning)}。${r.weather.kind==='demo'?'这里是人工年景，不用于实际准确率判断。':'不包含全部模型、病虫害与价格不确定性。'}</p></article>`:''}
    <article class="hv-panel"><div class="hv-title-row"><h2>是什么限制了生长</h2><span>把原因拆开看</span></div><div class="hv-factors">${o.factors.map(x=>`<div><div class="hv-factor-label"><b>${x.name}</b><span>${num(x.value*100)} / 100</span></div><div class="hv-track"><i style="width:${Math.max(0,Math.min(100,x.value*100))}%"></i></div><p>${esc(x.detail)}</p></div>`).join('')}</div></article>
    <article class="hv-panel"><div class="hv-title-row"><h2>每天土壤里还剩多少可用水</h2><label class="hv-inline-label">查看年景<select id="hv-trace-year">${o.simulations.map((s,i)=>`<option value="${i}">${s.year}</option>`).join('')}</select></label></div><div id="hv-water-chart"></div><p class="hv-hint">曲线表示土壤里剩余的可用水；浇水量是模型估计的到田水量，不含输水损耗。排水压力天数是强降雨风险提示，不是实际积水天数或洪水预报。</p></article>
    ${o.yieldAvailable?`<article class="hv-panel"><div class="hv-title-row"><h2>预计能赚多少钱</h2><span>${esc(p.currency)} · 每${label}</span></div><p class="hv-hint">估算利润＝可出售的薯 × 售价 − 基础成本 − 新增肥料费 − 单独填写的采收运输费。取不同历史天气下的平均值，不是保证收入；未填的人工、地租、浇水费用等仍需扣除。</p><div class="hv-table-wrap"><table><thead><tr><th>方案</th><th>新增肥料 kg</th><th>新增肥料费</th><th>产量 kg</th><th>估算平均利润</th><th>较差年份利润</th></tr></thead><tbody>${rows.map(x=>`<tr class="${x.rate===b.rate?'hv-chosen':''}"><td>${x.rate===0?'不新增肥料':x.name}${x.rate===b.rate?' · 较优':''}</td><td>${num(x.rate*f,1)}</td><td>${num(x.cost*f)}</td><td>${num(x.fresh*f)}</td><td>${num(x.net*f)}</td><td>${num(x.netLow*f)}</td></tr>`).join('')}</tbody></table></div><p class="hv-hint">${b.rate===0?'当前候选中，不新增肥料的比较收益较好。':'相对不新增肥料，每'+label+'估算平均利润变化 '+num((b.net-o.rows[0].net)*f)+' '+esc(p.currency)+'。'} 较优方案在 ${num(b.lossShare*100)}% 的所选情景中亏损；这不是未来亏损概率。</p><div class="hv-break-even">按平均可出售产量，保本需要卖到 <b>${b.breakEvenPrice===null?'无法计算':num(b.breakEvenPrice,2)+' '+esc(p.currency)+'/kg'}</b></div></article>`:''}
    <article class="hv-panel hv-method"><details><summary>这次怎么算 · 参数与版本</summary><p>每天计算有效降雨、径流、深层流失、灌溉和作物耗水；积温决定阶段与根深。Beta生长模块得到水热限制产量，再用QUEFTS计算N/P/K限制，最后按商品率、售价和成本比较收益。</p><p>${r.planning?esc(r.planning.note):'按指定日期模拟一个生长季，不作为整个地区全年适宜性结论。'}</p><p>${o.assumptions.map(esc).join('；')}。</p><p>算法 ${esc(o.version)} · 参数 ${esc(o.parameterVersion)} · ${o.calibrationId?'校准 '+esc(o.calibrationId):'未应用地区校准'}</p><p>参考 <a href="https://www.fao.org/4/X0490E/x0490e0e.htm" target="_blank" rel="noopener">FAO-56</a> / <a href="https://github.com/IITA-AKILIMO/akilimo-recommendations" target="_blank" rel="noopener">AKILIMO QUEFTS</a>。不是经过当地标定的完整LINTUL模型。</p></details><button type="button" id="hv-export" class="hv-secondary">导出完整分析 JSON ↓</button></article>
    ${o.yieldAvailable?`<article class="hv-panel"><details><summary>收获后：记录实际结果，让模型逐步变准</summary><p class="hv-hint">导出一条实收记录，之后与其他地块合并做独立验证。文件仅保存到你的电脑，本次不上传生产数据库。</p><div class="hv-grid"><label>稳定的地块ID<input id="hv-field-id" value="${esc(r.fieldId)}" placeholder="同一地块每季使用相同ID"></label><label>实际收获日期<input id="hv-harvest-date" type="date"></label>${input('actual-area','实际收获面积（'+label+'）',area,.001,100000)}${input('actual-weight','实际鲜薯总重量（kg）','',0,100000000)}</div><button type="button" id="hv-record" class="hv-secondary">导出实收记录</button><p id="hv-record-status" role="status" class="hv-hint"></p></details></article>`:''}</div>`;
    $('trace-year').addEventListener('change',()=>waterChart(o.simulations[Number($('trace-year').value)]));waterChart(o.simulations[0]);
    $('export').addEventListener('click',()=>{if(!stale)download('收成分析-'+p.date+'.json',result);});
    $('record')?.addEventListener('click',()=>recordActual(r));
  }
  function waterChart(s){
    const points=s.trace.map((x,i)=>`${10+i/Math.max(1,s.trace.length-1)*580},${125-x.storage/x.capacity*100}`).join(' ');
    $('water-chart').innerHTML=`<div class="hv-water-summary"><span>明显缺水 <b>${s.stressDays} 天</b></span><span>最长连续 <b>${s.longestDry} 天</b></span><span>模拟浇水量 <b>${num(s.irrigation*2/3*factor(),1)} 立方米/${per()}</b></span><span>排水压力较大 <b>${s.wetDays} 天</b></span><span>模型估计生长进度 <b>${num(s.maturity*100)}%</b></span></div><svg class="hv-chart" viewBox="0 0 600 150" role="img" aria-label="${s.year}根区可用水逐日变化"><line x1="10" y1="125" x2="590" y2="125" stroke="#d7e2d8"/><line x1="10" y1="25" x2="590" y2="25" stroke="#e7ece7"/><polyline points="${points}" fill="none" stroke="#438b91" stroke-width="2"/><text x="10" y="145">种植</text><text x="590" y="145" text-anchor="end">第${s.trace.length}天</text></svg>`;
  }
  function recordActual(r){try{
    if(stale)throw Error('请先重新计算');if(r.weather.kind!=='history')throw Error('人工天气情景不能作为校准样本，请使用真实历史天气分析。');if(r.output.calibrationId)throw Error('校准工具需要未校准的原始预测，请移除校准包后重新生成。');
    const fieldId=$('field-id').value.trim(),harvestDate=$('harvest-date').value,actualArea=number('actual-area'),weight=number('actual-weight');
    if(!fieldId||!harvestDate||harvestDate<r.generatedAt.slice(0,10)||harvestDate>new Date().toISOString().slice(0,10))throw Error('填写地块ID和真实收获日期；预测必须在收获前形成。历史预测可从先前导出的JSON整理记录。');
    if(!Number.isFinite(actualArea)||actualArea<=0||!Number.isFinite(weight)||weight<0)throw Error('请填写有效面积和总重量');
    const ha=actualArea/(r.display.unit==='ha'?1:15);
    const record={schema:'harvest-observation-v1',id:globalThis.crypto?.randomUUID?.()||'harvest-'+Date.now(),fieldId,split:'unassigned',seasonYear:Number(harvestDate.slice(0,4)),harvestDate,crop:r.input.crop,variety:r.input.variety,lat:r.input.lat,lng:r.input.lng,observedFreshKgHa:weight/ha,
      prediction:{engineVersion:r.output.version,parameterVersion:r.output.parameterVersion,generatedAt:r.generatedAt,calibrationId:null,sourceKind:r.weather.kind,rawYears:r.output.best.years.map((y,i)=>({year:y.year,freshKgHa:y.rawFresh*15,waterLimitKgHa:r.output.simulations[i].wly/M.crops[r.input.crop].dm}))},analysis:r};
    download('实收记录-'+fieldId.replace(/[^\w\u4e00-\u9fff-]/g,'_')+'.json',record);$('record-status').textContent='已导出。合并样本并分配训练/验证集后，运行校准工具。';
  }catch(e){$('record-status').textContent=e.message;}}
  window.HarvestUI={init};
})();
