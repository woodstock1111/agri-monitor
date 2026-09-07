/* QUEFTS core adapted from IITA-AKILIMO/akilimo-recommendations R/quefts.R.
 * Copyright (c) 2024 Akilimo Project. MIT; see THIRD_PARTY_NOTICES.md.
 * Climate and economic scenario layers are uncalibrated demo assumptions. */
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
    const ranges={lat:[-90,90],lng:[-180,180],area:[.01,100000],days:[60,365],ph:[3,10],n:[0,500],p:[0,500],k:[0,1000],budget:[0,100000],price:[0,100],base:[0,100000],fertPrice:[.01,1000]};
    for(const [key,[lo,hi]] of Object.entries(ranges)) if(!Number.isFinite(p[key])||p[key]<lo||p[key]>hi) throw Error('请检查输入：'+key+' 必须在 '+lo+'–'+hi+' 之间');
    if(!Number.isInteger(p.days)||!crops[p.crop]||!['good','poor'].includes(p.drainage)||!['rain','irrigated'].includes(p.water)||!['cautious','balanced'].includes(p.risk)) throw Error('作物或管理选项无效');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!Number.isFinite(Date.parse(p.date))||new Date(p.date).toISOString().slice(0,10)!==p.date) throw Error('请选择有效播种日期');
    return p;
  }
  function climate(daily, days) {
    const keys=['temperature_2m_mean','temperature_2m_min','precipitation_sum','et0_fao_evapotranspiration'];
    if(!daily || keys.some(k=>!Array.isArray(daily[k])||daily[k].length!==days||daily[k].some(v=>typeof v!=='number'||!Number.isFinite(v)))) throw Error('气象数据缺失，无法评估。可切换示例模式重试。');
    if (daily.precipitation_sum.some(x=>x<0)||daily.et0_fao_evapotranspiration.some(x=>x<0)) throw Error('气象水量数据无效');
    return daily;
  }
  function evaluate(p, daily) {
    validate(p); climate(daily,p.days);
    const c=crops[p.crop], [t0,t1,t2,t3]=c.temp;
    const temp=daily.temperature_2m_mean.reduce((a,t)=>a+(t<t1?clamp((t-t0)/(t1-t0)):t>t2?clamp((t3-t)/(t3-t2)):1),0)/p.days;
    const frost=daily.temperature_2m_min.filter(t=>t<=0).length;
    const rain=daily.precipitation_sum.reduce((a,b)=>a+b,0), et=daily.et0_fao_evapotranspiration.reduce((a,b)=>a+b,0);
    const moisture=p.water==='irrigated'?1:clamp(rain*.75/Math.max(et*.85,1));
    const soilPH=p.ph<5.5?clamp((p.ph-3)/2.5):p.ph>7?clamp((10-p.ph)/3):1;
    const drain=p.drainage==='poor'?.55:1;
    const factors=[{name:'生育期温度',value:temp,detail:`同期情景均温 ${(daily.temperature_2m_mean.reduce((a,b)=>a+b,0)/p.days).toFixed(1)} °C`},
      {name:'霜冻风险',value:frost?clamp(1-frost/8):1,detail:`最低温 ≤ 0°C：${frost} 天`},
      {name:'水分供给',value:moisture,detail:`累计降雨 ${Math.round(rain)} mm · ET₀ ${Math.round(et)} mm${p.water==='irrigated'?' · 假设灌溉补足':''}`},
      {name:'土壤条件',value:soilPH*drain,detail:`${p.soilOrigin==='china'?'背景':'假设'} pH ${p.ph} · ${p.drainage==='poor'?'排水较差':'排水良好'}`}];
    const score=Math.round(100*Math.min(...factors.map(f=>f.value)));
    const wly=c.potential*c.dm*temp*moisture*soilPH*drain*(frost?clamp(1-frost/8):1)*Math.min(1,p.days/c.days);
    const spread=p.crop==='sweetpotato'?.4:.3;
    const scenario=rate=> {
      // N-P2O5-K2O 15-15-15; convert oxide labels to elemental P/K, then apply recovery.
      const nutrient=[.15,.15*.4364,.15*.8301].map((v,i)=>rate*15*v*c.rf[i]);
      const fresh=quefts([p.n,p.p,p.k],nutrient,wly,c)/c.dm/15;
      const cost=rate*p.fertPrice, net=fresh*p.price-p.base-cost;
      return {rate,fresh,low:fresh*(1-spread),high:Math.min(c.potential/15,fresh*(1+spread)),cost,net,
        objective:fresh*(p.risk==='cautious'?1-spread:1)*p.price-p.base-cost};
    };
    const candidates=[];
    for(let rate=0;rate<=80;rate+=5) if(rate*p.fertPrice<=p.budget+1e-9) candidates.push(scenario(rate));
    const best=candidates.reduce((a,b)=>b.objective>a.objective+1e-9?b:a);
    const middle=candidates[Math.floor((candidates.length-1)/2)];
    return {score,factors,frost,wly,best,rows:[{...candidates[0],name:'不新增肥料'},{...middle,name:'中档投入'},{...best,name:'候选最优'}],crop:c.name,spread};
  }
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
  const api={crops,quefts,validate,climate,evaluate,soilSupply};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  else root.HarvestModel=api;
})(typeof window!=='undefined'?window:globalThis);
