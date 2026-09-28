const api = require('../../utils/api.js')

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

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
    vw: 375,
    vh: 700,
    ratio: 0.5,
    initTx: 0,
    initTy: 0,
    focusId: '',
    // 平移边界对应的地块坐标范围（rpx），随实际地块动态计算
    extMinCx: 200,
    extMaxCx: 1050,
    extMinCy: 200,
    extMaxCy: 860,
    statusBarHeight: 20,
    safeBottom: 0,
    detailScrollH: 400,
    decos: [],
    agentOpen: false,
    detailOpen: false,
    // 智能管家 / 成熟度面板（演示数据，纯前端）
    aiOpen: false,
    ripeOpen: false,
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
    detailShown: false,
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
      ratio,
      statusBarHeight: info.statusBarHeight || 20,
      safeBottom,
      detailScrollH: detailScrollH > 200 ? detailScrollH : 200,
      panelScrollH: panelScrollH > 200 ? panelScrollH : 200,
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

  // 平移边界，和 gesture.wxs 保持一致（范围随实际地块动态）
  bounds() {
    const r = this.data.ratio
    const cx = this.data.vw / 2
    const cy = this.data.vh * 0.46
    return {
      minX: cx - this.data.extMaxCx * r,
      maxX: cx - this.data.extMinCx * r,
      minY: cy - this.data.extMaxCy * r,
      maxY: cy - this.data.extMinCy * r
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

      // 按实际地块算出平移边界（任意数量都能拖到中心）
      let ext = { extMinCx: 200, extMaxCx: 1050, extMinCy: 200, extMaxCy: 860 }
      if (geo.length) {
        const xs = geo.map(p => p.cx)
        const ys = geo.map(p => p.cy)
        ext = {
          extMinCx: Math.min(...xs),
          extMaxCx: Math.max(...xs),
          extMinCy: Math.min(...ys),
          extMaxCy: Math.max(...ys)
        }
      }
      this.setData(ext)

      // 初始聚焦：跳转指定地块 → 居中它；否则取第一个
      const focusUid = this._focusOnLoad
      const center = (focusUid && geo.find(p => p.id === focusUid)) || geo[0]
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

      // 从台账「地图查看」进来：渲染完成后自动展开该地块详情
      if (focusUid && center) {
        this._focusOnLoad = ''
        setTimeout(() => this.openPlotDetail(focusUid), 360)
      }
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

  onTapPlot(event) {
    const id = event.currentTarget.dataset.id
    if (id) this.openPlotDetail(id)
  },

  async openPlotDetail(id) {
    if (!id) return
    this._activePlotId = id
    try {
      const res = await api.getPlotDetail(id)
      if (!res || !res.ok) {
        wx.showToast({ title: (res && res.msg) || '加载失败', icon: 'none' })
        return
      }
      // page-container 自带上滑动画，直接 show 即可
      this.setData({
        focusId: id,
        detail: { plot: res.plot, devices: res.devices || [], tasks: res.tasks || [] },
        detailOpen: true
      })
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  closeDetail() {
    this.setData({ detailOpen: false })
  },

  // 系统返回键触发：page-container afterleave 调用，关闭详情
  onDetailBack() {
    this.setData({ detailOpen: false })
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

  // 左上角返回封面；直接进本页（无栈）时兜底跳转
  onBackCover() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
    } else {
      wx.redirectTo({ url: '/pages/cover/cover' })
    }
  },

  onOpenAgent() {
    if (!this.data.messages.length) this.setData({ messages: [chatWelcome()] })
    this.setData({ agentOpen: true })
  },

  onCloseAgent() {
    this.setData({ agentOpen: false })
  },

  // 合并后的 page-container 返回处理：关掉当前打开的那层
  onSheetLeave() {
    if (this.data.agentOpen) this.setData({ agentOpen: false })
    if (this.data.detailOpen) this.setData({ detailOpen: false })
    if (this.data.aiOpen) this.setData({ aiOpen: false })
    if (this.data.ripeOpen) this.setData({ ripeOpen: false })
  },

  onOpenAiPanel() {
    this.setData({ aiOpen: true })
  },

  onCloseAiPanel() {
    this.setData({ aiOpen: false })
  },

  onOpenRipePanel() {
    this.setData({ ripeOpen: true })
  },

  onCloseRipePanel() {
    this.setData({ ripeOpen: false })
  },

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

  onUnload() {
    clearTimeout(this._closeTimer)
  }
})
