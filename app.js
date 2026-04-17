/* =====================================================
   智慧农业监测平台 — Application Logic v3
   Features: Dynamic status, Automation engine, 
   Cloud Platform API integration, LoRa/RS485 Modbus
   ===================================================== */

// ====================================================
// DATA STORE
// ====================================================
const Store = {
  _get(key, fb) { try { return JSON.parse(localStorage.getItem('agri_' + key)) || fb; } catch { return fb; } },
  _set(key, val) {
    localStorage.setItem('agri_' + key, JSON.stringify(val));
    globalThis.SyncService?.schedulePush?.();
  },

  getLocations()       { return this._get('locations', defaultLocations()); },
  saveLocations(d)     { this._set('locations', d); },
  getDevices()         { return this._get('devices', defaultDevices()); },
  saveDevices(d)       { this._set('devices', d); },
  getAutomations()     { return this._get('automations', defaultAutomations()); },
  saveAutomations(d)   { this._set('automations', d); },
  getAutoLog()         { return this._get('autoLog', []); },
  saveAutoLog(d)       { this._set('autoLog', d); },

  exportData() {
    return {
      locations: this.getLocations(),
      devices: this.getDevices(),
      automations: this.getAutomations(),
      autoLog: this.getAutoLog(),
      history: this._get('history', {}),
    };
  },

  importData(snapshot = {}) {
    localStorage.setItem('agri_locations', JSON.stringify(snapshot.locations || []));
    localStorage.setItem('agri_devices', JSON.stringify(snapshot.devices || []));
    localStorage.setItem('agri_automations', JSON.stringify(snapshot.automations || []));
    localStorage.setItem('agri_autoLog', JSON.stringify(snapshot.autoLog || []));
    localStorage.setItem('agri_history', JSON.stringify(snapshot.history || {}));
  },
};

const SyncService = {
  _timer: null,
  _inFlight: null,
  _bootstrapped: false,

  isEnabled() {
    const config = RuntimeConfigStore.get();
    return config.mode !== 'local' && window.location.protocol !== 'file:';
  },

  async bootstrap() {
    if (!this.isEnabled()) {
      this._bootstrapped = true;
      return;
    }
    try {
      const res = await fetch('/api/v1/app-state', { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        Store.importData(data);
      }
    } catch (error) {
      console.warn('[SyncService] bootstrap failed:', error.message);
    } finally {
      this._bootstrapped = true;
    }
  },

  schedulePush(delay = 500) {
    if (!this.isEnabled() || !this._bootstrapped) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => { this.pushNow(); }, delay);
  },

  async pushNow() {
    if (!this.isEnabled() || this._inFlight) return;
    const snapshot = Store.exportData();
    this._inFlight = fetch('/api/v1/app-state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    }).catch(error => {
      console.warn('[SyncService] push failed:', error.message);
    }).finally(() => {
      this._inFlight = null;
    });
    await this._inFlight;
  },
};
globalThis.SyncService = SyncService;

const RuntimeConfigStore = {
  KEY: 'runtimeConfig',
  defaults() {
    const servedOverHttp = window.location.protocol in { 'http:': true, 'https:': true };
    return {
      mode: servedOverHttp ? 'remote' : 'local',
      backendBaseUrl: '/api/v1',
      proxyBaseUrl: '/proxy',
      healthEndpoint: '/health',
      syncPolicy: 'manual',
    };
  },
  get() {
    const stored = Store._get(this.KEY, {});
    const isServerHost = !['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.protocol !== 'file:';
    const mode = (isServerHost && stored.mode === 'local') ? 'remote' : stored.mode;
    return {
      ...this.defaults(),
      ...stored,
      ...(mode ? { mode } : {}),
    };
  },
  save(patch) {
    const next = { ...this.get(), ...patch };
    Store._set(this.KEY, next);
    return next;
  },
};

const LocalRepository = {
  listLocations() {
    return Store.getLocations().map(this._normalizeLocation);
  },

  saveLocation(location) {
    const locations = this.listLocations();
    const normalized = this._normalizeLocation(location);
    const index = locations.findIndex(item => item.id === normalized.id);
    if (index >= 0) locations[index] = normalized;
    else locations.push(normalized);
    Store.saveLocations(locations);
    return normalized;
  },

  deleteLocation(locationId) {
    Store.saveLocations(this.listLocations().filter(item => item.id !== locationId));
    const devices = this.listDevices().map(device => (
      device.locationId === locationId ? { ...device, locationId: '' } : device
    ));
    Store.saveDevices(devices);
  },

  listDevices() {
    return Store.getDevices().map(this._normalizeDevice);
  },

  saveDevice(device) {
    const devices = this.listDevices();
    const normalized = this._normalizeDevice(device);
    const index = devices.findIndex(item => item.id === normalized.id);
    if (index >= 0) devices[index] = { ...devices[index], ...normalized };
    else devices.push(normalized);
    Store.saveDevices(devices);
    return normalized;
  },

  saveDevices(devices) {
    Store.saveDevices(devices.map(device => this._normalizeDevice(device)));
  },

  deleteDevice(deviceId) {
    this.saveDevices(this.listDevices().filter(item => item.id !== deviceId));
  },

  listAutomations() {
    return Store.getAutomations();
  },

  saveAutomation(rule) {
    const rules = this.listAutomations();
    const index = rules.findIndex(item => item.id === rule.id);
    if (index >= 0) rules[index] = { ...rules[index], ...rule };
    else rules.push(rule);
    Store.saveAutomations(rules);
    return rule;
  },

  saveAutomations(rules) {
    Store.saveAutomations(rules);
  },

  deleteAutomation(ruleId) {
    this.saveAutomations(this.listAutomations().filter(item => item.id !== ruleId));
  },

  getAutoLog() {
    return Store.getAutoLog();
  },

  saveAutoLog(logs) {
    Store.saveAutoLog(logs);
  },

  _normalizeLocation(location) {
    return {
      id: location.id,
      name: (location.name || '').trim(),
      type: location.type || '其他',
      lat: Number(location.lat) || 0,
      lng: Number(location.lng) || 0,
      area: Number(location.area) || 0,
      notes: (location.notes || '').trim(),
    };
  },

  _normalizeDevice(device) {
    return {
      id: device.id,
      name: (device.name || '').trim(),
      type: device.type || 'sensor_env',
      locationId: device.locationId || '',
      address: (device.address || '').trim(),
      protocol: device.protocol || 'LoRa',
      streamUrl: (device.streamUrl || '').trim(),
      notes: (device.notes || '').trim(),
      online: device.online !== false,
      lat: Number(device.lat) || 0,
      lng: Number(device.lng) || 0,
      apiConfig: device.apiConfig || null,
      metadata: device.metadata || {},
    };
  },
};

const BackendAdapter = {
  _health: { ok: null, checkedAt: 0, message: '未检查' },

  getConfig() {
    return RuntimeConfigStore.get();
  },

  getModeMeta() {
    const { mode, backendBaseUrl, syncPolicy } = this.getConfig();
    const labels = {
      local: '本地模式',
      hybrid: '混合模式',
      remote: '后端模式',
    };
    return {
      mode,
      label: labels[mode] || '本地模式',
      backendBaseUrl,
      syncPolicy,
    };
  },

  async checkHealth(force = false) {
    const now = Date.now();
    if (!force && now - this._health.checkedAt < 45000) return this._health;
    const { mode, backendBaseUrl, healthEndpoint } = this.getConfig();
    if (mode === 'local') {
      this._health = { ok: true, checkedAt: now, message: '本地运行中' };
      return this._health;
    }
    try {
      const res = await fetch(`${backendBaseUrl}${healthEndpoint}`, { method: 'GET' });
      this._health = {
        ok: res.ok,
        checkedAt: now,
        message: res.ok ? '后端可连接' : `后端响应异常 (${res.status})`,
      };
    } catch (error) {
      this._health = {
        ok: false,
        checkedAt: now,
        message: `后端不可达: ${error.message}`,
      };
    }
    return this._health;
  },

  getHealthSnapshot() {
    return this._health;
  },

  getEndpointMap() {
    const { backendBaseUrl } = this.getConfig();
    return {
      locations: `${backendBaseUrl}/locations`,
      devices: `${backendBaseUrl}/devices`,
      readings: `${backendBaseUrl}/readings`,
      automations: `${backendBaseUrl}/automations`,
      health: `${backendBaseUrl}${this.getConfig().healthEndpoint}`,
    };
  },
};

const DataRepository = {
  listLocations() { return LocalRepository.listLocations(); },
  saveLocation(location) { return LocalRepository.saveLocation(location); },
  deleteLocation(locationId) { return LocalRepository.deleteLocation(locationId); },
  listDevices() { return LocalRepository.listDevices(); },
  saveDevice(device) { return LocalRepository.saveDevice(device); },
  saveDevices(devices) { return LocalRepository.saveDevices(devices); },
  deleteDevice(deviceId) { return LocalRepository.deleteDevice(deviceId); },
  listAutomations() { return LocalRepository.listAutomations(); },
  saveAutomation(rule) { return LocalRepository.saveAutomation(rule); },
  saveAutomations(rules) { return LocalRepository.saveAutomations(rules); },
  deleteAutomation(ruleId) { return LocalRepository.deleteAutomation(ruleId); },
  getAutoLog() { return LocalRepository.getAutoLog(); },
  saveAutoLog(logs) { return LocalRepository.saveAutoLog(logs); },
  getRuntimeConfig() { return RuntimeConfigStore.get(); },
  saveRuntimeConfig(patch) { return RuntimeConfigStore.save(patch); },
  getEndpointMap() { return BackendAdapter.getEndpointMap(); },
};

const HistoryStore = {
  KEY: 'history',
  MAX_PER_DEVICE: 720,

  getAll() {
    return Store._get(this.KEY, {});
  },

  getDeviceRecords(deviceId) {
    const history = this.getAll();
    return Array.isArray(history[deviceId]) ? history[deviceId] : [];
  },

  append(deviceId, payload) {
    if (!deviceId || !payload) return;
    const history = this.getAll();
    const records = Array.isArray(history[deviceId]) ? history[deviceId] : [];
    records.push({
      ts: payload.ts || Date.now(),
      values: payload.values || {},
      source: payload.source || 'simulated',
    });
    history[deviceId] = records.slice(-this.MAX_PER_DEVICE);
    Store._set(this.KEY, history);
  },
};

const UI = {
  toast(message, type = 'info') {
    const host = document.getElementById('toast-stack');
    if (!host) return;
    const item = document.createElement('div');
    item.className = `toast toast-${type}`;
    item.textContent = message;
    host.appendChild(item);
    requestAnimationFrame(() => item.classList.add('show'));
    setTimeout(() => {
      item.classList.remove('show');
      setTimeout(() => item.remove(), 250);
    }, 2600);
  },
};

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

// ====================================================
// SEED DATA
// ====================================================
function defaultLocations() {
  return [];
}

function defaultDevices() {
  return [];
}

function defaultAutomations() {
  return [];
}

// ====================================================
// PEST DB
// ====================================================
const PEST_DB = [
  { id:'p1', type:'pest', name:'稻飞虱', latin:'Nilaparvata lugens', emoji:'🦗', severity:'high', crops:['水稻'], season:'5-10月',
    symptoms:'叶片出现黄白色条斑，植株下部枯黄，严重时整株倒伏。', prevention:'及时排水晒田，减少氮肥，选用抗性品种。',
    control:'吡虫啉、噻嗪酮等药剂喷雾，注意对准基部。', threshold:'百丛虫量超过1000头时即需防治。' },
  { id:'p2', type:'disease', name:'水稻纹枯病', latin:'Rhizoctonia solani', emoji:'🍂', severity:'high', crops:['水稻'], season:'6-9月',
    symptoms:'叶鞘上出现椭圆形云纹状病斑，高温高湿时向上蔓延。', prevention:'合理密植，降低田间湿度，控制氮肥。',
    control:'苯醚甲环唑、井冈霉素等喷施茎基部。', threshold:'丛发病率达到20%时开始防治。' },
  { id:'p3', type:'pest', name:'斜纹夜蛾', latin:'Spodoptera litura', emoji:'🦋', severity:'medium', crops:['蔬菜','水稻','玉米'], season:'7-10月',
    symptoms:'幼虫取食叶片成穿孔状，老龄幼虫昼伏夜出。', prevention:'安装诱虫灯，推广性信息素诱捕。',
    control:'氯虫苯甲酰胺等喷雾，傍晚施药效果最佳。', threshold:'百株卵块达到3块或幼虫30头时防治。' },
  { id:'p4', type:'disease', name:'蔬菜灰霉病', latin:'Botrytis cinerea', emoji:'🌫️', severity:'medium', crops:['蔬菜','番茄'], season:'冬-春季',
    symptoms:'病部出现水浸状斑点，扩大后产生灰褐色霉层。', prevention:'加强通风透光，降低湿度，清除病残体。',
    control:'腐霉利、嘧霉胺等轮换使用避免抗性。', threshold:'发病初期即开始施药。' },
  { id:'p5', type:'pest', name:'蚜虫（菜蚜）', latin:'Myzus persicae', emoji:'🐜', severity:'medium', crops:['蔬菜','叶菜'], season:'全年',
    symptoms:'群集叶背刺吸汁液，叶片卷曲皱缩，可传播病毒病。', prevention:'黄色粘虫板，保护瓢虫等天敌。',
    control:'吡虫啉、啶虫脒等喷雾，注意叶背。', threshold:'每株蚜虫100头时开始防治。' },
  { id:'p6', type:'disease', name:'黄瓜霜霉病', latin:'Pseudoperonospora cubensis', emoji:'🥒', severity:'high', crops:['黄瓜','葫芦科'], season:'春季',
    symptoms:'叶面黄绿色角斑，背面紫褐色霉层，发展迅速。', prevention:'选用抗病品种，大棚降湿。',
    control:'烯酰吗啉等喷雾，发病前预防最佳。', threshold:'发现中心病株时立即用药。' },
];

// ====================================================
// SENSOR ENGINE (supports both simulated & API data)
// ====================================================
const SensorEngine = {
  _state: {},
  _apiCache: {},   // { deviceAddr: { data, timestamp, factors } }
  _apiCacheTTL: 25000,  // 25 seconds (API polled every 30s)

  _init(id) {
    if (!this._state[id]) {
      this._state[id] = {
        temp: 20+Math.random()*15, humid: 40+Math.random()*40,
        soil: 30+Math.random()*50, light: 5000+Math.random()*40000,
        co2: 380+Math.random()*200, wind: 0.5+Math.random()*5,
        pest: Math.floor(Math.random()*25),
      };
    }
  },
  _drift(v, min, max, mag) { v += (Math.random()-0.5)*mag; return Math.max(min, Math.min(max, v)); },
  tick(id) {
    this._init(id);
    const s = this._state[id];
    s.temp  = this._drift(s.temp, 5, 45, 0.4);
    s.humid = this._drift(s.humid, 10, 99, 1.0);
    s.soil  = this._drift(s.soil, 5, 100, 0.8);
    s.light = this._drift(s.light, 0, 80000, 800);
    s.co2   = this._drift(s.co2, 350, 1200, 5);
    s.wind  = this._drift(s.wind, 0, 20, 0.3);
    if (Math.random() > 0.9) s.pest = Math.max(0, s.pest + Math.floor(Math.random()*3-1));
    return { ...s };
  },
  get(id) { this._init(id); return { ...this._state[id] }; },

  // Store API data in cache
  setApiData(deviceAddr, dataItems, timestamp) {
    this._apiCache[deviceAddr] = { dataItems, timestamp, fetchedAt: Date.now() };
  },

  // Get cached API data
  getApiData(deviceAddr) {
    return this._apiCache[deviceAddr] || null;
  },

  // Check if cache is fresh
  isApiCacheFresh(deviceAddr) {
    const entry = this._apiCache[deviceAddr];
    return entry && (Date.now() - entry.fetchedAt) < this._apiCacheTTL;
  },
};

// ====================================================
// CLOUD PLATFORM API CLIENT
// ====================================================
const CloudAPI = {
  _proxyBase: '/proxy',  // Local proxy prefix
  _token: null,
  _tokenExpiry: 0,
  _credentials: null,    // { loginName, password, apiUrl }

  // Load saved credentials from localStorage
  loadCredentials() {
    try {
      this._credentials = JSON.parse(localStorage.getItem('agri_cloud_creds'));
    } catch { this._credentials = null; }
    return this._credentials;
  },

  saveCredentials(loginName, password, apiUrl) {
    this._credentials = { loginName, password, apiUrl: apiUrl || 'http://www.0531yun.com' };
    localStorage.setItem('agri_cloud_creds', JSON.stringify(this._credentials));
  },

  clearCredentials() {
    this._credentials = null;
    this._token = null;
    this._tokenExpiry = 0;
    localStorage.removeItem('agri_cloud_creds');
  },

  isConfigured() {
    return !!(this._credentials || this.loadCredentials());
  },

  _buildProxyHeaders(extra = {}) {
    const apiUrl = this._credentials?.apiUrl || 'http://www.0531yun.com';
    return { 'x-target-base': apiUrl, ...extra };
  },

  getProxyBase() {
    return DataRepository.getRuntimeConfig().proxyBaseUrl || this._proxyBase;
  },

  // Authenticate and get token
  async authenticate(loginName, password) {
    const url = `${this.getProxyBase()}/api/getToken?loginName=${encodeURIComponent(loginName)}&password=${encodeURIComponent(password)}`;
    const res = await fetch(url, { headers: this._buildProxyHeaders() });
    const json = await res.json();
    if (json.code !== 1000) throw new Error(json.message || '认证失败');
    this._token = json.data.token;
    this._tokenExpiry = json.data.expiration * 1000; // Convert to ms
    return json.data;
  },

  // Ensure token is valid, refresh if needed
  async ensureToken() {
    if (!this._credentials) this.loadCredentials();
    if (!this._credentials) throw new Error('未配置识别码');
    if (this._token && Date.now() < this._tokenExpiry - 60000) return; // 1min buffer
    await this.authenticate(this._credentials.loginName, this._credentials.password);
  },

  // Generic API request with auth
  async request(endpoint, params = {}) {
    await this.ensureToken();
    const qs = new URLSearchParams(params).toString();
    const url = `${this.getProxyBase()}${endpoint}${qs ? '?' + qs : ''}`;
    const res = await fetch(url, { headers: this._buildProxyHeaders({ authorization: this._token }) });
    const json = await res.json();
    if (json.code !== 1000) throw new Error(json.message || 'API Error');
    return json.data;
  },

  // Get all devices under the account
  async getDeviceList() {
    return await this.request('/api/device/getDeviceList');
  },

  // Get real-time data for a device
  async getRealTimeData(deviceAddr) {
    const data = await this.request('/api/data/getRealTimeDataByDeviceAddr', { deviceAddrs: deviceAddr });
    return data && data.length > 0 ? data[0] : null;
  },

  // Get device info (with factors/thresholds)
  async getDeviceInfo(deviceAddr) {
    return await this.request('/api/device/getDevice', { deviceAddr });
  },

  // Get historical data
  async getHistoryData(deviceAddr, startTime, endTime, nodeId = -1) {
    return await this.request('/api/data/historyList', {
      deviceAddr, nodeId, startTime, endTime
    });
  },

  // Fetch and cache real-time data for a device
  async fetchAndCacheRealTime(deviceAddr) {
    try {
      const rtData = await this.getRealTimeData(deviceAddr);
      if (rtData && rtData.dataItem) {
        SensorEngine.setApiData(deviceAddr, rtData.dataItem, rtData.timeStamp);
        return rtData;
      }
    } catch (err) {
      console.warn(`[CloudAPI] Failed to fetch data for ${deviceAddr}:`, err.message);
    }
    return null;
  },
};

// ====================================================
// CHART HELPER
// ====================================================
const ChartHelper = {
  _i: {},
  destroy(id) { if (this._i[id]) { this._i[id].destroy(); delete this._i[id]; } },
  defaults() { Chart.defaults.color = '#94a3b8'; Chart.defaults.borderColor = '#e2e8f0'; Chart.defaults.font.family = 'Inter'; },
  line(id, labels, datasets) {
    this.destroy(id);
    const ctx = document.getElementById(id);
    if (!ctx) return;
    this._i[id] = new Chart(ctx, {
      type: 'line', data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
        plugins: { legend: { position:'top', labels: { usePointStyle: true, padding: 16 } } },
        scales: { x: { grid: { color:'#f1f5f9' } }, y: { grid: { color:'#f1f5f9' } } }
      }
    });
  },
};

// ====================================================
// PARAM LABELS
// ====================================================
const PARAM_LABELS = {
  temp: '空气温度 (°C)', humid: '空气湿度 (%)', soil: '土壤湿度 (%)',
  light: '光照强度 (lux)', co2: 'CO₂ (ppm)', wind: '风速 (m/s)', pest: '虫害捕获量'
};
const OP_LABELS = { '>': '大于', '<': '小于', '>=': '大于等于', '<=': '小于等于', '==': '等于' };
const ACTION_LABELS = { on: '开启', off: '关闭' };
const TYPE_LABELS = {
  sensor_env:'🌡️ 环境传感器', sensor_soil:'🌱 土壤传感器', sensor_soil_api:'🔗 在线传感器',
  sensor_pest:'🦟 虫情监测仪', camera:'📹 摄像头', controller_water:'💧 灌溉控制器',
  controller_light:'💡 补光控制器', controller_fan:'🌀 风机控制器'
};

// ====================================================
// MAIN APP
// ====================================================
const app = {
  currentPage: 'dashboard',
  dashMap: null,
  liveInterval: null,
  liveReadings: [],
  livePaused: false,
  autoInterval: null,
  _tempConditions: [],
  _tempActions: [],
  _locPickerMap: null,
  _locPickerMarker: null,
  _devPickerMap: null,
  _devPickerMarker: null,
  _dashMapFilterLoc: 'all',
  _cloudDevices: [],       // Devices discovered from cloud
  _cloudSelected: new Set(),
  _cloudRenameMap: {},
  _cloudApiPollInterval: null,
  _backendHealthInterval: null,
  _runtimeConfig: null,

  // ─── BOOT ───
  async init() {
    await SyncService.bootstrap();
    ChartHelper.defaults();
    this._runtimeConfig = DataRepository.getRuntimeConfig();
    this._ensureDeviceCoords();
    this.bindNav();
    this.bindSidebarToggle();
    this.bindAlertDrawer();
    this.bindDeviceTypeChange();
    this.updateSidebarStatus();
    this.renderAlerts();
    this.navigate('dashboard');
    this.startClock();
    this.startAutoEngine();
    this.startCloudApiPolling();
    this.startBackendHealthPolling();
  },

  startClock() {
    const el = document.getElementById('live-time');
    const tick = () => { el.textContent = new Date().toLocaleTimeString('zh-CN'); };
    tick(); setInterval(tick, 1000);
  },

  startBackendHealthPolling() {
    if (this._backendHealthInterval) clearInterval(this._backendHealthInterval);
    this.refreshBackendHealth(true);
    this._backendHealthInterval = setInterval(() => this.refreshBackendHealth(), 60000);
  },

  async refreshBackendHealth(force = false) {
    await BackendAdapter.checkHealth(force);
    this._runtimeConfig = DataRepository.getRuntimeConfig();
    this.updateSidebarStatus();
    if (this.currentPage === 'devices') this.renderDevices();
  },

  // ─── DYNAMIC SIDEBAR STATUS ───
  updateSidebarStatus() {
    const devices = DataRepository.listDevices();
    const total = devices.length;
    const online = devices.filter(d => d.online).length;
    const offline = total - online;
    const loraDev = devices.filter(d => d.protocol === 'LoRa');
    const loraOnline = loraDev.filter(d => d.online).length;
    const loraTotal = loraDev.length;

    let sysStatus, sysColor;
    if (offline === 0) { sysStatus = '系统运行正常'; sysColor = 'green'; }
    else if (offline <= 2) { sysStatus = `${offline}台设备离线`; sysColor = 'yellow'; }
    else { sysStatus = `${offline}台设备异常`; sysColor = 'red'; }

    let loraStatus, loraColor;
    if (loraTotal === 0) { loraStatus = '无LoRa设备'; loraColor = 'yellow'; }
    else if (loraOnline === loraTotal) { loraStatus = `LoRa 全部在线 (${loraOnline}/${loraTotal})`; loraColor = 'green'; }
    else { loraStatus = `LoRa ${loraOnline}/${loraTotal} 在线`; loraColor = 'yellow'; }

    const modeMeta = BackendAdapter.getModeMeta();
    const health = BackendAdapter.getHealthSnapshot();
    const backendColor = health.ok === null ? 'yellow' : (health.ok ? 'green' : 'red');
    const backendStatus = health.ok === null
      ? `${modeMeta.label} · 待检查`
      : `${modeMeta.label} · ${health.message}`;

    const el = document.getElementById('sidebar-status');
    el.innerHTML = `
      <div class="status-row"><span class="status-dot ${sysColor}"></span><span>${sysStatus}</span></div>
      <div class="status-row"><span class="status-dot ${loraColor}"></span><span>${loraStatus}</span></div>
      <div class="status-row"><span class="status-dot ${backendColor}"></span><span>${backendStatus}</span></div>
    `;
  },

  // ─── NAV ───
  bindNav() {
    document.querySelectorAll('.nav-link[data-page]').forEach(l => {
      l.addEventListener('click', () => this.navigate(l.dataset.page));
    });
  },

  navigate(page) {
    this.currentPage = page;
    document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.page === page));
    const titles = {
      dashboard:'系统总览', realtime:'实时数据', video:'视频监控', history:'历史数据',
      pestdb:'病害虫数据库', automation:'自动化流程', locations:'地块管理', devices:'设备管理'
    };
    document.getElementById('page-title').textContent = titles[page] || '';
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById('page-'+page);
    if (el) el.classList.add('active');
    this.stopLive();
    const init = {
      dashboard: () => this.initDashboard(), realtime: () => this.initRealtime(),
      video: () => this.renderVideo(), history: () => this.initHistory(),
      pestdb: () => this.renderPests(), automation: () => this.renderAutomation(),
      locations: () => this.renderLocations(), devices: () => this.renderDevices(),
    };
    if (init[page]) init[page]();
  },

  bindSidebarToggle() {
    document.getElementById('sidebarToggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('collapsed');
    });
  },

  bindAlertDrawer() {
    document.getElementById('alertToggle').addEventListener('click', () => {
      document.getElementById('alertDrawer').classList.toggle('open');
    });
  },

  setRuntimeMode(mode, patch = {}) {
    const allowed = ['local', 'hybrid', 'remote'];
    if (!allowed.includes(mode)) {
      UI.toast('运行模式无效', 'warning');
      return;
    }
    this._runtimeConfig = DataRepository.saveRuntimeConfig({ mode, ...patch });
    UI.toast(`已切换到${BackendAdapter.getModeMeta().label}`, 'success');
    this.refreshBackendHealth(true);
  },

  // ─── ALERTS ───
  getAlerts() {
    const devices = DataRepository.listDevices();
    const locs = DataRepository.listLocations();
    const locMap = Object.fromEntries(locs.map(l => [l.id, l.name]));
    const alerts = [];
    devices.forEach(d => {
      const data = SensorEngine.get(d.id);
      const loc = locMap[d.locationId] || '未分配';
      if (d.online && d.type === 'sensor_env') {
        if (data.temp > 36) alerts.push({ type:'danger', icon:'fa-temperature-arrow-up', title:`气温过高 (${data.temp.toFixed(1)}°C)`, meta:`${d.name} · ${loc}`, page:'realtime' });
        if (data.humid < 25) alerts.push({ type:'warning', icon:'fa-droplet-slash', title:`湿度过低 (${data.humid.toFixed(0)}%)`, meta:`${d.name} · ${loc}`, page:'realtime' });
      }
      if (d.online && d.type === 'sensor_soil') {
        if (data.soil < 20) alerts.push({ type:'warning', icon:'fa-droplet', title:`土壤缺水 (${data.soil.toFixed(0)}%) 建议灌溉`, meta:`${d.name} · ${loc}`, page:'realtime' });
      }
      if (d.online && d.type === 'sensor_pest') {
        if (data.pest > 15) alerts.push({ type:'danger', icon:'fa-bug', title:`虫害预警 捕获: ${data.pest}头`, meta:`${d.name} · ${loc}`, page:'pestdb' });
      }
      if (!d.online) alerts.push({ type:'info', icon:'fa-circle-exclamation', title:'设备离线', meta:`${d.name} · ${loc}` });
    });
    return alerts;
  },

  renderAlerts() {
    const alerts = this.getAlerts();
    document.getElementById('alertCount').textContent = alerts.length || '';
    const html = alerts.length === 0
      ? '<div class="empty-state"><i class="fa-solid fa-circle-check"></i><p>暂无警报，一切正常</p></div>'
      : alerts.map(a => `
          <div class="alert-item ${a.type}">
            <i class="fa-solid ${a.icon}"></i>
            <div class="alert-item-content">
              <div class="alert-item-title">${a.title}</div>
              <div class="alert-item-meta">${a.meta}</div>
            </div>
            ${a.page ? `<button class="alert-action-btn" onclick="app.navigate('${a.page}')">查看</button>` : ''}
          </div>`).join('');
    ['dash-alerts','alertsList'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    });
  },

  // ─── DASHBOARD ───
  initDashboard() {
    const devices = DataRepository.listDevices();
    const locs = DataRepository.listLocations();
    const online = devices.filter(d => d.online).length;
    const envDevs = devices.filter(d => d.type === 'sensor_env' && d.online);
    let avgT = 0; envDevs.forEach(d => avgT += SensorEngine.get(d.id).temp);
    if (envDevs.length) avgT /= envDevs.length;
    const alerts = this.getAlerts();

    document.getElementById('kpi-row').innerHTML = `
      <div class="kpi-card accent" onclick="app.navigate('devices')" style="cursor:pointer" title="点击查看设备管理">
        <div class="kpi-icon"><i class="fa-solid fa-microchip"></i></div>
        <div><div class="kpi-label">在线设备</div><div class="kpi-value">${online}<span class="kpi-unit">/${devices.length}</span></div><div class="kpi-sub">点击管理设备 →</div></div></div>
      <div class="kpi-card ${alerts.length ? 'danger' : 'success'}" onclick="document.getElementById('alertToggle').click()" style="cursor:pointer" title="点击查看警报详情">
        <div class="kpi-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <div><div class="kpi-label">当前警报</div><div class="kpi-value">${alerts.length}<span class="kpi-unit">条</span></div><div class="kpi-sub">${alerts.length?'点击查看详情 →':'所有指标正常 ✓'}</div></div></div>
      <div class="kpi-card warning" onclick="app.navigate('realtime')" style="cursor:pointer" title="点击查看实时数据">
        <div class="kpi-icon"><i class="fa-solid fa-temperature-half"></i></div>
        <div><div class="kpi-label">平均气温</div><div class="kpi-value">${avgT.toFixed(1)}<span class="kpi-unit">°C</span></div><div class="kpi-sub">点击查看实时数据 →</div></div></div>
      <div class="kpi-card success" onclick="app.navigate('locations')" style="cursor:pointer" title="点击管理地块">
        <div class="kpi-icon"><i class="fa-solid fa-map"></i></div>
        <div><div class="kpi-label">监测地块</div><div class="kpi-value">${locs.length}<span class="kpi-unit">块</span></div><div class="kpi-sub">共 ${locs.reduce((a,l)=>a+(+l.area||0),0)} 亩 · 点击管理 →</div></div></div>
    `;

    if (!this.dashMap) {
      this.dashMap = L.map('dash-map', { zoomControl: true, attributionControl: true }).setView([20.044,110.199], 15);
      // 高德地图瓦片（中国大陆可用，无需API Key）
      this._mapLayers = {
        standard: L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
          subdomains: '1234',
          attribution: '© <a href="https://www.amap.com">高德地图</a>',
          maxZoom: 18,
        }),
        satellite: L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}', {
          subdomains: '1234',
          attribution: '© <a href="https://www.amap.com">高德地图 卫星图</a>',
          maxZoom: 18,
        }),
        satelliteLabel: L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}', {
          subdomains: '1234',
          maxZoom: 18,
        }),
      };
      this._mapLayers.standard.addTo(this.dashMap);
      this._currentMapLayer = 'standard';
      // 图层切换控件
      this._addMapLayerControl();
    } else { this.dashMap.eachLayer(l => { if (l instanceof L.Marker || l instanceof L.CircleMarker) this.dashMap.removeLayer(l); }); }
    // Populate map location filter
    const mapFilter = document.getElementById('map-location-filter');
    if (mapFilter) {
      const curVal = this._dashMapFilterLoc || 'all';
      mapFilter.innerHTML = '<option value="all">🗺️ 全部地块</option>' + locs.map(l => `<option value="${l.id}" ${l.id===curVal?'selected':''}>${l.name}</option>`).join('');
      mapFilter.value = curVal;
    }
    this.addMapMarkers(this.dashMap, this._dashMapFilterLoc);
    this.renderAlerts();
    this.updateSidebarStatus();
  },

  addMapMarkers(map, filterLocId) {
    const locs = DataRepository.listLocations();
    const devices = DataRepository.listDevices();
    const filteredLocs = (!filterLocId || filterLocId === 'all') ? locs : locs.filter(l => l.id === filterLocId);
    const bounds = [];

    // Location markers (colored circles)
    filteredLocs.forEach(loc => {
      if (!loc.lat || !loc.lng) return;
      bounds.push([loc.lat, loc.lng]);
      const devs = devices.filter(d => d.locationId === loc.id);
      const hasOff = devs.some(d => !d.online);
      const bgColor = hasOff ? '#f59e0b' : '#3b82f6';
      const locIcon = L.divIcon({
        className: '',
        html: `<div style="width:28px;height:28px;border-radius:50%;background:${bgColor};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:14px;">🏷️</div>`,
        iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -18],
      });
      const popup = `<div style="font-family:Inter;min-width:180px">
        <div style="font-weight:700;font-size:14px;margin-bottom:4px">${loc.name}</div>
        <span style="color:#666;font-size:12px">${loc.type} · ${loc.area}亩</span>
        <hr style="margin:6px 0;border-color:#eee">
        <div style="font-size:12px;margin-bottom:6px">${devs.length} 台设备 (${devs.filter(d=>d.online).length} 在线)</div>
        <button onclick="app.filterMapByLocation('${loc.id}')" style="width:100%;padding:5px;background:#1070e0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px">聚焦此地块</button></div>`;
      L.marker([loc.lat, loc.lng], {icon: locIcon}).addTo(map).bindPopup(popup);
    });

    // Device markers (small colored circles)
    const typeColors = {
      sensor_env:'#f59e0b', sensor_soil:'#10b981', sensor_pest:'#ef4444',
      camera:'#8b5cf6', controller_water:'#3b82f6', controller_light:'#eab308', controller_fan:'#64748b'
    };
    const filteredDevs = (!filterLocId || filterLocId === 'all') ? devices : devices.filter(d => d.locationId === filterLocId);
    filteredDevs.forEach(dev => {
      if (!dev.lat || !dev.lng) return;
      bounds.push([dev.lat, dev.lng]);
      const fillColor = typeColors[dev.type] || '#94a3b8';
      const marker = L.circleMarker([dev.lat, dev.lng], {
        radius: 7, fillColor, fillOpacity: dev.online ? 0.9 : 0.3,
        color: '#fff', weight: 2,
      }).addTo(map);
      const typeName = TYPE_LABELS[dev.type] || dev.type;
      const locName = locs.find(l => l.id === dev.locationId)?.name || '未分配';
      marker.bindPopup(`<div style="font-family:Inter;min-width:160px">
        <div style="font-weight:600;font-size:13px">${dev.name}</div>
        <div style="font-size:11px;color:#666;margin:4px 0">${typeName}</div>
        <div style="font-size:11px;color:#888">📍 ${locName}</div>
        <div style="font-size:11px;margin-top:4px"><span style="color:${dev.online?'#10b981':'#ef4444'}">● ${dev.online?'在线':'离线'}</span></div>
        ${dev.notes ? `<div style="font-size:11px;color:#999;margin-top:4px">${dev.notes}</div>` : ''}
      </div>`);
    });

    // Fit map bounds
    if (bounds.length > 0) {
      if (filterLocId && filterLocId !== 'all') {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
      } else {
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
      }
    }
  },

  _addMapLayerControl() {
    const ctrl = L.control({ position: 'topright' });
    ctrl.onAdd = () => {
      const div = L.DomUtil.create('div', 'map-layer-ctrl');
      div.innerHTML = `
        <button id="map-btn-standard" class="map-layer-btn active" onclick="app.switchMapLayer('standard')">标准图</button>
        <button id="map-btn-satellite" class="map-layer-btn" onclick="app.switchMapLayer('satellite')">卫星图</button>
      `;
      L.DomEvent.disableClickPropagation(div);
      return div;
    };
    ctrl.addTo(this.dashMap);
  },

  switchMapLayer(type) {
    if (!this.dashMap || !this._mapLayers) return;
    // Remove current base layers
    ['standard','satellite','satelliteLabel'].forEach(k => {
      if (this.dashMap.hasLayer(this._mapLayers[k])) this.dashMap.removeLayer(this._mapLayers[k]);
    });
    if (type === 'satellite') {
      this._mapLayers.satellite.addTo(this.dashMap);
      this._mapLayers.satelliteLabel.addTo(this.dashMap);
    } else {
      this._mapLayers.standard.addTo(this.dashMap);
    }
    this._currentMapLayer = type;
    document.querySelectorAll('.map-layer-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('map-btn-' + type);
    if (btn) btn.classList.add('active');
  },

  filterMapByLocation(locId) {
    this._dashMapFilterLoc = locId;
    const sel = document.getElementById('map-location-filter');
    if (sel) sel.value = locId;
    const closeBtn = document.getElementById('map-close-focus-btn');
    const addBtn = document.getElementById('map-add-device-btn');
    const isFocused = locId && locId !== 'all';
    // Toggle close button visibility
    if (closeBtn) closeBtn.style.display = isFocused ? '' : 'none';
    // Update add button text for focused mode
    if (addBtn && isFocused) {
      const loc = DataRepository.listLocations().find(l => l.id === locId);
      addBtn.innerHTML = `<i class="fa-solid fa-plus" style="margin-right:4px"></i>添加设备到「${loc?.name || ''}」`;
    } else if (addBtn) {
      addBtn.innerHTML = '<i class="fa-solid fa-plus" style="margin-right:4px"></i>添加设备';
    }
    // Toggle map fullscreen overlay
    const mapPanel = document.getElementById('dash-map')?.closest('.glass-panel');
    if (mapPanel) mapPanel.classList.toggle('map-fullscreen', isFocused);
    if (!this.dashMap) return;
    this.dashMap.eachLayer(l => { if (l instanceof L.Marker || l instanceof L.CircleMarker) this.dashMap.removeLayer(l); });
    this.addMapMarkers(this.dashMap, locId);
    // Invalidate size after CSS transition
    setTimeout(() => { if (this.dashMap) this.dashMap.invalidateSize(); }, 350);
  },

  addDeviceFromMap() {
    const locId = this._dashMapFilterLoc;
    this.openModal_device_prep();
    this.clearDeviceForm();
    if (locId && locId !== 'all') {
      document.getElementById('dev-location').value = locId;
    }
    this.openModal('device');
  },

  // ─── REALTIME ───
  initRealtime() {
    this.populateLocationSelect('rt-location-select', () => this.onRtLocChange());
    this.onRtLocChange();
  },
  onRtLocChange() {
    const locId = document.getElementById('rt-location-select').value;
    const devs = DataRepository.listDevices().filter(d => d.type.startsWith('sensor') && (locId==='all' || d.locationId===locId));
    const sel = document.getElementById('rt-device-select');
    sel.innerHTML = devs.map(d => `<option value="${d.id}">${d.name}${d.type==='sensor_soil_api'?' ☁️':''}</option>`).join('');
    if (!devs.length) { sel.innerHTML = '<option value="">（无传感器）</option>'; this.stopLive(); return; }
    sel.onchange = () => this.startLive(sel.value);
    this.startLive(devs[0].id);
  },
  startLive(id) {
    this.stopLive();
    this.liveReadings = [];
    this.livePaused = false;
    const pauseBtn = document.getElementById('live-pause-btn');
    if (pauseBtn) { pauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i> 暂停记录'; pauseBtn.classList.remove('paused'); }
    this.updateSensors(id);
    this.liveInterval = setInterval(() => { this.updateSensors(id); this.renderAlerts(); this.updateSidebarStatus(); }, 3000);
  },
  stopLive() { if (this.liveInterval) { clearInterval(this.liveInterval); this.liveInterval = null; } },
  toggleLivePause() {
    this.livePaused = !this.livePaused;
    const btn = document.getElementById('live-pause-btn');
    if (btn) {
      btn.innerHTML = this.livePaused
        ? '<i class="fa-solid fa-play"></i> 恢复记录'
        : '<i class="fa-solid fa-pause"></i> 暂停记录';
      btn.classList.toggle('paused', this.livePaused);
    }
  },

  // ─── UPDATE SENSORS (supports both simulated & API devices) ───
  updateSensors(deviceId) {
    const dev = DataRepository.listDevices().find(d => d.id === deviceId);
    if (!dev) return;

    // API-connected soil monitor
    if (dev.type === 'sensor_soil_api' && dev.apiConfig) {
      this._updateSensorsAPI(dev);
      return;
    }

    // Standard simulated sensor
    const data = SensorEngine.tick(deviceId);
    if (!this.livePaused) {
      this.liveReadings.unshift({ time: new Date().toLocaleTimeString('zh-CN'), ...data, device: dev.name });
      if (this.liveReadings.length > 20) this.liveReadings.pop();
      HistoryStore.append(deviceId, {
        values: {
          temp: data.temp,
          humid: data.humid,
          soil: data.soil,
          light: data.light,
          co2: data.co2,
          wind: data.wind,
          pest: data.pest,
        },
        source: 'simulated',
      });
    }

    const sensors = dev.type === 'sensor_pest'
      ? [{ key:'pest', icon:'🦟', name:'今日捕获量', unit:'头', min:0, max:50, warn:10, crit:20, color:'#ef4444' }]
      : [
          { key:'temp',  icon:'🌡️', name:'空气温度', unit:'°C',  min:5,  max:45,   warn:35,   crit:40,   color:'#f59e0b' },
          { key:'humid', icon:'💧', name:'空气湿度', unit:'%',   min:0,  max:100,  warn:null, crit:null, color:'#3b82f6' },
          { key:'soil',  icon:'🌱', name:'土壤湿度', unit:'%',   min:0,  max:100,  warn:25,   crit:15,   color:'#10b981', invert:true },
          { key:'light', icon:'☀️', name:'光照强度', unit:'lux', min:0,  max:80000,warn:null, crit:null, color:'#eab308' },
          { key:'co2',   icon:'🌫️', name:'CO₂浓度', unit:'ppm', min:350,max:1200, warn:800,  crit:1000, color:'#8b5cf6' },
          { key:'wind',  icon:'🌬️', name:'风速',    unit:'m/s', min:0,  max:20,   warn:null, crit:null, color:'#64748b' },
        ];

    document.getElementById('sensor-grid').innerHTML = sensors.map(s => {
      const v = data[s.key];
      const pct = Math.min(100, Math.max(0, ((v-s.min)/(s.max-s.min))*100));
      let cls='', st='正常', sc='var(--success)';
      if (s.invert) {
        if (s.crit && v <= s.crit) { cls='alert-danger'; st='极度缺水'; sc='var(--danger)'; }
        else if (s.warn && v <= s.warn) { cls='alert-warning'; st='建议灌溉'; sc='var(--warning)'; }
      } else {
        if (s.crit && v >= s.crit) { cls='alert-danger'; st='严重超标'; sc='var(--danger)'; }
        else if (s.warn && v >= s.warn) { cls='alert-warning'; st='注意'; sc='var(--warning)'; }
      }
      return `<div class="sensor-card ${cls}">
        <div class="sensor-icon">${s.icon}</div>
        <div class="sensor-name">${s.name}</div>
        <div class="sensor-value">${s.key==='light'?(v/1000).toFixed(1)+'<span class="sensor-unit">klux</span>':v.toFixed(s.key==='pest'?0:1)+'<span class="sensor-unit">'+s.unit+'</span>'}</div>
        <div class="sensor-status" style="color:${sc}">● ${st}</div>
        <div class="sensor-bar"><div class="sensor-bar-fill" style="width:${pct}%;background:${s.color}"></div></div>
      </div>`;
    }).join('');

    const thead = document.querySelector('#page-realtime .data-table thead tr');
    if (thead) {
      thead.innerHTML = '<th>时间</th><th>设备</th><th>空气温度 (°C)</th><th>空气湿度 (%)</th><th>土壤湿度 (%)</th><th>光照强度 (lux)</th><th>CO₂ (ppm)</th>';
    }

    document.getElementById('rt-table-body').innerHTML = this.liveReadings.slice(0,10).map(r => `
      <tr><td style="font-family:'JetBrains Mono';font-size:12px">${r.time}</td><td>${r.device}</td>
      <td>${r.temp?.toFixed(1)??'-'}</td><td>${r.humid?.toFixed(1)??'-'}</td><td>${r.soil?.toFixed(1)??'-'}</td>
      <td>${r.light?(r.light/1000).toFixed(1)+'k':'-'}</td><td>${r.co2?.toFixed(0)??'-'}</td></tr>`).join('');
  },

  // ─── API SENSOR RENDERING ───
  _updateSensorsAPI(dev) {
    const addr = dev.apiConfig.deviceAddr;
    const cached = SensorEngine.getApiData(addr);

    if (!cached) {
      document.getElementById('sensor-grid').innerHTML = `
        <div class="cloud-loading" style="grid-column:1/-1">
          <div class="cloud-spinner"></div>
          <div>正在获取传感器数据...</div>
        </div>`;
      return;
    }

    const { dataItems, timestamp } = cached;
    const timeStr = timestamp ? new Date(timestamp).toLocaleString('zh-CN') : '--';

    // Icon mapping for known factor names
    const iconMap = { '温度':'🌡️', '湿度':'💧', 'PH':'🧪', '电导率':'⚡', '氮':'🟢', '磷':'🟡', '钾':'🟠',
      '光照':'☀️', '压力':'📊', '含水率':'💦', '盐分':'🧂' };
    const colorMap = { '温度':'#f59e0b', '湿度':'#3b82f6', 'PH':'#8b5cf6', '电导率':'#10b981',
      '氮':'#22c55e', '磷':'#eab308', '钾':'#f97316' };

    // Flatten all register items from all nodes
    const allRegisters = [];
    dataItems.forEach(node => {
      (node.registerItem || []).forEach(reg => {
        allRegisters.push({ ...reg, nodeId: node.nodeId });
      });
    });

    // Build sensor cards dynamically from API data
    const sensorHtml = allRegisters.map(reg => {
      const icon = iconMap[reg.registerName] || '📊';
      const color = colorMap[reg.registerName] || '#64748b';
      const v = reg.value ?? 0;
      const unit = reg.unit || '';
      const alarmCls = reg.alarmLevel > 0 ? (reg.alarmLevel >= 3 ? 'alert-danger' : 'alert-warning') : '';
      const alarmSt = reg.alarmLevel > 0 ? (reg.alarmLevel >= 3 ? '报警' : '预警') : '正常';
      const alarmColor = reg.alarmLevel > 0 ? (reg.alarmLevel >= 3 ? 'var(--danger)' : 'var(--warning)') : 'var(--success)';

      return `<div class="sensor-card ${alarmCls}">
        <div class="sensor-icon">${icon}</div>
        <div class="sensor-name">${reg.registerName}</div>
        <div class="sensor-value">${typeof v === 'number' ? v.toFixed(1) : v}<span class="sensor-unit">${unit}</span></div>
        <div class="sensor-status" style="color:${alarmColor}">● ${alarmSt}</div>
        <div class="sensor-bar"><div class="sensor-bar-fill" style="width:50%;background:${color}"></div></div>
      </div>`;
    }).join('');

    // Add API info header
    document.getElementById('sensor-grid').innerHTML = `
      <div style="grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;padding:0 4px">
        <div class="api-data-timestamp"><i class="fa-solid fa-cloud"></i> 在线传感器数据 · 设备 ${addr}</div>
        <div class="api-data-timestamp"><i class="fa-solid fa-clock"></i> 更新于 ${timeStr}</div>
      </div>
      ${sensorHtml}`;

    // Update table with API data
    if (!this.livePaused && allRegisters.length > 0) {
      const reading = { time: new Date().toLocaleTimeString('zh-CN'), device: dev.name + ' ☁️' };
      allRegisters.forEach(r => { reading[r.registerName] = r.value; });
      this.liveReadings.unshift(reading);
      if (this.liveReadings.length > 20) this.liveReadings.pop();
      HistoryStore.append(dev.id, {
        ts: timestamp || Date.now(),
        values: Object.fromEntries(allRegisters.map(r => [r.registerName, r.value])),
        source: 'cloud',
      });
    }

    // Render table - dynamic columns for API devices
    const colNames = allRegisters.map(r => r.registerName);
    const thead = document.querySelector('#page-realtime .data-table thead tr');
    if (thead) {
      thead.innerHTML = '<th>时间</th><th>设备</th>' + colNames.map(n => `<th>${n} (${allRegisters.find(r=>r.registerName===n)?.unit||''})</th>`).join('');
    }
    const tbody = document.getElementById('rt-table-body');
    if (tbody) {
      tbody.innerHTML = this.liveReadings.slice(0,10).map(r => {
        return `<tr><td style="font-family:'JetBrains Mono';font-size:12px">${r.time}</td><td>${r.device}</td>
        ${colNames.map(n => `<td>${r[n] !== undefined ? (typeof r[n] === 'number' ? r[n].toFixed(1) : r[n]) : '-'}</td>`).join('')}</tr>`;
      }).join('');
    }
  },

  // ─── CLOUD API POLLING ───
  startCloudApiPolling() {
    if (this._cloudApiPollInterval) clearInterval(this._cloudApiPollInterval);
    this._pollCloudDevices();
    this._cloudApiPollInterval = setInterval(() => this._pollCloudDevices(), 30000);
  },

  async _pollCloudDevices() {
    const devices = DataRepository.listDevices().filter(d => d.type === 'sensor_soil_api' && d.apiConfig);
    if (!devices.length) return;
    if (!CloudAPI.isConfigured()) return;
    for (const dev of devices) {
      try {
        await CloudAPI.fetchAndCacheRealTime(dev.apiConfig.deviceAddr);
        const cached = SensorEngine.getApiData(dev.apiConfig.deviceAddr);
        if (cached) {
          DataRepository.saveDevice({ ...dev, online: true });
        }
      } catch (err) {
        console.warn(`[Poll] ${dev.name}:`, err.message);
        DataRepository.saveDevice({ ...dev, online: false });
      }
    }
    if (this.currentPage === 'devices') this.renderDevices();
    if (this.currentPage === 'dashboard') this.initDashboard();
  },

  // ─── VIDEO ───
  renderVideo() {
    const cams = DataRepository.listDevices().filter(d => d.type==='camera');
    const locMap = Object.fromEntries(DataRepository.listLocations().map(l=>[l.id,l.name]));
    const g = document.getElementById('video-grid');
    if (!cams.length) { g.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><i class="fa-solid fa-video-slash"></i><p>暂无摄像头设备</p></div>'; return; }
    g.innerHTML = cams.map(c => `
      <div class="video-slot">
        <div class="video-slot-header"><span><i class="fa-solid fa-video" style="color:var(--accent);margin-right:6px"></i>${c.name}</span>
          <span class="badge ${c.online?'badge-online':'badge-offline'}">${c.online?'在线':'离线'}</span></div>
        <div class="video-slot-body"><i class="fa-solid fa-${c.online?'circle-play':'video-slash'}"></i><p>${c.online&&c.streamUrl?'接口预留: 视频流待接入':c.online?'未配置流地址':'设备离线'}</p></div>
        ${c.streamUrl?`<div class="video-src"><i class="fa-solid fa-link" style="margin-right:4px"></i>${c.streamUrl}</div>`:''}
      </div>`).join('');
  },

  // ─── HISTORY ───
  initHistory() {
    this.populateLocationSelect('hist-location-select', () => {
      const locId = document.getElementById('hist-location-select').value;
      const devs = DataRepository.listDevices().filter(d => d.type.startsWith('sensor') && (locId==='all'||d.locationId===locId));
      document.getElementById('hist-device-select').innerHTML = devs.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
      this.refreshHistoryCharts();
    });
    document.getElementById('hist-device-select').onchange = () => this.refreshHistoryCharts();
    this.refreshHistoryCharts();
  },
  refreshHistoryCharts() {
    const range = document.getElementById('hist-range')?.value || '24h';
    const pts = range==='24h'?24:range==='7d'?7:30;
    const deviceId = document.getElementById('hist-device-select')?.value;
    const labels = Array.from({length:pts},(_,i)=>{
      if(range==='24h') return `${String(i).padStart(2,'0')}:00`;
      const d=new Date(); d.setDate(d.getDate()-(pts-1-i)); return `${d.getMonth()+1}/${d.getDate()}`;
    });
    const history = deviceId ? HistoryStore.getDeviceRecords(deviceId) : [];
    const pickSeries = (keys, fallbackBase, fallbackAmp, transform = value => value) => {
      if (!history.length) {
        return Array.from({length:pts},(_,i)=>transform(+(fallbackBase+Math.sin(i*0.4)*fallbackAmp*0.5+(Math.random()-0.5)*fallbackAmp).toFixed(1)));
      }
      const bucketSizeMs = range === '24h' ? 3600_000 : 24 * 3600_000;
      const end = Date.now();
      const start = end - (pts * bucketSizeMs);
      const buckets = Array.from({ length: pts }, () => []);
      history.forEach(item => {
        const index = Math.floor((item.ts - start) / bucketSizeMs);
        if (index < 0 || index >= pts) return;
        const keyList = Array.isArray(keys) ? keys : [keys];
        const foundKey = keyList.find(key => item.values[key] !== undefined);
        if (foundKey) buckets[index].push(Number(item.values[foundKey]));
      });
      return buckets.map((bucket, index) => {
        if (bucket.length) {
          const avg = bucket.reduce((sum, value) => sum + value, 0) / bucket.length;
          return transform(+avg.toFixed(1));
        }
        if (index > 0) return buckets[index - 1].length ? transform(+(buckets[index - 1].reduce((sum, value) => sum + value, 0) / buckets[index - 1].length).toFixed(1)) : transform(fallbackBase);
        return transform(fallbackBase);
      });
    };
    ChartHelper.line('hist-temp-hum', labels, [
      { label:'温度(°C)', data:pickSeries(['temp', '温度'], 28, 8), borderColor:'#f59e0b', backgroundColor:'rgba(245,158,11,0.06)', tension:0.4, fill:true },
      { label:'湿度(%)', data:pickSeries(['humid', '湿度'], 65, 20), borderColor:'#3b82f6', backgroundColor:'rgba(59,130,246,0.06)', tension:0.4, fill:true },
    ]);
    ChartHelper.line('hist-soil', labels, [{ label:'土壤湿度(%)', data:pickSeries(['soil', '含水率'], 50, 20), borderColor:'#10b981', backgroundColor:'rgba(16,185,129,0.06)', tension:0.4, fill:true }]);
    ChartHelper.line('hist-light', labels, [{ label:'光照(klux)', data:pickSeries(['light', '光照'], 30000, 25000, value => Math.max(0, +(value / 1000).toFixed(1))), borderColor:'#eab308', backgroundColor:'rgba(234,179,8,0.06)', tension:0.3, fill:true }]);
    ChartHelper.line('hist-co2', labels, [{ label:'CO₂(ppm)', data:pickSeries(['co2', 'CO₂浓度'], 480, 80), borderColor:'#8b5cf6', backgroundColor:'rgba(139,92,246,0.06)', tension:0.4, fill:true }]);
  },

  // ─── PEST DB ───
  renderPests(search='',type='all') {
    const q = (document.getElementById('pest-search')?.value||search).trim().toLowerCase();
    const t = document.getElementById('pest-type-filter')?.value||type;
    const filtered = PEST_DB.filter(p => (!q||p.name.includes(q)||p.latin.toLowerCase().includes(q)) && (t==='all'||p.type===t));
    document.getElementById('pest-grid').innerHTML = filtered.length===0
      ? '<div class="empty-state" style="grid-column:1/-1"><i class="fa-solid fa-magnifying-glass"></i><p>未找到相关记录</p></div>'
      : filtered.map(p=>`
        <div class="pest-card" onclick="app.showPestDetail('${p.id}')">
          <div class="pest-img">${p.emoji}</div>
          <div class="pest-info"><div class="pest-name">${p.name}</div><div class="pest-latin">${p.latin}</div>
          <div class="pest-tags"><span class="pest-tag">${p.type==='pest'?'虫害':'病害'}</span>
          <span class="pest-tag ${p.severity==='high'?'danger-tag':''}">${p.severity==='high'?'高风险':'中等'}</span>
          ${p.crops.map(c=>`<span class="pest-tag">${c}</span>`).join('')}</div></div>
        </div>`).join('');
  },
  filterPests(v) { this.renderPests(v); },
  showPestDetail(id) {
    const p = PEST_DB.find(x=>x.id===id); if(!p) return;
    document.getElementById('pest-modal-title').textContent = `${p.emoji} ${p.name}`;
    document.getElementById('pest-modal-body').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:12px">
        <div class="form-group"><label>学名</label><div style="font-style:italic;color:var(--text-secondary)">${p.latin}</div></div>
        <div class="form-group"><label>类型</label><div>${p.type==='pest'?'虫害':'病害'}</div></div>
        <div class="form-group"><label>危害等级</label><div style="color:${p.severity==='high'?'var(--danger)':'var(--warning)'}">● ${p.severity==='high'?'高风险':'中等'}</div></div>
        <div class="form-group"><label>高发季节</label><div>${p.season}</div></div>
        <div class="form-group"><label>危害作物</label><div>${p.crops.join('、')}</div></div>
        <div class="form-group"><label>防治阈值</label><div style="color:var(--warning)">${p.threshold}</div></div>
      </div>
      <div class="form-group"><label>为害症状</label><div style="color:var(--text-secondary);line-height:1.7">${p.symptoms}</div></div>
      <div class="form-group" style="margin-top:8px"><label>农业防治</label><div style="color:var(--text-secondary);line-height:1.7">${p.prevention}</div></div>
      <div class="form-group" style="margin-top:8px"><label>药剂防治</label><div style="color:var(--text-secondary);line-height:1.7">${p.control}</div></div>`;
    this.openModal('pest');
  },

  // ====================================================
  // AUTOMATION ENGINE
  // ====================================================
  startAutoEngine() {
    this.autoInterval = setInterval(() => this.runAutomationCheck(), 3000);
  },

  runAutomationCheck() {
    const rules = DataRepository.listAutomations().filter(r => r.enabled);
    const devices = DataRepository.listDevices();
    const log = DataRepository.getAutoLog();

    rules.forEach(rule => {
      // Check all conditions (AND logic)
      const allMet = rule.conditions.every(cond => {
        const dev = devices.find(d => d.id === cond.sourceDeviceId);
        if (!dev || !dev.online) return false;
        const data = SensorEngine.get(dev.id);
        const val = data[cond.param];
        if (val === undefined) return false;
        switch(cond.operator) {
          case '>':  return val > cond.value;
          case '<':  return val < cond.value;
          case '>=': return val >= cond.value;
          case '<=': return val <= cond.value;
          case '==': return Math.abs(val - cond.value) < 0.5;
          default: return false;
        }
      });

      if (allMet) {
        // Execute actions
        rule.actions.forEach(act => {
          const target = devices.find(d => d.id === act.targetDeviceId);
          if (!target) return;
          const condDesc = rule.conditions.map(c => {
            const sd = devices.find(d=>d.id===c.sourceDeviceId);
            return `${sd?.name||'?'} ${PARAM_LABELS[c.param]||c.param} ${c.operator} ${c.value}`;
          }).join(' 且 ');
          const actDesc = `${ACTION_LABELS[act.action]||act.action} ${target.name}`;
          
          // Avoid duplicate logs within 30 seconds
          const recent = log.find(l => l.ruleId === rule.id && (Date.now() - l.ts) < 30000);
          if (!recent) {
            log.unshift({
              ts: Date.now(),
              time: new Date().toLocaleTimeString('zh-CN'),
              ruleId: rule.id,
              ruleName: rule.name,
              condition: condDesc,
              action: actDesc,
              result: '✅ 已执行 (模拟)',
            });
            if (log.length > 50) log.pop();
            DataRepository.saveAutoLog(log);
            console.log(`[自动化] ${rule.name}: ${condDesc} → ${actDesc} (Modbus ${act.action==='on'?'0xFF00':'0x0000'})`);
          }
        });
      }
    });

    // Refresh if on automation page
    if (this.currentPage === 'automation') {
      this.renderAutoLog();
    }
  },

  renderAutomation() {
    const rules = DataRepository.listAutomations();
    const devices = DataRepository.listDevices();
    const devMap = Object.fromEntries(devices.map(d=>[d.id,d.name]));
    const list = document.getElementById('automation-list');

    if (!rules.length) {
      list.innerHTML = '<div class="empty-state"><i class="fa-solid fa-wand-magic-sparkles"></i><p>暂无自动化规则，点击上方按钮创建</p></div>';
    } else {
      list.innerHTML = rules.map(rule => {
        const condBlocks = rule.conditions.map(c => `
          <div class="flow-block"><div class="flow-block-label if-label">条件</div>
            <div class="flow-block-value">${devMap[c.sourceDeviceId]||'?'}</div>
            <div style="font-size:11px;color:var(--text-muted)">${PARAM_LABELS[c.param]||c.param} ${OP_LABELS[c.operator]||c.operator} ${c.value}</div>
          </div>`).join('<div class="flow-arrow"><i class="fa-solid fa-plus" style="font-size:10px"></i></div>');
        const actBlocks = rule.actions.map(a => `
          <div class="flow-block"><div class="flow-block-label then-label">动作</div>
            <div class="flow-block-value">${devMap[a.targetDeviceId]||'?'}</div>
            <div style="font-size:11px;color:var(--text-muted)">${ACTION_LABELS[a.action]||a.action}</div>
          </div>`).join('');
        return `
          <div class="auto-rule-card ${rule.enabled?'':'disabled'}">
            <div class="auto-rule-header">
              <div class="auto-rule-name"><i class="fa-solid fa-bolt" style="color:var(--warning)"></i> ${rule.name}</div>
              <div class="action-row">
                <button class="btn-icon" title="编辑" onclick="app.editAutomation('${rule.id}')"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-icon delete" title="删除" onclick="app.confirmDelete('automation','${rule.id}')"><i class="fa-solid fa-trash"></i></button>
              </div>
            </div>
            ${rule.desc ? `<div class="auto-rule-desc">${rule.desc}</div>` : ''}
            <div class="auto-rule-flow">
              ${condBlocks}
              <div class="flow-arrow"><i class="fa-solid fa-arrow-right"></i></div>
              ${actBlocks}
            </div>
            <div class="auto-rule-footer">
              <label class="toggle-switch">
                <input type="checkbox" ${rule.enabled?'checked':''} onchange="app.toggleAutomation('${rule.id}', this.checked)">
                <span class="toggle-slider"></span>
              </label>
              <span style="font-size:12px;color:var(--text-muted)">${rule.enabled?'规则已启用':'规则已停用'}</span>
            </div>
          </div>`;
      }).join('');
    }
    this.renderAutoLog();
  },

  renderAutoLog() {
    const log = DataRepository.getAutoLog();
    const tbody = document.getElementById('auto-log-body');
    if (!tbody) return;
    tbody.innerHTML = log.length === 0
      ? '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-muted)">暂无执行记录</td></tr>'
      : log.slice(0,20).map(l => `
        <tr><td style="font-family:'JetBrains Mono';font-size:12px">${l.time}</td>
        <td>${l.ruleName}</td><td style="font-size:12px">${l.condition}</td>
        <td style="font-size:12px">${l.action}</td><td>${l.result}</td></tr>`).join('');
  },

  toggleAutomation(id, enabled) {
    const rules = DataRepository.listAutomations();
    const r = rules.find(x=>x.id===id);
    if (r) { r.enabled = enabled; DataRepository.saveAutomations(rules); this.renderAutomation(); }
  },

  // ─── Automation Editor ───
  openAutomationEditor(editId) {
    this._tempConditions = [];
    this._tempActions = [];
    document.getElementById('auto-edit-id').value = '';
    document.getElementById('auto-name').value = '';
    document.getElementById('auto-desc').value = '';
    document.getElementById('modal-auto-title').textContent = '新建自动化规则';

    if (editId) {
      const rule = DataRepository.listAutomations().find(r=>r.id===editId);
      if (rule) {
        document.getElementById('auto-edit-id').value = rule.id;
        document.getElementById('auto-name').value = rule.name;
        document.getElementById('auto-desc').value = rule.desc || '';
        document.getElementById('modal-auto-title').textContent = '编辑自动化规则';
        this._tempConditions = JSON.parse(JSON.stringify(rule.conditions));
        this._tempActions = JSON.parse(JSON.stringify(rule.actions));
      }
    }

    if (!this._tempConditions.length) this.addCondition();
    if (!this._tempActions.length) this.addAction();
    this.renderConditionRows();
    this.renderActionRows();
    this.openModal('automation');
  },

  editAutomation(id) { this.openAutomationEditor(id); },

  addCondition() {
    const sensors = DataRepository.listDevices().filter(d => d.type.startsWith('sensor'));
    this._tempConditions.push({
      sourceDeviceId: sensors[0]?.id || '',
      param: 'temp', operator: '>', value: 30
    });
    this.renderConditionRows();
  },

  addAction() {
    const ctrls = DataRepository.listDevices().filter(d => d.type.startsWith('controller'));
    this._tempActions.push({
      targetDeviceId: ctrls[0]?.id || '',
      action: 'on'
    });
    this.renderActionRows();
  },

  renderConditionRows() {
    const sensors = DataRepository.listDevices().filter(d => d.type.startsWith('sensor'));
    const el = document.getElementById('condition-list');
    el.innerHTML = this._tempConditions.map((c, i) => `
      <div class="condition-row">
        <select onchange="app._tempConditions[${i}].sourceDeviceId=this.value">
          ${sensors.map(d => `<option value="${d.id}" ${d.id===c.sourceDeviceId?'selected':''}>${d.name}</option>`).join('')}
        </select>
        <select onchange="app._tempConditions[${i}].param=this.value">
          ${Object.entries(PARAM_LABELS).map(([k,v]) => `<option value="${k}" ${k===c.param?'selected':''}>${v}</option>`).join('')}
        </select>
        <select onchange="app._tempConditions[${i}].operator=this.value">
          ${Object.entries(OP_LABELS).map(([k,v]) => `<option value="${k}" ${k===c.operator?'selected':''}>${v} (${k})</option>`).join('')}
        </select>
        <input type="number" value="${c.value}" style="width:80px" onchange="app._tempConditions[${i}].value=parseFloat(this.value)">
        <button class="remove-row-btn" onclick="app._tempConditions.splice(${i},1);app.renderConditionRows()"><i class="fa-solid fa-xmark"></i></button>
      </div>`).join('');
  },

  renderActionRows() {
    const ctrls = DataRepository.listDevices().filter(d => d.type.startsWith('controller'));
    const el = document.getElementById('action-list');
    el.innerHTML = this._tempActions.map((a, i) => `
      <div class="action-row-editor">
        <select onchange="app._tempActions[${i}].targetDeviceId=this.value">
          ${ctrls.map(d => `<option value="${d.id}" ${d.id===a.targetDeviceId?'selected':''}>${d.name}</option>`).join('')}
          ${!ctrls.length?'<option value="">（无控制器设备）</option>':''}
        </select>
        <select onchange="app._tempActions[${i}].action=this.value">
          <option value="on" ${a.action==='on'?'selected':''}>开启</option>
          <option value="off" ${a.action==='off'?'selected':''}>关闭</option>
        </select>
        <button class="remove-row-btn" onclick="app._tempActions.splice(${i},1);app.renderActionRows()"><i class="fa-solid fa-xmark"></i></button>
      </div>`).join('');
  },

  saveAutomation() {
    const name = document.getElementById('auto-name').value.trim();
    if (!name) { UI.toast('请填写规则名称', 'warning'); return; }
    if (!this._tempConditions.length) { UI.toast('请至少添加一个触发条件', 'warning'); return; }
    if (!this._tempActions.length) { UI.toast('请至少添加一个执行动作', 'warning'); return; }

    const id = document.getElementById('auto-edit-id').value || 'auto-' + uid();
    const rule = {
      id, name,
      desc: document.getElementById('auto-desc').value.trim(),
      enabled: true,
      conditions: this._tempConditions,
      actions: this._tempActions,
    };
    const rules = DataRepository.listAutomations();
    const idx = rules.findIndex(r=>r.id===id);
    if (idx >= 0) { rule.enabled = rules[idx].enabled; rules[idx] = rule; }
    else rules.push(rule);
    DataRepository.saveAutomations(rules);
    this.closeModal('automation');
    this.renderAutomation();
    UI.toast('自动化规则已保存', 'success');
  },

  // ─── LOCATIONS ───
  renderLocations() {
    const locs = DataRepository.listLocations();
    const devices = DataRepository.listDevices();
    const g = document.getElementById('location-grid');
    if (!locs.length) { g.innerHTML = '<div class="empty-state"><i class="fa-solid fa-map"></i><p>暂无地块</p></div>'; return; }
    g.innerHTML = locs.map(loc => {
      const devs = devices.filter(d=>d.locationId===loc.id);
      const ti = { sensor_env:'🌡️', sensor_soil:'🌱', sensor_pest:'🦟', camera:'📹', controller_water:'💧', controller_light:'💡', controller_fan:'🌀' };
      return `<div class="location-card">
        <div class="location-card-header"><div><div class="location-name">${loc.name}</div><div class="location-type">${loc.type}</div></div>
          <div class="action-row"><button class="btn-icon" onclick="app.editLocation('${loc.id}')"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-icon delete" onclick="app.confirmDelete('location','${loc.id}')"><i class="fa-solid fa-trash"></i></button></div></div>
        <div class="location-stats">
          <div class="loc-stat"><div class="loc-stat-value" style="color:var(--accent)">${loc.area||'-'}</div><div class="loc-stat-label">亩</div></div>
          <div class="loc-stat"><div class="loc-stat-value" style="color:var(--success)">${devs.length}</div><div class="loc-stat-label">台设备</div></div>
        </div>
        <div class="location-devices">${devs.map(d=>`<span class="badge badge-sensor">${ti[d.type]||'📡'} ${d.name}</span>`).join('')||'<span style="color:var(--text-muted);font-size:12px">暂无设备</span>'}</div>
        ${loc.notes?`<div style="font-size:12px;color:var(--text-muted);border-top:1px solid var(--border);padding-top:10px">${loc.notes}</div>`:''}
      </div>`;
    }).join('');
  },
  openModal(t) {
    document.getElementById('modal-'+t).classList.add('open');
    if (t === 'location') setTimeout(() => this.initLocMapPicker(), 200);
    if (t === 'device') setTimeout(() => this.initDevMapPicker(), 200);
  },
  closeModal(t) {
    document.getElementById('modal-'+t).classList.remove('open');
    if (t === 'location') this._destroyPickerMap('loc');
    if (t === 'device') this._destroyPickerMap('dev');
  },
  saveLocation() {
    const id = document.getElementById('loc-edit-id').value || 'loc-'+uid();
    const name = document.getElementById('loc-name').value.trim();
    if (!name) { UI.toast('请填写地块名称', 'warning'); return; }
    const loc = { id, name, type:document.getElementById('loc-type').value,
      lat:parseFloat(document.getElementById('loc-lat').value)||0,
      lng:parseFloat(document.getElementById('loc-lng').value)||0,
      area:parseInt(document.getElementById('loc-area').value)||0,
      notes:document.getElementById('loc-notes').value.trim() };
    DataRepository.saveLocation(loc);
    this.closeModal('location'); this.clearLocationForm(); this.renderLocations(); this.updateSidebarStatus();
    if (this.currentPage === 'dashboard') this.initDashboard();
    UI.toast('地块已保存', 'success');
  },
  editLocation(id) {
    const loc = DataRepository.listLocations().find(l=>l.id===id); if(!loc) return;
    document.getElementById('modal-location-title').textContent = '编辑地块';
    document.getElementById('loc-edit-id').value = loc.id;
    document.getElementById('loc-name').value = loc.name;
    document.getElementById('loc-type').value = loc.type;
    document.getElementById('loc-lat').value = loc.lat;
    document.getElementById('loc-lng').value = loc.lng;
    document.getElementById('loc-area').value = loc.area;
    document.getElementById('loc-notes').value = loc.notes||'';
    this.openModal('location');
  },
  clearLocationForm() {
    document.getElementById('modal-location-title').textContent = '添加新地块';
    ['loc-edit-id','loc-name','loc-lat','loc-lng','loc-area','loc-notes'].forEach(id=>document.getElementById(id).value='');
  },

  // ─── DEVICES ───
  renderDevices() {
    const filt = document.getElementById('dev-location-filter')?.value||'all';
    const locs = DataRepository.listLocations();
    const locMap = Object.fromEntries(locs.map(l=>[l.id,l.name]));
    const devices = DataRepository.listDevices().filter(d=>filt==='all'||d.locationId===filt);
    const modeMeta = BackendAdapter.getModeMeta();
    const health = BackendAdapter.getHealthSnapshot();
    const filterSel = document.getElementById('dev-location-filter');
    if(filterSel){ const cur=filterSel.value; filterSel.innerHTML=`<option value="all">全部地块</option>`+locs.map(l=>`<option value="${l.id}" ${l.id===cur?'selected':''}>${l.name}</option>`).join(''); }
    const endpointMap = DataRepository.getEndpointMap();
    const toolbar = document.querySelector('#page-devices .page-toolbar');
    const existingNotice = document.getElementById('runtime-mode-banner');
    if (existingNotice) existingNotice.remove();
    if (toolbar) {
      toolbar.insertAdjacentHTML('afterend', `
        <div class="runtime-banner glass-panel" id="runtime-mode-banner">
          <div class="runtime-banner-main">
            <strong>${modeMeta.label}</strong>
            <span>${health.message}</span>
          </div>
          <div class="runtime-banner-meta">后端接口预留: ${endpointMap.devices}</div>
        </div>
      `);
    }
    const tl = { sensor_env:['🌡️ 环境传感器','badge-sensor'], sensor_soil:['🌱 土壤传感器','badge-sensor'], sensor_soil_api:['🔗 在线传感器','badge-cloud'],
      sensor_pest:['🦟 虫情监测仪','badge-sensor'], camera:['📹 摄像头','badge-camera'],
      controller_water:['💧 灌溉控制器','badge-ctrl'], controller_light:['💡 补光控制器','badge-ctrl'], controller_fan:['🌀 风机控制器','badge-ctrl'] };
    document.getElementById('device-tbody').innerHTML = devices.length===0
      ? '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted)">暂无设备</td></tr>'
      : devices.map(d=>{
        const [tLabel,tBadge]=tl[d.type]||['未知','badge-offline'];
        const addrDisplay = d.type === 'sensor_soil_api' && d.apiConfig ? d.apiConfig.deviceAddr : (d.address || '-');
        const protocolDisplay = d.type === 'sensor_soil_api' ? '在线识别接入' : d.protocol;
        return `<tr><td><b>${d.name}</b>${d.notes?`<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${d.notes}</div>`:''}</td>
          <td><span class="badge ${tBadge}">${tLabel}</span></td>
          <td>${locMap[d.locationId]||'<span style="color:var(--text-muted)">未分配</span>'}</td>
          <td><code style="font-family:'JetBrains Mono';font-size:12px;color:var(--accent)">${addrDisplay}</code></td>
          <td><span class="badge ${d.type==='sensor_soil_api'?'badge-cloud':'badge-sensor'}">${protocolDisplay}</span></td>
          <td><span class="badge ${d.online?'badge-online':'badge-offline'}">● ${d.online?'在线':'离线'}</span></td>
          <td><div class="action-row"><button class="btn-icon" onclick="app.editDevice('${d.id}')"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-icon delete" onclick="app.confirmDelete('device','${d.id}')"><i class="fa-solid fa-trash"></i></button></div></td></tr>`;
      }).join('');
  },
  openModal_device_prep() {
    const locs = DataRepository.listLocations();
    document.getElementById('dev-location').innerHTML = `<option value="">-- 未分配 --</option>`+locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('');
  },
  bindDeviceTypeChange() { document.getElementById('dev-type')?.addEventListener('change',function(){ document.getElementById('stream-url-group').style.display=this.value==='camera'?'flex':'none'; }); },
  saveDevice() {
    const id=document.getElementById('dev-edit-id').value||'dev-'+uid();
    const name=document.getElementById('dev-name').value.trim();
    if(!name){UI.toast('请填写设备名称', 'warning');return;}
    const existing = DataRepository.listDevices().find(item => item.id === id);
    const dev={id,name,type:document.getElementById('dev-type').value,locationId:document.getElementById('dev-location').value,
      address:document.getElementById('dev-address').value.trim(),protocol:document.getElementById('dev-protocol').value,
      streamUrl:document.getElementById('dev-stream-url').value.trim(),notes:document.getElementById('dev-notes').value.trim(),
      lat:parseFloat(document.getElementById('dev-lat').value)||0,lng:parseFloat(document.getElementById('dev-lng').value)||0,
      online: existing?.online ?? true,
      apiConfig: existing?.apiConfig ?? null,
      metadata: existing?.metadata ?? {}};
    DataRepository.saveDevice(dev);
    this.closeModal('device'); this.clearDeviceForm(); this.renderDevices(); this.updateSidebarStatus();
    if (this.currentPage === 'dashboard') this.initDashboard();
    UI.toast('设备已保存', 'success');
  },
  editDevice(id) {
    const dev=DataRepository.listDevices().find(d=>d.id===id);if(!dev)return;
    this.openModal_device_prep();
    document.getElementById('modal-device-title').textContent='编辑设备';
    document.getElementById('dev-edit-id').value=dev.id;
    document.getElementById('dev-name').value=dev.name;
    document.getElementById('dev-type').value=dev.type;
    document.getElementById('dev-location').value=dev.locationId;
    document.getElementById('dev-address').value=dev.address;
    document.getElementById('dev-protocol').value=dev.protocol;
    document.getElementById('dev-stream-url').value=dev.streamUrl||'';
    document.getElementById('dev-notes').value=dev.notes||'';
    document.getElementById('dev-lat').value=dev.lat||'';
    document.getElementById('dev-lng').value=dev.lng||'';
    document.getElementById('stream-url-group').style.display=dev.type==='camera'?'flex':'none';
    this.openModal('device');
  },
  clearDeviceForm() {
    document.getElementById('modal-device-title').textContent='添加新设备';
    ['dev-edit-id','dev-name','dev-address','dev-stream-url','dev-notes','dev-lat','dev-lng'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('stream-url-group').style.display='none';
  },

  // ─── DELETE ───
  confirmDelete(type,id) {
    const msg = { location:'确定删除该地块？关联设备将变为"未分配"。', device:'确定删除该设备？', automation:'确定删除该自动化规则？' };
    document.getElementById('confirm-msg').textContent = msg[type]||'确定删除？';
    document.getElementById('confirm-ok-btn').onclick = () => {
      if(type==='location') this.deleteLocation(id);
      else if(type==='device'){ DataRepository.deleteDevice(id); this.renderDevices(); }
      else if(type==='automation'){ DataRepository.deleteAutomation(id); this.renderAutomation(); }
      this.closeModal('confirm'); this.updateSidebarStatus();
      if (this.currentPage === 'dashboard') this.initDashboard();
      UI.toast('删除成功', 'success');
    };
    this.openModal('confirm');
  },
  deleteLocation(id) {
    DataRepository.deleteLocation(id);
    this.renderLocations();
  },

  // ─── MAP PICKERS ───
  _createPickerMap(containerId, lat, lng) {
    const map = L.map(containerId, { zoomControl: true, attributionControl: false }).setView([lat || 20.044, lng || 110.199], lat ? 16 : 14);
    L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
      subdomains: '1234', maxZoom: 18,
    }).addTo(map);
    return map;
  },

  _destroyPickerMap(prefix) {
    const key = prefix === 'loc' ? '_locPickerMap' : '_devPickerMap';
    const mKey = prefix === 'loc' ? '_locPickerMarker' : '_devPickerMarker';
    if (this[key]) { this[key].remove(); this[key] = null; }
    this[mKey] = null;
  },

  initLocMapPicker() {
    this._destroyPickerMap('loc');
    const lat = parseFloat(document.getElementById('loc-lat').value) || 0;
    const lng = parseFloat(document.getElementById('loc-lng').value) || 0;
    this._locPickerMap = this._createPickerMap('loc-map-picker', lat, lng);
    if (lat && lng) {
      this._locPickerMarker = L.marker([lat, lng]).addTo(this._locPickerMap);
    }
    this._locPickerMap.on('click', e => {
      const { lat, lng } = e.latlng;
      document.getElementById('loc-lat').value = lat.toFixed(6);
      document.getElementById('loc-lng').value = lng.toFixed(6);
      if (this._locPickerMarker) this._locPickerMap.removeLayer(this._locPickerMarker);
      this._locPickerMarker = L.marker([lat, lng]).addTo(this._locPickerMap);
    });
  },

  syncLocPicker() {
    if (!this._locPickerMap) return;
    const lat = parseFloat(document.getElementById('loc-lat').value);
    const lng = parseFloat(document.getElementById('loc-lng').value);
    if (!lat || !lng) return;
    this._locPickerMap.setView([lat, lng], 16);
    if (this._locPickerMarker) this._locPickerMap.removeLayer(this._locPickerMarker);
    this._locPickerMarker = L.marker([lat, lng]).addTo(this._locPickerMap);
  },

  initDevMapPicker() {
    this._destroyPickerMap('dev');
    const lat = parseFloat(document.getElementById('dev-lat').value) || 0;
    const lng = parseFloat(document.getElementById('dev-lng').value) || 0;
    let centerLat = lat, centerLng = lng;
    if (!centerLat || !centerLng) {
      const locId = document.getElementById('dev-location').value;
      if (locId) {
      const loc = DataRepository.listLocations().find(l => l.id === locId);
        if (loc && loc.lat && loc.lng) { centerLat = loc.lat; centerLng = loc.lng; }
      }
    }
    this._devPickerMap = this._createPickerMap('dev-map-picker', centerLat, centerLng);

    // Show all location markers as reference
    DataRepository.listLocations().forEach(loc => {
      if (!loc.lat || !loc.lng) return;
      const locMarker = L.circleMarker([loc.lat, loc.lng], {
        radius: 12, fillColor: '#3b82f6', fillOpacity: 0.25,
        color: '#3b82f6', weight: 2, dashArray: '4 3',
      }).addTo(this._devPickerMap);
      locMarker.bindTooltip(loc.name, { permanent: true, direction: 'top', offset: [0, -14], className: 'loc-tooltip' });
    });

    if (lat && lng) {
      this._devPickerMarker = L.circleMarker([lat, lng], {radius:8, fillColor:'#1070e0', fillOpacity:0.9, color:'#fff', weight:2}).addTo(this._devPickerMap);
    }
    this._devPickerMap.on('click', e => {
      const { lat, lng } = e.latlng;
      document.getElementById('dev-lat').value = lat.toFixed(6);
      document.getElementById('dev-lng').value = lng.toFixed(6);
      if (this._devPickerMarker) this._devPickerMap.removeLayer(this._devPickerMarker);
      this._devPickerMarker = L.circleMarker([lat, lng], {radius:8, fillColor:'#1070e0', fillOpacity:0.9, color:'#fff', weight:2}).addTo(this._devPickerMap);
    });
  },

  syncDevPicker() {
    if (!this._devPickerMap) return;
    const lat = parseFloat(document.getElementById('dev-lat').value);
    const lng = parseFloat(document.getElementById('dev-lng').value);
    if (!lat || !lng) return;
    this._devPickerMap.setView([lat, lng], 16);
    if (this._devPickerMarker) this._devPickerMap.removeLayer(this._devPickerMarker);
    this._devPickerMarker = L.circleMarker([lat, lng], {radius:8, fillColor:'#1070e0', fillOpacity:0.9, color:'#fff', weight:2}).addTo(this._devPickerMap);
  },

  onDevLocChange() {
    if (!this._devPickerMap) return;
    const locId = document.getElementById('dev-location').value;
    if (!locId) return;
      const loc = DataRepository.listLocations().find(l => l.id === locId);
    if (loc && loc.lat && loc.lng) {
      this._devPickerMap.setView([loc.lat, loc.lng], 16);
    }
  },

  _ensureDeviceCoords() {
    const devs = DataRepository.listDevices();
    const locs = DataRepository.listLocations();
    let changed = false;
    devs.forEach(d => {
      if (d.locationId && (!d.lat || !d.lng)) {
        const loc = locs.find(l => l.id === d.locationId);
        if (loc && loc.lat && loc.lng) {
          d.lat = loc.lat + (Math.random() - 0.5) * 0.002;
          d.lng = loc.lng + (Math.random() - 0.5) * 0.002;
          changed = true;
        }
      }
    });
    if (changed) DataRepository.saveDevices(devs);
  },

  // ─── HELPERS ───
  populateLocationSelect(selId, onchange) {
    const locs = DataRepository.listLocations();
    const sel = document.getElementById(selId); if(!sel) return;
    sel.innerHTML = `<option value="all">所有地块</option>`+locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('');
    if(onchange) sel.onchange = onchange;
  },

  // ====================================================
  // CLOUD PLATFORM MODAL LOGIC
  // ====================================================
  openCloudModal() {
    // Reset to login step
    document.getElementById('cloud-step-login').style.display = '';
    document.getElementById('cloud-step-devices').style.display = 'none';
    document.getElementById('cloud-import-btn').style.display = 'none';
    this.clearCloudError();
    // Pre-fill saved credentials
    const creds = CloudAPI.loadCredentials();
    if (creds) {
      document.getElementById('cloud-access-code').value = creds.loginName || '';
    }
    this._cloudSelected = new Set();
    this._cloudRenameMap = {};
    this.openModal('cloud');
  },

  showCloudError(message) {
    const errEl = document.getElementById('cloud-top-error');
    if (!errEl) return;
    errEl.textContent = message;
    errEl.style.display = '';
  },

  clearCloudError() {
    const errEl = document.getElementById('cloud-top-error');
    if (!errEl) return;
    errEl.textContent = '';
    errEl.style.display = 'none';
  },

  async cloudLogin() {
    const accessCode = document.getElementById('cloud-access-code').value.trim();
    const username = accessCode;
    const password = accessCode;
    const apiUrl = 'http://www.0531yun.com';
    const btn = document.getElementById('cloud-login-btn');

    if (!accessCode) {
      this.showCloudError('请输入识别码');
      return;
    }

    this.clearCloudError();
    btn.disabled = true;
    btn.innerHTML = '<div class="cloud-spinner" style="width:18px;height:18px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:8px"></div> 正在识别...';

    try {
      // Save credentials and authenticate
      CloudAPI.saveCredentials(username, password, apiUrl);
      await CloudAPI.authenticate(username, password);

      // Fetch device list
      const devices = await CloudAPI.getDeviceList();
      this._cloudDevices = devices || [];

      // Also fetch real-time data for each device to get current values
      for (const dev of this._cloudDevices) {
        try {
          await CloudAPI.fetchAndCacheRealTime(dev.deviceAddr);
        } catch {}
      }

      // Show device selection step
      this._showCloudDeviceList(accessCode);

    } catch (err) {
      this.showCloudError(`识别失败: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> 识别并获取设备列表';
    }
  },

  cloudLogout() {
    document.getElementById('cloud-step-login').style.display = '';
    document.getElementById('cloud-step-devices').style.display = 'none';
    document.getElementById('cloud-import-btn').style.display = 'none';
    this.clearCloudError();
  },

  _showCloudDeviceList(accessCode) {
    document.getElementById('cloud-step-login').style.display = 'none';
    document.getElementById('cloud-step-devices').style.display = '';
    document.getElementById('cloud-import-btn').style.display = '';
    document.getElementById('cloud-account-display').textContent = `识别码 ${accessCode}`;

    // Populate location dropdown
    const locs = DataRepository.listLocations();
    document.getElementById('cloud-import-location').innerHTML =
      '<option value="">-- 导入到地块(可选) --</option>' +
      locs.map(l => `<option value="${l.id}">${l.name}</option>`).join('');

    const existingDevs = DataRepository.listDevices();
    const existingAddrs = new Set(existingDevs.filter(d => d.apiConfig).map(d => String(d.apiConfig.deviceAddr)));

    const listEl = document.getElementById('cloud-device-list');
    document.getElementById('cloud-device-count').textContent = `共发现 ${this._cloudDevices.length} 台设备`;

    listEl.innerHTML = this._cloudDevices.map(dev => {
      const isAdded = existingAddrs.has(String(dev.deviceAddr));
      const renameValue = this._cloudRenameMap[String(dev.deviceAddr)] || dev.deviceName || `传感器-${dev.deviceAddr}`;
      const cached = SensorEngine.getApiData(dev.deviceAddr);
      const statusBadge = cached
        ? '<span class="badge badge-online">● 在线</span>'
        : '<span class="badge badge-offline">● 未知</span>';

      // Get factor names
      const factors = (dev.factors || []).map(f => f.factorName).filter(Boolean);
      // Get current values if available
      let valueTags = '';
      if (cached && cached.dataItems) {
        const vals = [];
        cached.dataItems.forEach(node => {
          (node.registerItem || []).forEach(reg => {
            vals.push(`${reg.registerName}: ${typeof reg.value === 'number' ? reg.value.toFixed(1) : reg.value}${reg.unit}`);
          });
        });
        valueTags = vals.map(v => `<span class="cloud-factor-tag">${v}</span>`).join('');
      } else {
        valueTags = factors.map(f => `<span class="cloud-factor-tag">${f}</span>`).join('');
      }

      return `<div class="cloud-device-item ${isAdded ? 'already-added' : ''}" data-device-addr="${dev.deviceAddr}" onclick="${isAdded ? '' : `app.cloudToggleDevice('${dev.deviceAddr}')`}">
        <input type="checkbox" ${isAdded ? 'disabled checked' : ''}
          ${this._cloudSelected.has(String(dev.deviceAddr)) ? 'checked' : ''}
          onclick="event.stopPropagation(); app.cloudToggleDevice('${dev.deviceAddr}')" ${isAdded ? 'disabled' : ''}>
        <div class="cloud-device-info">
          <div class="cloud-device-name">
            ${dev.deviceName || dev.deviceAddr}
            ${isAdded ? '<span class="cloud-already-badge">已导入</span>' : ''}
          </div>
          <div class="cloud-rename-row">
            <label>导入名称</label>
            <input class="text-input cloud-rename-input" type="text" value="${renameValue.replace(/"/g, '&quot;')}" ${isAdded ? 'disabled' : ''}
              onclick="event.stopPropagation()" oninput="app.setCloudDeviceName('${dev.deviceAddr}', this.value)">
          </div>
          <div class="cloud-device-meta">
            <span>📡 设备地址: ${dev.deviceAddr}</span>
            <span>📊 ${factors.length} 个传感参数</span>
          </div>
          <div class="cloud-device-factors">${valueTags}</div>
        </div>
        <div class="cloud-device-status">${statusBadge}</div>
      </div>`;
    }).join('');

    if (this._cloudDevices.length === 0) {
      listEl.innerHTML = '<div class="empty-state"><i class="fa-solid fa-inbox"></i><p>当前识别码下暂无可导入设备</p></div>';
      document.getElementById('cloud-import-btn').style.display = 'none';
    }

    this._updateCloudImportCount();
  },

  setCloudDeviceName(addr, value) {
    this._cloudRenameMap[String(addr)] = value.trim();
  },

  cloudToggleDevice(addr) {
    addr = String(addr);
    if (this._cloudSelected.has(addr)) {
      this._cloudSelected.delete(addr);
    } else {
      this._cloudSelected.add(addr);
    }
    document.querySelectorAll('.cloud-device-item:not(.already-added)').forEach(item => {
      const checkbox = item.querySelector('input[type="checkbox"]');
      if (checkbox) checkbox.checked = this._cloudSelected.has(String(item.dataset.deviceAddr));
      item.classList.toggle('selected', this._cloudSelected.has(String(item.dataset.deviceAddr)));
    });
    // Update select-all checkbox
    document.getElementById('cloud-select-all-cb').checked = this._getSelectableCount() > 0 && this._cloudSelected.size >= this._getSelectableCount();
    this._updateCloudImportCount();
  },

  cloudToggleAll(checked) {
    const existingDevs = DataRepository.listDevices();
    const existingAddrs = new Set(existingDevs.filter(d => d.apiConfig).map(d => String(d.apiConfig.deviceAddr)));
    this._cloudDevices.forEach(dev => {
      const addr = String(dev.deviceAddr);
      if (!existingAddrs.has(addr)) {
        if (checked) this._cloudSelected.add(addr);
        else this._cloudSelected.delete(addr);
      }
    });
    document.querySelectorAll('.cloud-device-item:not(.already-added)').forEach(item => {
      const checkbox = item.querySelector('input[type="checkbox"]');
      if (checkbox) checkbox.checked = checked;
      item.classList.toggle('selected', checked);
    });
    this._updateCloudImportCount();
  },

  _getSelectableCount() {
    const existingDevs = DataRepository.listDevices();
    const existingAddrs = new Set(existingDevs.filter(d => d.apiConfig).map(d => String(d.apiConfig.deviceAddr)));
    return this._cloudDevices.filter(d => !existingAddrs.has(String(d.deviceAddr))).length;
  },

  _updateCloudImportCount() {
    const countEl = document.getElementById('cloud-import-count');
    if (countEl) countEl.textContent = this._cloudSelected.size;
    const btn = document.getElementById('cloud-import-btn');
    if (btn) btn.style.opacity = this._cloudSelected.size > 0 ? '1' : '0.5';
  },

  cloudImportSelected() {
    if (this._cloudSelected.size === 0) { this.showCloudError('请至少选择一台设备'); return; }
    this.clearCloudError();
    const locationId = document.getElementById('cloud-import-location')?.value || '';
    const devices = DataRepository.listDevices();
    const creds = CloudAPI.loadCredentials();

    this._cloudSelected.forEach(addr => {
      const cloudDev = this._cloudDevices.find(d => String(d.deviceAddr) === addr);
      if (!cloudDev) return;

      // Build factor names for the notes
      const factorNames = (cloudDev.factors || []).map(f => f.factorName).filter(Boolean);
      const customName = this._cloudRenameMap[String(addr)]?.trim();

      const newDev = {
        id: 'dev-' + uid(),
        name: customName || cloudDev.deviceName || `传感器-${addr}`,
        type: 'sensor_soil_api',
        locationId: locationId,
        address: String(addr),
        protocol: 'CloudAPI',
        streamUrl: '',
        notes: `在线传感器 | 参数: ${factorNames.join(', ')}`,
        online: true,
        lat: cloudDev.lat || 0,
        lng: cloudDev.lng || 0,
        apiConfig: {
          deviceAddr: String(addr),
          loginName: creds?.loginName || '',
          password: creds?.password || '',
          apiUrl: creds?.apiUrl || 'http://www.0531yun.com',
          factors: cloudDev.factors || [],
        },
      };
      devices.push(newDev);
    });

    DataRepository.saveDevices(devices);
    this._ensureDeviceCoords();
    this.closeModal('cloud');
    this.renderDevices();
    this.updateSidebarStatus();
    this.startCloudApiPolling();

    UI.toast(`成功导入 ${this._cloudSelected.size} 台设备`, 'success');
    this._cloudSelected = new Set();
    this._cloudRenameMap = {};
  },
};

// ─── INIT ───
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if(e.target===overlay) app.closeModal(overlay.id.replace('modal-','')); });
  });
  window.agriRuntime = {
    setMode: (mode, patch) => app.setRuntimeMode(mode, patch),
    getConfig: () => DataRepository.getRuntimeConfig(),
    getEndpoints: () => DataRepository.getEndpointMap(),
  };
  app.init().catch(error => {
    console.error('[AppInit]', error);
    UI.toast('初始化失败，请刷新重试', 'danger');
  });
});
