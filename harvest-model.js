/* QUEFTS core adapted from IITA-AKILIMO/akilimo-recommendations R/quefts.R.
 * Copyright (c) 2024 Akilimo Project. MIT; see THIRD_PARTY_NOTICES.md.
 * Beta 4: simplified LINTUL-style light-use growth + FAO-56 water balance with limited drainage and ponding.
 * Not a full LINTUL implementation; every parameter carries provenance in PARAMETERS. */
(function(root) {
  'use strict';
  const clamp = (x, a=0, b=1) => Math.max(a, Math.min(b, x));
  const VERSION = 'harvest-beta-4.0.0';
  const PARAMETER_VERSION = 'tubers-beta-2026-09-28';
  const SRC = {
    ecocrop:'FAO EcoCrop, Ipomoea batatas (cropView id=1265)：“May be damaged below 10°C… below 1°C brief / 3°C longer”',
    cip:'CIP 2013《Everything You Ever Wanted to Know about Sweetpotato》Vol.4 Topic 6 pp.147–148',
    fao56:'FAO-56（Allen et al. 1998）',
    lintul:'LINTUL-2（WUR）模型结构/通用默认值，非该作物实测',
    akilimo:'AKILIMO QUEFTS（IITA）',
    aquacrop:'AquaCrop 排水系数关系 τ=0.0866·Ksat^0.35',
    cassavaLit:'木薯生理综述常用范围（Alves 2002 等），本轮未逐条核对原文',
    beta:'本项目Beta假设，无地区/品种实测'
  };
  // confidence: 文献/手册 = 有公开出处但未在当地标定；通用默认 = 通用作物模型取值；假设 = 工程假设，待验证。
  const param = (value, unit, source, confidence, scope, note='') => ({value, unit, source, confidence, scope, note});
  const PARAMETERS = {
    sweetpotato: {
      tGrowth: param([10,20,30,40],'°C 最低/适宜下限/适宜上限/最高（日间逐时温度）',SRC.cip+'；10℃下限为待验证参考',
        '文献/手册','光合生长，全生育期','CIP：适宜20–25℃，15–35℃可生长，日温25–30℃块根产量最高；40℃上限为假设'),
      tBaseDev: param(10,'°C','同上下限','假设','发育积温'),
      thermalTarget: param(2400,'°C·d（基温10℃）',SRC.beta,'假设','计划收获参考积温','约等于26℃下150天'),
      tChill: param(10,'°C 日最低气温',SRC.ecocrop,'文献/手册','冷害风险阈值'),
      chillLeafLoss: param(.02,'1/(°C·d) 叶片额外死亡率',SRC.beta,'假设','冷害损伤，建立期×1.5','系数无实测依据'),
      frostTmin: param(0,'°C 日最低气温（2m）','风险指标阈值；EcoCrop: 1℃短时即很敏感','文献/手册','冻害风险','2m气温≤0℃不能证明地块实际结霜'),
      frostLeafDamage: param([.3,.2,.9],'叶片损失 = min(c, a + b×(0−Tmin))',SRC.beta,'假设','冻害：叶片受损','一次≤0℃只损伤叶片，不等于整株死亡'),
      plantDeath: param({hardFreeze:-2,coldMean:3,coldDays:3},'日最低≤hardFreeze℃，或日均温≤coldMean℃连续coldDays天',SRC.ecocrop+'；具体阈值为假设','假设','冻害：植株死亡','待确认；死亡后停止生长'),
      establishment: param({days:21,minMean:[15,18]},'建立期天数 / 日均温下限区间℃（低于区间=不支持，区间内=边缘）',SRC.cip+'：15–35℃可生长','假设','成活','区间待品种确认'),
      warmWindow: param({tMean:15,minDays:[90,120]},'日均温≥tMean℃的最长连续天数下限区间','CIP：早熟品种3–4.5个月可收，一般需4–5个月','文献/手册','连续适温窗口','品种未确认时用区间'),
      harvestable: param({minThermal:[1350,1800],minDays:[90,120]},'收获时有效积温（基温10℃，°C·d）/ 生育天数下限区间','由CIP 3–4.5个月生育期 × 约15°C·d/日推算','假设','可收获条件','待品种确认；不是“有块根就算可收”'),
      undergroundCold: param({chillRun:7,frost:1},'膨大期日最低<冷害阈值的连续天数 / 膨大期≤0℃天数','EcoCrop 低温敏感；块根受损与可销售比例未建模','假设','地下部低温风险','触发即限制推荐结论'),
      tHeat: param(35,'°C 日最高气温',SRC.cip,'文献/手册','高温暴露指标','只统计暴露，不额外扣产；高温对光合的影响已在连续温度响应中体现'),
      rue: param(2.0,'g 干物质 / MJ 截获PAR',SRC.beta+'；低于LINTUL马铃薯常用值','假设','全生育期'),
      k: param(.6,'—（消光系数）',SRC.beta,'假设','冠层'),
      sla: param(.02,'m² 叶 / g 叶干重',SRC.beta,'假设','冠层'),
      lai0: param(.01,'m²/m²（移栽时）',SRC.beta,'假设','建立期'),
      rgrl: param(.012,'1/(°C·d)',SRC.lintul,'通用默认','幼苗期叶面积指数增长'),
      rdrAge: param([[0,0],[.6,0],[1,.02],[1.6,.04]],'积温进度 → 1/d',SRC.beta,'假设','叶片衰老'),
      partition: param([[0,.6,.4,0],[.13,.55,.35,.1],[.3,.3,.2,.5],[.6,.15,.1,.75],[1,.08,.07,.85]],'积温进度 → 叶/茎蔓/块根 分配',
        SRC.beta+'；CIP：块根分化通常4–6周，8–12周后主要供块根膨大','假设','干物质分配'),
      rootPartition: param([[0,.3],[.3,.15],[.6,.05],[1,.03]],'积温进度 → 纤维根分配比例（其余再分给叶/茎蔓/块根）',SRC.lintul+'（先分根、再分地上部的结构）；数值为假设','假设','干物质分配'),
      dm: param(.25,'kg 干 / kg 鲜（块根）',SRC.beta,'假设','鲜重换算'),
      kc: param([.5,1.15,.65],'初/中/末',SRC.fao56,'文献/手册','作物系数'),
      stages: param([20/150,50/150,110/150,1],'积温进度分界',SRC.fao56+' 阶段比例','文献/手册','阶段'),
      rootDepth: param(1,'m',SRC.fao56+' 表列范围','文献/手册','有效根深'),
      depletion: param(.65,'—',SRC.fao56,'文献/手册','允许耗水比例'),
      ph: param([3,5.5,7,10],'pH 零/适宜下限/适宜上限/零','CIP：适宜约5.6–6.6；两侧线性下降为假设','假设','土壤酸碱度'),
      waterlog: param({anoxic:.5,lag:1,tau:2,kwMin:.2,rotLag:3,rotRate:.02},'饱和度阈值/滞后d/时间常数d/最低系数/烂薯滞后d/烂薯日比例',
        'CIP：长期过湿缺氧导致块根问题，宜高垄排水；数值为假设','假设','过湿缺氧'),
      plausibleFresh: param(80000,'kg/ha 鲜重','EcoCrop记载最高产量量级','文献/手册','合理性检查（只提示不截断）'),
      queftsAD: param({a:[40,96,30],d:[80,272,85]},'kg 块根干物质 / kg 吸收的 N、P、K（a=最大富集，d=最大稀释）',
        'Kumar et al. 2016, Commun. Soil Sci. Plant Anal. 47:1599（印度多点试验）；原文未能访问，按干重口径使用——换算为鲜重后与EcoCrop带走量一致','文献/手册','QUEFTS 养分限制','非中国品种/地区标定'),
      fertilizerCaps: param({npk:100,urea:10,sop:30},'kg/亩 上限：复合肥15-15-15 / 尿素 / 硫酸钾',
        '广西农业农村厅农技知识库常见用量（复合肥50–75、硫酸钾10–15 kg/亩；红薯忌氮过量、忌氯）的约1.3–2倍','假设','推荐施肥量上限','超过上限不再推荐，即使模型显示更赚钱'),
      removal: param([4,1,7],'kg N / P / K 每吨鲜薯',SRC.ecocrop.split('：')[0]+'：“1 ton of roots remove 4 kg N, 1 kg P and 7 kg K”','文献/手册','施肥需求粗估')
    },
    cassava: {
      tGrowth: param([12,25,32,40],'°C 最低/适宜下限/适宜上限/最高（日间逐时温度）',SRC.cassavaLit,'假设','光合生长'),
      tBaseDev: param(12,'°C',SRC.cassavaLit,'假设','发育积温'),
      thermalTarget: param(4500,'°C·d（基温12℃）',SRC.beta,'假设','参考积温（木薯无固定成熟终点）'),
      tChill: param(10,'°C 日最低气温',SRC.cassavaLit,'假设','冷害风险阈值'),
      chillLeafLoss: param(.02,'1/(°C·d)',SRC.beta,'假设','冷害损伤'),
      frostTmin: param(0,'°C 日最低气温（2m）','风险指标阈值','假设','冻害风险','2m气温≤0℃不能证明地块实际结霜'),
      frostLeafDamage: param([.3,.2,.9],'叶片损失 = min(c, a + b×(0−Tmin))',SRC.beta,'假设','冻害：叶片受损','一次≤0℃只损伤叶片，不等于整株死亡'),
      plantDeath: param({hardFreeze:-2,coldMean:5,coldDays:5},'日最低≤hardFreeze℃，或日均温≤coldMean℃连续coldDays天',SRC.cassavaLit,'假设','冻害：植株死亡','待确认'),
      establishment: param({days:30,minMean:[16,20]},'建立期天数 / 日均温下限区间℃',SRC.cassavaLit,'假设','插条成活','待品种确认'),
      warmWindow: param({tMean:16,minDays:[180,240]},'日均温≥tMean℃的最长连续天数下限区间',SRC.cassavaLit+'：商品木薯一般种植6–12个月','假设','连续适温窗口','待品种确认'),
      harvestable: param({minThermal:[2200,3000],minDays:[180,240]},'收获时有效积温（基温12℃）/ 生育天数下限区间','木薯无固定成熟终点，但需足够生长期形成商品块根；数值为假设','假设','可收获条件','待品种确认'),
      undergroundCold: param({chillRun:10,frost:1},'膨大期日最低<冷害阈值的连续天数 / 膨大期≤0℃天数',SRC.beta,'假设','地下部低温风险','触发即限制推荐结论'),
      tHeat: param(38,'°C 日最高气温',SRC.cassavaLit,'假设','高温暴露指标','只统计暴露，不额外扣产'),
      rue: param(1.8,'g 干物质 / MJ 截获PAR',SRC.beta,'假设','全生育期'),
      k: param(.7,'—',SRC.beta,'假设','冠层'),
      sla: param(.018,'m²/g',SRC.beta,'假设','冠层'),
      lai0: param(.01,'m²/m²',SRC.beta,'假设','建立期'),
      rgrl: param(.01,'1/(°C·d)',SRC.lintul,'通用默认','幼苗期叶面积指数增长'),
      rdrAge: param([[0,0],[.25,.012],[3,.012]],'积温进度 → 1/d',SRC.beta,'假设','叶片持续更替'),
      partition: param([[0,.55,.45,0],[.1,.5,.4,.1],[.29,.3,.3,.4],[.5,.2,.25,.55],[1,.18,.22,.6]],'积温进度 → 叶/茎/块根 分配',
        'DSSAT MANIHOT：木薯为无限生长、无固定成熟终点；数值为假设','假设','干物质分配'),
      rootPartition: param([[0,.3],[.3,.1],[.6,.05]],'积温进度 → 纤维根分配比例',SRC.lintul+'（结构）；数值为假设','假设','干物质分配'),
      dm: param(.35,'kg 干 / kg 鲜',SRC.beta,'假设','鲜重换算'),
      kc: param([.3,.8,.3],'初/中/末（第一年）',SRC.fao56,'文献/手册','作物系数'),
      stages: param([20/210,60/210,150/210,1],'积温进度分界',SRC.fao56+' 阶段比例','文献/手册','阶段'),
      rootDepth: param(.6,'m',SRC.fao56+' 表列范围','文献/手册','有效根深'),
      depletion: param(.35,'—',SRC.fao56,'文献/手册','允许耗水比例'),
      ph: param([3,5,7.5,10],'pH 零/适宜下限/适宜上限/零','木薯耐酸性较强；具体数值为假设','假设','土壤酸碱度'),
      waterlog: param({anoxic:.5,lag:1,tau:2,kwMin:.2,rotLag:3,rotRate:.02},'同红薯',SRC.beta,'假设','过湿缺氧'),
      plausibleFresh: param(90000,'kg/ha 鲜重',SRC.beta,'假设','合理性检查（只提示不截断）'),
      fertilizerCaps: param({npk:80,urea:35,mop:25},'kg/亩 上限：复合肥15-15-15 / 尿素 / 氯化钾',
        '广西农业农村厅《木薯栽培技术》常见用量（尿素约25、复合肥约60、氯化钾约15 kg/亩）的约1.3–1.7倍','假设','推荐施肥量上限','超过上限不再推荐，即使模型显示更赚钱'),
      removal: param([3.5,.75,6.2],'kg N / P / K 每吨鲜薯','广西农业农村厅《木薯栽培技术》：“每生产一吨木薯鲜薯，约需从土壤吸收3.5公斤氮、0.75公斤磷、6.2公斤钾”','文献/手册','施肥需求粗估')
    },
    shared: {
      parFraction: param(.5,'PAR / 短波辐射',SRC.lintul,'通用默认','辐射换算'),
      clearSky: param(.75,'Rso/Ra（未计海拔）',SRC.fao56+' 式37','文献/手册','晴空辐射参考'),
      laiCritical: param(4,'m²/m²',SRC.lintul,'通用默认','遮荫衰老'),
      rdrShade: param(.03,'1/d',SRC.lintul,'通用默认','遮荫衰老'),
      diurnal: param('余弦曲线，最高温15时','—',SRC.beta,'假设','由日最高/最低温估计逐时温度'),
      feasibilityPolicy: param({notRecommendedShare:.3,marginalShare:.3,minSeasons:3},'年份比例阈值 / 最少完整生长季',SRC.beta,'假设','可行性汇总',
        '≥30%年份未满足→不建议；任一年未满足、≥30%年份边缘或有未建模的严重低温风险→有明显风险')
    }
  };
  const V = (crop,k) => PARAMETERS[crop][k].value;
  const crops = {
    sweetpotato: { id:'sweetpotato', name:'红薯', days:150, hi:.5, dm:V('sweetpotato','dm'),
      concentrations:[[2.5,.9,3.2,1.4],[.6,.1,1,.13],[4.6,1.1,4.6,.85]], rf:[.41,.25,.65],
      parameterSource:'红薯养分参数取 Kumar 等 2016（印度）QUEFTS 标定值；生长参数见参数表，均未做地区标定' },
    cassava: { id:'cassava', name:'木薯', days:300, hi:.52, dm:V('cassava','dm'),
      concentrations:[[6.6,2.5,17.9,7.9],[1.5,.8,2.8,.9],[11,2.8,18.8,3.4]], rf:[.5,.21,.49],
      parameterSource:'AKILIMO / Ezui 木薯养分参数；生长参数见参数表，均未做地区标定' }
  };
  for(const [id,c] of Object.entries(crops)) {
    const v=k=>V(id,k);
    Object.assign(c,{status:'beta',parameterVersion:PARAMETER_VERSION,rootDepth:v('rootDepth'),depletion:v('depletion'),kc:v('kc'),stages:v('stages'),
      tGrowth:v('tGrowth'),tBaseDev:v('tBaseDev'),thermalTarget:v('thermalTarget'),tChill:v('tChill'),chillLeafLoss:v('chillLeafLoss'),
      frostTmin:v('frostTmin'),frostLeafDamage:v('frostLeafDamage'),plantDeath:v('plantDeath'),establishment:v('establishment'),warmWindow:v('warmWindow'),harvestable:v('harvestable'),undergroundCold:v('undergroundCold'),tHeat:v('tHeat'),rue:v('rue'),k:v('k'),sla:v('sla'),lai0:v('lai0'),rgrl:v('rgrl'),
      rdrAge:v('rdrAge'),partition:v('partition'),rootPartition:v('rootPartition'),ph:v('ph'),waterlog:v('waterlog'),plausibleFresh:v('plausibleFresh'),fertilizerCaps:v('fertilizerCaps'),queftsAD:PARAMETERS[id].queftsAD?.value??null,removal:PARAMETERS[id].removal?.value??null,
      stageNames:id==='cassava'?['建立期','冠层生长期','块根膨大期','后期（持续生长）']:['建立期','藤蔓生长与块根形成期','块根膨大期','后期膨大与衰老期']});
  }
  // Soil hydraulics per texture. FC/WP kept from Beta 3; SAT/Ksat are texture-class assumptions (AquaCrop-style classes).
  const textures = {
    sandy:{name:'砂质土（假设）',fc:.15,wp:.06,sat:.40,ksat:1200},
    loam:{name:'壤土（假设）',fc:.28,wp:.12,sat:.46,ksat:300},
    clay:{name:'黏质土（假设）',fc:.36,wp:.22,sat:.50,ksat:60}
  };
  for(const t of Object.values(textures)) t.tau=clamp(.0866*t.ksat**.35);
  // Field-level drainage scenarios (outlet capacity, surface storage before spill, share of ponded water removed by ditches per day). All assumptions.
  const drainages = {
    good:{name:'排水良好（高垄、沟渠通畅）',cap:60,pondMax:5,surfaceOut:.9},
    moderate:{name:'排水一般',cap:15,pondMax:15,surfaceOut:.4},
    poor:{name:'排水较差 / 易积水',cap:3,pondMax:40,surfaceOut:.1}
  };
  function freeze(o) {Object.values(o).forEach(v=>{if(v&&typeof v==='object')freeze(v);});return Object.freeze(o);}
  freeze(PARAMETERS); freeze(crops); freeze(textures); freeze(drainages);

  function quefts(soil, recovered, wly, crop=crops.cassava) {
    if(!Array.isArray(soil)||soil.length!==3||!Array.isArray(recovered)||recovered.length!==3)throw Error('需要N/P/K三项供应量');
    if (![...soil,...recovered,wly].every(Number.isFinite) || [...soil,...recovered,wly].some(x=>x<0)) throw Error('养分和产量上限必须是非负数');
    if (!wly) return 0;
    // Crop-specific a/d when published directly (sweet potato); otherwise derived from plant concentrations (AKILIMO cassava).
    const a=crop.queftsAD?crop.queftsAD.a:crop.concentrations.map(c=>Math.round(1000*crop.hi/(crop.hi*c[0]+(1-crop.hi)*c[2])));
    const d=crop.queftsAD?crop.queftsAD.d:crop.concentrations.map(c=>Math.round(1000*crop.hi/(crop.hi*c[1]+(1-crop.hi)*c[3])));
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
  const DRAINAGE_OPTIONS=['good','moderate','poor','unknown'];
  function validate(p) {
    const ranges={lat:[-90,90],lng:[-180,180],area:[.01,100000],days:[60,365],ph:[3,10],n:[0,500],p:[0,500],k:[0,1000],budget:[0,100000000],price:[0,1000000],base:[0,100000000],fertPrice:[.0001,1000000]};
    for(const [key,[lo,hi]] of Object.entries(ranges)) if(!Number.isFinite(p[key])||p[key]<lo||p[key]>hi) throw Error('请检查输入：'+key+' 必须在 '+lo+'–'+hi+' 之间');
    if(!Number.isInteger(p.days)||!crops[p.crop]||!DRAINAGE_OPTIONS.includes(p.drainage)||!['rain','irrigated','sufficient'].includes(p.water)||!['cautious','balanced'].includes(p.risk)) throw Error('作物或管理选项无效');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!Number.isFinite(Date.parse(p.date))||new Date(p.date).toISOString().slice(0,10)!==p.date) throw Error('请选择有效播种日期');
    return p;
  }
  const REQUIRED=['temperature_2m_mean','temperature_2m_min','precipitation_sum','et0_fao_evapotranspiration'];
  const OPTIONAL=['temperature_2m_max','shortwave_radiation_sum'];
  // Validates units and relations. Optional series may be absent, but a present series must be complete: no silent filling.
  function climate(daily, days) {
    const complete=k=>Array.isArray(daily[k])&&daily[k].length===days&&daily[k].every(v=>typeof v==='number'&&Number.isFinite(v));
    if(!daily || REQUIRED.some(k=>!complete(k))) throw Error('气象数据缺失，无法评估。可切换示例模式重试。');
    for(const k of OPTIONAL) if(daily[k]!==undefined&&daily[k]!==null&&!complete(k)) throw Error(k==='shortwave_radiation_sum'?'短波辐射有缺测，不能按理想光照补齐':'最高气温有缺测');
    if (daily.precipitation_sum.some(x=>x<0)||daily.et0_fao_evapotranspiration.some(x=>x<0||x>20)) throw Error('气象水量数据无效');
    const tol=.3,max=daily.temperature_2m_max;
    if(daily.temperature_2m_mean.some((v,i)=>v < -90 || v > 65 || daily.temperature_2m_min[i] > v+tol || daily.temperature_2m_min[i] < -100 || (max&&(max[i]<v-tol||max[i]>70)))) throw Error('气温范围或最高最低关系无效');
    if(daily.shortwave_radiation_sum&&daily.shortwave_radiation_sum.some(x=>x<0||x>45)) throw Error('短波辐射超出 0–45 MJ/m²/日，请检查单位');
    return daily;
  }
  const mean = a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:NaN;
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
    const p={texture:'loam',initialWater:.6,rootDepth:crops[input.crop]?.rootDepth||1,drainage:'unknown',
      irrigationLimit:300,irrigationDailyMax:15,marketable:.85,harvestCost:0,irrigationPrice:null,irrigationPriceOrigin:'user',irrigationInBase:false,
      existingRate:0,maxRate:80,fertilizer:[15,15,15],variety:'generic',currency:'CNY',...input};
    validate(p);
    for(const [k,lo,hi] of [['initialWater',0,1],['rootDepth',.15,2],['irrigationLimit',0,3000],['irrigationDailyMax',0,100],['marketable',0,1],['harvestCost',0,100],['existingRate',0,300],['maxRate',0,300]]) finite(p[k],k,lo,hi);
    if(p.irrigationPrice!==null)finite(p.irrigationPrice,'灌溉单价',0,1000);
    if(!['user','example'].includes(p.irrigationPriceOrigin))throw Error('灌溉单价来源无效');
    if(typeof p.irrigationInBase!=='boolean')throw Error('“基础成本是否已含灌溉费”选项无效');
    if(!textures[p.texture])throw Error('请选择有效的土壤质地');
    if(!Array.isArray(p.fertilizer)||p.fertilizer.length!==3)throw Error('肥料配方需要N、P₂O₅、K₂O三项');
    p.fertilizer.forEach(v=>finite(v,'肥料百分比',0,100));
    if(p.fertilizer.reduce((a,b)=>a+b,0)>100)throw Error('肥料配方总百分比不能超过100');
    if(typeof p.variety!=='string'||p.variety.length>80||!['CNY','USD','THB','VND','IDR','NGN','KES','TZS','GHS'].includes(p.currency))throw Error('品种或币种无效');
    if(p.fieldCapacity!==undefined||p.wiltingPoint!==undefined) {
      finite(p.fieldCapacity,'田间持水量',.01,.7); finite(p.wiltingPoint,'萎蔫点',0,.6);
      if(p.fieldCapacity<=p.wiltingPoint)throw Error('田间持水量必须大于萎蔫点');
    }
    if(p.saturation!==undefined){finite(p.saturation,'饱和含水量',.05,.8);if(p.saturation<=(p.fieldCapacity??textures[p.texture].fc))throw Error('饱和含水量必须大于田间持水量');}
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
  const WEATHER_KEYS=[...REQUIRED,...OPTIONAL];
  // Every season needs all six daily series, aligned by calendar date. Incomplete seasons are excluded with a reason.
  function extractSeasons(daily,seasons,lat) {
    if(!daily||!Array.isArray(daily.time))throw Error('天气缺少日期序列');
    const index=new Map(daily.time.map((d,i)=>[d,i]));
    if(index.size!==daily.time.length)throw Error('天气日期重复');
    const included=[],excluded=[];
    for(const s of seasons) {
      const days=Math.round((Date.parse(s.end)-Date.parse(s.start))/86400000)+1,d={time:[]};WEATHER_KEYS.forEach(k=>d[k]=[]);
      let missingDate=0;
      for(let i=0;i<days;i++) {
        const day=new Date(Date.parse(s.start)+i*86400000).toISOString().slice(0,10),idx=index.get(day);
        if(idx===undefined)missingDate++;
        d.time.push(day);WEATHER_KEYS.forEach(k=>d[k].push(idx===undefined?null:daily[k]?.[idx]??null));
      }
      const missing=WEATHER_KEYS.filter(k=>d[k].some(v=>typeof v!=='number'||!Number.isFinite(v)));
      try{
        if(missingDate)throw Error('缺少 '+missingDate+' 天日期');
        if(missing.length)throw Error('变量缺测：'+missing.join(', '));
        climate(d,days);checkRadiation(d,lat);included.push({...s,daily:d});
      }catch(e){excluded.push({year:s.year,reason:'逐日数据缺失或无效（'+e.message+'）'});}
    }
    if(!included.length)throw Error('没有完整的历史季节数据，不能计算');
    return {included,excluded};
  }
  const dayOfYear=date=>Math.round((Date.parse(date)-Date.parse(date.slice(0,4)+'-01-01'))/86400000)+1;
  // FAO-56 eq. 21: extraterrestrial radiation, MJ m-2 d-1.
  function extraterrestrialRadiation(lat,doy) {
    const phi=lat*Math.PI/180,dr=1+.033*Math.cos(2*Math.PI*doy/365),dec=.409*Math.sin(2*Math.PI*doy/365-1.39);
    const ws=Math.acos(clamp(-Math.tan(phi)*Math.tan(dec),-1,1));
    return Math.max(0,24*60/Math.PI*.082*dr*(ws*Math.sin(phi)*Math.sin(dec)+Math.cos(phi)*Math.cos(dec)*Math.sin(ws)));
  }
  function checkRadiation(daily,lat) {
    if(!Number.isFinite(lat)||!daily.shortwave_radiation_sum||!daily.time)return;
    daily.time.forEach((t,i)=>{if(daily.shortwave_radiation_sum[i]>extraterrestrialRadiation(lat,dayOfYear(t))*1.02+.5)throw Error('短波辐射高于大气顶辐射，疑似单位错误');});
  }
  const interp=(table,x)=>{
    if(x<=table[0][0])return table[0].slice(1);
    for(let i=1;i<table.length;i++)if(x<=table[i][0]){const a=table[i-1],b=table[i],t=(x-a[0])/(b[0]-a[0]),out=new Array(a.length-1);for(let j=1;j<a.length;j++)out[j-1]=a[j]+t*(b[j]-a[j]);return out;}
    return table[table.length-1].slice(1);
  };
  // Continuous trapezoid response: 0 below Tmin, rises to 1 at Topt1, 1 until Topt2, falls to 0 at Tmax.
  function temperatureResponse(t,r) {const t0=r[0],t1=r[1],t2=r[2],t3=r[3];return t<=t0||t>=t3?0:t<t1?(t-t0)/(t1-t0):t<=t2?1:(t3-t)/(t3-t2);}
  const DIURNAL=Array.from({length:24},(_,h)=>Math.cos(2*Math.PI*(h+.5-15)/24));
  // Clear-sky radiation per season day, cached per date list and latitude: control runs reuse the same weather arrays.
  const RSO_CACHE=new WeakMap();
  function clearSkySeries(dates,lat) {
    let byLat=RSO_CACHE.get(dates);if(!byLat){byLat=new Map();RSO_CACHE.set(dates,byLat);}
    let series=byLat.get(lat);
    if(!series){series=dates.map(d=>PARAMETERS.shared.clearSky.value*extraterrestrialRadiation(lat,dayOfYear(d)));byLat.set(lat,series);}
    return series;
  }
  function stageAt(progress,c) {
    let s=c.stages.findIndex(end=>progress<end);if(s<0)s=3;
    const begin=s?c.stages[s-1]:0,t=clamp((progress-begin)/(c.stages[s]-begin));
    const kc=s===0?c.kc[0]:s===1?c.kc[0]+t*(c.kc[1]-c.kc[0]):s===2?c.kc[1]:c.kc[1]+t*(c.kc[2]-c.kc[1]);
    return {index:s,name:c.stageNames[s],kc};
  }
  function phFactor(ph,c) {const [z0,o0,o1,z1]=c.ph;return ph<o0?clamp((ph-z0)/(o0-z0)):ph>o1?clamp((z1-ph)/(z1-o1)):1;}
  /* One season, daily step.
   * Units: radiation MJ m-2 d-1; PAR = 0.5·SW; biomass g DM m-2 (×10 = kg/ha); water mm; LAI m² m-2.
   * options.disable.{temperature,wetness,water}: control runs with that mechanism switched off.
   * options.clearSky: replace radiation with FAO-56 clear-sky Rso (light reference control).
   * options.trace===false: skip the per-day trace (control runs only read season totals).
   * Hot loop: hourly sums are plain loops over a reused buffer, summed in the same order as mean(), so results are unchanged. */
  function simulateSeason(input,daily,options={}) {
    const p=normalize(input);climate(daily,p.days);
    const c=crops[p.crop],soil=textures[p.texture],off=options.disable||{};
    const drain=drainages[options.drainage||(p.drainage==='unknown'?'moderate':p.drainage)];
    const fc=p.fieldCapacity??soil.fc,wp=p.wiltingPoint??soil.wp,sat=p.saturation??Math.max(soil.sat,fc+.02);
    const tawPerM=1000*(fc-wp),excPerM=1000*(sat-fc),initialDepth=Math.min(.15,p.rootDepth);
    const dates=Array.isArray(daily.time)&&daily.time.length===p.days?daily.time:Array.from({length:p.days},(_,i)=>new Date(Date.parse(p.date)+i*86400000).toISOString().slice(0,10));
    const sw=daily.shortwave_radiation_sum,radiationAvailable=Array.isArray(sw)||!!options.clearSky,tmaxEstimated=!Array.isArray(daily.temperature_2m_max);
    const wl=c.waterlog,shared=PARAMETERS.shared;
    let storage=tawPerM*initialDepth*p.initialWater,pond=0,previousDepth=initialDepth;
    const initialStorage=storage,trace=[],stageStats=c.stageNames.map(name=>({name,days:0,stressDays:0,anoxicDays:0,rain:0,irrigation:0,et:0,growth:0}));
    let tsum=0,lai=c.lai0,wlv=c.lai0/c.sla,wlvDead=0,wst=0,wso=0,wrt=0,laiMax=lai,rotLoss=0,wetRun=0;
    let rainTotal=0,runoffTotal=0,drainageTotal=0,irrigationTotal=0,etTotal=0,rootWater=0,stressDays=0,drySpell=0,longestDry=0;
    let alive=true,deathDay=null,coldMeanRun=0,anoxicDays=0,wetSpell=0,longestWet=0,pondDays=0,maxPond=0,chillDays=0,chillDose=0,frostDays=0,heatDays=0,heatHours=0,frostCanopyLoss=0;
    let parSum=0,fTweighted=0,radSum=0,rsoSum=0,growthLimitedByColdDays=0;
    const keepTrace=options.trace!==false,hours=new Float64Array(24),rsoSeries=radiationAvailable?clearSkySeries(dates,p.lat):null;
    const tBaseDev=c.tBaseDev,devSpan=c.tGrowth[2]-c.tBaseDev,tChill=c.tChill,tHeat=c.tHeat;
    for(let i=0;i<p.days;i++) {
      const tmean=daily.temperature_2m_mean[i],tmin=daily.temperature_2m_min[i],rain=daily.precipitation_sum[i],et0=daily.et0_fao_evapotranspiration[i];
      const tmax=tmaxEstimated?Math.max(tmean,2*tmean-tmin):daily.temperature_2m_max[i];
      let dttSum=0,doseSum=0,hot=0,daySum=0,fTSum=0;
      for(let h=0;h<24;h++){
        const v=(tmin+tmax)/2+(tmax-tmin)/2*DIURNAL[h];hours[h]=v;
        dttSum+=clamp(v-tBaseDev,0,devSpan);doseSum+=Math.max(0,tChill-v);if(v>=tHeat)hot++;
      }
      for(let h=6;h<18;h++){daySum+=hours[h];if(!off.temperature)fTSum+=temperatureResponse(hours[h],c.tGrowth);}
      const progress=tsum/c.thermalTarget,stage=stageAt(progress,c);
      // Development: 24-hour mean of degree-hours between base and upper optimum.
      // Temperature control run: development at least as fast as at the middle of the optimum range (not stretched to the plan length).
      const dttActual=dttSum/24;
      const dtt=off.temperature?Math.max(dttActual,(c.tGrowth[1]+c.tGrowth[2])/2-c.tBaseDev):dttActual;
      // --- water balance (mm) ---
      const rootDepth=initialDepth+(p.rootDepth-initialDepth)*clamp(progress/.6);
      const taw=tawPerM*rootDepth,excessCapacity=excPerM*rootDepth;
      const newRootWater=Math.max(0,rootDepth-previousDepth)*tawPerM*p.initialWater;
      storage+=newRootWater;rootWater+=newRootWater;previousDepth=Math.max(previousDepth,rootDepth);
      let surface=pond+rain;
      const infiltration=Math.min(surface,soil.ksat,Math.max(0,taw+excessCapacity-storage));
      storage+=infiltration;surface-=infiltration;
      let runoff=Math.max(0,surface-drain.pondMax);surface-=runoff;
      const ditch=surface*drain.surfaceOut;surface-=ditch;runoff+=ditch;pond=surface;
      const demand=et0*stage.kc,depletion=clamp(c.depletion+.04*(5-demand),.1,.8),threshold=taw*(1-depletion);
      let irrigation=0;
      if(p.irrigation)irrigation=p.irrigation[i];
      else if(pond<=0&&p.water==='sufficient') irrigation=Math.max(0,Math.min(taw,threshold+demand)-storage);
      else if(pond<=0&&p.water==='irrigated'&&storage<threshold) irrigation=Math.max(0,Math.min(taw-storage,p.irrigationDailyMax,p.irrigationLimit-irrigationTotal));
      storage+=irrigation;
      const drainage=Math.min(Math.max(0,storage-taw)*soil.tau,drain.cap);storage-=drainage;
      const pondEvap=Math.min(pond,demand);pond-=pondEvap;
      const ks=off.water?1:clamp(Math.min(storage,taw)/Math.max(threshold,1e-9));
      const soilEt=Math.min(storage,(demand-pondEvap)*ks);storage-=soilEt;
      const et=pondEvap+soilEt;
      // --- wetness: sustained saturation / ponding, not a single-day rain threshold ---
      const excessFraction=excessCapacity>0?clamp((storage-taw)/excessCapacity):0,intensity=pond>0?1:excessFraction;
      const anoxic=intensity>=wl.anoxic;
      wetRun=anoxic?wetRun+1:Math.max(0,wetRun-1);
      const kw=off.wetness?1:1-(1-wl.kwMin)*(1-Math.exp(-Math.max(0,wetRun-wl.lag)/wl.tau));
      if(anoxic){anoxicDays++;wetSpell++;longestWet=Math.max(longestWet,wetSpell);}else wetSpell=0;
      if(pond>0)pondDays++;maxPond=Math.max(maxPond,pond);
      // --- temperature mechanisms (kept separate) ---
      const fT=off.temperature?1:fTSum/12;
      const dose=doseSum/24;
      if(tmin<c.tChill){chillDays++;chillDose+=dose;}
      if(tmin<=c.frostTmin)frostDays++;
      coldMeanRun=tmean<=c.plantDeath.coldMean?coldMeanRun+1:0;
      if(alive&&!off.temperature&&(tmin<=c.plantDeath.hardFreeze||coldMeanRun>=c.plantDeath.coldDays)){alive=false;deathDay=i+1;}
      heatHours+=hot;if(tmax>=c.tHeat)heatDays++;
      if(daySum/12<c.tGrowth[1])growthLimitedByColdDays++;
      // --- growth ---
      let par=null,growth=0;
      if(radiationAvailable&&!alive) {const dlv=wlv;wlv=0;wlvDead+=dlv;lai=0;}
      else if(radiationAvailable) {
        const rso=rsoSeries[i];
        const rad=options.clearSky?rso:sw[i];radSum+=rad;rsoSum+=rso;
        par=shared.parFraction.value*rad;
        const fi=1-Math.exp(-c.k*lai);
        growth=c.rue*par*fi*fT*Math.min(ks,kw);
        parSum+=par;fTweighted+=par*fT;
        const frt=interp(c.rootPartition,progress)[0],shoot=growth*(1-frt),[fl,fs,fo]=interp(c.partition,progress);
        wrt+=growth*frt;wlv+=shoot*fl;wst+=shoot*fs;wso+=shoot*fo;
        const juvenile=progress<.3&&lai<.75;
        const glai=juvenile?lai*(Math.exp(c.rgrl*dtt)-1)*Math.min(ks,kw):c.sla*shoot*fl;
        let rdr=interp(c.rdrAge,progress)[0]+clamp(shared.rdrShade.value*(lai-shared.laiCritical.value)/shared.laiCritical.value,0,shared.rdrShade.value);
        if(!off.temperature&&tmin<c.tChill)rdr+=c.chillLeafLoss*dose*(stage.index===0?1.5:1);
        let kill=0;
        if(!off.temperature&&tmin<=c.frostTmin){const [a,b,cap]=c.frostLeafDamage;kill=Math.min(cap,a+b*(c.frostTmin-tmin));}
        const dead=clamp(rdr);
        const laiBefore=lai;
        lai=Math.max(0,(lai+glai)*(1-dead)*(1-kill));
        const dlv=wlv*(1-(1-dead)*(1-kill));wlv-=dlv;wlvDead+=dlv;
        frostCanopyLoss=Math.max(frostCanopyLoss,kill&&laiBefore>0?kill:0);
        if(!off.wetness&&wetRun>wl.rotLag&&stage.index>=2){const rot=wso*wl.rotRate*intensity;wso-=rot;rotLoss+=rot;}
        laiMax=Math.max(laiMax,lai);
      }
      tsum+=dtt;
      if(ks<.5){stressDays++;drySpell++;longestDry=Math.max(longestDry,drySpell);}else drySpell=0;
      rainTotal+=rain;runoffTotal+=runoff;drainageTotal+=drainage;irrigationTotal+=irrigation;etTotal+=et;
      const stat=stageStats[stage.index];stat.days++;stat.stressDays+=ks<.5?1:0;stat.anoxicDays+=anoxic?1:0;stat.rain+=rain;stat.irrigation+=irrigation;stat.et+=et;stat.growth+=growth;
      if(keepTrace)trace.push({day:i+1,date:dates[i],stage:stage.name,progress,rootDepth,capacity:taw,excessCapacity,storage,pond,rain,runoff,drainage,irrigation,et,ks,kw,anoxic,fT,par,lai,growth,storageRoot:wso,tmean,tmin,alive,newRootWater,available:Math.min(storage,taw),availableFraction:taw>0?Math.min(storage,taw)/taw:0,excess:Math.max(0,storage-taw)});
    }
    const finalProgress=tsum/c.thermalTarget,biomass=radiationAvailable?wlv+wlvDead+wst+wso+wrt:null;
    const t=daily.temperature_2m_mean,tn=daily.temperature_2m_min,tx=daily.temperature_2m_max;
    return {radiationAvailable,tmaxEstimated,drainageScenario:options.drainage||(p.drainage==='unknown'?'moderate':p.drainage),
      weather:{meanT:mean(t),meanTmin:mean(tn),minTmin:Math.min(...tn),meanTmax:tmaxEstimated?null:mean(tx),maxTmax:tmaxEstimated?null:Math.max(...tx),
        radiation:radiationAvailable&&!options.clearSky?radSum:null,meanRadiation:radiationAvailable&&!options.clearSky?radSum/p.days:null,
        clearSkyRatio:radiationAvailable&&!options.clearSky&&rsoSum>0?radSum/rsoSum:null,rain:rainTotal,et0:daily.et0_fao_evapotranspiration.reduce((a,b)=>a+b,0)},
      temperature:{growthIndex:parSum>0?fTweighted/parSum:null,coolDays:growthLimitedByColdDays,chillDays,chillDose,frostRiskDays:frostDays,
        heatDays:tmaxEstimated?null:heatDays,heatHours:tmaxEstimated?null:heatHours,frostCanopyLoss},
      plantDeathDay:deathDay,plantDeathDate:deathDay?dates[deathDay-1]:null,
      minimumTemperature:Math.min(...tn),maturity:finalProgress,progress:finalProgress,stageAtHarvest:stageAt(finalProgress,c).name,
      laiMax:radiationAvailable?laiMax:null,biomass:radiationAvailable?biomass:null,storageDry:radiationAvailable?wso:null,
      storageDryKgHa:radiationAvailable?wso*10:null,wly:radiationAvailable?wso*10*phFactor(p.ph,c):null,biomassKgHa:radiationAvailable?biomass*10:null,
      harvestIndex:radiationAvailable&&biomass>0?wso/biomass:null,rotLossKgHa:radiationAvailable?rotLoss*10:null,
      stressDays,longestDry,anoxicDays,longestWet,pondDays,maxPond,
      rain:rainTotal,irrigation:irrigationTotal,runoff:runoffTotal,drainage:drainageTotal,et:etTotal,pond,storage,
      massBalanceError:initialStorage+rootWater+rainTotal+irrigationTotal-runoffTotal-drainageTotal-etTotal-storage-pond,
      trace,stages:stageStats};
  }
  function validateCalibration(pack,p) {
    if(!pack||pack.schema!=='harvest-calibration-v1'||pack.status!=='approved'||pack.validation?.eligibleForReview!==true||pack.engineVersion!==VERSION||pack.parameterVersion!==PARAMETER_VERSION)throw Error('校准包未通过独立验证、未审核或模型版本不匹配（Beta 4 不接受旧版本校准包）');
    if(typeof pack.id!=='string'||!pack.id||pack.scope?.crop!==p.crop||pack.scope?.variety!==(p.variety||'generic'))throw Error('校准包作物/品种不匹配');
    const b=pack.scope.bbox;
    if(!Array.isArray(b)||b.length!==4||!b.every(Number.isFinite)||b[0]<-180||b[2]>180||b[1]<-90||b[3]>90||b[0]>b[2]||b[1]>b[3]||p.lng<b[0]||p.lng>b[2]||p.lat<b[1]||p.lat>b[3])throw Error('当前位置不在校准范围内');
    finite(pack.yieldScale,'校准系数',.5,1.5);
    return pack.yieldScale;
  }
  // Main run plus single-mechanism control runs for one historical season (kg DM/ha of storage roots).
  function runSeason(p,season) {
    const sim=simulateSeason(p,season.daily),y=o=>simulateSeason(p,season.daily,{...o,trace:false}).storageDryKgHa;
    const controls=sim.radiationAvailable?{
      temperature:y({disable:{temperature:true}}),wetness:y({disable:{wetness:true}}),light:y({clearSky:true}),
      water:p.water==='sufficient'?null:y({disable:{water:true}}),
      climate:y({disable:{temperature:true,wetness:true,water:true}})}:null;
    const scenarios=p.drainage==='unknown'?Object.fromEntries(['good','moderate','poor'].map(d=>{const s=d==='moderate'?sim:simulateSeason(p,season.daily,{drainage:d,trace:false});return [d,{storageDryKgHa:s.storageDryKgHa,anoxicDays:s.anoxicDays,longestWet:s.longestWet,pondDays:s.pondDays}];})):null;
    return {year:season.year,...sim,controls,drainageScenarios:scenarios};
  }
  const statusOf=(score,bands=[85,60])=>score===null?'unknown':score>=bands[0]?'favorable':score>=bands[1]?'moderate':'unfavorable';
  const STATUS_TEXT={favorable:'适宜',moderate:'一般',unfavorable:'不利',unknown:'未知'};
  const ratioScore=(actual,control)=>{const a=mean(actual),b=mean(control);return Number.isFinite(a)&&Number.isFinite(b)&&b>0?Math.round(100*Math.min(1,a/b)):null;};
  const fmt=(x,d=0)=>x===null||!Number.isFinite(x)?'—':x.toFixed(d);
  /* One scoring function for full and climate-only analyses. Scores are model indices (actual / control run), not probabilities
   * nor measured losses. Soil factors are null when not supplied. */
  function assess(p,runs,soil={}) {
    const c=crops[p.crop],hasRad=runs.every(r=>r.radiationAvailable),n=runs.length;
    const actual=runs.map(r=>r.storageDryKgHa),ctl=k=>hasRad?runs.map(r=>r.controls[k]):[];
    const avg=f=>mean(runs.map(f)),factor=(o)=>({...o,statusText:STATUS_TEXT[o.status]});
    const tScore=hasRad?ratioScore(actual,ctl('temperature')):null;
    const chill=avg(r=>r.temperature.chillDays),frost=runs.filter(r=>r.temperature.frostRiskDays>0).length,heat=runs.some(r=>r.temperature.heatDays===null)?null:avg(r=>r.temperature.heatDays);
    const risks=[];
    if(chill>0)risks.push({id:'chill',level:chill>=10?'high':'watch',text:`日最低气温低于${c.tChill}℃：平均每季 ${fmt(chill)} 天（冷害风险，不等于霜冻）`});
    risks.push(frost?{id:'frost-risk',level:'high',text:`${frost}/${n} 个年份出现日最低气温≤${c.frostTmin}℃：冻害/霜冻风险提示；2m气温不能证明地块实际结霜`}
      :{id:'frost-risk',level:'none',text:`所选年份日最低气温未低于或等于${c.frostTmin}℃，未触发冻害风险提示`});
    if(heat===null)risks.push({id:'heat',level:'unknown',text:'缺少日最高气温，高温暴露未评估'});
    else if(heat>0)risks.push({id:'heat',level:heat>=15?'high':'watch',text:`日最高气温≥${c.tHeat}℃：平均每季 ${fmt(heat)} 天（高温暴露指标，已在温度响应中计入，不重复扣分）`});
    const temperature=factor({id:'temperature',name:'温度适宜性',score:tScore,status:statusOf(tScore),assumption:false,
      evidence:`季节平均气温 ${fmt(avg(r=>r.weather.meanT),1)}℃；${runs.every(r=>r.weather.meanTmax!==null)?'平均日最高 '+fmt(avg(r=>r.weather.meanTmax),1)+'℃；':''}最低日最低温 ${fmt(Math.min(...runs.map(r=>r.weather.minTmin)),1)}℃；日间温度响应均值 ${fmt(hasRad?avg(r=>r.temperature.growthIndex):null,2)}`,
      metrics:{meanT:avg(r=>r.weather.meanT),meanTmin:avg(r=>r.weather.meanTmin),meanTmax:runs.every(r=>r.weather.meanTmax!==null)?avg(r=>r.weather.meanTmax):null,minTmin:Math.min(...runs.map(r=>r.weather.minTmin)),
        growthIndex:hasRad?avg(r=>r.temperature.growthIndex):null,chillDays:chill,frostRiskYears:frost,heatDays:heat,cardinal:c.tGrowth},
      method:'对照模拟：同一季关闭温度限制（含冷害、冻害）后的块根干重比',source:'逐日气温（ERA5 或输入）；温度参数见参数表',risks});
    const lScore=hasRad?ratioScore(actual,ctl('light')):null,csr=hasRad?avg(r=>r.weather.clearSkyRatio):null;
    const light=factor({id:'light',name:'光照条件',score:lScore,status:statusOf(lScore,[70,50]),assumption:false,
      evidence:hasRad?`平均短波辐射 ${fmt(avg(r=>r.weather.meanRadiation),1)} MJ/m²/日，为晴空参考的 ${fmt(csr*100)}%`:'缺少逐日短波辐射：光照未评估，不按理想光照计算',
      metrics:{meanRadiation:hasRad?avg(r=>r.weather.meanRadiation):null,clearSkyRatio:csr},
      method:'对照模拟：全季按FAO-56晴空辐射计算的块根干重比。晴空是理想上限，档位阈值 70/50 为显示设定',source:'ERA5 短波辐射；FAO-56 晴空辐射',risks:[]});
    const wScore=hasRad?ratioScore(actual,ctl('wetness')):null,dn=p.drainage==='unknown'?'unknown':p.drainage;
    const scen=runs[0].drainageScenarios?Object.fromEntries(['good','moderate','poor'].map(d=>[d,{storageDryKgHa:avg(r=>r.drainageScenarios[d].storageDryKgHa),anoxicDays:avg(r=>r.drainageScenarios[d].anoxicDays),longestWet:avg(r=>r.drainageScenarios[d].longestWet)}])):null;
    const wet=factor({id:'wetness',name:'过湿与排水',score:wScore,status:statusOf(wScore),assumption:true,
      evidence:`平均缺氧（饱和或积水）${fmt(avg(r=>r.anoxicDays))} 天，最长连续 ${fmt(avg(r=>r.longestWet))} 天，地表积水 ${fmt(avg(r=>r.pondDays))} 天；排水按「${dn==='unknown'?'未知 · 主结果取一般':drainages[dn].name}」`,
      metrics:{rain:avg(r=>r.rain),anoxicDays:avg(r=>r.anoxicDays),longestWet:avg(r=>r.longestWet),pondDays:avg(r=>r.pondDays),maxPond:Math.max(...runs.map(r=>r.maxPond)),drainage:dn,scenarios:scen},
      method:'对照模拟：关闭过湿缺氧影响后的块根干重比；影响随持续时间、饱和程度和阶段变化',source:'逐日降雨；排水能力与持水参数为假设',
      risks:[...(scen&&scen.moderate.storageDryKgHa>0&&scen.poor.storageDryKgHa<scen.moderate.storageDryKgHa*.9?[{id:'poor-drainage',level:'watch',text:`如果实际排水较差，模拟产量约低 ${Math.round(100*(1-scen.poor.storageDryKgHa/scen.moderate.storageDryKgHa))}%（平均缺氧 ${fmt(scen.poor.anoxicDays)} 天）`}]:[]),{id:'river-flood',level:'not-assessed',text:'河流洪水淹没：尚未评估（缺少地形、河网和洪水资料）。上面只评估降雨导致的田间过湿与积水。'}]});
    const factors=[temperature,light,wet];
    if(p.water!=='sufficient'){
      const s=hasRad?ratioScore(actual,ctl('water')):null;
      factors.push(factor({id:'water',name:'水分供应',score:s,status:statusOf(s),assumption:true,evidence:`平均明显缺水 ${fmt(avg(r=>r.stressDays))} 天，最长连续 ${fmt(avg(r=>r.longestDry))} 天`,
        metrics:{stressDays:avg(r=>r.stressDays),longestDry:avg(r=>r.longestDry),irrigation:avg(r=>r.irrigation)},method:'对照模拟：关闭缺水胁迫后的块根干重比',source:'所选供水方式',risks:[]}));
    }
    const climateScore=hasRad?ratioScore(actual,ctl('climate')):null;
    const phScore=soil.ph===undefined||soil.ph===null?null:Math.round(100*phFactor(soil.ph,c));
    factors.push(factor({id:'ph',name:'土壤酸碱度',score:phScore,status:statusOf(phScore),assumption:soil.phOrigin!=='measured',
      evidence:phScore===null?'未提供土壤pH，未评估':`pH ${fmt(soil.ph,2)}；适宜区间按 ${c.ph[1]}–${c.ph[2]}`,metrics:{ph:soil.ph??null,range:c.ph},
      method:'pH响应规则（Beta）',source:soil.phSource||'未提供',risks:[]}));
    const nScore=soil.nutrientRatio===undefined||soil.nutrientRatio===null?null:Math.round(100*soil.nutrientRatio),need=soil.fertilizerNeed;
    factors.push(factor({id:'nutrients',name:'养分供应',score:nScore,status:statusOf(nScore),assumption:true,
      evidence:nScore===null?'未提供整季养分供应，未计算产量':`按${soil.planName||'较优施肥方案'}，养分限制后产量为气候与pH限制产量的 ${nScore}%`,
      metrics:{nutrientRatio:soil.nutrientRatio??null,soilOnlyRatio:soil.soilOnlyRatio??null,supply:soil.supply??null},method:'QUEFTS（AKILIMO移植）：土壤供应加所示施肥方案',source:soil.nutrientSource||'未提供',
      risks:need?[{id:'fertilizer-need',level:need.level==='较多'?'high':need.level==='中等'?'watch':'none',text:`施肥需求：${need.level}。${need.summary}`}]:[]}));
    const progress=avg(r=>r.progress);
    const harvestStatus=p.crop==='cassava'
      ?{id:'harvest',progress,stage:runs[0].stageAtHarvest,text:`木薯为持续生长作物，没有固定“成熟100%”；按计划收获日计算。参考积温进度平均 ${fmt(progress*100)}%`}
      :{id:'harvest',progress,stage:runs[0].stageAtHarvest,text:progress<.85?`收获时参考积温进度平均 ${fmt(progress*100)}%，块根可能未充分膨大。是否能延长生育期需重新计算并检查后续是否进入寒冷季节，本结果未检查`:`收获时参考积温进度平均 ${fmt(progress*100)}%，处于${runs[0].stageAtHarvest}`};
    const soilScores=[phScore,nScore];
    const siteScore=climateScore===null||soilScores.some(x=>x===null)?null:Math.min(climateScore,...soilScores);
    const contributions=hasRad?{
      note:'单因素对照：仅去掉该因素后块根干重的增加量。各因素之间有交互，不能直接相加。',
      unit:'kg 干物质/ha（块根）',
      items:[['temperature','温度'],['light','光照（相对晴空）'],['wetness','过湿'],...(p.water==='sufficient'?[]:[['water','缺水']])].map(([k,name])=>({id:k,name,gainKgHa:mean(runs.map(r=>r.controls[k]-r.storageDryKgHa))}))}:null;
    return {factors,climateScore,siteScore,harvestStatus,contributions,drainageScenarios:scen};
  }
  /* Can this plan be grown? Judged season by season from temperature, cold events and harvest conditions — never from averaged
   * relative-yield scores. Levels: pass / marginal / fail / unmodeled (a severe risk the model cannot quantify). */
  const LEVEL_RANK={pass:0,marginal:1,unmodeled:1,fail:2};
  const worst=levels=>levels.reduce((a,b)=>LEVEL_RANK[b]>LEVEL_RANK[a]?b:a,'pass');
  const band=(v,[lo,hi])=>v<lo?'fail':v<hi?'marginal':'pass';
  const CHECK_NAMES={establishment:'建立期成活','warm-window':'连续适温窗口','plant-death':'植株冻死','leaf-frost':'叶片受冻','underground-cold':'地下部低温',harvestable:'可收获条件'};
  function seasonFeasibility(p,run) {
    const c=crops[p.crop],tr=run.trace,checks=[],add=(id,level,text)=>checks.push({id,name:CHECK_NAMES[id],level,text});
    const unsure=p.variety&&p.variety!=='generic'?'（该品种暂无专用参数，仍按Beta区间）':'（品种未确认，按Beta区间）';
    const e=c.establishment,est=tr.slice(0,Math.min(e.days,tr.length)),estMean=mean(est.map(d=>d.tmean)),estFrost=est.filter(d=>d.tmin<=c.frostTmin).length;
    add('establishment',estFrost?'fail':band(estMean,e.minMean),`前${est.length}天平均气温 ${fmt(estMean,1)}℃${estFrost?`，其中 ${estFrost} 天日最低≤0℃`:''}；成活参考下限 ${e.minMean[0]}–${e.minMean[1]}℃${unsure}`);
    // 5-day centred running mean, so one cool day does not break an otherwise warm spell.
    const smooth=tr.map((_,i)=>mean(tr.slice(Math.max(0,i-2),i+3).map(d=>d.tmean)));
    let warm=0,longest=0;smooth.forEach(t=>{warm=t>=c.warmWindow.tMean?warm+1:0;longest=Math.max(longest,warm);});
    add('warm-window',band(longest,c.warmWindow.minDays),`5日滑动平均气温≥${c.warmWindow.tMean}℃的最长连续 ${longest} 天；参考需要 ${c.warmWindow.minDays[0]}–${c.warmWindow.minDays[1]} 天${unsure}`);
    const h=c.harvestable,death=run.plantDeathDay,bulk=tr.filter(d=>d.progress>=c.stages[1]&&(!death||d.day<death));
    let chill=0,maxChill=0;bulk.forEach(d=>{chill=d.tmin<c.tChill?chill+1:0;maxChill=Math.max(maxChill,chill);});
    const frostBulk=bulk.filter(d=>d.tmin<=c.frostTmin).length,leafFrost=tr.filter(d=>d.tmin<=c.frostTmin&&(!death||d.day<death)).length;
    const harvestLevel=(thermal,days)=>worst([band(thermal,h.minThermal),band(days,h.minDays)]);
    let harvestBy=null;
    if(death) {
      const days=death-1,thermal=days?tr[days-1].progress*c.thermalTarget:0,level=harvestLevel(thermal,days);harvestBy=days;
      add('plant-death',level==='fail'?'fail':'marginal',`第${death}天（${run.plantDeathDate}）达到植株死亡条件（日最低≤${c.plantDeath.hardFreeze}℃或日均温≤${c.plantDeath.coldMean}℃连续${c.plantDeath.coldDays}天）。`+
        (level==='fail'?`此前只有 ${days} 天、有效积温 ${fmt(thermal)}°C·d，不满足可收获条件`:`须在此前收获（比计划提前 ${p.days-days} 天），届时 ${days} 天、有效积温 ${fmt(thermal)}°C·d`));
      add('underground-cold','unmodeled','植株死亡后块根在田间的冻伤、腐烂和可销售比例未建模；不能默认块根全部可销售，露地越冬不作推荐');
    } else {
      const thermal=run.progress*c.thermalTarget;
      add('harvestable',harvestLevel(thermal,p.days),`计划收获时 ${p.days} 天、有效积温 ${fmt(thermal)}°C·d；参考下限 ${h.minDays[0]}–${h.minDays[1]} 天、${h.minThermal[0]}–${h.minThermal[1]}°C·d${unsure}`+(p.crop==='cassava'?'。木薯无固定成熟点，但生长期不足时难以形成商品块根':''));
    }
    if(leafFrost)add('leaf-frost','marginal',`${leafFrost} 天日最低气温≤0℃：叶片受冻风险，不等于整株死亡；2m气温不能证明实际结霜`);
    if(!death&&(maxChill>=c.undergroundCold.chillRun||frostBulk>=c.undergroundCold.frost))
      add('underground-cold','unmodeled',`块根膨大期连续 ${maxChill} 天日最低<${c.tChill}℃${frostBulk?`、${frostBulk} 天≤0℃`:''}：块根冷害/冻伤与可销售比例未建模，不能默认全部可销售`);
    return {year:run.year,verdict:worst(checks.map(x=>x.level)),severeUnmodeled:checks.some(x=>x.level==='unmodeled'),harvestBy,checks};
  }
  const FEASIBILITY_LABEL={supported:'所选季节条件支持种植',risky:'有明显风险，需调整方案','not-recommended':'不建议按当前露地方案种植',insufficient:'数据不足，无法判断'};
  function feasibilityOf(p,runs,options={},factors=[]) {
    const pol=PARAMETERS.shared.feasibilityPolicy.value,n=runs.length,years=runs.map(r=>seasonFeasibility(p,r));
    const pick=v=>years.filter(y=>y.verdict===v).map(y=>y.year);
    const out=(status,reasons)=>({status,label:FEASIBILITY_LABEL[status],reasons,years,passYears:pick('pass'),marginalYears:years.filter(y=>y.verdict==='marginal'||y.verdict==='unmodeled').map(y=>y.year),failYears:pick('fail'),
      basis:'逐个历史生长季检查成活、连续适温、低温冻害和可收获条件；不用多年平均分掩盖风险年份。相对产量分数只作解释，不决定能不能种。',policy:PARAMETERS.shared.feasibilityPolicy.note});
    if(options.weatherKind==='demo')return out('insufficient',['当前是人工天气情景，不能对真实地点给出适种结论']);
    if(n<pol.minSeasons)return out('insufficient',[`只有 ${n} 个完整历史生长季，少于 ${pol.minSeasons} 个，无法判断年际风险`]);
    const reasons=[];
    for(const id of Object.keys(CHECK_NAMES)) {
      const hit=years.map(y=>({year:y.year,c:y.checks.find(x=>x.id===id)})).filter(x=>x.c&&x.c.level!=='pass');
      if(!hit.length)continue;
      const count=l=>hit.filter(x=>x.c.level===l).length,parts=[['fail','不满足'],['marginal','边缘'],['unmodeled','有未建模的严重风险']].filter(([l])=>count(l)).map(([l,t])=>`${t} ${count(l)} 年`);
      reasons.push(`${CHECK_NAMES[id]}：${hit.length}/${n} 年触发（${parts.join('，')}）：${hit.slice(0,4).map(x=>x.year).join('、')}${hit.length>4?' 等':''}`);
    }
    const failShare=pick('fail').length/n,marginalShare=years.filter(y=>y.verdict==='marginal'||y.verdict==='unmodeled').length/n,severe=years.some(y=>y.severeUnmodeled);
    const wet=factors.find(f=>f.id==='wetness');
    if(wet&&wet.score!==null&&wet.score<60)reasons.push(`过湿与排水：模型对照指标 ${wet.score}/100，持续过湿明显（按所选排水情景）`);
    if(failShare>=pol.notRecommendedShare)return out('not-recommended',reasons);
    if(failShare>0||marginalShare>=pol.marginalShare||severe||(wet&&wet.score!==null&&wet.score<60))return out('risky',reasons);
    return out('supported',reasons.length?reasons:['所有历史生长季均满足成活、连续适温和可收获条件']);
  }
  function climateAssumptions(p,c) {
    return [
      p.water==='sufficient'?'供水：按及时适量灌溉计算，默认不因缺水减产；补灌量为模型估计的到田水量，不是灌溉处方':'供水：按所选“'+(p.water==='rain'?'只靠降雨':'有限补灌')+'”计算',
      p.drainage==='unknown'?'排水：未知。主结果按“排水一般”，并给出良好/较差两个情景；不默认安全，也不判定洪涝':'排水：按“'+drainages[p.drainage].name+'”假设计算，请核实',
      '品种：'+(p.variety&&p.variety!=='generic'?p.variety+'（仅记录，仍用通用参数）':'未指定，使用通用Beta参数'),
      '生长模块为简化的光能利用（LINTUL式）Beta实现：冠层、分配、衰老参数均未做地区/品种标定，不是完整LINTUL',
      '过湿按饱和/积水持续时间估计；河流洪水淹没未评估',
      '冷害与冻害损伤系数为未验证假设；≤0℃只作冻害风险提示，不代表实际结霜',
      '土壤持水、饱和含水量、排水能力由质地估计：'+textures[p.texture].name,
      '湿度/VPD、风、台风、病虫害未建模，不扣分'
    ];
  }
  // 1 mm of water over 1 mu (666.7 m²) = 0.667 m³; over 1 ha = 10 m³.
  const M3_PER_MM_MU=10000/15/1000,M3_PER_MM_HA=10;
  /* Irrigation per historical season and its cost. The reference is the mean over the selected complete seasons for the same
   * site, crop, date and management — not a "normal year" and not a forecast. Cost is null (not 0) when no price is given. */
  function waterUse(p,runs) {
    const priced=p.irrigationPrice!==null,deducted=priced&&!p.irrigationInBase;
    const years=runs.map(r=>({year:r.year,irrigationMm:r.irrigation,m3PerMu:r.irrigation*M3_PER_MM_MU,costPerMu:priced?r.irrigation*M3_PER_MM_MU*p.irrigationPrice:null,
      stressDays:r.stressDays,rain:r.rain,et:r.et}));
    const refMm=mean(years.map(y=>y.irrigationMm)),refCost=priced?mean(years.map(y=>y.costPerMu)):null;
    years.forEach(y=>{y.deltaM3PerMu=(y.irrigationMm-refMm)*M3_PER_MM_MU;y.deltaCostPerMu=priced?y.costPerMu-refCost:null;});
    const example=priced&&p.irrigationPriceOrigin==='example';
    return {priced,deducted,inBase:p.irrigationInBase,unitPrice:p.irrigationPrice,priceOrigin:priced?p.irrigationPriceOrigin:null,currency:p.currency,
      priceBasis:'每立方米到田补灌水的综合费用（抽水电费、水费等）；模型给出的是到田水量，未另计输配水损耗',
      reference:{label:'相对所选历史年景平均值',irrigationMm:refMm,m3PerMu:refMm*M3_PER_MM_MU,costPerMu:refCost},years,
      conversions:{m3PerMmPerMu:M3_PER_MM_MU,m3PerMmPerHa:M3_PER_MM_HA},
      status:(!priced?'未填写灌溉单价：灌溉费用未计入（不是0元）':p.irrigationInBase?'灌溉费已包含在基础成本中：不再单独扣除，逐年差额只作说明':'灌溉费 = 模拟到田补灌量 × 单价，已从利润中扣除一次')+(example?`；单价 ${p.irrigationPrice} ${p.currency}/立方米是粗略参考值，不是当地实际水电价，请按实际修改`:''),
      note:p.water==='sufficient'?'按及时灌溉计算：补灌可减轻缺水对产量的影响，但会增加投入；干旱年份需要更多补灌。':'按所选供水方式计算补灌量。'};
  }
  /* How much fertilizer the land needs, roughly: nutrients removed by the attainable crop minus the soil's own supply.
   * Not a prescription — fertilizer recovery is not applied, so real rates are usually higher. */
  // Products used to fill the gap. content = N, P₂O₅, K₂O mass fractions.
  const FERTILIZER_PRODUCTS={npk:{name:'复合肥（15-15-15）',content:[.15,.15,.15]},urea:{name:'尿素',content:[.46,0,0]},
    sop:{name:'硫酸钾',content:[0,0,.5]},mop:{name:'氯化钾',content:[0,0,.6]}};
  function fertilizerNeed(p,c,freshTHa) {
    if(!c.removal||!(freshTHa>0))return null;
    const need=c.removal.map(r=>r*freshTHa),supply=[p.n,p.p,p.k],gap=need.map((x,i)=>Math.max(0,x-supply[i])),share=gap.map((g,i)=>need[i]>0?g/need[i]:0);
    const worst=Math.max(...share),level=worst>=.5?'较多':worst>=.2?'中等':'较少',names=['氮','磷','钾'],main=names[share.indexOf(worst)];
    const perMu={N:gap[0]/15,P2O5:gap[1]*2.291/15,K2O:gap[2]*1.205/15};
    return {level,targetFreshTHa:freshTHa,needKgHa:need,supplyKgHa:supply,gapKgHa:gap,perMu,main:worst>=.2?main:null,source:PARAMETERS[c.id].removal.source,
      summary:worst<.05?'土壤供应大致够当前产量的带走量':`按 ${fmt(freshTHa)} 吨/公顷产量的带走量粗估，每亩约缺 N ${fmt(perMu.N,1)}、P₂O₅ ${fmt(perMu.P2O5,1)}、K₂O ${fmt(perMu.K2O,1)} kg，主要缺${main}`,
      note:'带走量减土壤供应的粗略缺口；未计肥料利用率（实际用量通常更多），不是施肥处方'};
  }
  function requireRadiation(seasons) {
    if(seasons.some(s=>!Array.isArray(s.daily?.shortwave_radiation_sum)))throw Error('缺少逐日短波辐射，无法计算产量；不会按理想光照补齐。可改为只看气候条件。');
  }
  function evaluateEnsemble(input,seasons,options={}) {
    const p=normalize(input),c=crops[p.crop];
    if(!Array.isArray(seasons)||!seasons.length||seasons.length>30)throw Error('需要1–30个天气情景');
    if(new Set(seasons.map(s=>s.year)).size!==seasons.length)throw Error('天气情景年份重复');
    requireRadiation(seasons);
    const calibrationScale=options.calibration?validateCalibration(options.calibration,p):1;
    const runs=seasons.map(s=>runSeason(p,s)),ph=phFactor(p.ph,c),water=waterUse(p,runs);
    const maxRate=Math.min(p.maxRate,p.budget/p.fertPrice),rates=[];
    for(let r=0;r<=maxRate+1e-9;r++)rates.push(r);
    if(maxRate-rates[rates.length-1]>1e-6)rates.push(maxRate);
    const nutrients=rate=>p.fertilizer.map((v,i)=>rate*15*v/100*[1,.4364,.8301][i]*c.rf[i]);
    const toFreshMu=dry=>dry/c.dm/15;
    function candidate(rate) {return evaluatePlan(nutrients(rate+p.existingRate),rate*p.fertPrice,{rate});}
    function evaluatePlan(rec,cost,extra) {
      const years=runs.map(s=>{
        const attainable=s.storageDryKgHa*ph,nutrientDry=quefts([p.n,p.p,p.k],rec,attainable,c);
        const rawFresh=toFreshMu(nutrientDry),cap=toFreshMu(attainable);
        const fresh=Math.min(rawFresh*calibrationScale,cap);
        const irrigationCost=water.deducted?water.years.find(w=>w.year===s.year).costPerMu:null;
        const saleable=fresh*p.marketable,revenue=saleable*p.price,harvestCost=fresh*p.harvestCost;
        const net=revenue-p.base-cost-harvestCost-(irrigationCost??0);
        return {year:s.year,fresh,rawFresh,saleable,revenue,fertilizerCost:cost,harvestCost,irrigationCost,baseCost:p.base,net,
          flags:{nutrientLimited:nutrientDry<attainable*.98,calibrationCapped:rawFresh*calibrationScale>cap+1e-9,implausible:fresh*15>c.plausibleFresh}};
      });
      const yields=years.map(y=>y.fresh),nets=years.map(y=>y.net),fresh=mean(yields),net=mean(nets);
      return {...extra,cost,fresh,saleable:mean(years.map(y=>y.saleable)),low:quantile(yields,.1),high:quantile(yields,.9),median:quantile(yields,.5),net,netLow:quantile(nets,.1),netHigh:quantile(nets,.9),lossShare:nets.filter(n=>n<0).length/nets.length,
        breakEvenPrice: fresh*p.marketable>0?(p.base+cost+fresh*p.harvestCost+(water.deducted?mean(years.map(y=>y.irrigationCost)):0))/(fresh*p.marketable):null,
        objective:p.risk==='cautious'?quantile(nets,.1):net,years};
    }
    const candidates=rates.map(candidate),best=candidates.reduce((a,b)=>b.objective>a.objective+1e-8?b:a);
    const baseline=candidates[0],middle=candidates[Math.floor((candidates.length-1)/2)];
    const need=fertilizerNeed(p,c,mean(runs.map(s=>s.storageDryKgHa*ph/c.dm/1000)));
    /* Fertilizer plan chosen by profit: starting from none, repeatedly add the product step (or a balanced step of all three)
     * that raises the objective most, within the budget, until no step pays. Compared against none, half and 1.5× the result.
     * If fertilizing gains little over none, none is recommended. Requires product prices (CNY reference or user input). */
    const prices={npk:p.fertPrice,...(options.fertilizerPrices||{})},potash=p.crop==='sweetpotato'?'sop':'mop';
    const keys=['npk','urea',potash],priced=keys.every(k=>Number.isFinite(prices[k]));
    const planFor=(kg,extra)=>{
      const products=keys.map((k,i)=>({key:k,name:FERTILIZER_PRODUCTS[k].name,kg:Math.round(kg[i]*2)/2})).filter(x=>x.kg>=.5);
      const added=[0,1,2].map(i=>products.reduce((a,x)=>a+x.kg*15*FERTILIZER_PRODUCTS[x.key].content[i],0));
      const rec=nutrients(p.existingRate).map((x,i)=>x+added[i]*[1,.4364,.8301][i]*c.rf[i]);
      return {...evaluatePlan(rec,products.reduce((a,x)=>a+x.kg*prices[x.key],0),extra),products,priced:true};
    };
    let plans=[],plan=null;
    if(priced&&need){
      const step=[5,1,2],cap=keys.map(k=>c.fertilizerCaps[k]),moves=[[1,0,0],[0,1,0],[0,0,1],[1,1,1]],score=x=>x.objective;
      let kg=[0,0,0],current=planFor(kg,{});
      for(let guard=0;guard<200;guard++){
        let next=null;
        for(const mv of moves){
          const k=kg.map((v,i)=>v+mv[i]*step[i]);if(k.some((v,i)=>v>cap[i]))continue;
          const cand=planFor(k,{});if(cand.cost>p.budget+1e-9)continue;
          if(score(cand)>score(current)+.5&&(!next||score(cand)>score(next.plan)))next={kg:k,plan:cand};
        }
        if(!next)break;kg=next.kg;current=next.plan;
      }
      const none=planFor([0,0,0],{id:'none',name:'不施肥'}),gain=score(current)-score(none);
      const worth=gain>Math.max(30,.03*Math.abs(score(none)));
      const opt=worth?kg:[0,0,0],atCap=worth&&kg.some((v,i)=>v+step[i]>cap[i]),budgetBound=worth&&!atCap&&current.cost>p.budget-Math.max(...keys.map((k,i)=>prices[k]*step[i]));
      const limit=atCap?'（已到常见用量上限）':budgetBound?'（受肥料预算限制）':'';
      const half=planFor(opt.map(v=>v/2),{id:'low',name:'少施（推荐量的一半）'}),rec=planFor(opt,{id:'rec',name:worth?'推荐（收益最高）'+limit:'推荐：不另施肥（增收不明显）',atCap,budgetBound});
      // A "more" row only when the optimum is interior, to show that extra fertilizer stops paying.
      const more=!atCap&&!budgetBound&&worth?planFor(opt.map(v=>v*1.5),{id:'high',name:'多施（推荐量的1.5倍）'}):null;
      plans=worth?[none,half,rec,...(more?[more]:[])]:[rec];
      plan=rec;
    }
    const soilOnlyRatio=mean(runs.map(s=>{const w=s.storageDryKgHa*ph;return w>0?quefts([p.n,p.p,p.k],[0,0,0],w,c)/w:0;}));
    const shown=plan||best,nutrientRatio=mean(runs.map((s,i)=>s.storageDryKgHa*ph>0?shown.years[i].fresh/toFreshMu(s.storageDryKgHa*ph):0));
    const a=assess(p,runs,{ph:p.ph,phSource:p.soilOrigin==='china'?'国内0–4.5cm表层背景格网':p.soilOrigin==='manual'?'手填':'输入',nutrientRatio,soilOnlyRatio,fertilizerNeed:need,planName:plan?(plan.products.length?'推荐施肥方案':'不另施肥'):'较优施肥方案',
      supply:{n:p.n,p:p.p,k:p.k,unit:'kg/ha 整季供应（估计）'},nutrientSource:p.soilOrigin==='china'?'0–4.5cm表层背景浓度 × 容重 × 20cm耕层（假设）× 假设利用比例':'手填整季供应'});
    const yearly=runs.map((s,i)=>{const y=shown.years[i];return {year:s.year,meanT:s.weather.meanT,meanTmax:s.weather.meanTmax,minTmin:s.weather.minTmin,
      radiation:s.weather.radiation,meanRadiation:s.weather.meanRadiation,rain:s.rain,irrigation:s.irrigation,chillDays:s.temperature.chillDays,frostRiskDays:s.temperature.frostRiskDays,
      heatDays:s.temperature.heatDays,anoxicDays:s.anoxicDays,longestWet:s.longestWet,pondDays:s.pondDays,stageAtHarvest:s.stageAtHarvest,progress:s.progress,laiMax:s.laiMax,
      biomassKgHa:s.biomassKgHa,storageDryKgHa:s.storageDryKgHa,harvestIndex:s.harvestIndex,rotLossKgHa:s.rotLossKgHa,
      climateFreshMu:toFreshMu(s.storageDryKgHa),phFreshMu:toFreshMu(s.storageDryKgHa*ph),fresh:y.fresh,saleable:y.saleable,revenue:y.revenue,
      costs:{base:y.baseCost,fertilizer:y.fertilizerCost,harvest:y.harvestCost,irrigation:y.irrigationCost},net:y.net,flags:y.flags};});
    const spread=v=>{const m=mean(v);return m>0?(Math.max(...v)-Math.min(...v))/m:0;};
    const climateSpread=spread(yearly.map(y=>y.phFreshMu)),finalSpread=spread(yearly.map(y=>y.fresh)),limitedYears=yearly.filter(y=>y.flags.nutrientLimited).length;
    const explanations=[];
    if(runs.length>1&&limitedYears>=runs.length/2&&finalSpread<climateSpread*.5)
      explanations.push(`各年天气能支撑的产量相差约 ${Math.round(climateSpread*100)}%，但 ${limitedYears}/${runs.length} 年被养分供应封顶，最终产量只相差约 ${Math.round(finalSpread*100)}%，所以看起来接近甚至相同：养分是主要瓶颈。这是养分限制的正常结果，不是天气没有影响。`);
    if(yearly.some(y=>y.flags.implausible))explanations.push('部分年份产量超过合理性检查量级，请核对输入和参数；结果未被截断。');
    if(yearly.some(y=>y.flags.calibrationCapped))explanations.push('校准后产量在部分年份被气候与pH限制产量截断。');
    const costsIncluded=[p.irrigationInBase?'基础成本（含灌溉费）':'基础成本','新增肥料费','按产量计的采收运输费',...(water.deducted?['灌溉费（模拟到田补灌量 × 单价）']:[])];
    const feasibility=feasibilityOf(p,runs,options,a.factors);
    return {version:VERSION,parameterVersion:PARAMETER_VERSION,status:'beta',yieldAvailable:true,calibrationId:options.calibration?.id||null,crop:c.name,cropId:p.crop,feasibility,water,
      score:a.siteScore,siteScore:a.siteScore,climateScore:a.climateScore,nutrientRatio,soilNutrientRatio:soilOnlyRatio,fertilizerNeed:need,factors:a.factors,harvestStatus:a.harvestStatus,contributions:a.contributions,drainageScenarios:a.drainageScenarios,
      wly:mean(runs.map(s=>s.storageDryKgHa*ph)),best,plan,fertilizerPlans:plans,rows:[{...baseline,name:'不新增肥料'},{...middle,name:'中档投入'},{...best,name:'候选较优'}],candidates,yearly,explanations,
      economics:{profitDefinition:'利润 = 可出售鲜薯 × 售价 − '+costsIncluded.join(' − '),costsIncluded,irrigationCostIncluded:water.deducted,
        sameAssumptions:'各年使用相同售价和基础成本，只比较天气造成的产量与补灌量差异',irrigationNote:water.status},
      count:seasons.length,yearRange:seasons.map(s=>s.year),rangeMeaning:seasons.length>1?'历史天气情景P10–P90，非未来预测置信区间':'单一情景，不提供统计区间',
      lossMeaning:'历史情景中亏损年份的占比，不是已校准的未来亏损概率',
      diagnostics:{maturity:mean(runs.map(s=>s.progress)),stressDays:mean(runs.map(s=>s.stressDays)),irrigation:mean(runs.map(s=>s.irrigation)),anoxicDays:mean(runs.map(s=>s.anoxicDays)),maxMassBalanceError:Math.max(...runs.map(s=>Math.abs(s.massBalanceError)))},
      management:managementOf(p),simulations:runs,assumptions:[...climateAssumptions(p,c),c.parameterSource,'土壤化验浓度不等于整季作物可吸收供应','天气区间不包含全部参数误差、病虫害和市场风险']};
  }
  function managementOf(p) {
    return {variety:p.variety||'generic',water:p.water,waterText:p.water==='sufficient'?'按及时灌溉计算':p.water==='rain'?'只靠降雨':'有限补灌',
      drainage:p.drainage,drainageText:p.drainage==='unknown'?'排水未知（按一般计算）':drainages[p.drainage].name,texture:textures[p.texture].name};
  }
  function evaluateClimate(input,seasons,options={}) {
    if(!Array.isArray(seasons)||!seasons.length||seasons.length>30||new Set(seasons.map(s=>s.year)).size!==seasons.length)throw Error('天气情景无效');
    const p=normalize(input),c=crops[p.crop],runs=seasons.map(s=>runSeason(p,s)),a=assess(p,runs);
    return {version:VERSION,parameterVersion:PARAMETER_VERSION,status:'beta',yieldAvailable:false,crop:c.name,cropId:p.crop,feasibility:feasibilityOf(p,runs,options,a.factors),water:waterUse(p,runs),count:seasons.length,yearRange:seasons.map(s=>s.year),
      climateScore:a.climateScore,siteScore:null,factors:a.factors,harvestStatus:a.harvestStatus,contributions:a.contributions,drainageScenarios:a.drainageScenarios,
      climateFreshMu:runs.every(r=>r.radiationAvailable)?runs.map(r=>({year:r.year,freshMu:r.storageDryKgHa/c.dm/15})):null,
      diagnostics:{maturity:mean(runs.map(s=>s.progress)),stressDays:mean(runs.map(s=>s.stressDays)),irrigation:mean(runs.map(s=>s.irrigation)),anoxicDays:mean(runs.map(s=>s.anoxicDays))},
      management:managementOf(p),simulations:runs,
      assumptions:[...climateAssumptions(p,c),'缺少养分供应，暂不计算产量或施肥收益；土壤pH未评估']};
  }
  /* Compare planting windows with identical management on the same historical years.
   * Feasibility first: only windows whose seasons support planting are ranked as candidates. The objective among them is the
   * mean climate-limited storage-root yield (before nutrients) — an average, not a risk-optimal choice. Stability: leave-one-year-out. */
  const FEASIBILITY_ORDER={supported:0,risky:1,'not-recommended':2,insufficient:3};
  function rankPlantingWindows(input,windows,options={}) {
    if(!Array.isArray(windows)||!windows.length)throw Error('没有可比较的播期');
    const common=windows[0].seasons.map(s=>s.year).filter(y=>windows.every(w=>w.seasons.some(s=>s.year===y)));
    if(common.length<3)throw Error('播期比较至少需要3个共同完整历史年景');
    requireRadiation(windows.flatMap(w=>w.seasons));
    // Screening runs only what ranking needs: the main run (yield, per-season feasibility) and the wetness control, whose score
    // feeds the feasibility rule. Temperature/light/climate controls and drainage scenarios only explain the final report,
    // so they run once for the chosen window (evaluateEnsemble / evaluateClimate), not for all 12 candidates.
    const rows=windows.map(w=>{
      const p=normalize({...input,date:w.date}),c=crops[p.crop],seasons=common.map(y=>w.seasons.find(s=>s.year===y));
      const runs=seasons.map(s=>{const sim=simulateSeason(p,s.daily);return {year:s.year,...sim,wetnessControl:sim.radiationAvailable?simulateSeason(p,s.daily,{disable:{wetness:true},trace:false}).storageDryKgHa:null};});
      const wScore=ratioScore(runs.map(r=>r.storageDryKgHa),runs.map(r=>r.wetnessControl));
      const byYear=runs.map(s=>s.storageDryKgHa/c.dm/15),f=feasibilityOf(p,runs,options,[{id:'wetness',score:wScore}]);
      return {date:w.date,objective:mean(byYear),p10:quantile(byYear,.1),byYear,
        feasibility:{status:f.status,label:f.label,reasons:f.reasons,passYears:f.passYears,failYears:f.failYears},
        stressDays:mean(runs.map(s=>s.stressDays)),anoxicDays:mean(runs.map(s=>s.anoxicDays)),maturity:mean(runs.map(s=>s.progress)),years:common};
    });
    const supported=rows.filter(r=>r.feasibility.status==='supported'),pool=supported.length?supported:rows;
    const top=idx=>pool.reduce((b,r)=>{const v=mean(idx.map(i=>r.byYear[i]));return v>b.v+1e-9?{v,date:r.date}:b;},{v:-Infinity,date:null}).date;
    const all=common.map((_,i)=>i),overall=top(all),folds=common.map((_,i)=>top(all.filter(j=>j!==i)));
    return rows.map(r=>({...r,objectiveName:'平均气候限制产量（养分前，kg鲜薯/亩）',candidate:r.feasibility.status==='supported',
      stability:{method:'逐年留出：去掉一个历史年份后在可行候选中重新排序',topShare:folds.filter(d=>d===r.date).length/folds.length,folds:folds.length,overallTop:overall}}))
      .sort((a,b)=>FEASIBILITY_ORDER[a.feasibility.status]-FEASIBILITY_ORDER[b.feasibility.status]||b.objective-a.objective||a.date.localeCompare(b.date));
  }
  function evaluate(p,daily,options={}) {return evaluateEnsemble(p,[{year:Number(p.date.slice(0,4)),daily}],options);}
  /* Season supply from a soil test: concentration × bulk density × layer thickness × assumed availability fraction.
   * The national grid only covers 0–4.5 cm; by default the surface concentration is assumed to represent a 0–20 cm plough
   * layer (usual soil-test sampling depth). Pass {depthCm:null} to use the measured layer only. */
  function soilSupply(data, fractions, options={}) {
    const f=data?.fields;
    if(!data?.ok||!f||!Array.isArray(data.depthCm)||data.depthCm.length!==2) throw Error('国内土壤数据尚未就绪');
    const assumed=options.depthCm===undefined?20:options.depthCm;
    if(assumed!==null&&(!Number.isFinite(assumed)||assumed<=0||assumed>100))throw Error('耕层厚度无效');
    const depth=(assumed===null?data.depthCm[1]-data.depthCm[0]:assumed)/100, bd=f.bulkDensity?.value;
    if(!Number.isFinite(depth)||depth<=0||depth>2||!Number.isFinite(bd)||bd<=0||bd>3) throw Error('土层或容重数据无效');
    if(!Array.isArray(fractions)||fractions.length!==3||fractions.some(x=>!Number.isFinite(x)||x<0||x>1)) throw Error('养分利用比例须在0–1之间');
    const names=['availableN','availableP','availableK'];
    const supply=names.map((key,i)=>{
      const v=f[key];
      if(v?.unit!=='mg/kg'||!Number.isFinite(v.value)||v.value<0) throw Error('土壤养分单位或数值无效');
      return v.value*bd*depth*10*fractions[i];
    });
    if(!Number.isFinite(f.ph?.value)) throw Error('pH 数据缺失');
    return {n:supply[0],p:supply[1],k:supply[2],ph:f.ph.value,depthCm:data.depthCm,assumedDepthCm:assumed,fractions};
  }
  const api={rankPlantingWindows,VERSION,PARAMETER_VERSION,PARAMETERS,crops,textures,drainages,quefts,validate,normalize,climate,evaluate,evaluateEnsemble,evaluateClimate,
    simulateSeason,runSeason,assess,feasibilityOf,seasonFeasibility,FEASIBILITY_LABEL,soilSupply,quantile,historicalSeasons,seasonDates,extractSeasons,validateCalibration,extraterrestrialRadiation,temperatureResponse,phFactor};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  else root.HarvestModel=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:this);
