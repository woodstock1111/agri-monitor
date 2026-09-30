const api = require('../../utils/api.js')
const H = require('../../utils/harvest.js')

const CROPS = [
  { value: 'sweetpotato', label: '红薯' },
  { value: 'cassava', label: '木薯' }
]

function validPoint(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
}

// WGS84 -> GCJ-02 的逆换算：wx.chooseLocation 返回高德/腾讯坐标（GCJ-02），模型和土壤格网用 WGS84（与网页版 harvest.js 相同）
function gcjOffset(lat, lng) {
  const a = 6378245
  const ee = 0.00669342162296594323
  const x = lng - 105
  const y = lat - 35
  const dLat = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x)) + (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3 + (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3 + (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3
  const dLng = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x)) + (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3 + (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3 + (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3
  const rad = lat / 180 * Math.PI
  const magic = 1 - ee * Math.sin(rad) * Math.sin(rad)
  const sq = Math.sqrt(magic)
  return [dLat * 180 / ((a * (1 - ee)) / (magic * sq) * Math.PI), dLng * 180 / (a / sq * Math.cos(rad) * Math.PI)]
}
function outsideChina(lat, lng) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}
function gcjToWgs(lat, lng) {
  if (outsideChina(lat, lng)) return [lat, lng]
  let w = [lat, lng]
  for (let i = 0; i < 3; i++) {
    const d = gcjOffset(w[0], w[1])
    w = [w[0] - (w[0] + d[0] - lat), w[1] - (w[1] + d[1] - lng)]
  }
  return w
}

Page({
  data: {
    crops: CROPS,
    cropIndex: 0,
    places: [],
    placeIndex: 0,
    lat: null,
    lng: null,
    pointText: '',
    dateMode: 'auto',
    date: '',
    days: 150,
    area: 10,
    waterOptions: H.WATER_OPTIONS,
    waterIndex: 0,
    drainageOptions: H.DRAINAGE_OPTIONS,
    drainageIndex: 0,
    textureOptions: H.TEXTURE_OPTIONS,
    textureIndex: 0,
    soilOptions: H.SOIL_OPTIONS,
    soilIndex: 0,
    soilState: 'idle', // idle | loading | ready | error | off
    soilText: '',
    ph: H.NUTRIENT_DEFAULTS.ph,
    n: H.NUTRIENT_DEFAULTS.n,
    p: H.NUTRIENT_DEFAULTS.p,
    k: H.NUTRIENT_DEFAULTS.k,
    price: 2,
    base: 1000,
    budget: 500,
    moreOpen: false,
    running: false,
    stage: '',
    error: '',
    stale: false,
    view: null
  },

  _soil: null,
  _soilToken: 0,
  _runToken: 0,

  onLoad(options) {
    this._wantPlot = (options && options.plotId) || ''
    this.setData({ date: new Date().toISOString().slice(0, 10) })
    this.loadPlaces()
  },

  onUnload() {
    this._soilToken++
    this._runToken++
  },

  async loadPlaces() {
    let plots = []
    try {
      const res = await api.getPlots()
      plots = ((res && res.plots) || [])
        .filter(p => validPoint(Number(p.lat), Number(p.lng)))
        .map(p => ({ id: p.id, name: p.name, lat: Number(p.lat), lng: Number(p.lng), area: Number(p.area) }))
    } catch (e) {}
    const places = plots.map(p => ({ ...p, label: '我的地块 · ' + p.name }))
      .concat(H.PRESETS.map(p => ({ ...p, label: '示例 · ' + p.name })))
      .concat([{ id: 'pick', label: '在地图上选点…' }])
    let index = places.findIndex(p => p.id === this._wantPlot)
    if (index < 0) index = 0
    this.setData({ places })
    this.usePlace(index)
  },

  usePlace(index) {
    const place = this.data.places[index]
    if (!place) return
    if (place.id === 'pick') {
      this.pickOnMap()
      return
    }
    const patch = { placeIndex: index }
    if (Number.isFinite(place.area) && place.area > 0) patch.area = place.area
    this.setData(patch)
    this.setPoint(place.lat, place.lng)
  },

  pickOnMap() {
    const lat = this.data.lat
    const lng = this.data.lng
    wx.chooseLocation({
      latitude: validPoint(lat, lng) ? lat : undefined,
      longitude: validPoint(lat, lng) ? lng : undefined,
      success: res => {
        const w = gcjToWgs(res.latitude, res.longitude)
        const places = this.data.places.slice()
        const custom = { id: 'custom', label: '地图选点 · ' + (res.name || '自定义位置'), lat: Number(w[0].toFixed(5)), lng: Number(w[1].toFixed(5)) }
        const at = places.findIndex(p => p.id === 'custom')
        if (at >= 0) places[at] = custom
        else places.splice(places.length - 1, 0, custom)
        this.setData({ places, placeIndex: places.indexOf(custom) })
        this.setPoint(custom.lat, custom.lng)
      },
      fail: err => {
        if (err && /auth|deny/i.test(err.errMsg || '')) wx.showToast({ title: '需要允许选择位置', icon: 'none' })
      }
    })
  },

  setPoint(lat, lng) {
    this.setData({ lat, lng, pointText: `${lat.toFixed(4)}°, ${lng.toFixed(4)}° · WGS84` })
    const soilMode = H.SOIL_OPTIONS[this.data.soilIndex].value
    // 与网页版一致：国外的点自动改为只看天气；手填模式保持不变
    if (soilMode === 'china' && !H.isDomestic(lat, lng)) {
      this.setData({ soilIndex: H.SOIL_OPTIONS.findIndex(o => o.value === 'climate') })
      wx.showToast({ title: '国外地点只看天气', icon: 'none' })
    }
    this.markStale()
    this.loadSoil()
  },

  async loadSoil() {
    const token = ++this._soilToken
    this._soil = null
    const mode = H.SOIL_OPTIONS[this.data.soilIndex].value
    if (mode !== 'china') {
      this.setData({ soilState: 'off', soilText: mode === 'manual' ? '使用下方的示例养分，可按化验结果修改。' : '只分析天气与水分，不计算产量和收益。' })
      return
    }
    const { lat, lng } = this.data
    if (!validPoint(lat, lng)) return
    this.setData({ soilState: 'loading', soilText: '正在读取国内土壤格网…' })
    const data = await H.fetchSoil(lat, lng)
    if (token !== this._soilToken) return
    if (!data.ok) {
      this.setData({ soilState: 'error', soilText: data.msg || '此点暂无土壤数据。' })
      return
    }
    this._soil = data
    const f = data.fields
    const near = data.nearest ? `附近约 ${H.num(data.nearest.distanceKm, 1)} km 处的数据 · ` : ''
    this.setData({
      soilState: 'ready',
      soilText: `${near}pH ${H.num(f.ph.value, 1)} · 氮 ${H.num(f.availableN.value, 0)} · 磷 ${H.num(f.availableP.value, 0)} · 钾 ${H.num(f.availableK.value, 0)} mg/kg（表层背景值，非实时测土）`
    })
  },

  markStale() {
    if (this.data.view) this.setData({ stale: true })
  },

  onPlace(e) {
    this.usePlace(Number(e.detail.value))
  },
  onCrop(e) {
    const cropIndex = Number(e.currentTarget.dataset.index)
    if (cropIndex === this.data.cropIndex) return
    this.setData({ cropIndex, days: H.crops[CROPS[cropIndex].value].days })
    this.markStale()
  },
  onDateMode(e) {
    this.setData({ dateMode: e.currentTarget.dataset.mode })
    this.markStale()
  },
  onDate(e) {
    this.setData({ date: e.detail.value, dateMode: 'manual' })
    this.markStale()
  },
  onPicker(e) {
    this.setData({ [e.currentTarget.dataset.key]: Number(e.detail.value) })
    this.markStale()
    if (e.currentTarget.dataset.key === 'soilIndex') this.loadSoil()
  },
  onNumber(e) {
    this.setData({ [e.currentTarget.dataset.key]: e.detail.value })
    this.markStale()
  },
  onUseManual() {
    this.setData({ soilIndex: H.SOIL_OPTIONS.findIndex(o => o.value === 'manual') })
    this.markStale()
    this.loadSoil()
  },
  onToggleMore() {
    this.setData({ moreOpen: !this.data.moreOpen })
  },

  readForm() {
    const d = this.data
    const number = (key, label, min, max) => {
      const v = Number(d[key])
      if (String(d[key]).trim() === '' || !Number.isFinite(v) || v < min || v > max) throw new Error(`${label}需在 ${min}–${max} 之间`)
      return v
    }
    if (!validPoint(d.lat, d.lng)) throw new Error('请先选择地块或位置')
    const soilMode = H.SOIL_OPTIONS[d.soilIndex].value
    const form = {
      lat: d.lat,
      lng: d.lng,
      crop: CROPS[d.cropIndex].value,
      dateMode: d.dateMode,
      date: d.date,
      days: Math.round(number('days', '生育期（天）', 60, 365)),
      area: number('area', '面积（亩）', 0.001, 100000),
      water: H.WATER_OPTIONS[d.waterIndex].value,
      drainage: H.DRAINAGE_OPTIONS[d.drainageIndex].value,
      texture: H.TEXTURE_OPTIONS[d.textureIndex].value,
      soilMode,
      price: number('price', '售价', 0, 1000),
      base: number('base', '基础成本', 0, 1000000),
      budget: number('budget', '肥料预算', 0, 1000000),
      ph: 6, n: 0, p: 0, k: 0
    }
    if (soilMode === 'manual') {
      Object.assign(form, { ph: number('ph', 'pH', 3, 10), n: number('n', '氮供应', 0, 500), p: number('p', '磷供应', 0, 500), k: number('k', '钾供应', 0, 1000) })
    }
    return form
  },

  async onRun() {
    if (this.data.running) return
    let form
    try {
      form = this.readForm()
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' })
      return
    }
    if (form.soilMode === 'china' && !this._soil) {
      wx.showToast({ title: this.data.soilState === 'loading' ? '土壤还在读取，请稍等' : '土壤没读到，可改用示例养分', icon: 'none' })
      return
    }
    const token = ++this._runToken
    this.setData({ running: true, error: '', stage: '正在准备…' })
    wx.pageScrollTo({ selector: '#result', duration: 300 })
    try {
      const result = await H.analyze(form, this._soil, {
        onStage: stage => { if (token === this._runToken) this.setData({ stage }) }
      })
      if (token !== this._runToken) return
      const view = H.buildView(result)
      if (result.planning) this.setData({ date: result.input.date })
      this.setData({ view, stale: false, running: false, stage: '' })
      wx.vibrateShort({ type: 'light' })
    } catch (e) {
      if (token !== this._runToken) return
      this.setData({ running: false, stage: '', error: e.message || '分析失败，请重试。' })
    }
  }
})
