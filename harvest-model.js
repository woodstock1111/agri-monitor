/* QUEFTS core adapted from IITA-AKILIMO/akilimo-recommendations R/quefts.R.
 * Copyright (c) 2024 Akilimo Project. MIT; see THIRD_PARTY_NOTICES.md.
 * FAO-56-inspired daily water balance; growth/economics remain versioned Beta assumptions. */
(function(root) {
  'use strict';
  const clamp = (x, a=0, b=1) => Math.max(a, Math.min(b, x));
  const crops = {
    sweetpotato: { name:'红薯', days:150, hi:.5, dm:.25, potential:36000, temp:[15,22,30,38],
      concentrations:[[2.5,.9,3.2,1.4],[.6,.1,1,.13],[4.6,1.1,4.6,.85]], rf:[.41,.25,.65] },
    cassava: { name:'木薯', days:300, hi:.52, dm:.35, potential:45000, temp:[16,25,30,40],
      concentrations:[[6.6,2.5,17.9,7.9],[1.5,.8,2.8,.9],[11,2.8,18.8,3.4]], rf:[.5,.21,.49] }
  };
  function quefts(soil, recovered, wly, crop=crops.cassava) {
    if(!Array.isArray(soil)||soil.length!==3||!Array.isArray(recovered)||recovered.length!==3)throw Error('需要N/P/K三项供应量');
    if (![...soil,...recovered,wly].every(Number.isFinite) || [...soil,...recovered,wly].some(x=>x<0)) throw Error('养分和产量上限必须是非负数');
    if (!wly) return 0;
    const a=crop.concentrations.map(c=>Math.round(1000*crop.hi/(crop.hi*c[0]+(1-crop.hi)*c[2])));
    const d=crop.concentrations.map(c=>Math.round(1000*crop.hi/(crop.hi*c[1]+(1-crop.hi)*c[3])));
    const s=soil.map((x,i)=>x+recovered[i]);
    if (s.some(x=>x===0)) return 0;
    const uptake=(i,j)=> {
      if(s[i]<s[j]*a[j]/d[i]) return s[i];
      if(s[i]>s[j]*(2*d[j]/a[i]-a[j]/d[i])) return s[j]*d[j]/a[i];
      return s[i]-.25*(s[i]-s[j]*a[j]/d[i])**2/(s[j]*(d[j]/a[i]-a[j]/d[i]));
    };
    const water=i=> {
      if(s[i]<wly/d[i]) return s[i];
      if(s[i]>2*wly/a[i]-wly/d[i]) return wly/a[i];
      return s[i]-.25*(s[i]-wly/d[i])**2/(wly/a[i]-wly/d[i]);
    };
    const u=s.map((_,i)=>Math.min(water(i),...s.map((_,j)=>i===j?Infinity:uptake(i,j))));
    const ya=u.map((x,i)=>x*a[i]), yd=u.map((x,i)=>x*d[i]);
    let sum=0;
    for(let i=0;i<3;i++) for(let j=0;j<3;j++) if(i!==j) {
      const k=3-i-j, limit=Math.min(yd[j],yd[k]), denom=limit/a[i]-ya[j]/d[i];
      const t=Math.abs(denom)<1e-10?0:(u[i]-ya[j]/d[i])/denom;
      const y=u[i]===0||limit===0?0:ya[j]+(limit-ya[j])*(2*t-t*t);
      sum+=clamp(y,0,Math.min(...yd,wly));
    }
    return sum/6; // kg/ha dry matter (upstream comment incorrectly says tonnes).
  }
  function validate(p) {
    const ranges={lat:[-90,90],lng:[-180,180],area:[.01,100000],days:[60,365],ph:[3,10],n:[0,500],p:[0,500],k:[0,1000],budget:[0,100000000],price:[0,1000000],base:[0,100000000],fertPrice:[.0001,1000000]};
    for(const [key,[lo,hi]] of Object.entries(ranges)) if(!Number.isFinite(p[key])||p[key]<lo||p[key]>hi) throw Error('请检查输入：'+key+' 必须在 '+lo+'–'+hi+' 之间');
    if(!Number.isInteger(p.days)||!crops[p.crop]||!['good','poor'].includes(p.drainage)||!['rain','irrigated'].includes(p.water)||!['cautious','balanced'].includes(p.risk)) throw Error('作物或管理选项无效');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!Number.isFinite(Date.parse(p.date))||new Date(p.date).toISOString().slice(0,10)!==p.date) throw Error('请选择有效播种日期');
    return p;
  }
  function climate(daily, days) {
    const keys=['temperature_2m_mean','temperature_2m_min','precipitation_sum','et0_fao_evapotranspiration'];
    if(!daily || keys.some(k=>!Array.isArray(daily[k])||daily[k].length!==days||daily[k].some(v=>typeof v!=='number'||!Number.isFinite(v)))) throw Error('气象数据缺失，无法评估。可切换示例模式重试。');
    if (daily.precipitation_sum.some(x=>x<0)||daily.et0_fao_evapotranspiration.some(x=>x<0)) throw Error('气象水量数据无效');
    if(daily.temperature_2m_mean.some((v,i)=>v < -90 || v > 65 || daily.temperature_2m_min[i] > v || daily.temperature_2m_min[i] < -100)) throw Error('气温范围或最高最低关系无效');
    return daily;
  }
  const VERSION = 'harvest-beta-3.0.0';
  const PARAMETER_VERSION = 'tubers-beta-2026-09-23';
  // Published water parameters + explicitly uncalibrated regional growth assumptions.
  Object.assign(crops.sweetpotato, {id:'sweetpotato', status:'beta', parameterVersion:PARAMETER_VERSION,
    parameterSource:'马铃薯养分代理（待甘薯参数鲜干重基准复核）',
    baseTemp:10, thermalTarget:2400, rootDepth:1, depletion:.65, kc:[.5,1.15,.65],
    stages:[20/150,50/150,110/150,1], sink:[.3,.8,1.5,.8], temp:[10,22,30,40]});
  Object.assign(crops.cassava, {id:'cassava', status:'beta', parameterVersion:PARAMETER_VERSION,
    parameterSource:'AKILIMO / Ezui 木薯参数；地区生长参数待标定',
    baseTemp:12, thermalTarget:4500, rootDepth:.6, depletion:.35, kc:[.3,.8,.3],
    stages:[20/210,60/210,150/210,1], sink:[.3,.8,1.5,.8]});
  const textures = {
    sandy:{name:'砂质土（假设）',fc:.15,wp:.06,infiltration:70,runoff:.03},
    loam:{name:'壤土（假设）',fc:.28,wp:.12,infiltration:40,runoff:.08},
    clay:{name:'黏质土（假设）',fc:.36,wp:.22,infiltration:20,runoff:.15}
  };
  function freeze(o) {Object.values(o).forEach(v=>{if(v&&typeof v==='object')freeze(v);});return Object.freeze(o);}
  freeze(crops); freeze(textures);
  const mean = a=>a.reduce((s,x)=>s+x,0)/a.length;
  function quantile(values,q) {
    if(!values.length||!values.every(Number.isFinite)||!Number.isFinite(q)||q<0||q>1) throw Error('分位数输入无效');
    const a=[...values].sort((x,y)=>x-y),i=(a.length-1)*q,l=Math.floor(i);
    return a[l]+(a[Math.ceil(i)]-a[l])*(i-l);
  }
  function finite(value,name,lo,hi) {
    if(typeof value!=='number'||!Number.isFinite(value)||value<lo||value>hi) throw Error(name+' 必须在 '+lo+'–'+hi+' 之间');
    return value;
  }
  function dateValid(date) {
    return typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;
  }
  function normalize(input) {
    const p={texture:'loam',initialWater:.6,rootDepth:crops[input.crop]?.rootDepth||1,
      irrigationLimit:300,irrigationDailyMax:15,marketable:.85,harvestCost:0,
      existingRate:0,maxRate:80,fertilizer:[15,15,15],variety:'generic',currency:'CNY',...input};
    validate(p);
    for(const [k,lo,hi] of [['initialWater',0,1],['rootDepth',.15,2],['irrigationLimit',0,3000],['irrigationDailyMax',0,100],['marketable',0,1],['harvestCost',0,100],['existingRate',0,300],['maxRate',0,300]]) finite(p[k],k,lo,hi);
    if(!textures[p.texture])throw Error('请选择有效的土壤质地');
    if(!Array.isArray(p.fertilizer)||p.fertilizer.length!==3)throw Error('肥料配方需要N、P₂O₅、K₂O三项');
    p.fertilizer.forEach(v=>finite(v,'肥料百分比',0,100));
    if(p.fertilizer.reduce((a,b)=>a+b,0)>100)throw Error('肥料配方总百分比不能超过100');
    if(typeof p.variety!=='string'||p.variety.length>80||!['CNY','USD','THB','VND','IDR','NGN','KES','TZS','GHS'].includes(p.currency))throw Error('品种或币种无效');
    if(p.fieldCapacity!==undefined||p.wiltingPoint!==undefined) {
      finite(p.fieldCapacity,'田间持水量',.01,.7); finite(p.wiltingPoint,'萎蔫点',0,.6);
      if(p.fieldCapacity<=p.wiltingPoint)throw Error('田间持水量必须大于萎蔫点');
    }
    if(p.irrigation!==undefined&&(!Array.isArray(p.irrigation)||p.irrigation.length!==p.days||p.irrigation.some(x=>typeof x!=='number'||!Number.isFinite(x)||x<0||x>200)))throw Error('逐日灌溉记录无效');
    return p;
  }
  function seasonDates(date,days,year) {
    if(!dateValid(date)||!Number.isInteger(days)||days<1||days>365||!Number.isInteger(year)||year<1940||year>2200)throw Error('历史季节日期无效');
    let start=year+date.slice(4),adjusted=false;
    if(!dateValid(start)) {if(start.endsWith('-02-29')){start=year+'-02-28';adjusted=true;}else throw Error('日期无效');}
    return {year,start,end:new Date(Date.parse(start)+(days-1)*86400000).toISOString().slice(0,10),adjusted};
  }
  function historicalSeasons(date,days,count=10,asOf=new Date().toISOString().slice(0,10)) {
    if(!dateValid(asOf)||!Number.isInteger(count)||count<1||count>30)throw Error('历史年数无效');
    const reference=date<asOf?date:asOf;
    const lastYear=Number(reference.slice(0,4))-1,cutoff=lastYear+'-12-31',seasons=[];
    for(let year=lastYear;seasons.length<count&&year>=1940;year--) {
      const s=seasonDates(date,days,year);if(s.end<=cutoff)seasons.push(s);
    }
    return seasons.reverse();
  }
  function extractSeasons(daily,seasons) {
    if(!daily||!Array.isArray(daily.time))throw Error('天气缺少日期序列');
    const index=new Map(daily.time.map((d,i)=>[d,i]));
    if(index.size!==daily.time.length)throw Error('天气日期重复');
    const included=[],excluded=[],keys=['temperature_2m_mean','temperature_2m_min','precipitation_sum','et0_fao_evapotranspiration'];
    if(daily.shortwave_radiation_sum)keys.push('shortwave_radiation_sum');
    for(const s of seasons) {
      const days=Math.round((Date.parse(s.end)-Date.parse(s.start))/86400000)+1,d={time:[]}; keys.forEach(k=>d[k]=[]);
      for(let i=0;i<days;i++) {
        const day=new Date(Date.parse(s.start)+i*86400000).toISOString().slice(0,10),idx=index.get(day);
        d.time.push(day);keys.forEach(k=>d[k].push(idx===undefined?null:daily[k]?.[idx]));
      }
      try{climate(d,days);if(d.shortwave_radiation_sum?.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0))throw Error('辐射缺失'); included.push({...s,daily:d});}
      catch{excluded.push({year:s.year,reason:'逐日数据缺失或无效'});}
    }
    if(!included.length)throw Error('没有完整的历史季节数据，不能计算');
    return {included,excluded};
  }
  function stageAt(progress,c) {
    let s=c.stages.findIndex(end=>progress<end);if(s<0)s=3;
    const begin=s?c.stages[s-1]:0,t=clamp((progress-begin)/(c.stages[s]-begin));
    const kc=s===0?c.kc[0]:s===1?c.kc[0]+t*(c.kc[1]-c.kc[0]):s===2?c.kc[1]:c.kc[1]+t*(c.kc[2]-c.kc[1]);
    return {index:s,name:['建立期','生长发育期','薯块膨大期','成熟期'][s],kc,sink:c.sink[s]};
  }
  function simulateSeason(input,daily) {
    const p=normalize(input);climate(daily,p.days);
    const c=crops[p.crop],soil=textures[p.texture],fc=p.fieldCapacity??soil.fc,wp=p.wiltingPoint??soil.wp;
    const capacityPerM=1000*(fc-wp),initialDepth=Math.min(.15,p.rootDepth);
    let storage=capacityPerM*initialDepth*p.initialWater,previousCapacity=capacityPerM*initialDepth;
    const initialStorage=storage,trace=[],stageStats=c.stages.map((_,i)=>({name:['建立期','生长发育期','薯块膨大期','成熟期'][i],days:0,stressDays:0,rain:0,irrigation:0,et:0}));
    let progress=0,survival=1,growth=0,potentialGrowth=0,tempSum=0,weightWater=0,weights=0;
    let rainTotal=0,runoffTotal=0,drainageTotal=0,irrigationTotal=0,etTotal=0,rootWater=0,frost=0,drySpell=0,longestDry=0,stressDays=0;
    const normalization=c.sink.reduce((v,w,i)=>v+w*(c.stages[i]-(i?c.stages[i-1]:0)),0);
    for(let i=0;i<p.days;i++) {
      const t=daily.temperature_2m_mean[i],minT=daily.temperature_2m_min[i],rain=daily.precipitation_sum[i],et0=daily.et0_fao_evapotranspiration[i];
      const [t0,t1,t2,t3]=c.temp;
      const thermal=t<t1?clamp((t-t0)/(t1-t0)):t>t2?clamp((t3-t)/(t3-t2)):1;
      const step=Math.min(1-progress,Math.max(0,Math.min(t,t2)-c.baseTemp)/c.thermalTarget);
      const stage=stageAt(progress,c),rootDepth=initialDepth+(p.rootDepth-initialDepth)*clamp(progress/.6);
      const capacity=capacityPerM*rootDepth,newRootWater=Math.max(0,capacity-previousCapacity)*p.initialWater;
      storage+=newRootWater;rootWater+=newRootWater;previousCapacity=capacity;
      const infiltration=Math.min(rain*(1-soil.runoff),soil.infiltration),runoff=rain-infiltration;
      storage+=infiltration;
      const demand=et0*stage.kc,depletion=clamp(c.depletion+.04*(5-demand),.1,.8);
      let irrigation=0;
      if(p.irrigation)irrigation=p.irrigation[i];
      else if(p.water==='irrigated'&&storage<capacity*(1-depletion)) irrigation=Math.max(0,Math.min(capacity-storage,p.irrigationDailyMax,p.irrigationLimit-irrigationTotal));
      storage+=irrigation;
      const drainage=Math.max(0,storage-capacity);storage=Math.min(capacity,storage);
      const ks=clamp(storage/Math.max(capacity*(1-depletion),1e-9));
      const et=Math.min(storage,demand*ks);storage-=et;
      if(minT<=0){frost++;survival*=minT<=-3?.3:.65;}
      let light=1;
      if(daily.shortwave_radiation_sum)light=clamp(finite(daily.shortwave_radiation_sum[i],'短波辐射',0,60)/18,0,1.2);
      // Beta growth integration, NOT a calibrated LINTUL implementation.
      const growthStep=step*stage.sink/normalization*thermal*light;
      const wetPenalty=p.drainage==='poor'&&drainage>5?.65:1;
      potentialGrowth+=growthStep;growth+=growthStep*ks*survival*wetPenalty;
      progress+=step;tempSum+=thermal;
      const weight=Math.max(step,1/c.days)*stage.sink;weightWater+=ks*weight;weights+=weight;
      if(ks<.5){stressDays++;drySpell++;longestDry=Math.max(longestDry,drySpell);}else drySpell=0;
      rainTotal+=rain;runoffTotal+=runoff;drainageTotal+=drainage;irrigationTotal+=irrigation;etTotal+=et;
      const stat=stageStats[stage.index];stat.days++;stat.stressDays+=ks<.5?1:0;stat.rain+=rain;stat.irrigation+=irrigation;stat.et+=et;
      trace.push({day:i+1,stage:stage.name,progress,rootDepth,capacity,storage,rain,runoff,drainage,irrigation,et,ks,newRootWater,survival});
    }
    const ph=p.ph<5.5?clamp((p.ph-3)/2.5):p.ph>7?clamp((10-p.ph)/3):1;
    const potentialDry=c.potential*c.dm;
    const wly=potentialDry*clamp(growth)*ph;
    return {wly,potentialDry,potentialGrowth:clamp(potentialGrowth),maturity:progress,temp:tempSum/p.days,moisture:weightWater/Math.max(weights,1e-9),ph,frost,survival,stressDays,longestDry,
      rain:rainTotal,irrigation:irrigationTotal,runoff:runoffTotal,drainage:drainageTotal,et:etTotal,
      massBalanceError:initialStorage+rootWater+rainTotal+irrigationTotal-runoffTotal-drainageTotal-etTotal-storage,
      trace,stages:stageStats};
  }
  function validateCalibration(pack,p) {
    if(!pack||pack.schema!=='harvest-calibration-v1'||pack.status!=='approved'||pack.validation?.eligibleForReview!==true||pack.engineVersion!==VERSION||pack.parameterVersion!==PARAMETER_VERSION)throw Error('校准包未通过独立验证、未审核或模型版本不匹配');
    if(typeof pack.id!=='string'||!pack.id||pack.scope?.crop!==p.crop||pack.scope?.variety!==(p.variety||'generic'))throw Error('校准包作物/品种不匹配');
    const b=pack.scope.bbox;
    if(!Array.isArray(b)||b.length!==4||!b.every(Number.isFinite)||b[0]<-180||b[2]>180||b[1]<-90||b[3]>90||b[0]>b[2]||b[1]>b[3]||p.lng<b[0]||p.lng>b[2]||p.lat<b[1]||p.lat>b[3])throw Error('当前位置不在校准范围内');
    finite(pack.yieldScale,'校准系数',.5,1.5);
    return pack.yieldScale;
  }
  function evaluateEnsemble(input,seasons,options={}) {
    const p=normalize(input),c=crops[p.crop];
    if(!Array.isArray(seasons)||!seasons.length||seasons.length>30)throw Error('需要1–30个天气情景');
    if(new Set(seasons.map(s=>s.year)).size!==seasons.length)throw Error('天气情景年份重复');
    const calibrationScale=options.calibration?validateCalibration(options.calibration,p):1;
    const simulations=seasons.map(s=>({year:s.year,...simulateSeason(p,s.daily)}));
    const maxRate=Math.min(p.maxRate,p.budget/p.fertPrice),rates=[];
    for(let r=0;r<=maxRate+1e-9;r++)rates.push(r);
    if(maxRate-rates[rates.length-1]>1e-6)rates.push(maxRate);
    const nutrients=rate=>p.fertilizer.map((v,i)=>rate*15*v/100*[1,.4364,.8301][i]*c.rf[i]);
    function candidate(rate) {
      const rec=nutrients(rate+p.existingRate),cost=rate*p.fertPrice;
      const years=simulations.map(s=>{
        const rawFresh=quefts([p.n,p.p,p.k],rec,s.wly,c)/c.dm/15;
        const fresh=Math.min(rawFresh*calibrationScale,s.wly/c.dm/15);
        const saleable=fresh*p.marketable,net=saleable*p.price-p.base-cost-fresh*p.harvestCost;
        return {year:s.year,fresh,rawFresh,saleable,net};
      });
      const yields=years.map(y=>y.fresh),nets=years.map(y=>y.net),fresh=mean(yields),net=mean(nets);
      return {rate,cost,fresh,saleable:mean(years.map(y=>y.saleable)),low:quantile(yields,.1),high:quantile(yields,.9),median:quantile(yields,.5),net,netLow:quantile(nets,.1),netHigh:quantile(nets,.9),lossShare:nets.filter(n=>n<0).length/nets.length,
        breakEvenPrice: fresh*p.marketable>0?(p.base+cost+fresh*p.harvestCost)/(fresh*p.marketable):null,
        objective:p.risk==='cautious'?quantile(nets,.1):net,years};
    }
    const candidates=rates.map(candidate),best=candidates.reduce((a,b)=>b.objective>a.objective+1e-8?b:a);
    const baseline=candidates[0],middle=candidates[Math.floor((candidates.length-1)/2)];
    const avg=k=>mean(simulations.map(s=>s[k]));
    const nutrientRatio=mean(simulations.map((s,i)=>s.wly>0?best.years[i].fresh/(s.wly/c.dm/15):0));
    const climateScore=Math.round(100*Math.min(avg('temp'),avg('moisture'),avg('maturity'),avg('survival')));
    const score=Math.round(Math.min(climateScore,avg('ph')*100,nutrientRatio*100));
    const factors=[{name:'温度与成熟',value:Math.min(avg('temp'),avg('maturity')),detail:`平均成熟进度 ${Math.round(avg('maturity')*100)}%`},
      {name:'逐日水分',value:avg('moisture'),detail:`平均缺水 ${Math.round(avg('stressDays'))} 天 · 补灌 ${Math.round(avg('irrigation'))} mm`},
      {name:'霜冻与低温',value:avg('survival'),detail:`${simulations.filter(s=>s.frost>0).length}/${simulations.length} 个情景出现霜冻`},
      {name:'养分与土壤',value:Math.min(avg('ph'),nutrientRatio),detail:'受供应估计、pH和Beta作物参数影响'}];
    return {version:VERSION,parameterVersion:PARAMETER_VERSION,status:'beta',yieldAvailable:true,calibrationId:options.calibration?.id||null,crop:c.name,score,climateScore,nutrientRatio,factors,frost:avg('frost'),wly:avg('wly'),best,
      rows:[{...baseline,name:'不新增肥料'},{...middle,name:'中档投入'},{...best,name:'候选较优'}],candidates,
      count:seasons.length,yearRange:seasons.map(s=>s.year),rangeMeaning:seasons.length>1?'历史天气情景P10–P90，非预测置信区间':'单一情景，不提供统计区间',
      diagnostics:{maturity:avg('maturity'),stressDays:avg('stressDays'),irrigation:avg('irrigation'),maxMassBalanceError:Math.max(...simulations.map(s=>Math.abs(s.massBalanceError)))},
      simulations,assumptions:[c.parameterSource,'水分依据FAO-56简化单作物系数；土壤质地/初始水量默认是假设','生长、低温损伤与产量上限待地区标定；非完整LINTUL','土壤化验浓度不等于整季作物可吸收供应','天气区间不包含全部参数误差、病虫害和市场风险']};
  }
  function evaluateClimate(input,seasons) {
    if(!Array.isArray(seasons)||!seasons.length||seasons.length>30||new Set(seasons.map(s=>s.year)).size!==seasons.length)throw Error('天气情景无效');
    const p=normalize(input),simulations=seasons.map(s=>({year:s.year,...simulateSeason(p,s.daily)})),avg=k=>mean(simulations.map(s=>s[k]));
    return {version:VERSION,parameterVersion:PARAMETER_VERSION,status:'beta',yieldAvailable:false,crop:crops[p.crop].name,count:seasons.length,yearRange:seasons.map(s=>s.year),
      climateScore:Math.round(100*Math.min(avg('temp'),avg('moisture'),avg('maturity'),avg('survival'))),
      diagnostics:{maturity:avg('maturity'),stressDays:avg('stressDays'),irrigation:avg('irrigation')},simulations,
      factors:[{name:'温度与成熟',value:Math.min(avg('temp'),avg('maturity')),detail:`平均成熟进度 ${Math.round(avg('maturity')*100)}%`},
      {name:'逐日水分',value:avg('moisture'),detail:`平均缺水 ${Math.round(avg('stressDays'))} 天`},
      {name:'霜冻与低温',value:avg('survival'),detail:`${simulations.filter(s=>s.frost).length}/${seasons.length} 个情景有霜冻`}],
      assumptions:['缺少养分供应，暂不计算产量或施肥收益','土壤持水参数和作物生长参数均为Beta假设']};
  }
  function evaluate(p,daily,options={}) {return evaluateEnsemble(p,[{year:Number(p.date.slice(0,4)),daily}],options);}
  function soilSupply(data, fractions) {
    const f=data?.fields;
    if(!data?.ok||!f||!Array.isArray(data.depthCm)||data.depthCm.length!==2) throw Error('国内土壤数据尚未就绪');
    const depth=(data.depthCm[1]-data.depthCm[0])/100, bd=f.bulkDensity?.value;
    if(!Number.isFinite(depth)||depth<=0||depth>2||!Number.isFinite(bd)||bd<=0||bd>3) throw Error('土层或容重数据无效');
    if(!Array.isArray(fractions)||fractions.length!==3||fractions.some(x=>!Number.isFinite(x)||x<0||x>1)) throw Error('养分利用比例须在0–1之间');
    const names=['availableN','availableP','availableK'];
    const supply=names.map((key,i)=>{
      const v=f[key];
      if(v?.unit!=='mg/kg'||!Number.isFinite(v.value)||v.value<0) throw Error('土壤养分单位或数值无效');
      return v.value*bd*depth*10*fractions[i];
    });
    if(!Number.isFinite(f.ph?.value)) throw Error('pH 数据缺失');
    return {n:supply[0],p:supply[1],k:supply[2],ph:f.ph.value,depthCm:data.depthCm,fractions};
  }
  const api={VERSION,PARAMETER_VERSION,crops,textures,quefts,validate,normalize,climate,evaluate,evaluateEnsemble,evaluateClimate,simulateSeason,soilSupply,quantile,historicalSeasons,seasonDates,extractSeasons,validateCalibration};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  else root.HarvestModel=api;
})(typeof window!=='undefined'?window:globalThis);
