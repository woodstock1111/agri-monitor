/* 小程序收成预测：取天气与土壤、运行 harvest-model、把结果压成页面用的小对象。
 * 算法与网页版 harvest.js 相同（同一份 harvest-model.js）；这里只复刻网页版的取数流程，不改模型。
 * 模型输出约 1MB（含逐日轨迹），不能整个 setData，页面只拿 buildView() 的摘要。 */
const M = require('./harvest-model.js')
const auth = require('./auth.js')

// 天气和土壤都走我们自己的服务器（与“小薯”助手同一台），带登录令牌；服务器再去 Open-Meteo 取 ERA5 历史天气并存库
// 与网页版 harvest.js 的 FERT_REF / IRRIGATION_EXAMPLE_CNY 保持一致（2026-09-11 基准价，元/kg；灌溉参考 元/立方米）
const FERT_PRICES = { urea: 1.81, npk: 3.49, sop: 3.95, mop: 3.33 }
const IRRIGATION_EXAMPLE_CNY = 0.5
const NUTRIENT_DEFAULTS = { ph: 6, n: 60, p: 12, k: 80 }
const SOIL_FRACTIONS = [0.3, 0.2, 0.4]

// 以下选项与网页版 harvest.js 的表单逐项一致（文字、取值、顺序）
const PRESETS = [
  { id: 'preset-0', name: '海南 · 海口', lat: 20.045, lng: 110.198 },
  { id: 'preset-1', name: '山东 · 潍坊', lat: 36.71, lng: 119.1 },
  { id: 'preset-2', name: '广西 · 南宁（武鸣）', lat: 23.16, lng: 108.27 },
  { id: 'preset-3', name: '尼日利亚 · 示例区域', lat: 8, lng: 8 },
  { id: 'preset-4', name: '坦桑尼亚 · 示例区域', lat: -6, lng: 35 },
  { id: 'preset-5', name: '泰国 · 示例区域', lat: 15, lng: 101 },
  { id: 'preset-6', name: '越南 · 示例区域', lat: 12, lng: 108 }
]
const CROP_OPTIONS = [
  { value: 'sweetpotato', label: '红薯 · Beta' },
  { value: 'cassava', label: '木薯 · Beta' }
]
const UNIT_OPTIONS = [
  { value: 'mu', label: '亩' },
  { value: 'ha', label: '公顷 ha' }
]
const DATE_MODE_OPTIONS = [
  { value: 'auto', label: '自动比较当地种植时间 · Beta' },
  { value: 'manual', label: '使用我填写的日期' }
]
const SOURCE_OPTIONS = [
  { value: 'history', label: '真实历史天气 · 全球坐标' },
  { value: 'demo', label: '人工天气情景 · 只看界面，不判断能否种' }
]
const YEARS_OPTIONS = [
  { value: 5, label: '最近5个完整生长季' },
  { value: 10, label: '最近10个完整生长季' },
  { value: 20, label: '最近20个完整生长季' }
]
const WATER_OPTIONS = [
  { value: 'sufficient', label: '水源充足 · 缺水时及时适量浇水' },
  { value: 'irrigated', label: '浇水有限 · 按实际水量计算' },
  { value: 'rain', label: '只靠下雨 · 不额外浇水' }
]
const DRAINAGE_OPTIONS = [
  { value: 'unknown', label: '不确定 · 按一般计算' },
  { value: 'good', label: '良好 · 高垄、沟渠通畅' },
  { value: 'moderate', label: '一般' },
  { value: 'poor', label: '较差 / 易积水' }
]
const TEXTURE_OPTIONS = [
  { value: 'loam', label: '壤土 · 假设' },
  { value: 'sandy', label: '砂质土 · 假设' },
  { value: 'clay', label: '黏质土 · 假设' }
]
const SOIL_OPTIONS = [
  { value: 'china', label: '读取国内表层格网 · Beta' },
  { value: 'manual', label: '手填整季养分供应 · Beta' },
  { value: 'climate', label: '只有天气 · 先看气候和水分条件' }
]
const CURRENCIES = ['CNY', 'USD', 'THB', 'VND', 'IDR', 'NGN', 'KES', 'TZS', 'GHS']
const RISK_OPTIONS = [
  { value: 'cautious', label: '稳妥一些 · 优先看较差年份的利润' },
  { value: 'balanced', label: '看平均表现 · 比较多年平均利润' }
]

const weatherCache = new Map()

function isDomestic(lat, lng) {
  return lat >= 17.8 && lat <= 54 && lng >= 73 && lng <= 136
}

function todayString() {
  return new Date().toISOString().slice(0, 10)
}

// 请求走 auth.request（自动登录、401 重试一次）；测试时可传入替身。path 是 /api/v1 之后的部分。
const LOGIN_LOST = '登录已失效，请重新打开小程序。'

async function fetchSoil(lat, lng, request = auth.request) {
  let res
  try {
    res = await request({
      path: `/harvest/soil?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`,
      method: 'GET',
      timeout: 22000
    })
  } catch (e) {
    return { ok: false, msg: '土壤接口连不上，请检查网络后重试。' }
  }
  if (res.statusCode === 401) return { ok: false, status: 'unauthorized', msg: LOGIN_LOST }
  if (res.statusCode === 429) return { ok: false, status: 'busy', msg: '土壤查询太频繁，请稍后再试。' }
  const data = res.data
  if (!data || typeof data.ok !== 'boolean') return { ok: false, msg: '土壤接口返回异常，请稍后重试。' }
  return data
}

// 与网页版 weather() 相同：一次取覆盖所有生长季的整年段，按坐标和年段缓存 6 小时
async function fetchDaily(lat, lng, start, end, request) {
  const key = JSON.stringify([lat, lng, start, end])
  const cached = weatherCache.get(key)
  if (cached && Date.now() - cached.at < 6 * 3600000) return cached.daily
  let res
  try {
    res = await request({
      path: `/harvest/weather?lat=${lat}&lng=${lng}&start=${start}&end=${end}`,
      method: 'GET',
      timeout: 45000
    })
  } catch (e) {
    throw new Error('历史天气读取失败，请检查网络后重试。')
  }
  if (res.statusCode === 401) throw new Error(LOGIN_LOST)
  if (res.statusCode === 429) throw new Error('查询太频繁，请稍后再试。')
  if (res.statusCode < 200 || res.statusCode >= 300 || !res.data || !res.data.ok || !res.data.daily) throw new Error((res.data && res.data.msg) || '历史天气服务暂不可用，请稍后重试。')
  if (weatherCache.size >= 8) weatherCache.delete(weatherCache.keys().next().value)
  weatherCache.set(key, { at: Date.now(), daily: res.data.daily })
  return res.data.daily
}

function yearWindow(date, count) {
  const today = todayString()
  const reference = date < today ? date : today
  const year = Number(reference.slice(0, 4))
  return { year, start: (year - count - 1) + '-01-01', end: (year - 1) + '-12-31' }
}

async function seasonsFor(p, count, planning, request) {
  const w = yearWindow(p.date, count)
  const seasons = planning
    ? Array.from({ length: count }, (_, i) => M.seasonDates(p.date, p.days, w.year - count - 1 + i))
    : M.historicalSeasons(p.date, p.days, count)
  const daily = await fetchDaily(p.lat, p.lng, w.start, w.end, request)
  const checked = M.extractSeasons(daily, seasons, p.lat)
  if (checked.included.length < 3) throw new Error('完整历史生长季不足3个，请稍后重试。')
  return { kind: 'history', source: 'Open-Meteo / ERA5 · 完整历史生长季', ...checked, requested: seasons.length }
}

// 与网页版 artificial() 相同：按年份和纬度可复现的人工天气，只用于看界面
function artificial(p, season) {
  let seed = (season.year * 7919 + Math.round((p.lat + 90) * 100)) >>> 0
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  const daily = { time: [], temperature_2m_mean: [], temperature_2m_min: [], temperature_2m_max: [], precipitation_sum: [], et0_fao_evapotranspiration: [], shortwave_radiation_sum: [] }
  for (let i = 0; i < p.days; i++) {
    const date = new Date(Date.parse(season.start) + i * 86400000)
    const day = (date - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86400000
    const wave = Math.cos(2 * Math.PI * (day - (p.lat < 0 ? 18 : 200)) / 365.25)
    const t = 27 - Math.abs(p.lat) * 0.3 + Math.min(18, Math.abs(p.lat) * 0.32) * wave + (random() - 0.5) * 4
    const range = 8 + random() * 4
    const ra = M.extraterrestrialRadiation(p.lat, day + 1)
    daily.time.push(date.toISOString().slice(0, 10))
    daily.temperature_2m_mean.push(t)
    daily.temperature_2m_min.push(t - range / 2)
    daily.temperature_2m_max.push(t + range / 2)
    daily.precipitation_sum.push(random() < 0.35 ? random() * 25 : 0)
    daily.et0_fao_evapotranspiration.push(Math.max(0.5, t * 0.14))
    daily.shortwave_radiation_sum.push(ra * (0.3 + 0.45 * random()))
  }
  return { ...season, daily }
}

async function weatherFor(p, form, planning, request) {
  if (form.source === 'demo') {
    const w = yearWindow(p.date, form.years)
    const seasons = planning
      ? Array.from({ length: form.years }, (_, i) => M.seasonDates(p.date, p.days, w.year - form.years - 1 + i))
      : M.historicalSeasons(p.date, p.days, form.years)
    return { kind: 'demo', source: '人工天气情景 · 不代表实测或预测', included: seasons.map(s => artificial(p, s)), excluded: [], requested: seasons.length }
  }
  return seasonsFor(p, form.years, planning, request)
}

/* form：面板表单，字段与网页版 params() 相同；面积、预算、基础成本已换算成“每亩”。
 * soil：fetchSoil 的成功结果或 null。onStage(text)：进度文字。
 * 返回 { input, output, planning, weather, soil }，只在内存里用。 */
// 表单没给的项用网页版的默认值（null 是有意的“不计入”，保留不动）
function withDefaults(form) {
  const defaults = {
    variety: 'generic', risk: 'cautious', currency: 'CNY', source: 'history', years: 10,
    rootDepth: M.crops[form.crop] ? M.crops[form.crop].rootDepth : 1, initialWater: 0.6, irrigationLimit: 300, irrigationDailyMax: 15,
    fertPrice: FERT_PRICES.npk, marketable: 0.85, harvestCost: 0,
    irrigationPrice: IRRIGATION_EXAMPLE_CNY, irrigationInBase: false, irrigationPriceOrigin: 'example', fractions: SOIL_FRACTIONS
  }
  const out = { ...form }
  Object.keys(defaults).forEach(k => { if (out[k] === undefined) out[k] = defaults[k] })
  return out
}

async function analyze(input, soil, { request = auth.request, onStage = () => {} } = {}) {
  const form = withDefaults(input)
  const pointOk = Number.isFinite(form.lat) && Number.isFinite(form.lng) && Math.abs(form.lat) <= 90 && Math.abs(form.lng) <= 180 && !(form.lat === 0 && form.lng === 0)
  if (!pointOk) throw new Error('请先选择有位置的地块，或在地图上选点。')
  const raw = {
    lat: form.lat, lng: form.lng, area: form.area, days: form.days, crop: form.crop, date: form.date,
    water: form.water, drainage: form.drainage, texture: form.texture, risk: form.risk, currency: form.currency,
    rootDepth: form.rootDepth, initialWater: form.initialWater, irrigationLimit: form.irrigationLimit, irrigationDailyMax: form.irrigationDailyMax,
    price: form.price, base: form.base, budget: form.budget, fertPrice: form.fertPrice, marketable: form.marketable, harvestCost: form.harvestCost,
    irrigationPrice: form.irrigationPrice, irrigationInBase: form.irrigationInBase, irrigationPriceOrigin: form.irrigationPriceOrigin,
    variety: form.variety || 'generic', soilOrigin: form.soilMode,
    ph: form.ph, n: form.n, p: form.p, k: form.k
  }
  let usedSoil = null
  if (form.soilMode === 'china') {
    if (!soil || !soil.ok) throw new Error('土壤尚未就绪，请点击读取内置国内土壤重试。')
    Object.assign(raw, M.soilSupply(soil, form.fractions))
    usedSoil = soil
  }
  if (form.soilMode === 'climate') {
    Object.assign(raw, { n: 0, p: 0, k: 0, ph: 6, price: 0, base: 0, budget: 0, fertPrice: 1, marketable: 1, harvestCost: 0, existingRate: 0, maxRate: 0, fertilizer: [0, 0, 0] })
  }
  const p = M.normalize(raw)

  let planning = null
  let weather
  if (form.dateMode === 'auto') {
    onStage('正在比较12个月的候选播期，保持供水和生育期相同…')
    const today = todayString()
    const year = Number(today.slice(0, 4))
    const windows = []
    for (let month = 1; month <= 12; month++) {
      const suffix = '-' + String(month).padStart(2, '0') + '-15'
      let date = year + suffix
      if (date < today) date = (year + 1) + suffix
      const climate = await weatherFor({ ...p, date }, form, true, request)
      windows.push({ date, seasons: climate.included, weather: climate })
    }
    await yieldToUi()
    const ranking = M.rankPlantingWindows(p, windows, { weatherKind: form.source })
    const chosen = windows.find(w => w.date === ranking[0].date)
    const found = ranking[0].feasibility.status === 'supported'
    p.date = chosen.date
    weather = {
      ...chosen.weather,
      included: chosen.weather.included.filter(s => ranking[0].years.includes(s.year)),
      excluded: chosen.weather.excluded.concat(chosen.weather.included.filter(s => !ranking[0].years.includes(s.year)).map(s => ({ year: s.year, reason: '播期比较统一年份' })))
    }
    planning = { ranking, selectedDate: p.date, found }
  } else {
    onStage('正在读取多年天气并逐日计算…')
    weather = await weatherFor(p, form, false, request)
  }

  onStage('正在逐日计算生长与收益…')
  await yieldToUi()
  const output = p.soilOrigin === 'climate'
    ? M.evaluateClimate(p, weather.included, { weatherKind: weather.kind })
    : M.evaluateEnsemble(p, weather.included, { weatherKind: weather.kind, fertilizerPrices: p.currency === 'CNY' ? { urea: FERT_PRICES.urea, sop: FERT_PRICES.sop, mop: FERT_PRICES.mop } : undefined })
  return { input: p, output, planning, weather, soil: usedSoil }
}

// 让“正在计算”的文字先渲染出来，再进入同步的大计算
function yieldToUi() {
  return new Promise(resolve => setTimeout(resolve, 30))
}

function num(x, digits = 0) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return '—'
  const fixed = Math.abs(x).toFixed(digits)
  const parts = fixed.split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const trimmed = parts[1] ? parts[1].replace(/0+$/, '') : ''
  return (x < 0 && Number(fixed) !== 0 ? '-' : '') + parts[0] + (trimmed ? '.' + trimmed : '')
}

const FEAS_TONE = { supported: 'ok', risky: 'warn', 'not-recommended': 'bad', insufficient: 'unknown' }
// 与网页版 CHECK_PLAIN 相同的通俗说法
const CHECK_PLAIN = {
  establishment: '种下后头几周气温偏低，苗可能长不好',
  'warm-window': '适合生长的暖和天数不够',
  'plant-death': '收获前会遇到严重低温，植株可能冻死',
  'leaf-frost': '有霜冻风险，叶子可能受冻',
  'underground-cold': '薯块在地里可能受冻或变质（模型没有算这部分损失）',
  harvestable: '到计划收获时积温不够，薯块可能长不大'
}
const STATUS_TONE = { favorable: 'ok', moderate: 'warn', unfavorable: 'bad', unknown: 'unknown' }

function yieldBars(plan, f = 1) {
  const rows = plan.years
  if (rows.length < 2) return []
  const values = rows.map(r => r.fresh)
  const max = Math.max(1, ...values)
  const min = Math.min(...values)
  const mean = values.reduce((a, v) => a + v, 0) / values.length
  if (mean <= 0 || (max - min) / mean < 0.03) return []
  const hi = values.indexOf(max)
  const lo = values.indexOf(min)
  return rows.map((r, i) => ({
    year: String(r.year).slice(2),
    value: num(r.fresh * f),
    height: Math.max(4, Math.round(r.fresh / max * 100)),
    tag: i === hi ? 'best' : i === lo ? 'worst' : ''
  }))
}

function issuesOf(o, planning) {
  const F = o.feasibility
  if (F.status === 'supported' && (!planning || planning.found)) return []
  const items = []
  if (planning && !planning.found) items.push(`比较了 12 个月的种植时间，没有找到合适的露地种植窗口；${planning.selectedDate} 只是相对较好的试验方案。`)
  Object.keys(CHECK_PLAIN).forEach(id => {
    const hit = F.years.filter(y => y.checks.some(c => c.id === id && c.level !== 'pass'))
    if (hit.length) items.push(`${CHECK_PLAIN[id]}：${hit.length}/${F.years.length} 年（${hit.slice(0, 4).map(y => y.year).join('、')}${hit.length > 4 ? ' 等' : ''}）`)
  })
  if (F.reasons.some(x => /过湿与排水/.test(x))) items.push('雨水多、排水差时，地里容易长期过湿')
  if (F.status === 'insufficient') items.push(...F.reasons)
  return items
}

// 页面只需要这些字段；全部是短字符串和小数组，可以直接 setData
// display：{ unit: 'mu'|'ha' }。每亩的数值乘 f 换成每公顷（与网页版 view.f 相同）
function buildView(result, display = {}) {
  const { input: p, output: o, planning, weather, soil } = result
  const f = display.unit === 'ha' ? 15 : 1
  const per = display.unit === 'ha' ? '公顷' : '亩'
  const money = p.currency === 'CNY' ? '元' : p.currency
  const n = (x, d) => num(typeof x === 'number' ? x * f : x, d)
  const F = o.feasibility
  const view = {
    crop: o.crop,
    tone: FEAS_TONE[F.status],
    headline: F.label,
    detail: F.reasons[0] || '',
    supported: F.status === 'supported',
    yieldAvailable: o.yieldAvailable,
    climateScore: o.climateScore === null || o.climateScore === undefined ? '—' : String(o.climateScore),
    footnote: `${p.date} 种植 · ${p.days} 天 · ${num(p.area / f, 2)} ${per}${planning ? ' · 已比较 12 个种植月份' : ''}`,
    issues: issuesOf(o, planning),
    factors: o.factors.map(f => ({
      id: f.id,
      name: f.name,
      statusText: f.statusText,
      score: f.score === null ? '' : String(f.score),
      width: f.score === null ? 0 : Math.max(0, Math.min(100, f.score)),
      tone: STATUS_TONE[f.status] || 'unknown',
      evidence: f.evidence
    })),
    source: `${weather.kind === 'demo' ? '人工天气情景 · 不代表实测或预测' : '历史天气'} · ${o.yearRange[0]}–${o.yearRange[o.yearRange.length - 1]} · ${o.count} 个生长季 · ` +
      (soil ? '土壤：国内表层格网背景值，按 0–20cm 耕层换算' : p.soilOrigin === 'manual' ? '养分：示例/手填值，非测土' : '未计算养分'),
    version: `算法 ${o.version} · 参数 ${o.parameterVersion} · 未做地区校准`,
    waterText: o.management.waterText,
    irrigation: p.water === 'sufficient' ? `平均补灌约 ${n(o.diagnostics.irrigation * 2 / 3, 1)} 立方米/${per}` : '',
    per,
    money
  }
  if (!o.yieldAvailable) return view

  const b = o.plan || o.best
  const avg = key => b.years.reduce((a, y) => a + (y[key] || 0), 0) / b.years.length
  const revenue = avg('revenue')
  const water = o.water.deducted ? avg('irrigationCost') : null
  const harvest = avg('harvestCost')
  const need = o.fertilizerNeed
  Object.assign(view, {
    yieldText: o.count > 1 && n(b.low) !== n(b.high) ? `${n(b.low)}–${n(b.high)}` : n(b.fresh),
    yieldMean: n(b.fresh),
    saleable: n(b.saleable),
    marketable: num(p.marketable * 100),
    net: n(b.net),
    netLow: n(b.netLow),
    revenue: n(revenue),
    cost: n(revenue - b.net),
    breakEven: b.breakEvenPrice === null ? '无法计算' : num(b.breakEvenPrice, 2) + ` ${money}/kg`,
    lossShare: num(b.lossShare * 100),
    bars: yieldBars(b, f),
    costs: [
      { name: '基础成本', value: n(p.base), note: '种苗、人工、地租等' },
      { name: '肥料', value: n(b.cost), note: b.products && b.products.length ? b.products.map(x => `${x.name} ${n(x.kg)} kg`).join('、') : '不另施肥' },
      { name: '灌溉用水', value: water === null ? (o.water.inBase ? '已含在基础成本' : '未计入') : n(water), note: p.irrigationPrice === null ? '未填灌溉费' : `按 ${num(p.irrigationPrice, 2)} ${money}/立方米` },
      { name: '采收运输', value: n(harvest), note: '按产量计' },
      { name: '合计', value: n(p.base + b.cost + harvest + (water || 0)), note: '以上各项之和' }
    ],
    fertilizer: need ? {
      level: need.level,
      tone: need.level === '较多' ? 'bad' : need.level === '中等' ? 'warn' : 'ok',
      summary: need.summary,
      advice: o.plan ? (o.plan.products.length
        ? `推荐施 ${o.plan.products.map(x => `${x.name} 约 ${n(x.kg)} kg`).join('、')}/${per}，约 ${n(o.plan.cost)} ${money}/${per}`
        : '不另施肥：模型算得施肥增收不明显') : ''
    } : null
  })
  return view
}

module.exports = {
  PRESETS,
  CROP_OPTIONS,
  UNIT_OPTIONS,
  DATE_MODE_OPTIONS,
  SOURCE_OPTIONS,
  YEARS_OPTIONS,
  CURRENCIES,
  RISK_OPTIONS,
  FERT_PRICES,
  IRRIGATION_EXAMPLE_CNY,
  SOIL_FRACTIONS,
  WATER_OPTIONS,
  DRAINAGE_OPTIONS,
  TEXTURE_OPTIONS,
  SOIL_OPTIONS,
  NUTRIENT_DEFAULTS,
  crops: M.crops,
  isDomestic,
  fetchSoil,
  analyze,
  buildView,
  num
}
