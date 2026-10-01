// AI收成预测：表单与网页版 harvest.js 逐项一致（分区、字段、选项、提示）；结果仍用小程序的摘要卡片。
// 同一个组件既放在园区地图的底部抽屉里，也放在独立页面里。
const api = require('../../utils/api.js')
const H = require('../../utils/harvest.js')
const M = require('../../utils/harvest-model.js')

// 0,0 是“没有填位置”的占位值，不是真实地块
function validPoint(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
}
const NO_LOCATION = '这块地还没有填位置：请在地块台账里补填经纬度，或点“在地图上选点”。'

// GCJ-02 -> WGS84：wx.chooseLocation 返回腾讯/高德坐标，模型和土壤格网用 WGS84（与网页版 fromMap 相同）
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

const index = (list, value) => Math.max(0, list.findIndex(o => o.value === value))
const QUICK_IDLE = '默认红薯 · 150天 · 自动比较种植时间 · 按及时灌溉计算'

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    plotId: { type: String, value: '' },
    // 滚动区高度（px）。抽屉和独立页面各自传入
    height: { type: Number, value: 600 },
    // 独立页面显示页头；抽屉里由抽屉自己的标题栏代替
    hero: { type: Boolean, value: false }
  },
  data: {
    cropOptions: H.CROP_OPTIONS,
    unitOptions: H.UNIT_OPTIONS,
    dateModeOptions: H.DATE_MODE_OPTIONS,
    sourceOptions: H.SOURCE_OPTIONS,
    yearsOptions: H.YEARS_OPTIONS,
    soilOptions: H.SOIL_OPTIONS,
    textureOptions: H.TEXTURE_OPTIONS,
    waterOptions: H.WATER_OPTIONS,
    drainageOptions: H.DRAINAGE_OPTIONS,
    currencies: H.CURRENCIES,
    riskOptions: H.RISK_OPTIONS,
    irrigationExample: H.IRRIGATION_EXAMPLE_CNY,

    cropIndex: 0,
    variety: '',
    cropNote: '',
    places: [],
    placeIndex: 0,
    lat: '',
    lng: '',
    pointText: '',

    unitIndex: 0,
    per: '亩',
    area: '10',
    dateModeIndex: 0,
    date: '',
    days: '150',
    sourceIndex: 0,
    yearsIndex: 1,

    soilIndex: 0,
    soilState: 'idle',
    soilText: '',
    soilFields: [],
    soilNearby: '',
    textureIndex: 0,
    waterIndex: 0,
    drainageIndex: 0,
    irrigationLimit: '300',
    irrigationPrice: String(H.IRRIGATION_EXAMPLE_CNY),
    irrigationInBase: false,

    rootDepth: String(M.crops.sweetpotato.rootDepth),
    initialWater: '0.6',
    irrigationDailyMax: '15',
    ph: String(H.NUTRIENT_DEFAULTS.ph),
    n: String(H.NUTRIENT_DEFAULTS.n),
    p: String(H.NUTRIENT_DEFAULTS.p),
    k: String(H.NUTRIENT_DEFAULTS.k),
    fracN: '0.3',
    fracP: '0.2',
    fracK: '0.4',

    currencyIndex: 0,
    budget: '500',
    price: '2',
    base: '1000',
    marketable: '0.85',
    harvestCost: '0',
    fertPrice: String(H.FERT_PRICES.npk),
    riskIndex: 0,

    settingsOpen: false,
    proOpen: false,
    econOpen: true,

    running: false,
    quickStatus: QUICK_IDLE,
    status: '选好地块与条件后即可开始。',
    error: '',
    stale: false,
    view: null,
    scrollTarget: ''
  },

  lifetimes: {
    attached() {
      this._soil = null
      this._soilKey = ''
      this._soilToken = 0
      this._runToken = 0
      this._autoClimate = false
      this._priceTouched = false
      this._nutrientOrigin = null
      this.setData({ date: new Date().toISOString().slice(0, 10), cropNote: this.cropNote(0) })
      this.loadPlaces()
    },
    detached() {
      this._soilToken++
      this._runToken++
    }
  },

  methods: {
    // 参数出处只在网页版管理员的“数据来源与隐私说明”里列出
    cropNote() {
      return '参数均未做地区标定。填写品种名用于记录，不会自动生成该品种的已验证参数。'
    },

    async loadPlaces() {
      let plots = []
      try {
        const res = await api.getPlots()
        plots = ((res && res.plots) || []).map(p => {
          const lat = p.lat === '' || p.lat == null ? NaN : Number(p.lat)
          const lng = p.lng === '' || p.lng == null ? NaN : Number(p.lng)
          return validPoint(lat, lng) ? { id: p.id, name: p.name, lat, lng } : { id: p.id, name: p.name, noLocation: true }
        })
      } catch (e) {}
      // 与网页版的分组一致：我的地块 → 示例区域 → 地图选点 / 自定义坐标
      const places = plots.map(p => ({ ...p, label: '我的地块 · ' + p.name + (p.noLocation ? '（未填位置）' : '') }))
        .concat(H.PRESETS.map(p => ({ ...p, label: '示例区域 · ' + p.name })))
        .concat([{ id: 'custom', label: '地图选点 / 自定义坐标' }])
      let at = places.findIndex(p => p.id === this.properties.plotId)
      if (at < 0) at = places.findIndex(p => p.id === 'preset-0')
      this.setData({ places })
      this.usePlace(at)
    },

    usePlace(at) {
      const place = this.data.places[at]
      if (!place) return
      if (place.id === 'custom') {
        this.setData({ placeIndex: at })
        this.pickOnMap()
        return
      }
      if (place.noLocation) {
        // 没有位置的地块可以选中，但不带坐标、不读土壤、不能开始分析
        this.invalidate()
        this.clearSoil()
        this.setData({ placeIndex: at, lat: '', lng: '', pointText: '', soilState: 'error', soilText: NO_LOCATION })
        this.setStatus(NO_LOCATION)
        return
      }
      this.setData({ placeIndex: at, lat: String(place.lat), lng: String(place.lng) })
      this.pointChanged()
    },

    pickOnMap() {
      const lat = Number(this.data.lat)
      const lng = Number(this.data.lng)
      const known = validPoint(lat, lng)
      wx.chooseLocation({
        latitude: known ? lat : undefined,
        longitude: known ? lng : undefined,
        success: res => {
          const w = gcjToWgs(res.latitude, res.longitude)
          this.setData({ placeIndex: this.data.places.length - 1, lat: w[0].toFixed(5), lng: w[1].toFixed(5) })
          this.pointChanged()
        },
        fail: err => {
          if (err && /auth|deny/i.test(err.errMsg || '')) wx.showToast({ title: '需要允许选择位置', icon: 'none' })
        }
      })
    },

    pointKey() {
      const lat = Number(this.data.lat)
      const lng = Number(this.data.lng)
      return this.data.lat !== '' && this.data.lng !== '' && validPoint(lat, lng) ? lat + ',' + lng : ''
    },

    // 与网页版 pointChanged() 相同：国外点自动切到只看天气，回到国内自动恢复读取土壤
    pointChanged() {
      this.invalidate()
      const lat = Number(this.data.lat)
      const lng = Number(this.data.lng)
      if (!this.pointKey()) {
        this.clearSoil()
        this.setStatus('请输入有效经纬度')
        return
      }
      const patch = { pointText: `${lat.toFixed(5)}, ${lng.toFixed(5)} · WGS84` }
      let reset = ''
      if (this._nutrientOrigin && this._nutrientOrigin.kind === 'soil' && this._nutrientOrigin.key !== this.pointKey()) {
        Object.assign(patch, { ph: String(H.NUTRIENT_DEFAULTS.ph), n: String(H.NUTRIENT_DEFAULTS.n), p: String(H.NUTRIENT_DEFAULTS.p), k: String(H.NUTRIENT_DEFAULTS.k) })
        this._nutrientOrigin = null
        reset = '手填养分已恢复为示例值（原数值来自上一个地点的土壤），请按当前地块核对。'
      }
      const domestic = H.isDomestic(lat, lng)
      const mode = H.SOIL_OPTIONS[this.data.soilIndex].value
      if (mode === 'china' && !domestic) {
        this._autoClimate = true
        patch.soilIndex = index(H.SOIL_OPTIONS, 'climate')
        this.setStatus('此点超出国内格网范围，已切换为气候初筛；回到国内会自动读取土壤。')
      } else if (this._autoClimate && domestic) {
        this._autoClimate = false
        patch.soilIndex = index(H.SOIL_OPTIONS, 'china')
      }
      this.setData(patch)
      this.loadSoil()
      if (reset && H.SOIL_OPTIONS[this.data.soilIndex].value === 'manual') this.setData({ soilText: reset })
    },

    clearSoil() {
      this._soilToken++
      this._soil = null
      this._soilKey = ''
      this.setData({ soilFields: [], soilNearby: '' })
      if (H.SOIL_OPTIONS[this.data.soilIndex].value === 'china') this.setData({ soilState: 'idle', soilText: '等待当前地点土壤数据。' })
    },

    async loadSoil() {
      this.clearSoil()
      const mode = H.SOIL_OPTIONS[this.data.soilIndex].value
      if (mode !== 'china') {
        this.setData({
          soilState: 'off',
          soilText: mode === 'manual'
            ? '手填养分模式：当前数值需自行核对，可点击上方按钮恢复内置国内土壤。'
            : this._autoClimate ? '此点在国内格网范围外；仅分析气候。回到国内将自动读取内置土壤。' : '当前仅分析气候；国内地点可点击上方按钮读取内置土壤。'
        })
        return
      }
      const key = this.pointKey()
      if (!key) {
        this.setData({ soilText: '请先填写有效经纬度' })
        return
      }
      const token = this._soilToken
      this.setData({ soilState: 'loading', soilText: '正在读取内置国内土壤…' })
      const data = await H.fetchSoil(Number(this.data.lat), Number(this.data.lng))
      if (token !== this._soilToken) return
      if (!data.ok) {
        this.setData({ soilState: 'error', soilText: data.msg || '此点暂无土壤数据' })
        return
      }
      this._soil = data
      this._soilKey = key
      this.applySoil()
      const f = data.fields
      const nearby = data.nearest ? `已使用附近约 ${H.num(data.nearest.distanceKm, 1)} km 处的数据（原点位没有土壤值，可能是城区或水面）` : ''
      this.setData({
        soilState: 'ready',
        soilText: (nearby ? nearby + ' · ' : '内置土壤已就绪 · ') + 'pH ' + H.num(f.ph.value, 2) + ' · 氮 ' + H.num(f.availableN.value, 1) + ' / 磷 ' + H.num(f.availableP.value, 1) + ' / 钾 ' + H.num(f.availableK.value, 1) + ' mg/kg（表层背景）',
        soilFields: Object.keys(f).map(k => ({ key: k, label: f[k].label, value: H.num(f[k].value, 2), unit: f[k].unit })),
        soilNearby: nearby
      })
    },

    fractions() {
      return [this.data.fracN, this.data.fracP, this.data.fracK].map(Number)
    },

    // 土壤读到后把整季供应写进 pH / N / P / K（与网页版 applySoil 相同，这几项此时不可编辑）
    applySoil() {
      if (!this._soil) throw new Error('土壤尚未就绪，请点击读取内置国内土壤重试。')
      if (this._soilKey !== this.pointKey()) throw new Error('土壤数据属于上一个地点，请等待当前地点读取完成后再分析。')
      const v = M.soilSupply(this._soil, this.fractions())
      this.setData({ ph: String(v.ph), n: String(v.n), p: String(v.p), k: String(v.k) })
      this._nutrientOrigin = { kind: 'soil', key: this._soilKey }
      return v
    },

    setStatus(text) {
      this.setData({ status: text, quickStatus: text })
    },

    invalidate() {
      this._runToken++
      if (!this.data.view && !this.data.running) return
      this.setData({ stale: !!this.data.view, running: false })
      this.setStatus('条件已修改，请重新计算。')
    },

    // ---- 表单事件 ----
    onCrop(e) {
      const cropIndex = Number(e.detail.value)
      const crop = M.crops[H.CROP_OPTIONS[cropIndex].value]
      this.setData({ cropIndex, days: String(crop.days), rootDepth: String(crop.rootDepth), cropNote: this.cropNote(cropIndex) })
      this.invalidate()
    },
    onPlace(e) {
      this.usePlace(Number(e.detail.value))
    },
    onPickMap() {
      this.pickOnMap()
    },
    onCoord(e) {
      this.setData({ [e.currentTarget.dataset.key]: e.detail.value, placeIndex: this.data.places.length - 1 })
      this.invalidate()
      this.clearSoil()
    },
    onCoordDone() {
      this.pointChanged()
    },
    onInput(e) {
      const key = e.currentTarget.dataset.key
      this.setData({ [key]: e.detail.value })
      if (key === 'irrigationPrice') this._priceTouched = true
      if (key === 'ph' || key === 'n' || key === 'p' || key === 'k') this._nutrientOrigin = { kind: 'user' }
      if ((key === 'fracN' || key === 'fracP' || key === 'fracK') && this._soil) {
        try { this.applySoil() } catch (err) { this.setData({ soilText: err.message }) }
      }
      this.invalidate()
    },
    onPicker(e) {
      const key = e.currentTarget.dataset.key
      this.setData({ [key]: Number(e.detail.value) })
      this.invalidate()
    },
    onUnit(e) {
      const next = Number(e.detail.value)
      if (next === this.data.unitIndex) return
      // 与网页版 changeUnit 相同：每亩 ↔ 每公顷的金额和面积一起换算
      const ratio = H.UNIT_OPTIONS[next].value === 'ha' ? 15 : 1 / 15
      const fix = v => String(Number((Number(v) * ratio).toFixed(6)))
      const patch = { unitIndex: next, per: H.UNIT_OPTIONS[next].value === 'ha' ? '公顷' : '亩' }
      ;['budget', 'base'].forEach(k => { if (this.data[k] !== '' && Number.isFinite(Number(this.data[k]))) patch[k] = fix(this.data[k]) })
      patch.area = String(Number((Number(this.data.area) / ratio).toFixed(6)))
      this.setData(patch)
      this.invalidate()
    },
    onDateMode(e) {
      this.setData({ dateModeIndex: Number(e.detail.value) })
      this.invalidate()
    },
    onDate(e) {
      this.setData({ date: e.detail.value, dateModeIndex: index(H.DATE_MODE_OPTIONS, 'manual') })
      this.invalidate()
    },
    onSoilMode(e) {
      this._autoClimate = false
      this.setData({ soilIndex: Number(e.detail.value) })
      this.invalidate()
      this.loadSoil()
    },
    onUseLocalSoil() {
      this._autoClimate = false
      this.setData({ soilIndex: index(H.SOIL_OPTIONS, 'china') })
      this.invalidate()
      this.loadSoil()
    },
    onSoilRetry() {
      this.invalidate()
      this.loadSoil()
    },
    onCurrency(e) {
      const currencyIndex = Number(e.detail.value)
      const patch = { currencyIndex }
      if (!this._priceTouched) patch.irrigationPrice = H.CURRENCIES[currencyIndex] === 'CNY' ? String(H.IRRIGATION_EXAMPLE_CNY) : ''
      this.setData(patch)
      this.invalidate()
    },
    onInBase(e) {
      this.setData({ irrigationInBase: e.detail.value.length > 0 })
      this.invalidate()
    },
    onToggle(e) {
      const key = e.currentTarget.dataset.key
      this.setData({ [key]: !this.data[key] })
    },
    onOpenSettings() {
      this.setData({ settingsOpen: true, scrollTarget: '' }, () => this.setData({ scrollTarget: 'hv-settings' }))
    },

    // 与网页版 params() 相同；面积单位为公顷时换算成每亩
    params() {
      const d = this.data
      const number = key => String(d[key]).trim() === '' ? NaN : Number(d[key])
      const form = {
        lat: number('lat'), lng: number('lng'), area: number('area'), days: number('days'),
        ph: number('ph'), n: number('n'), p: number('p'), k: number('k'),
        budget: number('budget'), price: number('price'), base: number('base'), fertPrice: number('fertPrice'),
        rootDepth: number('rootDepth'), initialWater: number('initialWater'),
        irrigationLimit: number('irrigationLimit'), irrigationDailyMax: number('irrigationDailyMax'),
        marketable: number('marketable'), harvestCost: number('harvestCost'),
        crop: H.CROP_OPTIONS[d.cropIndex].value,
        date: d.date,
        dateMode: H.DATE_MODE_OPTIONS[d.dateModeIndex].value,
        source: H.SOURCE_OPTIONS[d.sourceIndex].value,
        years: H.YEARS_OPTIONS[d.yearsIndex].value,
        water: H.WATER_OPTIONS[d.waterIndex].value,
        drainage: H.DRAINAGE_OPTIONS[d.drainageIndex].value,
        texture: H.TEXTURE_OPTIONS[d.textureIndex].value,
        risk: H.RISK_OPTIONS[d.riskIndex].value,
        currency: H.CURRENCIES[d.currencyIndex],
        irrigationPrice: String(d.irrigationPrice).trim() === '' ? null : number('irrigationPrice'),
        irrigationInBase: d.irrigationInBase,
        irrigationPriceOrigin: this._priceTouched ? 'user' : 'example',
        variety: d.variety.trim() || 'generic',
        soilMode: H.SOIL_OPTIONS[d.soilIndex].value,
        fractions: this.fractions()
      }
      const place = d.places[d.placeIndex]
      if (!validPoint(form.lat, form.lng)) throw new Error(place && place.noLocation ? NO_LOCATION : '请输入有效经纬度（不能为 0, 0）')
      if (H.UNIT_OPTIONS[d.unitIndex].value === 'ha') {
        form.area *= 15
        form.budget /= 15
        form.base /= 15
      }
      return form
    },

    async onRun() {
      if (this.data.running) return
      const token = ++this._runToken
      this.setData({ running: true, error: '', scrollTarget: '' }, () => this.setData({ scrollTarget: 'hv-result' }))
      this.setStatus('正在读取多年天气并逐日计算…')
      try {
        this.params()
        if (H.SOIL_OPTIONS[this.data.soilIndex].value === 'china' && (!this._soil || this._soilKey !== this.pointKey())) {
          await this.loadSoil()
          if (token !== this._runToken) return
        }
        const form = this.params()
        const result = await H.analyze(form, this._soil, {
          onStage: text => { if (token === this._runToken) this.setStatus(text) }
        })
        if (token !== this._runToken) return
        const view = H.buildView(result, { unit: H.UNIT_OPTIONS[this.data.unitIndex].value })
        const patch = { view, stale: false, running: false }
        if (result.planning) patch.date = result.input.date
        this.setData(patch)
        this.setStatus('分析完成。Beta结果可用于情景比较，实际精度仍需田间验证。')
        wx.vibrateShort({ type: 'light' })
      } catch (e) {
        if (token !== this._runToken) return
        this.setData({ running: false, error: e.message || '分析失败，请重试。' })
        this.setStatus(e.message || '分析失败，请重试。')
      }
    }
  }
})
