const api = require('../../utils/api.js')

const CACHE_PREFIX = 'dashboard_realtime_cache_'
const ICONS = {
  '温度': '℃',
  '湿度': '◐',
  'PH': 'pH',
  '电导率': '⚡'
}

function normalizeRegisters(realtime, device) {
  const items = ((realtime.dataItems || [])[0] || {}).registerItem || []
  if (items.length) return items

  const values = realtime.values || {}
  const factors = (device.apiConfig && device.apiConfig.factors) || []
  return factors.map(factor => ({
    registerName: factor.factorName,
    value: values[factor.factorName],
    unit: factor.unit,
    alarmLevel: 0
  }))
}

function formatValue(value, digits) {
  if (value === null || value === undefined || value === '') return '--'
  const num = Number(value)
  if (Number.isNaN(num)) return '--'
  return num.toFixed(digits === undefined ? 1 : digits)
}

function getAlarmTone(alarmLevel) {
  if (alarmLevel >= 3) return 'alert'
  if (alarmLevel > 0) return 'warn'
  return 'normal'
}

function getStatusText(alarmLevel, cached) {
  if (cached) return '缓存'
  if (alarmLevel >= 3) return '报警'
  if (alarmLevel > 0) return '预警'
  return '正常'
}

function getTrend(rows, name, unit) {
  const values = rows
    .map(row => row.values ? row.values[name] : null)
    .filter(value => value !== null && value !== undefined && !Number.isNaN(Number(value)))
    .map(Number)

  if (values.length < 2) {
    return { dir: 'flat', text: '数据不足' }
  }

  const delta = values[values.length - 1] - values[0]
  if (Math.abs(delta) < 0.05) return { dir: 'flat', text: '→ 持平' }
  const sign = delta > 0 ? '↑' : '↓'
  const dir = delta > 0 ? 'up' : 'down'
  return { dir, text: `${sign} ${Math.abs(delta).toFixed(1)}${unit || ''}` }
}

function buildCards(device, realtime, history, cached) {
  const factors = (device.apiConfig && device.apiConfig.factors) || []
  const rows = (history && history.rows) || []
  const registers = normalizeRegisters(realtime || {}, device)
  return factors.map((factor, index) => {
    const register = registers.find(item => item.registerName === factor.factorName) || {}
    const alarmLevel = Number(register.alarmLevel || 0)
    const trend = getTrend(rows, factor.factorName, factor.unit)
    return {
      id: `${device.id}-${factor.factorName}`,
      canvasId: `chart-${device.id}-${index}`.replace(/[^a-zA-Z0-9_-]/g, '-'),
      name: factor.factorName,
      icon: ICONS[factor.factorName] || factor.factorName.slice(0, 1),
      unit: register.unit !== undefined ? register.unit : factor.unit,
      displayUnit: (register.unit !== undefined ? register.unit : factor.unit) || '无单位',
      value: formatValue(register.value, factor.digits),
      rawValue: register.value,
      alarmLevel,
      tone: getAlarmTone(alarmLevel),
      statusText: getStatusText(alarmLevel, cached),
      trend,
      cached,
      points: rows.map(row => row.values ? row.values[factor.factorName] : null),
      wide: false
    }
  })
}

Page({
  data: {
    devices: [],
    selectedDeviceId: '',
    selectedDevice: null,
    cards: [],
    loading: true,
    refreshing: false,
    cached: false,
    summaryStatus: '加载中',
    summarySub: '',
    summaryTime: '',
    summaryOnlineText: '',
    summaryDeviceName: '',
    summaryDeviceOnlineText: '',
    alertCount: 0,
    chartColors: null
  },

  onLoad() {
    this.loadDevices()
  },

  onPullDownRefresh() {
    this.refreshCurrentDevice(true)
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ selected: 1 })
  },

  async loadDevices() {
    this.setData({ loading: true })
    try {
      const res = await api.getDevices()
      const devices = (res.devices || []).map((device, index) => ({
        ...device,
        shortName: device.name,
        active: index === 0,
        offline: !device.online
      }))
      const first = devices[0]
      this.setData({
        devices,
        selectedDeviceId: first ? first.id : '',
        selectedDevice: first || null
      })
      if (first) await this.loadDeviceData(first.id, true)
    } catch (err) {
      wx.showToast({ title: err.message || '设备加载失败', icon: 'none' })
      this.setData({ loading: false })
    }
  },

  async onPickDevice(event) {
    const id = event.currentTarget.dataset.id
    if (!id || id === this.data.selectedDeviceId) return
    const devices = this.data.devices.map(device => ({ ...device, active: device.id === id }))
    const selected = devices.find(device => device.id === id)
    this.setData({
      devices,
      selectedDeviceId: id,
      selectedDevice: selected,
      cards: [],
      loading: true,
      cached: false
    })
    await this.loadDeviceData(id, true)
  },

  async refreshCurrentDevice(force) {
    if (!this.data.selectedDeviceId) return
    this.setData({ refreshing: true })
    await this.loadDeviceData(this.data.selectedDeviceId, force)
    this.setData({ refreshing: false })
    wx.stopPullDownRefresh()
  },

  async loadDeviceData(deviceId, force) {
    const device = this.data.devices.find(item => item.id === deviceId)
    if (!device) return
    let realtime = null
    let history = null
    let cached = false

    try {
      const res = await Promise.all([
        api.getDeviceRealtime(deviceId, { force }),
        api.getDeviceHistory(deviceId, { limit: 24, order: 'asc' })
      ])
      realtime = res[0]
      history = res[1]
      if (!realtime || realtime.ok === false) throw new Error((realtime && realtime.msg) || '实时数据不可用')
      wx.setStorageSync(`${CACHE_PREFIX}${deviceId}`, realtime)
    } catch (err) {
      realtime = wx.getStorageSync(`${CACHE_PREFIX}${deviceId}`)
      if (!realtime) realtime = this.buildEmptyRealtime(device)
      try {
        history = await api.getDeviceHistory(deviceId, { limit: 24, order: 'asc' })
      } catch (historyErr) {
        history = { deviceId, rows: [] }
      }
      cached = true
    }

    const cards = buildCards(device, realtime, history, cached || !device.online)
    const alertCount = cards.filter(card => card.alarmLevel > 0).length
    const summaryTime = api.formatBeijingTime(realtime.receivedAt || realtime.deviceTimestamp)
    this.setData({
      cards,
      loading: false,
      cached: cached || !device.online,
      alertCount,
      summaryStatus: cached || !device.online ? '缓存' : alertCount > 0 ? '注意' : '良好',
      summarySub: `${cards.length} 项指标 · ${alertCount} 项警告`,
      summaryTime,
      summaryDeviceName: device.name,
      summaryDeviceOnlineText: device.online ? '在线' : '离线',
      summaryOnlineText: cached || !device.online ? '离线 · 显示缓存' : `实时 · ${summaryTime}`
    })
    this.renderChartImages()
  },

  buildEmptyRealtime(device) {
    const registerItem = ((device.apiConfig && device.apiConfig.factors) || []).map(factor => ({
      registerName: factor.factorName,
      value: null,
      unit: factor.unit,
      alarmLevel: 0
    }))
    return {
      ok: true,
      deviceTimestamp: Date.now(),
      receivedAt: Date.now(),
      values: {},
      dataItems: [{ registerItem }]
    }
  },

  renderChartImages() {
    if (!this.data.cards.length) return
    wx.nextTick(() => {
      const query = wx.createSelectorQuery().in(this)
      query.selectAll('.palette-color').fields({ computedStyle: ['color', 'backgroundColor'] })
      query.select('.chart-export-canvas').fields({ node: true, size: true })
      query.exec(res => {
        const palette = this.normalizePalette((res && res[0]) || [])
        const canvasInfo = res && res[1]
        if (!canvasInfo || !canvasInfo.node) return
        this.exportCharts(canvasInfo.node, canvasInfo.width, canvasInfo.height, palette)
      })
    })
  },

  async exportCharts(canvas, width, height, palette) {
    const chartUrls = {}
    for (let index = 0; index < this.data.cards.length; index += 1) {
      const card = this.data.cards[index]
      this.drawChart(canvas, width, height, card, palette)
      try {
        chartUrls[card.id] = await this.canvasToTempFile(canvas, width, height)
      } catch (err) {
        chartUrls[card.id] = ''
      }
    }
    const cards = this.data.cards.map(card => ({ ...card, chartUrl: chartUrls[card.id] || '' }))
    this.setData({ cards })
  },

  canvasToTempFile(canvas, width, height) {
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas,
        x: 0,
        y: 0,
        width,
        height,
        destWidth: canvas.width,
        destHeight: canvas.height,
        success: res => resolve(res.tempFilePath),
        fail: reject
      }, this)
    })
  },

  normalizePalette(nodes) {
    const colors = {
      normal: nodes[0] && nodes[0].color,
      warn: nodes[1] && nodes[1].color,
      alert: nodes[2] && nodes[2].color,
      muted: nodes[3] && nodes[3].color,
      transparent: nodes[4] && nodes[4].backgroundColor
    }
    this.setData({ chartColors: colors })
    return colors
  },

  withAlpha(color, alpha) {
    if (!color) return ''
    if (color.indexOf('rgba') === 0) {
      return color.replace(/rgba\(([^)]+),\s*[\d.]+\)/, `rgba($1, ${alpha})`)
    }
    if (color.indexOf('rgb') === 0) {
      return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`)
    }
    return color
  },

  getChartColor(card, palette) {
    if (card.tone === 'alert') return palette.alert
    if (card.tone === 'warn') return palette.warn
    return palette.normal
  },

  drawChart(canvas, width, height, card, palette) {
    const ctx = canvas.getContext('2d')
    const dpr = wx.getSystemInfoSync().pixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)

    const values = card.points
      .filter(value => value !== null && value !== undefined && !Number.isNaN(Number(value)))
      .map(Number)

    if (values.length < 2) {
      ctx.strokeStyle = palette.muted
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(0, height / 2)
      ctx.lineTo(width, height / 2)
      ctx.stroke()
      return
    }

    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1
    const points = values.map((value, index) => ({
      x: (index / (values.length - 1)) * width,
      y: height - ((value - min) / range) * (height - 8) - 4
    }))
    const color = this.getChartColor(card, palette)

    ctx.beginPath()
    ctx.moveTo(points[0].x, height)
    points.forEach(point => ctx.lineTo(point.x, point.y))
    ctx.lineTo(points[points.length - 1].x, height)
    ctx.closePath()
    const gradient = ctx.createLinearGradient(0, 0, 0, height)
    gradient.addColorStop(0, this.withAlpha(color, 0.28))
    gradient.addColorStop(1, palette.transparent)
    ctx.fillStyle = gradient
    ctx.fill()

    ctx.beginPath()
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    })
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.stroke()
  }
})
