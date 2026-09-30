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

const PRESETS = [
  { id: 'preset-haikou', name: '海南 · 海口', lat: 20.045, lng: 110.198 },
  { id: 'preset-weifang', name: '山东 · 潍坊', lat: 36.71, lng: 119.1 },
  { id: 'preset-wuming', name: '广西 · 南宁（武鸣）', lat: 23.16, lng: 108.27 }
]
const WATER_OPTIONS = [
  { value: 'sufficient', label: '水源充足 · 缺水时及时浇' },
  { value: 'rain', label: '只靠下雨 · 不额外浇水' }
]
const DRAINAGE_OPTIONS = [
  { value: 'unknown', label: '不确定 · 按一般计算' },
  { value: 'good', label: '良好 · 高垄、沟渠通畅' },
  { value: 'moderate', label: '一般' },
  { value: 'poor', label: '较差 / 易积水' }
]
const TEXTURE_OPTIONS = [
  { value: 'loam', label: '壤土' },
  { value: 'sandy', label: '砂质土' },
  { value: 'clay', label: '黏质土' }
]
const SOIL_OPTIONS = [
  { value: 'china', label: '读取国内土壤格网' },
  { value: 'manual', label: '使用示例养分（可改）' },
  { value: 'climate', label: '只看天气，不算产量' }
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

/* form：页面表单（亩、人民币）。soil：fetchSoil 的成功结果或 null。
 * onStage(text)：进度文字。返回 { input, output, planning, weather, soil }，只在内存里用。 */
async function analyze(form, soil, { request = auth.request, onStage = () => {}, years = 10 } = {}) {
  const raw = {
    lat: form.lat, lng: form.lng, area: form.area, days: form.days, crop: form.crop, date: form.date,
    water: form.water, drainage: form.drainage, texture: form.texture, risk: 'cautious', currency: 'CNY',
    rootDepth: M.crops[form.crop].rootDepth, initialWater: 0.6, irrigationLimit: 300, irrigationDailyMax: 15,
    price: form.price, base: form.base, budget: form.budget, fertPrice: FERT_PRICES.npk, marketable: 0.85, harvestCost: 0,
    irrigationPrice: IRRIGATION_EXAMPLE_CNY, irrigationInBase: false, irrigationPriceOrigin: 'example',
    variety: 'generic', soilOrigin: form.soilMode,
    ph: form.ph, n: form.n, p: form.p, k: form.k
  }
  let usedSoil = null
  if (form.soilMode === 'china') {
    if (!soil || !soil.ok) throw new Error('土壤数据还没就绪，可以改用示例养分或只看天气。')
    Object.assign(raw, M.soilSupply(soil, SOIL_FRACTIONS))
    usedSoil = soil
  }
  if (form.soilMode === 'climate') {
    Object.assign(raw, { n: 0, p: 0, k: 0, ph: 6, price: 0, base: 0, budget: 0, fertPrice: 1, marketable: 1, harvestCost: 0, existingRate: 0, maxRate: 0, fertilizer: [0, 0, 0] })
  }
  const p = M.normalize(raw)

  let planning = null
  let weather
  if (form.dateMode === 'auto') {
    onStage('正在读取多年天气…')
    const today = todayString()
    const year = Number(today.slice(0, 4))
    const windows = []
    for (let month = 1; month <= 12; month++) {
      const suffix = '-' + String(month).padStart(2, '0') + '-15'
      let date = year + suffix
      if (date < today) date = (year + 1) + suffix
      const climate = await seasonsFor({ ...p, date }, years, true, request)
      windows.push({ date, seasons: climate.included, weather: climate })
    }
    onStage('正在比较 12 个种植月份…')
    await yieldToUi()
    const ranking = M.rankPlantingWindows(p, windows, { weatherKind: 'history' })
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
    onStage('正在读取多年天气…')
    weather = await seasonsFor(p, years, false, request)
  }

  onStage('正在逐日计算生长与收益…')
  await yieldToUi()
  const output = p.soilOrigin === 'climate'
    ? M.evaluateClimate(p, weather.included, { weatherKind: weather.kind })
    : M.evaluateEnsemble(p, weather.included, { weatherKind: weather.kind, fertilizerPrices: { urea: FERT_PRICES.urea, sop: FERT_PRICES.sop, mop: FERT_PRICES.mop } })
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

function yieldBars(plan) {
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
    value: num(r.fresh),
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
function buildView(result) {
  const { input: p, output: o, planning, weather, soil } = result
  const F = o.feasibility
  const view = {
    crop: o.crop,
    tone: FEAS_TONE[F.status],
    headline: F.label,
    detail: F.reasons[0] || '',
    supported: F.status === 'supported',
    yieldAvailable: o.yieldAvailable,
    climateScore: o.climateScore === null || o.climateScore === undefined ? '—' : String(o.climateScore),
    footnote: `${p.date} 种植 · ${p.days} 天 · ${num(p.area, 2)} 亩${planning ? ' · 已比较 12 个种植月份' : ''}`,
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
    source: `${weather.source} · ${o.yearRange[0]}–${o.yearRange[o.yearRange.length - 1]} · ${o.count} 个生长季 · ` +
      (soil ? '土壤：国内表层格网背景值，按 0–20cm 耕层换算' : p.soilOrigin === 'manual' ? '养分：示例/手填值，非测土' : '未计算养分'),
    version: `算法 ${o.version} · 参数 ${o.parameterVersion} · 未做地区校准`,
    waterText: o.management.waterText,
    irrigation: p.water === 'sufficient' ? `平均补灌约 ${num(o.diagnostics.irrigation * 2 / 3, 1)} 立方米/亩` : ''
  }
  if (!o.yieldAvailable) return view

  const b = o.plan || o.best
  const avg = key => b.years.reduce((a, y) => a + (y[key] || 0), 0) / b.years.length
  const revenue = avg('revenue')
  const water = o.water.deducted ? avg('irrigationCost') : null
  const harvest = avg('harvestCost')
  const need = o.fertilizerNeed
  Object.assign(view, {
    yieldText: o.count > 1 && num(b.low) !== num(b.high) ? `${num(b.low)}–${num(b.high)}` : num(b.fresh),
    yieldMean: num(b.fresh),
    saleable: num(b.saleable),
    net: num(b.net),
    netLow: num(b.netLow),
    revenue: num(revenue),
    cost: num(revenue - b.net),
    breakEven: b.breakEvenPrice === null ? '无法计算' : num(b.breakEvenPrice, 2) + ' 元/kg',
    lossShare: num(b.lossShare * 100),
    bars: yieldBars(b),
    costs: [
      { name: '基础成本', value: num(p.base), note: '种苗、人工、地租等' },
      { name: '肥料', value: num(b.cost), note: b.products && b.products.length ? b.products.map(x => `${x.name} ${num(x.kg)} kg`).join('、') : '不另施肥' },
      { name: '灌溉用水', value: water === null ? '未计入' : num(water), note: `按参考单价 ${IRRIGATION_EXAMPLE_CNY} 元/立方米` },
      { name: '采收运输', value: num(harvest), note: '按产量计' },
      { name: '合计', value: num(p.base + b.cost + harvest + (water || 0)), note: '以上各项之和' }
    ],
    fertilizer: need ? {
      level: need.level,
      tone: need.level === '较多' ? 'bad' : need.level === '中等' ? 'warn' : 'ok',
      summary: need.summary,
      advice: o.plan ? (o.plan.products.length
        ? `推荐施 ${o.plan.products.map(x => `${x.name} 约 ${num(x.kg)} kg`).join('、')}/亩，约 ${num(o.plan.cost)} 元/亩`
        : '不另施肥：模型算得施肥增收不明显') : ''
    } : null
  })
  return view
}

module.exports = {
  PRESETS,
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
