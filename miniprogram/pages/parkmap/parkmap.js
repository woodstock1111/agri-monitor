const api = require('../../utils/api.js')
const view = require('../../utils/park-view.js')

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

// Slots already unlocked on this device; a slot in use but not listed here pushes the fog back on entry.
const FOG_KEY = 'agri_park_fog_v1'

let chatSeq = 0
function chatUid() { return 'm' + (++chatSeq) }
function chatWelcome() {
  return {
    id: chatUid(),
    role: 'assistant',
    text: '你好，我是小薯🍠 木薯和红薯的事都可以问我～也可以拍张照片发我，帮你看看是什么虫、什么草，怎么防治。'
  }
}

Page({
  data: {
    plots: [],
    selectedPlot: null,
    selectedIndex: -1,
    selectorParity: 0,
    mapReady: false,
    loadError: '',
    sheetVisible: false,
    sheetKind: '',
    pageLeaving: false,
    pageReturn: false,
    parkTitle: '地瓜产业园',
    detailLoading: false,
    vw: 375,
    vh: 700,
    mapTop: 100,
    mapHeight: 500,
    ratio: 0.5,
    // movable-view position (px, ≤ 0), the camera box it spans (screen px) and the painting's size
    mapX: 0,
    mapY: 0,
    mapAnimate: false,
    boxX: 0,
    boxY: 0,
    boxW: 700,
    boxH: 1100,
    worldW: 700,
    worldH: 1100,
    fogNow: null,
    fogPrev: null,
    introOpen: false,
    introVisible: true,
    focusId: '',
    // 平移边界对应的地块坐标范围（rpx），随实际地块动态计算
    extMinCx: 200,
    extMaxCx: 1050,
    extMinCy: 200,
    extMaxCy: 860,
    statusBarHeight: 20,
    safeBottom: 0,
    detailScrollH: 400,
    agentOpen: false,
    detailOpen: false,
    // 智能管家 / 成熟度面板（演示数据，纯前端）
    aiOpen: false,
    ripeOpen: false,
    harvestOpen: false,
    harvestPlotId: '',
    panelScrollH: 400,
    aiTip: '今天午后高温少云，建议傍晚 17:30 给地块一补一轮水；地块二钾肥窗口期还剩 3 天，已提醒小张。',
    aiActions: [
      { id: 'a1', plot: '地块一', device: '滴灌阀门', state: 'run', statusText: '正在浇水', desc: '土壤湿度 41% 偏低，AI 已自动开启 · 预计 18 分钟后完成', progress: 65 },
      { id: 'a2', plot: '地块三', device: '喷灌系统', state: 'wait', statusText: '待浇水', desc: '计划今日 16:00 自动开启 · 时长 25 分钟', progress: 0 },
      { id: 'a3', plot: '地块二', device: '滴灌阀门', state: 'done', statusText: '浇水完毕', desc: '今早 07:30 完成 · 用水 2.4 吨，湿度已回到 58%', progress: 100 },
      { id: 'a4', plot: '地块四', device: '水肥一体机', state: 'wait', statusText: '待施肥', desc: '低浓度水溶肥已配好，明早 06:30 随滴灌下肥', progress: 0 }
    ],
    aiHumanTasks: [
      { id: 'h1', plot: '地块二', title: '追施钾肥', state: 'wait', statusText: '待完成', desc: 'AI 检测叶色偏淡，建议每亩 8kg 硫酸钾，今明两天完成', owner: '小张' },
      { id: 'h2', plot: '地块五', title: '田埂人工除草', state: 'wait', statusText: '待完成', desc: '边缘杂草盖度超 30%，机器进不去，需人工清一遍', owner: '小王' },
      { id: 'h3', plot: '地块一', title: '滴灌带巡检', state: 'done', statusText: '已完成', desc: '第 3 行有滴头堵塞，已疏通', owner: '小张' }
    ],
    ripePlots: [
      {
        id: 'plot-1', name: '地块一', progress: 72, harvest: '7 月中旬', expanded: true,
        blocks: [
          { id: 'b11', name: '区块一', variety: '品种A', owner: '小张', progress: 80 },
          { id: 'b12', name: '区块二', variety: '品种A', owner: '小张', progress: 70 },
          { id: 'b13', name: '区块三', variety: '品种B', owner: '小王', progress: 65 }
        ]
      },
      {
        id: 'plot-2', name: '地块二', progress: 58, harvest: '8 月上旬', expanded: false,
        blocks: [
          { id: 'b21', name: '区块一', variety: '品种B', owner: '小王', progress: 60 },
          { id: 'b22', name: '区块二', variety: '品种C', owner: '小李', progress: 55 }
        ]
      },
      {
        id: 'plot-3', name: '地块三', progress: 64, harvest: '7 月下旬', expanded: false,
        blocks: [
          { id: 'b31', name: '区块一', variety: '品种A', owner: '小张', progress: 68 },
          { id: 'b32', name: '区块二', variety: '品种B', owner: '小李', progress: 62 },
          { id: 'b33', name: '区块三', variety: '品种B', owner: '小王', progress: 61 }
        ]
      },
      {
        id: 'plot-4', name: '地块四', progress: 35, harvest: '9 月中旬', expanded: false,
        blocks: [
          { id: 'b41', name: '区块一', variety: '品种C', owner: '小李', progress: 38 },
          { id: 'b42', name: '区块二', variety: '品种C', owner: '小李', progress: 32 }
        ]
      },
      {
        id: 'plot-5', name: '地块五', progress: 46, harvest: '8 月下旬', expanded: false,
        blocks: [
          { id: 'b51', name: '区块一', variety: '品种B', owner: '小王', progress: 50 },
          { id: 'b52', name: '区块二', variety: '品种A', owner: '小张', progress: 42 }
        ]
      }
    ],
    detail: { plot: {}, devices: [], tasks: [] },
    // 小薯聊天（内联进 page-container）
    messages: [],
    text: '',
    pendingImage: '',
    pendingDataUrl: '',
    sending: false,
    scrollTo: '',
    kbHeight: 0
  },

  _activePlotId: '',
  _closeTimer: null,

  onLoad(options) {
    this._focusOnLoad = (options && options.focus) || ''
    const info = wx.getSystemInfoSync()
    const vw = info.windowWidth
    const vh = info.windowHeight
    const ratio = vw / 750
    const rawSafe = info.screenHeight - (info.safeArea ? info.safeArea.bottom : info.screenHeight)
    const safeBottom = rawSafe > 0 ? rawSafe : 0
    const detailScrollH = Math.round(vh * 0.8 - 190 * ratio - safeBottom)
    const panelScrollH = Math.round(vh * 0.8 - 170 * ratio - safeBottom)
    this.setData({
      vw,
      vh,
      // The map fills the space between the top bar and the shelf.
      mapTop: Math.round((info.statusBarHeight || 20) + 12 + 188 * ratio),
      mapHeight: Math.max(1, Math.round(vh - ((info.statusBarHeight || 20) + 12 + 188 * ratio) - (244 * ratio + safeBottom))),
      ratio,
      worldW: Math.round(view.WORLD_WIDTH * ratio),
      worldH: Math.round(view.WORLD_HEIGHT * ratio),
      statusBarHeight: info.statusBarHeight || 20,
      safeBottom,
      detailScrollH: detailScrollH > 200 ? detailScrollH : 200,
      panelScrollH: panelScrollH > 200 ? panelScrollH : 200,
      parkTitle: (wx.getStorageSync('agri_cover_v1') || {}).company || '地瓜产业园'
    })
    this.loadPlots()
    this._introTimer = setTimeout(() => this.openIntro(), 1600)
  },

  // The painting sits in a native movable-view: dragging and inertia never go through setData.
  // The movable-view only spans the camera box, so it cannot be dragged on into the fog;
  // the painting inside it is offset by the box origin and overflows visibly.
  clampCamera(x, y) {
    return {
      x: clamp(x, this.data.vw - this.data.boxW, 0),
      y: clamp(y, this.data.mapHeight - this.data.boxH, 0)
    }
  },

  // Centre a world point (image px) in the map view.
  moveCamera(wx, wy, animate = true) {
    const r = this.data.ratio
    const target = this.clampCamera(this.data.vw / 2 - wx * r + this.data.boxX, this.data.mapHeight / 2 - wy * r + this.data.boxY)
    // movable-view ignores x/y equal to the last bound value even after a drag; nudge so it always moves.
    if (Math.abs(target.x - this.data.mapX) < 0.01) target.x += 0.01
    if (Math.abs(target.y - this.data.mapY) < 0.01) target.y += 0.01
    this._pos = target
    this.setData({ mapX: target.x, mapY: target.y, mapAnimate: animate })
  },

  mapCentre() {
    const pos = this._pos || { x: this.data.mapX, y: this.data.mapY }
    const r = this.data.ratio
    return { x: (this.data.vw / 2 - pos.x + this.data.boxX) / r, y: (this.data.mapHeight / 2 - pos.y + this.data.boxY) / r }
  },

  // Whatever plot sits under the centre of the map is highlighted while the map moves.
  onMapChange(e) {
    this._pos = { x: e.detail.x, y: e.detail.y }
    if (!e.detail.source) return
    const c = this.mapCentre()
    const plot = view.nearest(this.data.plots, c.x, c.y)
    if (plot && plot.id !== this.data.focusId) this.selectPlot(plot.id)
    // Once the map settles, ease the highlighted plot to the centre if it is already close.
    clearTimeout(this._settleTimer)
    this._settleTimer = setTimeout(() => {
      const p = this.data.selectedPlot
      if (!p || !p.mapped || this.data.sheetVisible) return
      const now = this.mapCentre()
      if (Math.hypot(p.cx - now.x, p.cy - now.y) * this.data.ratio < 60) this.moveCamera(p.cx, p.cy)
    }, 220)
  },

  onMapTap(e) {
    if (this.data.sheetVisible || this.data.pageLeaving) return
    const pos = this._pos || { x: this.data.mapX, y: this.data.mapY }
    const r = this.data.ratio
    const x = (e.detail.x - pos.x + this.data.boxX) / r
    const y = (e.detail.y - this.data.mapTop - pos.y + this.data.boxY) / r
    const plot = this.data.plots.find(p => p.mapped && view.contains(p.points, x, y))
    if (plot) this.openPlotDetail(plot.id)
  },

  async loadPlots() {
    try {
      const res = await api.getPlots()
      const raw = (res && res.plots) || []
      const geo = view.place(view.geometry(raw), this.data.ratio)
      // 初始聚焦：跳转指定地块 → 居中它；否则取第一个
      const focusUid = this._focusOnLoad
      const center = (focusUid && geo.find(p => p.id === focusUid)) || geo[0]
      const lifting = this.updateFog(geo)
      const reveal = lifting.length ? geo.find(p => p.slot === lifting[lifting.length - 1]) : null
      // Every plot slot lies in the box, so the box can only be set together with the plots.
      const box = view.cameraBox(geo, this.data.vw / this.data.ratio, this.data.mapHeight / this.data.ratio)
      const r = this.data.ratio
      this.setData({ boxX: box.left * r, boxY: box.top * r, boxW: box.width * r, boxH: box.height * r })
      const start = focusUid ? center : reveal || center
      this.setData({ plots: geo, mapReady: true, loadError: '' }, () => {
        this.selectPlot(start ? start.id : '')
        if (start && start.mapped) this.moveCamera(start.cx, start.cy, false)
        // Focus navigation retains its existing direct-to-detail behavior, after render.
        if (focusUid && center) {
          this._focusOnLoad = ''
          this.openPlotDetail(focusUid)
        }
      })
    } catch (err) {
      this.setData({ loadError: err.message || '加载失败' })
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  // Fog covers everything outside the unlocked area. When plots were added since the last visit,
  // the fog first sits where it was and is then pushed back (old layer fades, new one fades in).
  updateFog(plots) {
    const used = new Set(plots.filter(p => p.mapped).map(p => p.slot))
    let seen = null
    try { seen = wx.getStorageSync(FOG_KEY) } catch (e) {}
    const known = Array.isArray(seen) ? new Set(seen) : null
    // First visit on this device: nothing to reveal, just remember what is there.
    const lifting = known ? [...used].filter(slot => !known.has(slot)).sort((a, b) => a - b) : []
    const ratio = this.data.ratio
    const now = view.fog(plots, ratio)
    try { wx.setStorageSync(FOG_KEY, [...used]) } catch (e) {}
    clearTimeout(this._fogTimer)
    clearTimeout(this._introTimer)
    if (!lifting.length) {
      this.setData({ fogNow: now, fogPrev: null })
      return lifting
    }
    const before = view.fog(plots.filter(p => !p.mapped || !lifting.includes(p.slot)), ratio)
    this.setData({ fogNow: before, fogPrev: null })
    this._fogTimer = setTimeout(() => {
      if (this._unloaded) return
      this.setData({ fogPrev: { ...before, out: false }, fogNow: { ...now, entering: true } }, () => {
        this._fogTimer = setTimeout(() => {
          if (this._unloaded) return
          this.setData({ 'fogPrev.out': true, 'fogNow.entering': false })
          this._fogTimer = setTimeout(() => { if (!this._unloaded) this.setData({ fogPrev: null }) }, 1700)
        }, 60)
      })
    }, 1300)
    return lifting
  },

  // Clouds part over the map once the painting has loaded (or after a short wait, whichever is first).
  onMapArtLoad() { this.openIntro() },
  openIntro() {
    if (this.data.introOpen || this._unloaded) return
    this.setData({ introOpen: true })
    this._introTimer = setTimeout(() => { if (!this._unloaded) this.setData({ introVisible: false }) }, 1500)
  },

  selectPlot(id) {
    const index = this.data.plots.findIndex(p => p.id === id)
    this.setData({ selectorParity: 1 - this.data.selectorParity, focusId: id, selectedIndex: index, selectedPlot: index < 0 ? null : this.data.plots[index] })
  },

  onPreviousPlot() { if (Date.now() - (this._selectorSwipedAt || 0) > 300) this.stepPlot(-1) },
  onNextPlot() { if (Date.now() - (this._selectorSwipedAt || 0) > 300) this.stepPlot(1) },
  stepPlot(direction) {
    const next = this.data.selectedIndex + direction
    if (next < 0 || next >= this.data.plots.length) return
    const plot = this.data.plots[next]
    this._detailRequest = (this._detailRequest || 0) + 1
    this.setData({ detailLoading: false })
    this.selectPlot(plot.id)
    if (!plot.mapped) return
    this.moveCamera(plot.cx, plot.cy)
  },
  onSelectorStart(e) {
    const touch = e.touches[0]
    this._selectorStart = { x: touch.clientX, y: touch.clientY }
  },
  onSelectorEnd(e) {
    if (!this._selectorStart || !e.changedTouches.length) return
    const touch = e.changedTouches[0]
    const dx = touch.clientX - this._selectorStart.x
    const dy = touch.clientY - this._selectorStart.y
    this._selectorStart = null
    if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      this._selectorSwipedAt = Date.now()
      this.stepPlot(dx < 0 ? 1 : -1)
    }
  },
  onSelectorCancel() { this._selectorStart = null },
  onEnterSelected() {
    if (Date.now() - (this._selectorSwipedAt || 0) < 300) return
    if (this.data.selectedPlot) this.openPlotDetail(this.data.selectedPlot.id)
  },
  onOpenLedger() { this.onBackCover() },

  showSheet(kind) {
    this._detailRequest = (this._detailRequest || 0) + 1
    this.setData({ detailLoading: false, sheetKind: kind, sheetVisible: true,
      detailOpen: kind === 'detail', agentOpen: kind === 'agent', aiOpen: kind === 'ai', ripeOpen: kind === 'ripe', harvestOpen: kind === 'harvest' })
  },
  hideSheet() {
    if (!this.data.sheetVisible) return
    this._detailRequest = (this._detailRequest || 0) + 1
    // Keep the content mounted until native afterleave; closing never shows a blank sheet.
    this.setData({ sheetVisible: false, detailLoading: false })
  },

  async openPlotDetail(id) {
    if (!id || this.data.sheetVisible) return
    const request = (this._detailRequest = (this._detailRequest || 0) + 1)
    this.setData({ detailLoading: true })
    try {
      const res = await api.getPlotDetail(id)
      if (request !== this._detailRequest || this._unloaded) return
      if (!res || !res.ok) {
        wx.showToast({ title: (res && res.msg) || '加载失败', icon: 'none' })
        return
      }
      this._activePlotId = id
      this.selectPlot(id)
      const plot = this.data.plots.find(p => p.id === id)
      this.setData({ detail: { plot: res.plot, devices: res.devices || [], tasks: res.tasks || [] } })
      if (plot && plot.mapped) this.moveCamera(plot.cx, plot.cy)
      this.showSheet('detail')
    } catch (err) {
      if (request === this._detailRequest && !this._unloaded) wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    } finally {
      if (request === this._detailRequest) this.setData({ detailLoading: false })
    }
  },

  closeDetail() { this.hideSheet() },
  onDetailBack() { this.hideSheet() },

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
    this.setData({ plots }, () => this.selectPlot(this.data.focusId))
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

  onBackCover() {
    if (this.data.pageLeaving) return
    this._detailRequest = (this._detailRequest || 0) + 1
    this.setData({ pageLeaving: true, detailLoading: false })
    this._closeTimer = setTimeout(() => {
      const pages = getCurrentPages()
      const fail = () => this.setData({ pageLeaving: false })
      if (pages.length > 1) wx.navigateBack({ fail })
      else wx.redirectTo({ url: '/pages/cover/cover', fail })
    }, 160)
  },

  onOpenAgent() {
    if (!this.data.messages.length) this.setData({ messages: [chatWelcome()] })
    this.showSheet('agent')
  },
  onCloseAgent() { this.hideSheet() },
  onSheetBeforeLeave() { this.hideSheet() },
  onSheetLeave() {
    if (this.data.sheetVisible) return
    this.setData({ detailOpen: false, agentOpen: false, aiOpen: false, ripeOpen: false, harvestOpen: false, sheetKind: '' })
  },
  onOpenAiPanel() { this.showSheet('ai') },
  onCloseAiPanel() { this.hideSheet() },
  onOpenRipePanel() { this.showSheet('ripe') },
  onCloseRipePanel() { this.hideSheet() },

  // 收成预测和其它入口一样从底部抽屉打开；打开过地块详情就带上这块地
  onOpenHarvest() {
    this.setData({ harvestPlotId: this._activePlotId || '' })
    this.showSheet('harvest')
  },
  onCloseHarvest() { this.hideSheet() },

  onToggleRipePlot(event) {
    const id = event.currentTarget.dataset.id
    const ripePlots = this.data.ripePlots.map(p => (p.id === id ? { ...p, expanded: !p.expanded } : p))
    this.setData({ ripePlots })
  },

  clearChat() {
    this.setData({ messages: [chatWelcome()], text: '', pendingImage: '', pendingDataUrl: '' })
  },

  onChatInput(e) {
    this.setData({ text: e.detail.value })
  },

  onKbHeight(e) {
    this.setData({ kbHeight: (e.detail && e.detail.height) || 0 })
    if (e.detail && e.detail.height) {
      this.scrollChat(this.data.messages.length ? this.data.messages[this.data.messages.length - 1].id : '')
    }
  },

  onInputBlur() {
    this.setData({ kbHeight: 0 })
  },

  scrollChat(id) {
    if (id) this.setData({ scrollTo: 'msg-' + id })
  },

  chooseChatImage() {
    if (this.data.sending) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles[0]
        wx.getFileSystemManager().readFile({
          filePath: file.tempFilePath,
          encoding: 'base64',
          success: (r) => {
            this.setData({ pendingImage: file.tempFilePath, pendingDataUrl: 'data:image/jpeg;base64,' + r.data })
          },
          fail: () => wx.showToast({ title: '读取图片失败', icon: 'none' })
        })
      }
    })
  },

  removeChatImage() {
    this.setData({ pendingImage: '', pendingDataUrl: '' })
  },

  async sendChat() {
    if (this.data.sending) return
    const text = (this.data.text || '').trim()
    const dataUrl = this.data.pendingDataUrl
    if (!text && !dataUrl) return

    const userMsg = { id: chatUid(), role: 'user', text, image: this.data.pendingImage || '' }
    const thinkId = chatUid()
    const history = this.data.messages
      .filter(m => m.text && !m.thinking)
      .map(m => ({ role: m.role, text: m.text }))

    this.setData({
      messages: this.data.messages.concat([userMsg, { id: thinkId, role: 'assistant', thinking: true }]),
      text: '',
      pendingImage: '',
      pendingDataUrl: '',
      sending: true
    })
    this.scrollChat(thinkId)

    try {
      const res = await api.agentChat({ text, image: dataUrl || undefined, history })
      const reply = (res && res.reply) || '（没有返回内容）'
      this.replaceChatMsg(thinkId, { id: thinkId, role: 'assistant', text: reply })
    } catch (err) {
      this.replaceChatMsg(thinkId, { id: thinkId, role: 'assistant', text: '小薯开小差了：' + (err.message || '请求失败') })
    } finally {
      this.setData({ sending: false })
      this.scrollChat(thinkId)
    }
  },

  replaceChatMsg(id, msg) {
    this.setData({ messages: this.data.messages.map(m => (m.id === id ? msg : m)) })
  },

  onShow() {
    if (this._hasShown) {
      this.setData({ pageLeaving: false, pageReturn: true })
      clearTimeout(this._returnTimer)
      this._returnTimer = setTimeout(() => this.setData({ pageReturn: false }), 300)
    }
    this._hasShown = true
  },

  onHide() {
    clearTimeout(this._settleTimer)
    clearTimeout(this._closeTimer)
    this._detailRequest = (this._detailRequest || 0) + 1
    this.setData({ detailLoading: false })
  },

  onUnload() {
    this._unloaded = true
    clearTimeout(this._settleTimer)
    clearTimeout(this._fogTimer)
    clearTimeout(this._introTimer)
    this._detailRequest = (this._detailRequest || 0) + 1
    clearTimeout(this._returnTimer)
    clearTimeout(this._closeTimer)
  }
})
