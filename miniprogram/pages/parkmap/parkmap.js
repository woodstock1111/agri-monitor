const api = require('../../utils/api.js')

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

Page({
  data: {
    plots: [],
    vw: 375,
    vh: 700,
    ratio: 0.5,
    initTx: 0,
    initTy: 0,
    focusId: '',
    statusBarHeight: 20,
    safeBottom: 0,
    detailScrollH: 400,
    decos: [],
    detailOpen: false,
    detailShown: false,
    detail: { plot: {}, devices: [], tasks: [] }
  },

  _activePlotId: '',
  _closeTimer: null,

  onLoad() {
    const info = wx.getSystemInfoSync()
    const vw = info.windowWidth
    const vh = info.windowHeight
    const ratio = vw / 750
    const rawSafe = info.screenHeight - (info.safeArea ? info.safeArea.bottom : info.screenHeight)
    const safeBottom = rawSafe > 0 ? rawSafe : 0
    const detailScrollH = Math.round(vh * 0.8 - 190 * ratio - safeBottom)
    this.setData({
      vw,
      vh,
      ratio,
      statusBarHeight: info.statusBarHeight || 20,
      safeBottom,
      detailScrollH: detailScrollH > 200 ? detailScrollH : 200,
      decos: this.buildDecos()
    })
    this.loadPlots()
  },

  // 散落的手绘小花/小草（CSS 绘制，铺满全图、低密度、避开田块，按拖动方向倾倒）
  buildDecos() {
    // 位置都选在田块之间的空隙与边缘，避免被田块遮挡
    const spots = [
      { x: -40, y: 40, v: 'a' }, { x: 560, y: -50, v: 'grass' }, { x: 1200, y: 30, v: 'b' },
      { x: -40, y: 430, v: 'grass' }, { x: 1300, y: 420, v: 'c' }, { x: 470, y: 460, v: 'a' },
      { x: 730, y: 600, v: 'grass' }, { x: 250, y: 470, v: 'b' }, { x: 1010, y: 660, v: 'grass' },
      { x: -40, y: 900, v: 'a' }, { x: 1300, y: 820, v: 'grass' }, { x: 430, y: 980, v: 'c' },
      { x: 820, y: 1010, v: 'grass' }, { x: 1100, y: 960, v: 'b' }
    ]
    return spots.map((p, i) => ({ idx: i, x: p.x, y: p.y, variant: p.v }))
  },

  // 平移边界，和 gesture.wxs 保持一致
  bounds() {
    const r = this.data.ratio
    const cx = this.data.vw / 2
    const cy = this.data.vh * 0.46
    return {
      minX: cx - 1050 * r,
      maxX: cx - 200 * r,
      minY: cy - 860 * r,
      maxY: cy - 200 * r
    }
  },

  // 根据当前平移量，算出每个地块的缩放/上浮/层级，并定出聚焦地块
  computeScales(plots, tx, ty) {
    const r = this.data.ratio
    const cx = this.data.vw / 2
    const cy = this.data.vh * 0.46
    const span = this.data.vw * 0.62
    let focusId = ''
    let minD = Infinity
    const out = plots.map(p => {
      const sx = p.cx * r + tx
      const sy = p.cy * r + ty
      const d = Math.sqrt((sx - cx) * (sx - cx) + (sy - cy) * (sy - cy))
      const t = Math.min(d / span, 1)
      if (d < minD) { minD = d; focusId = p.id }
      return {
        ...p,
        initScale: Number((1.12 - 0.24 * t).toFixed(3)),
        initLift: Math.round((1 - t) * 14),
        z: 1000 - Math.round(d)
      }
    })
    if (minD >= this.data.vw * 0.40) focusId = ''
    return { plots: out, focusId }
  },

  async loadPlots() {
    try {
      const res = await api.getPlots()
      const raw = (res && res.plots) || []
      // 几何信息：把中心坐标换成左上角定位
      const tones = ['a', 'b', 'c', 'd', 'e']
      const geo = raw.map((p, i) => {
        const h = Math.round(p.size * 0.78)
        return {
          ...p,
          h,
          tone: tones[i % tones.length],
          left: p.px - p.size / 2,
          top: p.py - h / 2,
          cx: p.px,
          cy: p.py
        }
      })
      // 初始聚焦：居中“地块三”，没有就取第一个
      const center = geo.find(p => p.id === 'plot-3') || geo[0]
      const b = this.bounds()
      const initTx = center ? clamp(this.data.vw / 2 - center.cx * this.data.ratio, b.minX, b.maxX) : 0
      const initTy = center ? clamp(this.data.vh * 0.46 - center.cy * this.data.ratio, b.minY, b.maxY) : 0
      const scaled = this.computeScales(geo, initTx, initTy)
      this.setData({
        plots: scaled.plots,
        focusId: scaled.focusId,
        initTx,
        initTy
      })
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  // 由 gesture.wxs 在松手后回调，保持 JS 侧位置与渲染层一致，避免重渲染跳动
  syncOffset(payload) {
    const tx = payload.tx
    const ty = payload.ty
    const scaled = this.computeScales(this.data.plots, tx, ty)
    this.setData({
      initTx: tx,
      initTy: ty,
      plots: scaled.plots,
      focusId: scaled.focusId
    })
  },

  async onTapPlot(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    this._activePlotId = id
    try {
      const res = await api.getPlotDetail(id)
      if (!res || !res.ok) {
        wx.showToast({ title: (res && res.msg) || '加载失败', icon: 'none' })
        return
      }
      // 先渲染内容（面板仍在屏幕外），渲染完成后再启动上滑动画，避免首帧掉帧
      this.setData({
        focusId: id,
        detail: { plot: res.plot, devices: res.devices || [], tasks: res.tasks || [] },
        detailOpen: true
      }, () => {
        setTimeout(() => this.setData({ detailShown: true }), 40)
      })
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  closeDetail() {
    this.setData({ detailShown: false })
    clearTimeout(this._closeTimer)
    this._closeTimer = setTimeout(() => this.setData({ detailOpen: false }), 460)
  },

  async refreshDetail() {
    if (!this._activePlotId) return
    const res = await api.getPlotDetail(this._activePlotId)
    if (res && res.ok) {
      this.setData({ detail: { plot: res.plot, devices: res.devices || [], tasks: res.tasks || [] } })
    }
    // 同步刷新地图上该地块的待办数量
    this.loadPlotSummary()
  },

  async loadPlotSummary() {
    const res = await api.getPlots()
    const raw = (res && res.plots) || []
    const map = {}
    raw.forEach(p => { map[p.id] = p })
    const plots = this.data.plots.map(p => {
      const fresh = map[p.id]
      return fresh ? { ...p, unfinishedCount: fresh.unfinishedCount, sensor: fresh.sensor } : p
    })
    this.setData({ plots })
  },

  async onCompleteTask(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    wx.vibrateShort({ type: 'light' })
    try {
      await api.updateFarmTask(id, { status: 'done', completedAt: Date.now() })
      await this.refreshDetail()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },

  onAddTask() {
    const plotId = this._activePlotId
    if (!plotId) return
    wx.showModal({
      title: '新增农事',
      editable: true,
      placeholderText: '例如：南区滴灌带巡检',
      success: async (r) => {
        if (!r.confirm) return
        const title = (r.content || '').trim()
        if (!title) return
        try {
          await api.createFarmTask({
            title,
            date: api.getBeijingDateString(),
            type: 'user',
            locationId: plotId
          })
          await this.refreshDetail()
        } catch (err) {
          wx.showToast({ title: err.message || '添加失败', icon: 'none' })
        }
      }
    })
  },

  onUnload() {
    clearTimeout(this._closeTimer)
  }
})
