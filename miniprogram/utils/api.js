const config = require('./config.js')

const TENANT_ID = 'tenant-demo'
const DAY_MS = 24 * 60 * 60 * 1000

function pad(num) {
  return String(num).padStart(2, '0')
}

function getBeijingDateString(date) {
  const source = date ? new Date(date) : new Date()
  const bj = new Date(source.getTime() + 8 * 60 * 60 * 1000)
  return `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())}`
}

function addDays(dateString, days) {
  const parts = dateString.split('-').map(Number)
  const next = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]) + days * DAY_MS)
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`
}

function monthOf(dateString) {
  return dateString.slice(0, 7)
}

const today = getBeijingDateString()
const yesterday = addDays(today, -1)
const tomorrow = addDays(today, 1)
const createdBase = Date.now() - 8 * 60 * 60 * 1000
const FACTORS = [
  { factorName: '温度', unit: '°C', digits: 1 },
  { factorName: '湿度', unit: '%', digits: 1 },
  { factorName: 'PH', unit: '', digits: 1 },
  { factorName: '电导率', unit: 'μS/cm', digits: 0 }
]

let mockTasks = [
  {
    id: 'ai-rec-irrigation',
    title: '早 8 点前完成西红柿区灌溉',
    category: '南棚 · 番茄|06:30 – 08:00',
    type: 'ai',
    date: today,
    status: 'pending',
    completedAt: null,
    aiReason: '南棚土壤湿度 38%，低于阈值；今日多云无雨，建议清晨灌溉避免高温蒸发。',
    createdAt: createdBase + 1000,
    tenantId: TENANT_ID
  },
  {
    id: 'ai-rec-light',
    title: '检查东棚补光灯（昨日异常停机 2 次）',
    category: '东棚 · 设备|任意时段',
    type: 'ai',
    date: today,
    status: 'pending',
    completedAt: null,
    aiReason: '设备日志：DI-04 出现间歇通讯中断；建议人工巡检线路接头。',
    createdAt: createdBase + 2000,
    tenantId: TENANT_ID
  },
  {
    id: 'ai-auto-patrol',
    title: '日常巡棚（自动每日 09:00）',
    category: '全棚区|09:00 – 09:30',
    type: 'ai',
    date: today,
    status: 'pending',
    completedAt: null,
    aiReason: null,
    createdAt: createdBase + 3000,
    tenantId: TENANT_ID
  },
  {
    id: 'user-potassium',
    title: '给南棚追施钾肥（5kg/100㎡）',
    category: '南棚 · 番茄|10:00 – 11:30|老张|老',
    type: 'user',
    date: today,
    status: 'pending',
    completedAt: null,
    aiReason: null,
    createdAt: createdBase + 4000,
    tenantId: TENANT_ID
  },
  {
    id: 'user-clean',
    title: '清理北侧排水沟落叶',
    category: '北侧沟渠|15:00 – 16:00|小林|林',
    type: 'user',
    date: today,
    status: 'done',
    completedAt: Date.now() - 90 * 60 * 1000,
    aiReason: null,
    createdAt: createdBase + 5000,
    tenantId: TENANT_ID
  },
  {
    id: 'user-harvest-overdue',
    title: '采摘西区一行黄熟果',
    category: '西区 · 番茄|补登|王婶|王',
    type: 'user',
    date: yesterday,
    status: 'pending',
    completedAt: null,
    aiReason: null,
    createdAt: createdBase + 6000,
    tenantId: TENANT_ID
  },
  {
    id: 'user-iso-done',
    title: '复核育苗棚温湿度记录',
    category: '育苗棚|08:30|小陈|陈',
    type: 'user',
    date: tomorrow,
    status: 'done',
    completedAt: new Date().toISOString(),
    aiReason: null,
    createdAt: createdBase + 7000,
    tenantId: TENANT_ID
  },
]

const mockDevices = Array.from({ length: 23 }).map((_, index) => {
  const names = [
    '南棚', '东棚', '西区', '北棚', '育苗棚', '水肥站', '番茄一号棚', '番茄二号棚',
    '黄瓜棚', '草莓棚', '西瓜棚', '辣椒棚', '叶菜区', '露地一区', '露地二区', '温室 A',
    '温室 B', '温室 C', '试验田', '冷棚一号', '冷棚二号', '堆肥区', '灌溉泵房'
  ]
  return {
    id: `sensor-${pad(index + 1)}`,
    name: names[index],
    type: 'sensor_soil_api',
    locationId: `location-${pad(index + 1)}`,
    online: index !== 3,
    apiConfig: {
      deviceAddr: `SOIL-${pad(index + 1)}`,
      factors: clone(FACTORS)
    }
  }
})

const PLOT_IDS = ['plot-1', 'plot-2', 'plot-3', 'plot-4', 'plot-5']
mockTasks.forEach((task, i) => { task.locationId = task.locationId || PLOT_IDS[i % PLOT_IDS.length] })
mockDevices.forEach((device, i) => { device.locationId = PLOT_IDS[i % PLOT_IDS.length] })

// 给地图每块地凑一些未完成农事
mockTasks.push(
  { id: 'mp-1', title: '南区滴灌带巡检', category: '', type: 'user', date: today, status: 'pending', completedAt: null, aiReason: null, createdAt: createdBase + 8000, tenantId: TENANT_ID, locationId: 'plot-1' },
  { id: 'mp-2', title: '起垄覆膜（剩 2 亩）', category: '', type: 'user', date: today, status: 'pending', completedAt: null, aiReason: null, createdAt: createdBase + 8200, tenantId: TENANT_ID, locationId: 'plot-2' },
  { id: 'mp-3', title: '种苗炼苗通风', category: '', type: 'user', date: today, status: 'pending', completedAt: null, aiReason: null, createdAt: createdBase + 8400, tenantId: TENANT_ID, locationId: 'plot-3' },
  { id: 'mp-4', title: '试验田株高采集', category: '', type: 'ai', date: today, status: 'pending', completedAt: null, aiReason: '紫罗兰品种进入膨大期，建议记录株高与土壤 EC。', createdAt: createdBase + 8600, tenantId: TENANT_ID, locationId: 'plot-4' },
  { id: 'mp-5', title: '北岭坡地除草', category: '', type: 'user', date: today, status: 'pending', completedAt: null, aiReason: null, createdAt: createdBase + 8800, tenantId: TENANT_ID, locationId: 'plot-5' },
  { id: 'mp-6', title: '北岭追施钾肥', category: '', type: 'user', date: today, status: 'pending', completedAt: null, aiReason: null, createdAt: createdBase + 9000, tenantId: TENANT_ID, locationId: 'plot-5' }
)

// 抽象园区布局：px/py 为地块中心在画布上的坐标（rpx），画布约 1200×1000
const mockPlots = [
  { id: 'plot-1', name: '地块一 · 东区', crop: '西瓜红地瓜', plantDate: '2026-03-12', manager: '老张', area: 18, px: 300, py: 250, size: 300, lat: 19.531, lng: 110.351 },
  { id: 'plot-2', name: '地块二 · 南区', crop: '普薯 32 号', plantDate: '2026-03-20', manager: '小林', area: 22, px: 300, py: 640, size: 320, lat: 19.527, lng: 110.352 },
  { id: 'plot-3', name: '地块三 · 育苗', crop: '脱毒种苗', plantDate: '2026-02-28', manager: '老陈', area: 8, px: 620, py: 440, size: 260, lat: 19.529, lng: 110.356 },
  { id: 'plot-4', name: '地块四 · 试验', crop: '紫罗兰地瓜', plantDate: '2026-04-02', manager: '王婶', area: 12, px: 650, py: 740, size: 280, lat: 19.525, lng: 110.357 },
  { id: 'plot-5', name: '地块五 · 北岭', crop: '烟薯 25', plantDate: '2026-03-08', manager: '阿珍', area: 26, px: 960, py: 260, size: 330, lat: 19.532, lng: 110.361 }
]

function plotPendingTasks(plotId) {
  return mockTasks.filter(task => task.locationId === plotId && task.status === 'pending')
}
function plotDevices(plotId) {
  return mockDevices.filter(device => device.locationId === plotId)
}
function plotSensorBrief(plotId) {
  const devs = plotDevices(plotId)
  if (!devs.length) return { online: false, metrics: [], alarmLevel: 0 }
  const dev = devs[0]
  const rt = buildMockRealtime(dev.id)
  const items = (rt.dataItems[0] && rt.dataItems[0].registerItem) || []
  const alarmLevel = items.reduce((max, it) => Math.max(max, it.alarmLevel || 0), 0)
  const metrics = ['温度', '湿度'].map(name => {
    const it = items.find(x => x.registerName === name)
    return it ? { name, value: it.value, unit: it.unit } : null
  }).filter(Boolean)
  return { online: dev.online, metrics, alarmLevel }
}
function buildMockPlots() {
  return mockPlots.map(plot => ({
    ...plot,
    unfinishedCount: plotPendingTasks(plot.id).length,
    sensor: plotSensorBrief(plot.id)
  }))
}
function buildMockPlotDetail(plotId) {
  const plot = mockPlots.find(p => p.id === plotId)
  if (!plot) return { ok: false, msg: '地块不存在' }
  const tasks = mockTasks
    .filter(task => task.locationId === plotId)
    .sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0) || a.createdAt - b.createdAt)
  const devices = plotDevices(plotId).slice(0, 2).map(d => {
    const rt = buildMockRealtime(d.id)
    const items = (rt.dataItems[0] && rt.dataItems[0].registerItem) || []
    return { id: d.id, name: d.name, online: d.online, deviceTimestamp: rt.deviceTimestamp, factors: items }
  })
  return { ok: true, plot: { ...plot }, tasks, devices }
}

function getMockAlarmLevel(deviceIndex, factorIndex) {
  const rank = deviceIndex * FACTORS.length + factorIndex
  if (rank < 4) return factorIndex === 1 ? 2 : factorIndex === 3 ? 3 : 1
  if (rank < 12) return rank % 3 === 0 ? 3 : 1
  return 0
}

function getMockValue(deviceIndex, factorIndex, step = 0) {
  const wave = Math.sin((step + deviceIndex + factorIndex) / 2) * (factorIndex + 1)
  if (factorIndex === 0) return 24 + deviceIndex * 0.25 + wave
  if (factorIndex === 1) return 61 - deviceIndex * 0.45 - step * 0.18 + wave
  if (factorIndex === 2) return 6.6 + (deviceIndex % 5) * 0.08 + wave * 0.03
  return 860 + deviceIndex * 18 + step * 5 + wave * 14
}

function buildMockRealtime(deviceId) {
  const deviceIndex = mockDevices.findIndex(device => device.id === deviceId)
  const device = mockDevices[deviceIndex]
  if (!device) return { ok: false, msg: '设备不存在' }

  const now = Date.now()
  const registerItem = device.apiConfig.factors.map((factor, factorIndex) => ({
    registerName: factor.factorName,
    value: Number(getMockValue(deviceIndex, factorIndex, 12).toFixed(factor.digits)),
    unit: factor.unit,
    alarmLevel: getMockAlarmLevel(deviceIndex, factorIndex)
  }))
  const values = registerItem.reduce((acc, item) => {
    acc[item.registerName] = item.value
    return acc
  }, {})

  return {
    ok: true,
    deviceTimestamp: device.online ? now - 18 * 1000 : now - 11 * 60 * 1000,
    receivedAt: device.online ? now : now - 11 * 60 * 1000,
    values,
    dataItems: [{ registerItem }]
  }
}

function buildMockHistory(deviceId, limit = 24, order = 'asc') {
  const deviceIndex = mockDevices.findIndex(device => device.id === deviceId)
  if (deviceIndex === -1) return { deviceId, rows: [] }
  const now = Date.now()
  const count = Math.max(1, Number(limit) || 24)
  const rows = Array.from({ length: count }).map((_, step) => {
    const values = FACTORS.reduce((acc, factor, factorIndex) => {
      acc[factor.factorName] = Number(getMockValue(deviceIndex, factorIndex, step).toFixed(factor.digits))
      return acc
    }, {})
    return {
      ts: now - (count - step - 1) * 30 * 60 * 1000,
      values
    }
  })
  return { deviceId, rows: order === 'desc' ? rows.reverse() : rows }
}

function clone(data) {
  return JSON.parse(JSON.stringify(data))
}

function buildHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  const token = wx.getStorageSync(config.tokenKey)
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function request(path, options = {}) {
  if (config.useMock) {
    return Promise.resolve(mockRequest(path, options))
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${config.baseURL}${config.apiPrefix}${path}`,
      method: options.method || 'GET',
      data: options.data || {},
      header: buildHeaders(),
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data)
        } else {
          reject(new Error((res.data && res.data.msg) || '请求失败'))
        }
      },
      fail: reject
    })
  })
}

function mockRequest(path, options = {}) {
  const method = options.method || 'GET'
  const data = options.data || {}

  if (method === 'GET' && path === '/app-state') {
    return { ok: true, devices: clone(mockDevices) }
  }

  if (method === 'GET' && path.indexOf('/device-realtime') === 0) {
    const query = parseQuery(path)
    return clone(buildMockRealtime(query.deviceId))
  }

  if (method === 'GET' && path.indexOf('/device-history') === 0) {
    const query = parseQuery(path)
    return clone(buildMockHistory(query.deviceId, query.limit, query.order))
  }

  if (method === 'GET' && path.indexOf('/farm-tasks/calendar') === 0) {
    const query = parseQuery(path)
    const targetMonth = `${query.year}-${pad(query.month)}`
    const calendar = {}
    mockTasks.forEach(task => {
      if (monthOf(task.date) === targetMonth) {
        calendar[task.date] = (calendar[task.date] || 0) + 1
      }
    })
    return { ok: true, calendar }
  }

  if (method === 'GET' && path.indexOf('/farm-tasks') === 0) {
    const query = parseQuery(path)
    const tasks = mockTasks
      .filter(task => task.date === query.date)
      .sort((a, b) => a.createdAt - b.createdAt)
    return { ok: true, tasks: clone(tasks) }
  }

  if (method === 'POST' && path === '/farm-tasks') {
    const now = Date.now()
    const task = {
      id: `task-${now}`,
      title: data.title,
      category: data.category || '',
      type: data.type || 'user',
      date: data.date,
      status: 'pending',
      completedAt: null,
      aiReason: data.aiReason || null,
      createdAt: now,
      tenantId: TENANT_ID,
      locationId: data.locationId || null
    }
    mockTasks.push(task)
    return { ok: true, task: clone(task) }
  }

  if (method === 'PUT' && path.indexOf('/farm-tasks/') === 0) {
    const id = decodeURIComponent(path.replace('/farm-tasks/', ''))
    const index = mockTasks.findIndex(task => task.id === id)
    if (index === -1) return { ok: false, msg: '任务不存在' }
    mockTasks[index] = { ...mockTasks[index], ...data }
    return { ok: true, task: clone(mockTasks[index]) }
  }

  if (method === 'DELETE' && path.indexOf('/farm-tasks/') === 0) {
    const id = decodeURIComponent(path.replace('/farm-tasks/', ''))
    mockTasks = mockTasks.filter(task => task.id !== id)
    return { ok: true }
  }

  if (method === 'GET' && path === '/park/plots') {
    return clone({ ok: true, plots: buildMockPlots() })
  }

  if (method === 'GET' && path.indexOf('/park/plots/') === 0) {
    const id = decodeURIComponent(path.replace('/park/plots/', ''))
    return clone(buildMockPlotDetail(id))
  }

  return { ok: false, msg: '未匹配的 mock 接口' }
}

function parseQuery(path) {
  const queryString = path.split('?')[1] || ''
  return queryString.split('&').reduce((acc, pair) => {
    if (!pair) return acc
    const parts = pair.split('=')
    acc[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1] || '')
    return acc
  }, {})
}

function getFarmTasks(date) {
  return request(`/farm-tasks?date=${encodeURIComponent(date)}`)
}

function getFarmTaskCalendar(year, month) {
  return request(`/farm-tasks/calendar?year=${year}&month=${month}`)
}

function createFarmTask(payload) {
  return request('/farm-tasks', { method: 'POST', data: payload })
}

function updateFarmTask(id, payload) {
  return request(`/farm-tasks/${encodeURIComponent(id)}`, { method: 'PUT', data: payload })
}

function deleteFarmTask(id) {
  return request(`/farm-tasks/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

function getDevices() {
  return request('/app-state').then(res => ({
    ...res,
    devices: (res.devices || []).filter(device => device.type === 'sensor_soil_api')
  }))
}

function getDeviceRealtime(deviceId, options = {}) {
  const force = options.force === false ? 'false' : 'true'
  return request(`/device-realtime?deviceId=${encodeURIComponent(deviceId)}&force=${force}`)
}

function getDeviceHistory(deviceId, options = {}) {
  const limit = options.limit || 24
  const order = options.order || 'asc'
  return request(`/device-history?deviceId=${encodeURIComponent(deviceId)}&limit=${limit}&order=${order}`)
}

function getPlots() {
  return request('/park/plots')
}

function getPlotDetail(plotId) {
  return request(`/park/plots/${encodeURIComponent(plotId)}`)
}

function formatBeijingTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const bj = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return `${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}:${pad(bj.getUTCSeconds())}`
}

module.exports = {
  getBeijingDateString,
  addDays,
  formatBeijingTime,
  getFarmTasks,
  getFarmTaskCalendar,
  createFarmTask,
  updateFarmTask,
  deleteFarmTask,
  getDevices,
  getDeviceRealtime,
  getDeviceHistory,
  getPlots,
  getPlotDetail
}
