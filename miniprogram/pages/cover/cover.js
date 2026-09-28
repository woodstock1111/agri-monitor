const COVER_KEY = 'agri_cover_v1'

let uidSeq = 0
function uid() { return 'p' + Date.now() + '_' + (++uidSeq) }

function emptyPlot() {
  return { uid: uid(), name: '', area: '', variety: '', plantDate: '', plantDateRaw: '', tech: '', phone: '' }
}

// 首次进入的示例台账（来自用户的表格底稿）
function seedPlots() {
  return [
    { uid: uid(), name: '东001', area: '130', variety: '高系14', plantDate: '2026.09.10', plantDateRaw: '2026-09-10', tech: '张三', phone: '' },
    { uid: uid(), name: '西南007', area: '90', variety: '心香', plantDate: '2026.07.10', plantDateRaw: '2026-07-10', tech: '李四', phone: '' },
    { uid: uid(), name: '北009', area: '150', variety: '丝滑', plantDate: '', plantDateRaw: '', tech: '张三', phone: '' },
    { uid: uid(), name: '0039', area: '', variety: '', plantDate: '', plantDateRaw: '', tech: '', phone: '' },
    { uid: uid(), name: '0124', area: '', variety: '', plantDate: '', plantDateRaw: '', tech: '', phone: '' }
  ]
}

Page({
  data: {
    statusBarHeight: 20,
    safeBottom: 0,
    company: '',
    plots: []
  },

  onLoad() {
    const info = wx.getSystemInfoSync()
    const rawSafe = info.screenHeight - (info.safeArea ? info.safeArea.bottom : info.screenHeight)
    const saved = wx.getStorageSync(COVER_KEY)
    const hasSaved = saved && saved.plots && saved.plots.length
    this.setData({
      statusBarHeight: info.statusBarHeight || 20,
      safeBottom: rawSafe > 0 ? rawSafe : 0,
      company: (saved && saved.company) || '',
      plots: hasSaved ? saved.plots : seedPlots()
    })
    // 首次进入：把示例台账落盘，保证地图读到的与封面一致
    if (!hasSaved) this.persist()
  },

  persist() {
    wx.setStorageSync(COVER_KEY, { company: this.data.company, plots: this.data.plots })
  },

  onCompany(e) {
    this.setData({ company: e.detail.value })
    this.persist()
  },

  onField(e) {
    const { idx, field } = e.currentTarget.dataset
    this.setData({ [`plots[${idx}].${field}`]: e.detail.value })
    this.persist()
  },

  onPlantDate(e) {
    const idx = e.currentTarget.dataset.idx
    const raw = e.detail.value // 2026-09-10
    this.setData({
      [`plots[${idx}].plantDateRaw`]: raw,
      [`plots[${idx}].plantDate`]: raw.replace(/-/g, '.')
    })
    this.persist()
  },

  onAddPlot() {
    wx.vibrateShort({ type: 'light' })
    this.setData({ plots: this.data.plots.concat([emptyPlot()]) })
    this.persist()
  },

  onDelPlot(e) {
    const idx = e.currentTarget.dataset.idx
    const plot = this.data.plots[idx]
    if (!plot) return
    wx.showModal({
      title: '删除地块',
      content: `确定删除「${plot.name || '未命名地块'}」吗？`,
      confirmColor: '#b0503a',
      success: (r) => {
        if (!r.confirm) return
        const plots = this.data.plots.filter((_, i) => i !== idx)
        this.setData({ plots })
        this.persist()
      }
    })
  },

  // 吞掉整条页脚的触摸：空白处不进地图，也挡住后面的输入框
  noop() {},

  onEnterMap() {
    wx.navigateTo({ url: '/pages/parkmap/parkmap' })
  },

  // 台账卡片「地图查看」：跳到地图并自动展开该地块详情
  onViewOnMap(e) {
    const uid = e.currentTarget.dataset.uid
    if (!uid) return
    wx.navigateTo({ url: `/pages/parkmap/parkmap?focus=${encodeURIComponent(uid)}` })
  }
})
