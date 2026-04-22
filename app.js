/* =====================================================
   \u667a\u6167\u519c\u4e1a\u76d1\u6d4b\u5e73\u53f0 \u2014 Application Logic v3
   Features: Dynamic status, Automation engine, 
   Cloud Platform API integration, LoRa/RS485 Modbus
   ===================================================== */

// ====================================================
// DATA STORE
// ====================================================
const AuthService = {
  TOKEN_KEY: 'agri_access_token',
  USER_KEY: 'agri_current_user',
  currentUser: null,

  authHeaders(extra = {}) {
    const token = localStorage.getItem(this.TOKEN_KEY);
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
  },

  async login(account, password) {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.msg || '\u767b\u5f55\u5931\u8d25');
    localStorage.setItem(this.TOKEN_KEY, data.accessToken);
    localStorage.setItem(this.USER_KEY, JSON.stringify(data.user || {}));
    this.currentUser = data.user || null;
    this.applyUserState();
    return data;
  },

  async ensureSession() {
    if (window.location.protocol === 'file:') {
      this.currentUser = { account: 'local', name: 'Local Admin', role: 'platform_admin' };
      this.applyUserState();
      return true;
    }
    const token = localStorage.getItem(this.TOKEN_KEY);
    if (!token) return false;
    try {
      const res = await fetch('/api/v1/auth/me', { headers: this.authHeaders() });
      if (!res.ok) {
        this.logout(false);
        return false;
      }
      const data = await res.json();
      this.currentUser = data.user || JSON.parse(localStorage.getItem(this.USER_KEY) || 'null');
      localStorage.setItem(this.USER_KEY, JSON.stringify(this.currentUser || {}));
      this.applyUserState();
      return true;
    } catch {
      this.logout(false);
      return false;
    }
  },

  bindLoginForm() {
    const form = document.getElementById('login-form');
    if (!form || form.dataset.bound === '1') return;
    form.dataset.bound = '1';
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const account = document.getElementById('login-account')?.value.trim();
      const password = document.getElementById('login-password')?.value || '';
      const error = document.getElementById('login-error');
      const btn = document.getElementById('login-submit');
      if (error) error.textContent = '';
      if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> \u767b\u5f55\u4e2d'; }
      try {
        await this.login(account, password);
        await app.init();
      } catch (err) {
        if (error) error.textContent = err.message || '\u767b\u5f55\u5931\u8d25';
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> \u767b\u5f55'; }
      }
    });
  },

  applyUserState() {
    const name = this.currentUser?.name || this.currentUser?.account || '--';
    const role = this.currentUser?.role === 'platform_admin' ? '\u5e73\u53f0\u7ba1\u7406\u5458' : '\u5ba2\u6237\u7ba1\u7406\u5458';
    const nameEl = document.getElementById('current-user-name');
    const roleEl = document.getElementById('current-user-role');
    if (nameEl) nameEl.textContent = name;
    if (roleEl) roleEl.textContent = role;
    document.querySelectorAll('.admin-only').forEach(el => {
      el.style.display = this.canManageUsers() ? '' : 'none';
    });
  },

  canManageUsers() {
    return this.currentUser?.role === 'platform_admin';
  },

  showLogin() {
    document.body.classList.remove('auth-pending');
    const shell = document.getElementById('app-shell');
    const login = document.getElementById('login-screen');
    if (shell) shell.style.display = 'none';
    if (login) login.style.display = '';
  },

  showApp() {
    document.body.classList.remove('auth-pending');
    const shell = document.getElementById('app-shell');
    const login = document.getElementById('login-screen');
    if (shell) shell.style.display = '';
    if (login) login.style.display = 'none';
  },

  logout(reload = true) {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    this.currentUser = null;
    if (reload) window.location.reload();
    else this.showLogin();
  },

  async request(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const headers = this.authHeaders(options.headers || {});
    try {
      const res = await fetch('/api/v1' + path, { ...options, headers, signal: controller.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.msg || '\u8bf7\u6c42\u5931\u8d25');
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('\u8bf7\u6c42\u8d85\u65f6\uff0c\u8bf7\u68c0\u67e5\u540e\u7aef\u662f\u5426\u542f\u52a8');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  },
};

const Store = {
  _get(key, fb) { try { return JSON.parse(localStorage.getItem('agri_' + key)) || fb; } catch { return fb; } },
  _set(key, val) {
    localStorage.setItem('agri_' + key, JSON.stringify(val));
    globalThis.SyncService?.schedulePush?.();
  },
  _serverRealtime: {},
  _deviceRows: {},

  getDeviceRealtime(id) { return this._serverRealtime[id] || null; },
  updateDeviceRealtime(id, rt) { this._serverRealtime[id] = rt; },
  getDeviceHistoryRows(id) { return this._deviceRows[id] || null; },
  updateDeviceHistoryRows(id, rows) { this._deviceRows[id] = Array.isArray(rows) ? rows : []; },

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
    };
  },

  importData(snapshot = {}) {
    localStorage.setItem('agri_locations', JSON.stringify(snapshot.locations || []));
    localStorage.setItem('agri_devices', JSON.stringify(snapshot.devices || []));
    localStorage.setItem('agri_automations', JSON.stringify(snapshot.automations || []));
    localStorage.setItem('agri_autoLog', JSON.stringify(snapshot.autoLog || []));
    localStorage.setItem('agri_history', JSON.stringify(snapshot.history || {}));
    this._serverRealtime = snapshot.serverRealtime || {};

    const byDevice = {};
    for (const item of (snapshot.sensorReadings || [])) {
      if (!item || !item.deviceId) continue;
      if (!byDevice[item.deviceId]) byDevice[item.deviceId] = [];
      byDevice[item.deviceId].push({
        ts: item.deviceTimestamp,
        deviceTimestamp: item.deviceTimestamp,
        recordTimeStr: item.recordTimeStr || null,
        receivedAt: item.receivedAt,
        values: item.externalValues || {},
        channelValues: item.values || {},
        readingId: item.id,
        source: item.source,
      });
    }
    for (const deviceId of Object.keys(byDevice)) {
      byDevice[deviceId].sort((a, b) => (a.ts || 0) - (b.ts || 0));
    }
    this._deviceRows = byDevice;
  },
};

const SyncService = {
  _timer: null,
  _inFlight: null,
  _bootstrapped: false,

  isEnabled() {
    // Always sync to backend when page is served over http(s)  - the old
    // "local" mode used frontend-only storage, which doesn't apply anymore
    // now that the backend is the source of truth for devices and readings.
    return window.location.protocol !== 'file:';
  },

  async bootstrap() {
    if (!this.isEnabled()) {
      this._bootstrapped = true;
      return;
    }
    try {
      const res = await fetch('/api/v1/app-state', {
        method: 'GET',
        headers: AuthService.authHeaders(),
      });
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
    clearTimeout(this._timer);
    const snapshot = Store.exportData();
    this._inFlight = fetch('/api/v1/app-state', {
      method: 'PUT',
      headers: AuthService.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(snapshot),
    }).catch(error => {
      console.warn('[SyncService] push failed:', error.message);
    }).finally(() => {
      this._inFlight = null;
    });
    await this._inFlight;
  },

  async pushNowForced() {
    if (window.location.protocol === 'file:') return;
    clearTimeout(this._timer);
    const snapshot = Store.exportData();
    const res = await fetch('/api/v1/app-state', {
      method: 'PUT',
      headers: AuthService.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(snapshot),
    });
    if (!res.ok) throw new Error('app-state ' + res.status);
  },
};
globalThis.SyncService = SyncService;

const RuntimeConfigStore = {
  KEY: 'runtimeConfig',
  defaults() {
    const servedOverHttp = window.location.protocol in { 'http:': true, 'https:': true };
    const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    return {
      mode: servedOverHttp && !isLocalHost ? 'remote' : 'local',
      backendBaseUrl: '/api/v1',
      proxyBaseUrl: '/proxy',
      healthEndpoint: '/health',
      syncPolicy: 'manual',
      demoMode: false
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
      type: location.type || '\u5176\u4ed6',
      lat: Number(location.lat) || 0,
      lng: Number(location.lng) || 0,
      area: Number(location.area) || 0,
      notes: (location.notes || '').trim(),
      metadata: location.metadata || {},
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
  _health: { ok: null, checkedAt: 0, message: '\u672a\u68c0\u67e5' },

  getConfig() {
    return RuntimeConfigStore.get();
  },

  getModeMeta() {
    const { mode, backendBaseUrl, syncPolicy } = this.getConfig();
    const labels = {
      local: '\u672c\u5730\u6a21\u5f0f',
      hybrid: '\u6df7\u5408\u6a21\u5f0f',
      remote: '\u540e\u7aef\u6a21\u5f0f',
    };
    return {
      mode,
      label: labels[mode] || '\u672c\u5730\u6a21\u5f0f',
      backendBaseUrl,
      syncPolicy,
    };
  },

  async checkHealth(force = false) {
    const now = Date.now();
    if (!force && now - this._health.checkedAt < 45000) return this._health;
    const { backendBaseUrl, healthEndpoint } = this.getConfig();
    try {
      const res = await fetch(`${backendBaseUrl}${healthEndpoint}`, { method: 'GET' });
      this._health = {
        ok: res.ok,
        checkedAt: now,
        message: res.ok ? '\u540e\u7aef\u53ef\u8fde\u63a5' : `\u540e\u7aef\u54cd\u5e94\u5f02\u5e38 (${res.status})`,
      };
    } catch (error) {
      this._health = {
        ok: false,
        checkedAt: now,
        message: `\u540e\u7aef\u4e0d\u53ef\u8fbe: ${error.message}`,
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
      deviceRealtime: `${backendBaseUrl}/device-realtime`,
      deviceHistory: `${backendBaseUrl}/device-history`,
    };
  },

  async getDeviceRealtime(deviceId, options = {}) {
    const force = options.force === true ? '&force=true' : '';
    const res = await fetch(`${this.getEndpointMap().deviceRealtime}?deviceId=${encodeURIComponent(deviceId)}${force}`, {
      headers: AuthService.authHeaders(),
    });
    if (!res.ok) throw new Error(`realtime ${res.status}`);
    return await res.json();
  },

  async getDeviceHistory(deviceId) {
    const res = await fetch(`${this.getEndpointMap().deviceHistory}?deviceId=${encodeURIComponent(deviceId)}`, {
      headers: AuthService.authHeaders(),
    });
    if (!res.ok) throw new Error(`history ${res.status}`);
    return await res.json();
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

function demoLocations() {
  return [
    { id:'demo-loc-1', name:'\u4e00\u53f7\u519c\u7530\uff08\u852c\u83dc\u533a\uff09', type:'\u852c\u83dc\u5730', lat:20.0450, lng:110.1980, area:120, notes:'\u6f14\u793a\u5730\u5757', metadata:{ demo:true } },
    { id:'demo-loc-2', name:'\u4e8c\u53f7\u519c\u7530\uff08\u6c34\u7a3b\u7530\uff09', type:'\u6c34\u7a3b\u7530', lat:20.0430, lng:110.2010, area:300, notes:'\u6f14\u793a\u5730\u5757', metadata:{ demo:true } },
    { id:'demo-loc-3', name:'\u5b9e\u9a8c\u6e29\u5ba4A', type:'\u6e29\u5ba4\u5927\u68da', lat:20.0465, lng:110.1950, area:20, notes:'\u6f14\u793a\u5730\u5757', metadata:{ demo:true } },
  ];
}

function demoDevices() {
  return [
    { id:'demo-dev-1', name:'\u73af\u5883\u4f20\u611f\u5668-A1', type:'sensor_env', locationId:'demo-loc-1', address:'0x01', protocol:'LoRa', streamUrl:'', notes:'\u6f14\u793a\u8bbe\u5907', online:true, lat:20.0452, lng:110.1975, metadata:{ demo:true } },
    { id:'demo-dev-2', name:'\u571f\u58e4\u4f20\u611f\u5668-A2', type:'sensor_soil', locationId:'demo-loc-1', address:'0x02', protocol:'LoRa', streamUrl:'', notes:'\u6f14\u793a\u8bbe\u5907', online:true, lat:20.0448, lng:110.1985, metadata:{ demo:true } },
    { id:'demo-dev-3', name:'\u73af\u5883\u4f20\u611f\u5668-B1', type:'sensor_env', locationId:'demo-loc-2', address:'0x03', protocol:'LoRa', streamUrl:'', notes:'\u6f14\u793a\u8bbe\u5907', online:true, lat:20.0433, lng:110.2005, metadata:{ demo:true } },
    { id:'demo-dev-4', name:'\u866b\u60c5\u76d1\u6d4b\u4eea-B2', type:'sensor_pest', locationId:'demo-loc-2', address:'0x04', protocol:'LoRa', streamUrl:'', notes:'\u6f14\u793a\u8bbe\u5907', online:false, lat:20.0427, lng:110.2015, metadata:{ demo:true } },
    { id:'demo-dev-5', name:'\u6444\u50cf\u5934-C1', type:'camera', locationId:'demo-loc-3', address:'192.168.1.21', protocol:'RTSP', streamUrl:'rtsp://192.168.1.21:554/main', notes:'\u6f14\u793a\u8bbe\u5907', online:true, lat:20.0468, lng:110.1948, metadata:{ demo:true } },
    { id:'demo-dev-6', name:'\u704c\u6e89\u63a7\u5236\u5668-A3', type:'controller_water', locationId:'demo-loc-1', address:'0x05', protocol:'RS485', streamUrl:'', notes:'\u6f14\u793a\u8bbe\u5907', online:true, lat:20.0445, lng:110.1990, metadata:{ demo:true } },
    { id:'demo-dev-7', name:'\u8865\u5149\u706f\u7ec4-C2', type:'controller_light', locationId:'demo-loc-3', address:'0x06', protocol:'RS485', streamUrl:'', notes:'\u6f14\u793a\u8bbe\u5907', online:true, lat:20.0462, lng:110.1955, metadata:{ demo:true } },
    { id:'demo-dev-8', name:'\u98ce\u673a-C3', type:'controller_fan', locationId:'demo-loc-3', address:'0x07', protocol:'RS485', streamUrl:'', notes:'\u6f14\u793a\u8bbe\u5907', online:true, lat:20.0467, lng:110.1943, metadata:{ demo:true } },
  ];
}

function demoAutomations() {
  return [
    {
      id:'demo-auto-1', name:'\u852c\u83dc\u533a\u81ea\u52a8\u704c\u6e89', desc:'\u5f53\u571f\u58e4\u6e7f\u5ea6\u8fc7\u4f4e\u65f6\u81ea\u52a8\u5f00\u542f\u704c\u6e89\u6c34\u6cf5', enabled: true,
      conditions: [{ sourceDeviceId:'demo-dev-2', param:'soil', operator:'<', value: 25 }],
      actions: [{ targetDeviceId:'demo-dev-6', action:'on' }],
      metadata:{ demo:true },
    },
    {
      id:'demo-auto-2', name:'\u6e29\u5ba4\u9ad8\u6e29\u901a\u98ce', desc:'\u6e29\u5ba4\u6e29\u5ea6\u8d85\u8fc735\u00b0C\u65f6\u81ea\u52a8\u5f00\u542f\u98ce\u673a\u964d\u6e29', enabled: true,
      conditions: [{ sourceDeviceId:'demo-dev-1', param:'temp', operator:'>', value: 35 }],
      actions: [{ targetDeviceId:'demo-dev-8', action:'on' }],
      metadata:{ demo:true },
    },
  ];
}

// ====================================================
// PEST DB
// ====================================================
const PEST_DB = [
  { id:'p1', type:'pest', name:'\u7a3b\u98de\u8671', latin:'Nilaparvata lugens', emoji:'\ud83e\udd97', severity:'high', crops:['\u6c34\u7a3b'], season:'5-10\u6708',
    symptoms:'\u53f6\u7247\u51fa\u73b0\u9ec4\u767d\u8272\u6761\u6591\uff0c\u690d\u682a\u4e0b\u90e8\u67af\u9ec4\uff0c\u4e25\u91cd\u65f6\u6574\u682a\u5012\u4f0f\u3002', prevention:'\u53ca\u65f6\u6392\u6c34\u6652\u7530\uff0c\u51cf\u5c11\u6c2e\u80a5\uff0c\u9009\u7528\u6297\u6027\u54c1\u79cd\u3002',
    control:'\u5421\u866b\u5549\u3001\u567b\u55ea\u916e\u7b49\u836f\u5242\u55b7\u96fe\uff0c\u6ce8\u610f\u5bf9\u51c6\u57fa\u90e8\u3002', threshold:'\u767e\u4e1b\u866b\u91cf\u8d85\u8fc71000\u5934\u65f6\u5373\u9700\u9632\u6cbb\u3002' },
  { id:'p2', type:'disease', name:'\u6c34\u7a3b\u7eb9\u67af\u75c5', latin:'Rhizoctonia solani', emoji:'\ud83c\udf42', severity:'high', crops:['\u6c34\u7a3b'], season:'6-9\u6708',
    symptoms:'\u53f6\u9798\u4e0a\u51fa\u73b0\u692d\u5706\u5f62\u4e91\u7eb9\u72b6\u75c5\u6591\uff0c\u9ad8\u6e29\u9ad8\u6e7f\u65f6\u5411\u4e0a\u8513\u5ef6\u3002', prevention:'\u5408\u7406\u5bc6\u690d\uff0c\u964d\u4f4e\u7530\u95f4\u6e7f\u5ea6\uff0c\u63a7\u5236\u6c2e\u80a5\u3002',
    control:'\u82ef\u919a\u7532\u73af\u5511\u3001\u4e95\u5188\u9709\u7d20\u7b49\u55b7\u65bd\u830e\u57fa\u90e8\u3002', threshold:'\u4e1b\u53d1\u75c5\u7387\u8fbe\u523020%\u65f6\u5f00\u59cb\u9632\u6cbb\u3002' },
  { id:'p3', type:'pest', name:'\u659c\u7eb9\u591c\u86fe', latin:'Spodoptera litura', emoji:'\ud83e\udd8b', severity:'medium', crops:['\u852c\u83dc','\u6c34\u7a3b','\u7389\u7c73'], season:'7-10\u6708',
    symptoms:'\u5e7c\u866b\u53d6\u98df\u53f6\u7247\u6210\u7a7f\u5b54\u72b6\uff0c\u8001\u9f84\u5e7c\u866b\u663c\u4f0f\u591c\u51fa\u3002', prevention:'\u5b89\u88c5\u8bf1\u866b\u706f\uff0c\u63a8\u5e7f\u6027\u4fe1\u606f\u7d20\u8bf1\u6355\u3002',
    control:'\u6c2f\u866b\u82ef\u7532\u9170\u80fa\u7b49\u55b7\u96fe\uff0c\u508d\u665a\u65bd\u836f\u6548\u679c\u6700\u4f73\u3002', threshold:'\u767e\u682a\u5375\u5757\u8fbe\u52303\u5757\u6216\u5e7c\u866b30\u5934\u65f6\u9632\u6cbb\u3002' },
  { id:'p4', type:'disease', name:'\u852c\u83dc\u7070\u9709\u75c5', latin:'Botrytis cinerea', emoji:'\ud83c\udf2b\ufe0f', severity:'medium', crops:['\u852c\u83dc','\u756a\u8304'], season:'\u51ac-\u6625\u5b63',
    symptoms:'\u75c5\u90e8\u51fa\u73b0\u6c34\u6d78\u72b6\u6591\u70b9\uff0c\u6269\u5927\u540e\u4ea7\u751f\u7070\u8910\u8272\u9709\u5c42\u3002', prevention:'\u52a0\u5f3a\u901a\u98ce\u900f\u5149\uff0c\u964d\u4f4e\u6e7f\u5ea6\uff0c\u6e05\u9664\u75c5\u6b8b\u4f53\u3002',
    control:'\u8150\u9709\u5229\u3001\u5627\u9709\u80fa\u7b49\u8f6e\u6362\u4f7f\u7528\u907f\u514d\u6297\u6027\u3002', threshold:'\u53d1\u75c5\u521d\u671f\u5373\u5f00\u59cb\u65bd\u836f\u3002' },
  { id:'p5', type:'pest', name:'\u869c\u866b\uff08\u83dc\u869c\uff09', latin:'Myzus persicae', emoji:'\ud83d\udc1c', severity:'medium', crops:['\u852c\u83dc','\u53f6\u83dc'], season:'\u5168\u5e74',
    symptoms:'\u7fa4\u96c6\u53f6\u80cc\u523a\u5438\u6c41\u6db2\uff0c\u53f6\u7247\u5377\u66f2\u76b1\u7f29\uff0c\u53ef\u4f20\u64ad\u75c5\u6bd2\u75c5\u3002', prevention:'\u9ec4\u8272\u7c98\u866b\u677f\uff0c\u4fdd\u62a4\u74e2\u866b\u7b49\u5929\u654c\u3002',
    control:'\u5421\u866b\u5549\u3001\u5576\u866b\u8112\u7b49\u55b7\u96fe\uff0c\u6ce8\u610f\u53f6\u80cc\u3002', threshold:'\u6bcf\u682a\u869c\u866b100\u5934\u65f6\u5f00\u59cb\u9632\u6cbb\u3002' },
  { id:'p6', type:'disease', name:'\u9ec4\u74dc\u971c\u9709\u75c5', latin:'Pseudoperonospora cubensis', emoji:'\ud83e\udd52', severity:'high', crops:['\u9ec4\u74dc','\u846b\u82a6\u79d1'], season:'\u6625\u5b63',
    symptoms:'\u53f6\u9762\u9ec4\u7eff\u8272\u89d2\u6591\uff0c\u80cc\u9762\u7d2b\u8910\u8272\u9709\u5c42\uff0c\u53d1\u5c55\u8fc5\u901f\u3002', prevention:'\u9009\u7528\u6297\u75c5\u54c1\u79cd\uff0c\u5927\u68da\u964d\u6e7f\u3002',
    control:'\u70ef\u9170\u5417\u5549\u7b49\u55b7\u96fe\uff0c\u53d1\u75c5\u524d\u9884\u9632\u6700\u4f73\u3002', threshold:'\u53d1\u73b0\u4e2d\u5fc3\u75c5\u682a\u65f6\u7acb\u5373\u7528\u836f\u3002' },
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
  async request(endpoint, params = {}) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
    ).toString();
    const path = endpoint.startsWith('/api/v1/') ? endpoint : `/api/v1${endpoint}`;
    const url = `${path}${qs ? '?' + qs : ''}`;
    const res = await fetch(url, { headers: AuthService.authHeaders() });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) throw new Error(json.msg || json.message || 'API Error');
    return json;
  },

  // Get all devices under the account
  async getDeviceList(accessCode, apiUrl = 'http://www.0531yun.com') {
    const data = await this.request('/cloud-devices', { accessCode, apiUrl });
    return data.devices || [];
  },

  // Get real-time data for a device
  async getRealTimeData(deviceAddr) {
    return await this.request('/device-realtime', { deviceId: String(deviceAddr) });
  },

  // Get device info (with factors/thresholds)
  async getDeviceInfo(deviceAddr) {
    const devices = DataRepository.listDevices();
    return devices.find(item => String(item.id) === String(deviceAddr) || String(item.apiConfig?.deviceAddr || '') === String(deviceAddr)) || null;
  },

  // Get historical data
  async getHistoryData(deviceAddr, startTime, endTime, nodeId = -1) {
    return await this.request('/device-history', {
      deviceId: String(deviceAddr),
      startTime,
      endTime,
      nodeId
    });
  },

  // Fetch and cache real-time data for a device
  async fetchAndCacheRealTime(deviceAddr) {
    try {
      const rtData = await this.getRealTimeData(deviceAddr);
      if (rtData && rtData.dataItems) {
        SensorEngine.setApiData(deviceAddr, rtData.dataItems, rtData.deviceTimestamp || rtData.timestamp || Date.now());
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
  temp: '\u7a7a\u6c14\u6e29\u5ea6 (\u00b0C)', humid: '\u7a7a\u6c14\u6e7f\u5ea6 (%)', soil: '\u571f\u58e4\u6e7f\u5ea6 (%)',
  light: '\u5149\u7167\u5f3a\u5ea6 (lux)', co2: 'CO\u2082 (ppm)', wind: '\u98ce\u901f (m/s)', pest: '\u866b\u5bb3\u6355\u83b7\u91cf'
};
const OP_LABELS = { '>': '\u5927\u4e8e', '<': '\u5c0f\u4e8e', '>=': '\u5927\u4e8e\u7b49\u4e8e', '<=': '\u5c0f\u4e8e\u7b49\u4e8e', '==': '\u7b49\u4e8e' };
const ACTION_LABELS = { on: '\u5f00\u542f', off: '\u5173\u95ed' };
const TYPE_LABELS = {
  sensor_env:'\ud83c\udf21\ufe0f \u73af\u5883\u4f20\u611f\u5668', sensor_soil:'\ud83c\udf31 \u571f\u58e4\u4f20\u611f\u5668', sensor_soil_api:'\ud83d\udd17 \u5728\u7ebf\u4f20\u611f\u5668',
  sensor_pest:'\ud83e\udd9f \u866b\u60c5\u76d1\u6d4b\u4eea', camera:'\ud83d\udcf9 \u6444\u50cf\u5934', controller_water:'\ud83d\udca7 \u704c\u6e89\u63a7\u5236\u5668',
  controller_light:'\ud83d\udca1 \u8865\u5149\u63a7\u5236\u5668', controller_fan:'\ud83c\udf00 \u98ce\u673a\u63a7\u5236\u5668'
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
  _backendHealthInterval: null,
  _runtimeConfig: null,
  _initialized: false,
  _accounts: [],
  _cloudHistoryData: [],
  _selectedFactors: new Set(),
  _historyLoading: false,
  _historyRefreshQueued: false,
  _selectedCropId: null,
  _selectedCropName: '',
  _photoCompressedBase64: null,
  _currentWeather: null,
  _crops: [],
  _photoRecordCache: {},
  _photoImageUrls: {},

  //     BOOT    
  async init() {
    const authenticated = await AuthService.ensureSession();
    if (!authenticated) {
      AuthService.showLogin();
      return;
    }
    AuthService.showApp();
    if (this._initialized) {
      this.navigate(this.currentPage || 'dashboard');
      return;
    }
    this._initialized = true;
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

  //     DYNAMIC SIDEBAR STATUS    
  updateSidebarStatus() {
    const devices = DataRepository.listDevices();
    const total = devices.length;
    const online = devices.filter(d => d.online).length;
    const offline = total - online;

    let sysStatus, sysColor;
    if (offline === 0) { sysStatus = '\u7cfb\u7edf\u8fd0\u884c\u6b63\u5e38'; sysColor = 'green'; }
    else if (offline <= 2) { sysStatus = `${offline}\u53f0\u8bbe\u5907\u79bb\u7ebf`; sysColor = 'yellow'; }
    else { sysStatus = `${offline}\u53f0\u8bbe\u5907\u5f02\u5e38`; sysColor = 'red'; }

    const modeMeta = BackendAdapter.getModeMeta();
    const health = BackendAdapter.getHealthSnapshot();
    const backendColor = health.ok === null ? 'yellow' : (health.ok ? 'green' : 'red');
    const backendStatus = health.ok === null
      ? `${modeMeta.label} \u00b7 \u5f85\u68c0\u67e5`
      : `${modeMeta.label} \u00b7 ${health.message}`;

    const el = document.getElementById('sidebar-status');
    el.innerHTML = `
      <div class="status-row"><span class="status-dot ${sysColor}"></span><span>${sysStatus}</span></div>
      <div class="status-row"><span class="status-dot ${backendColor}"></span><span>${backendStatus}</span></div>
    `;
  },

  //     NAV    
  bindNav() {
    document.querySelectorAll('.nav-link[data-page]').forEach(l => {
      l.addEventListener('click', () => this.navigate(l.dataset.page));
    });
  },

  navigate(page) {
    this.currentPage = page;
    document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.page === page));
    const titles = {
      dashboard:'\u7cfb\u7edf\u603b\u89c8', realtime:'\u5b9e\u65f6\u6570\u636e', video:'\u89c6\u9891\u76d1\u63a7', history:'\u66f2\u7ebf\u56fe\u8868',
      cloudsync:'\u5386\u53f2\u8bb0\u5f55', pestdb:'\u75c5\u5bb3\u866b\u6570\u636e\u5e93', photos:'AI\u8bb0\u5f55', automation:'\u81ea\u52a8\u5316\u6d41\u7a0b', locations:'\u5730\u5757\u7ba1\u7406', devices:'\u8bbe\u5907\u7ba1\u7406',
      accounts:'\u8d26\u53f7\u7ba1\u7406'
    };
    document.getElementById('page-title').textContent = titles[page] || '';
    document.querySelectorAll('.page').forEach(p => {
      p.style.willChange = '';
      p.classList.remove('active');
    });
    const el = document.getElementById('page-'+page);
    if (el) {
      el.style.willChange = 'transform, opacity';
      const clearWillChange = () => { el.style.willChange = ''; };
      el.addEventListener('transitionend', clearWillChange, { once: true });
      setTimeout(clearWillChange, 400);
      el.classList.add('active');
    }
    this.stopLive();
    const init = {
      dashboard: () => this.initDashboard(), realtime: () => this.initRealtime(),
      video: () => this.renderVideo(), history: () => this.initHistory(), cloudsync: () => this.initCloudSync(),
      pestdb: () => this.renderPests(), photos: () => this.renderPhotos(), automation: () => this.renderAutomation(),
      locations: () => this.renderLocations(), devices: () => this.renderDevices(), accounts: () => this.renderAccounts(),
    };
    if (init[page]) init[page]();
  },

  bindSidebarToggle() {
    document.getElementById('sidebarToggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('collapsed');
    });
  },

  bindAlertDrawer() {
    const toggle = document.getElementById('alertToggle');
    const drawer = document.getElementById('alertDrawer');
    toggle.addEventListener('click', event => {
      event.stopPropagation();
      drawer.classList.toggle('open');
    });
    drawer.addEventListener('click', event => {
      event.stopPropagation();
    });
    document.addEventListener('click', event => {
      if (!drawer.classList.contains('open')) return;
      if (toggle.contains(event.target) || drawer.contains(event.target)) return;
      drawer.classList.remove('open');
    });
  },

  setRuntimeMode(mode, patch = {}) {
    const allowed = ['local', 'hybrid', 'remote'];
    if (!allowed.includes(mode)) {
      UI.toast('\u8fd0\u884c\u6a21\u5f0f\u65e0\u6548', 'warning');
      return;
    }
    this._runtimeConfig = DataRepository.saveRuntimeConfig({ mode, ...patch });
    UI.toast(`\u5df2\u5207\u6362\u5230${BackendAdapter.getModeMeta().label}`, 'success');
    this.refreshBackendHealth(true);
  },

  toggleDemoMode(enabled) {
    const nextEnabled = enabled ?? !DataRepository.getRuntimeConfig().demoMode;
    const isDemoItem = item => Boolean(item?.metadata?.demo) || String(item?.id || '').startsWith('demo-');
    if (nextEnabled) {
      const locations = [
        ...DataRepository.listLocations().filter(item => !isDemoItem(item)),
        ...demoLocations(),
      ];
      const devices = [
        ...DataRepository.listDevices().filter(item => !isDemoItem(item)),
        ...demoDevices(),
      ];
      const automations = [
        ...DataRepository.listAutomations().filter(item => !isDemoItem(item)),
        ...demoAutomations(),
      ];
      DataRepository.saveDevices(devices);
      Store.saveLocations(locations);
      DataRepository.saveAutomations(automations);
      DataRepository.saveRuntimeConfig({ demoMode: true });
      UI.toast('\u6f14\u793a\u6a21\u5f0f\u5df2\u5f00\u542f', 'success');
    } else {
      const demoDeviceIds = new Set(DataRepository.listDevices().filter(isDemoItem).map(item => item.id));
      Store.saveLocations(DataRepository.listLocations().filter(item => !isDemoItem(item)));
      DataRepository.saveDevices(DataRepository.listDevices().filter(item => !isDemoItem(item)));
      DataRepository.saveAutomations(DataRepository.listAutomations().filter(item => !isDemoItem(item)));
      const history = HistoryStore.getAll();
      demoDeviceIds.forEach(id => delete history[id]);
      Store._set(HistoryStore.KEY, history);
      DataRepository.saveRuntimeConfig({ demoMode: false });
      this.liveReadings = this.liveReadings.filter(item => !String(item.device || '').includes('\u6f14\u793a'));
      this.stopLive();
      UI.toast('\u6f14\u793a\u6a21\u5f0f\u5df2\u5173\u95ed', 'success');
    }
    this._runtimeConfig = DataRepository.getRuntimeConfig();
    this.renderAlerts();
    this.updateSidebarStatus();
    if (this.currentPage === 'devices') this.renderDevices();
    if (this.currentPage === 'locations') this.renderLocations();
    if (this.currentPage === 'automation') this.renderAutomation();
    if (this.currentPage === 'dashboard') this.initDashboard();
    if (this.currentPage === 'realtime') this.initRealtime();
    if (this.currentPage === 'history') this.initHistory();
    if (this.currentPage === 'video') this.renderVideo();
  },

  //     ALERTS    
  getAlerts() {
    const devices = DataRepository.listDevices();
    const locs = DataRepository.listLocations();
    const locMap = Object.fromEntries(locs.map(l => [l.id, l.name]));
    const alerts = [];
    devices.forEach(d => {
      const data = SensorEngine.get(d.id);
      const loc = locMap[d.locationId] || '\u672a\u5206\u914d';
      if (d.online && d.type === 'sensor_env') {
        if (data.temp > 36) alerts.push({ type:'danger', icon:'fa-temperature-arrow-up', title:`\u6c14\u6e29\u8fc7\u9ad8 (${data.temp.toFixed(1)}\u00b0C)`, meta:`${d.name} \u00b7 ${loc}`, page:'realtime' });
        if (data.humid < 25) alerts.push({ type:'warning', icon:'fa-droplet-slash', title:`\u6e7f\u5ea6\u8fc7\u4f4e (${data.humid.toFixed(0)}%)`, meta:`${d.name} \u00b7 ${loc}`, page:'realtime' });
      }
      if (d.online && d.type === 'sensor_soil') {
        if (data.soil < 20) alerts.push({ type:'warning', icon:'fa-droplet', title:`\u571f\u58e4\u7f3a\u6c34 (${data.soil.toFixed(0)}%) \u5efa\u8bae\u704c\u6e89`, meta:`${d.name} \u00b7 ${loc}`, page:'realtime' });
      }
      if (d.online && d.type === 'sensor_pest') {
        if (data.pest > 15) alerts.push({ type:'danger', icon:'fa-bug', title:`\u866b\u5bb3\u9884\u8b66 \u6355\u83b7: ${data.pest}\u5934`, meta:`${d.name} \u00b7 ${loc}`, page:'pestdb' });
      }
      if (!d.online) alerts.push({ type:'info', icon:'fa-circle-exclamation', title:'\u8bbe\u5907\u79bb\u7ebf', meta:`${d.name} \u00b7 ${loc}` });
    });
    return alerts;
  },

  renderAlerts() {
    const alerts = this.getAlerts();
    const alertCountEl = document.getElementById('alertCount');
    alertCountEl.textContent = alerts.length || '';
    alertCountEl.classList.toggle('hidden', alerts.length === 0);
    const html = alerts.length === 0
      ? '<div class="empty-state"><i class="fa-solid fa-circle-check"></i><p>\u6682\u65e0\u8b66\u62a5\uff0c\u4e00\u5207\u6b63\u5e38</p></div>'
      : alerts.map(a => `
          <div class="alert-item ${a.type}">
            <i class="fa-solid ${a.icon}"></i>
            <div class="alert-item-content">
              <div class="alert-item-title">${a.title}</div>
              <div class="alert-item-meta">${a.meta}</div>
            </div>
            ${a.page ? `<button class="alert-action-btn" onclick="app.navigate('${a.page}')">\u67e5\u770b</button>` : ''}
          </div>`).join('');
    ['dash-alerts','alertsList'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    });
  },

  //     DASHBOARD    
  initDashboard() {
    const devices = DataRepository.listDevices();
    const locs = DataRepository.listLocations();
    const online = devices.filter(d => d.online).length;
    const envDevs = devices.filter(d => d.type === 'sensor_env' && d.online);
    let avgT = 0; envDevs.forEach(d => avgT += SensorEngine.get(d.id).temp);
    if (envDevs.length) avgT /= envDevs.length;
    const alerts = this.getAlerts();

    document.getElementById('kpi-row').innerHTML = `
      <div class="kpi-card accent" onclick="app.navigate('devices')" style="cursor:pointer" title="\u70b9\u51fb\u67e5\u770b\u8bbe\u5907\u7ba1\u7406">
        <div class="kpi-icon"><i class="fa-solid fa-microchip"></i></div>
        <div><div class="kpi-label">\u5728\u7ebf\u8bbe\u5907</div><div class="kpi-value">${online}<span class="kpi-unit">/${devices.length}</span></div><div class="kpi-sub">\u70b9\u51fb\u7ba1\u7406\u8bbe\u5907 \u2192</div></div></div>
      <div class="kpi-card ${alerts.length ? 'danger' : 'success'}" onclick="document.getElementById('alertToggle').click()" style="cursor:pointer" title="\u70b9\u51fb\u67e5\u770b\u8b66\u62a5\u8be6\u60c5">
        <div class="kpi-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <div><div class="kpi-label">\u5f53\u524d\u8b66\u62a5</div><div class="kpi-value">${alerts.length}<span class="kpi-unit">\u6761</span></div><div class="kpi-sub">${alerts.length?'\u70b9\u51fb\u67e5\u770b\u8be6\u60c5 \u2192':'\u6240\u6709\u6307\u6807\u6b63\u5e38 \u2713'}</div></div></div>
      <div class="kpi-card warning" onclick="app.navigate('realtime')" style="cursor:pointer" title="\u70b9\u51fb\u67e5\u770b\u5b9e\u65f6\u6570\u636e">
        <div class="kpi-icon"><i class="fa-solid fa-temperature-half"></i></div>
        <div><div class="kpi-label">\u5e73\u5747\u6c14\u6e29</div><div class="kpi-value">${avgT.toFixed(1)}<span class="kpi-unit">\u00b0C</span></div><div class="kpi-sub">\u70b9\u51fb\u67e5\u770b\u5b9e\u65f6\u6570\u636e \u2192</div></div></div>
      <div class="kpi-card success" onclick="app.navigate('locations')" style="cursor:pointer" title="\u70b9\u51fb\u7ba1\u7406\u5730\u5757">
        <div class="kpi-icon"><i class="fa-solid fa-map"></i></div>
        <div><div class="kpi-label">\u76d1\u6d4b\u5730\u5757</div><div class="kpi-value">${locs.length}<span class="kpi-unit">\u5757</span></div><div class="kpi-sub">\u5171 ${locs.reduce((a,l)=>a+(+l.area||0),0)} \u4ea9 \u00b7 \u70b9\u51fb\u7ba1\u7406 \u2192</div></div></div>
    `;

    if (!this.dashMap) {
      this.dashMap = L.map('dash-map', { zoomControl: true, attributionControl: true }).setView([20.044,110.199], 15);
      // Amap tile layers  - no API key required for these public endpoints
      this._mapLayers = {
        standard: L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
          subdomains: '1234',
          attribution: '\u00a9 <a href="https://www.amap.com">\u9ad8\u5fb7\u5730\u56fe</a>',
          maxZoom: 18,
        }),
        satellite: L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}', {
          subdomains: '1234',
          attribution: '\u00a9 <a href="https://www.amap.com">\u9ad8\u5fb7\u5361\u661f\u56fe</a>',
          maxZoom: 18,
        }),
        satelliteLabel: L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}', {
          subdomains: '1234',
          maxZoom: 18,
        }),
      };
      this._mapLayers.standard.addTo(this.dashMap);
      this._currentMapLayer = 'standard';
      // Add layer switch control
      this._addMapLayerControl();
    } else { this.dashMap.eachLayer(l => { if (l instanceof L.Marker || l instanceof L.CircleMarker) this.dashMap.removeLayer(l); }); }
    // Populate map location filter
    const mapFilter = document.getElementById('map-location-filter');
    if (mapFilter) {
      const curVal = this._dashMapFilterLoc || 'all';
      mapFilter.innerHTML = '<option value="all">\ud83d\uddfa\ufe0f \u5168\u90e8\u5730\u5757</option>' + locs.map(l => `<option value="${l.id}" ${l.id===curVal?'selected':''}>${l.name}</option>`).join('');
      mapFilter.value = curVal;
    }
    this.addMapMarkers(this.dashMap, this._dashMapFilterLoc);
    this.renderAlerts();
    this.updateSidebarStatus();
  },

  _getMapFocusPoints(filterLocId = 'all') {
    const locs = DataRepository.listLocations();
    const devices = DataRepository.listDevices();
    const targetLocs = (!filterLocId || filterLocId === 'all')
      ? locs
      : locs.filter(item => item.id === filterLocId);
    const points = [];

    targetLocs.forEach(loc => {
      if (loc.lat && loc.lng) points.push([loc.lat, loc.lng]);
    });

    const targetDevices = (!filterLocId || filterLocId === 'all')
      ? devices
      : devices.filter(item => item.locationId === filterLocId);
    targetDevices.forEach(dev => {
      if (dev.lat && dev.lng) points.push([dev.lat, dev.lng]);
    });

    return points;
  },

  _fitDashboardMap(filterLocId = 'all') {
    if (!this.dashMap) return;
    const points = this._getMapFocusPoints(filterLocId);
    if (!points.length) {
      this.dashMap.setView([20.044, 110.199], 13);
      return;
    }
    if (points.length === 1) {
      this.dashMap.setView(points[0], filterLocId === 'all' ? 14 : 16);
      return;
    }
    const bounds = L.latLngBounds(points);
    this.dashMap.fitBounds(bounds, {
      padding: filterLocId === 'all' ? [36, 36] : [48, 48],
      maxZoom: filterLocId === 'all' ? 15 : 17,
    });
  },

  addMapMarkers(map, filterLocId) {
    const locs = DataRepository.listLocations();
    const devices = DataRepository.listDevices();
    const filteredLocs = (!filterLocId || filterLocId === 'all') ? locs : locs.filter(l => l.id === filterLocId);

    // Location markers (colored circles)
    filteredLocs.forEach(loc => {
      if (!loc.lat || !loc.lng) return;
      const devs = devices.filter(d => d.locationId === loc.id);
      const hasOff = devs.some(d => !d.online);
      const bgColor = hasOff ? '#f59e0b' : '#3b82f6';
      const locIcon = L.divIcon({
        className: '',
        html: `<div style="width:28px;height:28px;border-radius:50%;background:${bgColor};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:14px;">\ud83c\udff7\ufe0f</div>`,
        iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -18],
      });
      const popup = `<div style="font-family:Inter;min-width:180px">
        <div style="font-weight:700;font-size:14px;margin-bottom:4px">${loc.name}</div>
        <span style="color:#666;font-size:12px">${loc.type} \u00b7 ${loc.area}\u4ea9</span>
        <hr style="margin:6px 0;border-color:#eee">
        <div style="font-size:12px;margin-bottom:6px">${devs.length} \u53f0\u8bbe\u5907 (${devs.filter(d=>d.online).length} \u5728\u7ebf)</div>
        <button onclick="app.filterMapByLocation('${loc.id}')" style="width:100%;padding:5px;background:#1070e0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px">\u805a\u7126\u6b64\u5730\u5757</button></div>`;
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
      const fillColor = typeColors[dev.type] || '#94a3b8';
      const marker = L.circleMarker([dev.lat, dev.lng], {
        radius: 7, fillColor, fillOpacity: dev.online ? 0.9 : 0.3,
        color: '#fff', weight: 2,
      }).addTo(map);
      const typeName = TYPE_LABELS[dev.type] || dev.type;
      const locName = locs.find(l => l.id === dev.locationId)?.name || '\u672a\u5206\u914d';
      marker.bindPopup(`<div style="font-family:Inter;min-width:160px">
        <div style="font-weight:600;font-size:13px">${dev.name}</div>
        <div style="font-size:11px;color:#666;margin:4px 0">${typeName}</div>
        <div style="font-size:11px;color:#888">\ud83d\udccd ${locName}</div>
        <div style="font-size:11px;margin-top:4px"><span style="color:${dev.online?'#10b981':'#ef4444'}">\u25cf ${dev.online?'\u5728\u7ebf':'\u79bb\u7ebf'}</span></div>
        ${dev.notes ? `<div style="font-size:11px;color:#999;margin-top:4px">${dev.notes}</div>` : ''}
      </div>`);
    });
    this._fitDashboardMap(filterLocId);
  },

  _addMapLayerControl() {
    const ctrl = L.control({ position: 'topright' });
    ctrl.onAdd = () => {
      const div = L.DomUtil.create('div', 'map-layer-ctrl');
      div.innerHTML = `
        <button id="map-btn-standard" class="map-layer-btn active" onclick="app.switchMapLayer('standard')">\u6807\u51c6\u56fe</button>
        <button id="map-btn-satellite" class="map-layer-btn" onclick="app.switchMapLayer('satellite')">\u536b\u661f\u56fe</button>
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
      addBtn.innerHTML = `<i class="fa-solid fa-plus" style="margin-right:4px"></i>\u6dfb\u52a0\u8bbe\u5907\u5230\u300c${loc?.name || ''}\u300d`;
    } else if (addBtn) {
      addBtn.innerHTML = '<i class="fa-solid fa-plus" style="margin-right:4px"></i>\u6dfb\u52a0\u8bbe\u5907';
    }
    // Toggle map fullscreen overlay
    const mapPanel = document.getElementById('dash-map')?.closest('.glass-panel');
    if (mapPanel) mapPanel.classList.toggle('map-fullscreen', isFocused);
    if (!this.dashMap) return;
    this.dashMap.eachLayer(l => { if (l instanceof L.Marker || l instanceof L.CircleMarker) this.dashMap.removeLayer(l); });
    this.addMapMarkers(this.dashMap, locId);
    // Invalidate size after CSS transition
    setTimeout(() => {
      if (!this.dashMap) return;
      this.dashMap.invalidateSize();
      this._fitDashboardMap(locId);
    }, 350);
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

  //     REALTIME    
  initRealtime() {
    this.populateLocationSelect('rt-location-select', () => this.onRtLocChange());
    this.onRtLocChange();
  },
  onRtLocChange() {
    const locId = document.getElementById('rt-location-select').value;
    const devs = DataRepository.listDevices().filter(d => d.type.startsWith('sensor') && (locId==='all' || d.locationId===locId));
    const sel = document.getElementById('rt-device-select');
    sel.innerHTML = devs.map(d => `<option value="${d.id}">${d.name}${d.type==='sensor_soil_api'?' \u2601\ufe0f':''}</option>`).join('');
    if (!devs.length) {
      sel.innerHTML = '<option value="">\uff08\u65e0\u4f20\u611f\u5668\uff09</option>';
      document.getElementById('sensor-grid').innerHTML = '<div class="empty-state" style="grid-column:1/-1"><i class="fa-solid fa-wave-square"></i><p>\u6682\u65e0\u53ef\u663e\u793a\u7684\u5b9e\u65f6\u4f20\u611f\u5668</p></div>';
      document.getElementById('rt-table-body').innerHTML = '';
      this.stopLive();
      return;
    }
    sel.onchange = () => this.startLive(sel.value);
    this.startLive(devs[0].id);
  },
  startLive(id) {
    this.stopLive();
    this.liveReadings = [];
    this.livePaused = false;
    const dev = DataRepository.listDevices().find(d => d.id === id);
    const pauseBtn = document.getElementById('live-pause-btn');
    const liveBadge = document.getElementById('rt-live-badge');
    const refreshBtn = document.getElementById('rt-refresh-btn');

    if (dev?.type === 'sensor_soil_api') {
      // Cloud device: single fetch, no polling interval
      if (pauseBtn) pauseBtn.style.display = 'none';
      if (liveBadge) liveBadge.style.display = 'none';
      if (refreshBtn) { refreshBtn.style.display = ''; refreshBtn.dataset.deviceId = id; }
      this._renderApiDeviceRealtime(dev);
    } else {
      // Simulated device: 3-second tick for demo
      if (pauseBtn) { pauseBtn.style.display = ''; pauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i> \u6682\u505c\u8bb0\u5f55'; pauseBtn.classList.remove('paused'); }
      if (liveBadge) liveBadge.style.display = '';
      if (refreshBtn) refreshBtn.style.display = 'none';
      this.updateSensors(id);
      this.liveInterval = setInterval(() => { this.updateSensors(id); this.renderAlerts(); this.updateSidebarStatus(); }, 3000);
    }
  },
  stopLive() { if (this.liveInterval) { clearInterval(this.liveInterval); this.liveInterval = null; } },
  toggleLivePause() {
    this.livePaused = !this.livePaused;
    const btn = document.getElementById('live-pause-btn');
    if (btn) {
      btn.innerHTML = this.livePaused
        ? '<i class="fa-solid fa-play"></i> \u6062\u590d\u8bb0\u5f55'
        : '<i class="fa-solid fa-pause"></i> \u6682\u505c\u8bb0\u5f55';
      btn.classList.toggle('paused', this.livePaused);
    }
  },
  refreshApiDevice() {
    const id = document.getElementById('rt-refresh-btn')?.dataset.deviceId;
    if (!id) return;
    const dev = DataRepository.listDevices().find(d => d.id === id);
    if (dev?.type === 'sensor_soil_api') this._renderApiDeviceRealtime(dev, { force: true });
  },

  // Simulated sensor tick  - cloud API devices use _renderApiDeviceRealtime instead
  updateSensors(deviceId) {
    const dev = DataRepository.listDevices().find(d => d.id === deviceId);
    if (!dev || dev.type === 'sensor_soil_api') return;

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
      ? [{ key:'pest', icon:'\ud83e\udd9f', name:'\u4eca\u65e5\u6355\u83b7\u91cf', unit:'\u5934', min:0, max:50, warn:10, crit:20, color:'#ef4444' }]
      : [
          { key:'temp',  icon:'\ud83c\udf21\ufe0f', name:'\u7a7a\u6c14\u6e29\u5ea6', unit:'\u00b0C',  min:5,  max:45,   warn:35,   crit:40,   color:'#f59e0b' },
          { key:'humid', icon:'\ud83d\udca7', name:'\u7a7a\u6c14\u6e7f\u5ea6', unit:'%',   min:0,  max:100,  warn:null, crit:null, color:'#3b82f6' },
          { key:'soil',  icon:'\ud83c\udf31', name:'\u571f\u58e4\u6e7f\u5ea6', unit:'%',   min:0,  max:100,  warn:25,   crit:15,   color:'#10b981', invert:true },
          { key:'light', icon:'\u2600\ufe0f', name:'\u5149\u7167\u5f3a\u5ea6', unit:'lux', min:0,  max:80000,warn:null, crit:null, color:'#eab308' },
          { key:'co2',   icon:'\ud83c\udf2b\ufe0f', name:'CO\u2082\u6d53\u5ea6', unit:'ppm', min:350,max:1200, warn:800,  crit:1000, color:'#8b5cf6' },
          { key:'wind',  icon:'\ud83c\udf2c\ufe0f', name:'\u98ce\u901f',    unit:'m/s', min:0,  max:20,   warn:null, crit:null, color:'#64748b' },
        ];

    document.getElementById('sensor-grid').innerHTML = sensors.map(s => {
      const v = data[s.key];
      const pct = Math.min(100, Math.max(0, ((v-s.min)/(s.max-s.min))*100));
      let cls='', st='\u6b63\u5e38', sc='var(--success)';
      if (s.invert) {
        if (s.crit && v <= s.crit) { cls='alert-danger'; st='\u6781\u5ea6\u7f3a\u6c34'; sc='var(--danger)'; }
        else if (s.warn && v <= s.warn) { cls='alert-warning'; st='\u5efa\u8bae\u704c\u6e89'; sc='var(--warning)'; }
      } else {
        if (s.crit && v >= s.crit) { cls='alert-danger'; st='\u4e25\u91cd\u8d85\u6807'; sc='var(--danger)'; }
        else if (s.warn && v >= s.warn) { cls='alert-warning'; st='\u6ce8\u610f'; sc='var(--warning)'; }
      }
      return `<div class="sensor-card ${cls}">
        <div class="sensor-icon">${s.icon}</div>
        <div class="sensor-name">${s.name}</div>
        <div class="sensor-value">${s.key==='light'?(v/1000).toFixed(1)+'<span class="sensor-unit">klux</span>':v.toFixed(s.key==='pest'?0:1)+'<span class="sensor-unit">'+s.unit+'</span>'}</div>
        <div class="sensor-status" style="color:${sc}">\u25cf ${st}</div>
        <div class="sensor-bar"><div class="sensor-bar-fill" style="width:${pct}%;background:${s.color}"></div></div>
      </div>`;
    }).join('');

    const thead = document.querySelector('#page-realtime .data-table thead tr');
    if (thead) {
      thead.innerHTML = '<th>\u65f6\u95f4</th><th>\u8bbe\u5907</th><th>\u7a7a\u6c14\u6e29\u5ea6 (\u00b0C)</th><th>\u7a7a\u6c14\u6e7f\u5ea6 (%)</th><th>\u571f\u58e4\u6e7f\u5ea6 (%)</th><th>\u5149\u7167\u5f3a\u5ea6 (lux)</th><th>CO\u2082 (ppm)</th>';
    }

    document.getElementById('rt-table-body').innerHTML = this.liveReadings.slice(0,10).map(r => `
      <tr><td style="font-family:'JetBrains Mono';font-size:12px">${r.time}</td><td>${r.device}</td>
      <td>${r.temp?.toFixed(1)??'-'}</td><td>${r.humid?.toFixed(1)??'-'}</td><td>${r.soil?.toFixed(1)??'-'}</td>
      <td>${r.light?(r.light/1000).toFixed(1)+'k':'-'}</td><td>${r.co2?.toFixed(0)??'-'}</td></tr>`).join('');
  },

  // Fetch latest + last 10 readings for a cloud API device and render them
  async _renderApiDeviceRealtime(dev, options = {}) {
    const grid = document.getElementById('sensor-grid');
    const addr = String(dev.apiConfig?.deviceAddr || '');
    const force = options.force === true;

    if (force) {
      if (grid) grid.innerHTML = `
        <div class="cloud-loading" style="grid-column:1/-1">
          <div class="cloud-spinner"></div>
          <div>\u6b63\u5728\u83b7\u53d6\u4f20\u611f\u5668\u6570\u636e...</div>
        </div>`;
    }
    try {
      let rtData;
      let rows;

      if (force) {
        // Sequential: wait for force fetch to save to DB before reading history
        rtData = await BackendAdapter.getDeviceRealtime(dev.id, { force: true });
        const freshHist = await BackendAdapter.getDeviceHistory(dev.id);
        rows = freshHist?.rows || [];
        if (rtData) Store.updateDeviceRealtime(dev.id, rtData);
        Store.updateDeviceHistoryRows(dev.id, rows);
      } else {
        rtData = Store.getDeviceRealtime(dev.id) || { ok: false };
        rows = Store.getDeviceHistoryRows(dev.id) || [];
      }

      const lastReadings = rows.slice(-10).reverse();

      if (rtData?.ok && rtData?.dataItems?.length) {
        this._renderApiSensorCards(dev, rtData);
      } else if (lastReadings.length) {
        const latest = lastReadings[0];
        const timeStr = new Date(latest.ts || latest.deviceTimestamp || 0).toLocaleString('zh-CN');
        if (grid) grid.innerHTML = `
          <div style="grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;padding:0 4px">
            <div class="api-data-timestamp"><i class="fa-solid fa-cloud"></i> \u5728\u7ebf\u4f20\u611f\u5668 \u00b7 \u8bbe\u5907 ${addr}</div>
            <div class="api-data-timestamp"><i class="fa-solid fa-clock"></i> \u6700\u8fd1\u66f4\u65b0 ${timeStr}</div>
          </div>
          ${this._buildSensorCardsFromValues(latest.values || {})}`;
      } else {
        if (grid) grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><i class="fa-solid fa-database"></i><p>\u6682\u65e0\u6570\u636e\uff0c\u8bf7\u7a0d\u5019\u540e\u7aef\u91c7\u96c6\u5668\u8fd0\u884c\u540e\u91cd\u8bd5</p></div>';
      }
      this._renderApiReadingsTable(dev, lastReadings);
    } catch (err) {
      console.warn('[Realtime API]', err.message);
      if (grid) grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><i class="fa-solid fa-circle-exclamation"></i><p>\u52a0\u8f7d\u5931\u8d25: ${err.message}</p></div>`;
    }
  },

  // Render sensor cards from a realtime response (has dataItems with full register info)
  _renderApiSensorCards(dev, rtData) {
    const grid = document.getElementById('sensor-grid');
    if (!grid) return;
    const addr = String(dev.apiConfig?.deviceAddr || '');
    const timeStr = rtData.deviceTimestamp ? new Date(rtData.deviceTimestamp).toLocaleString('zh-CN') : '--';
    const allRegisters = [];
    (rtData.dataItems || []).forEach(node => {
      (node.registerItem || []).forEach(reg => allRegisters.push({ ...reg }));
    });
    if (!allRegisters.length) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><i class="fa-solid fa-database"></i><p>\u5f53\u524d\u8bbe\u5907\u6682\u65e0\u53ef\u5c55\u793a\u7684\u5b9e\u65f6\u6570\u636e</p></div>';
      return;
    }
    const ICONS = { '\u6e29\u5ea6':'\ud83c\udf21\ufe0f','\u6e7f\u5ea6':'\ud83d\udca7','PH':'\ud83e\uddea','\u7535\u5bfc\u7387':'\u26a1','\u6c2e':'\ud83d\udfe2','\u78f7':'\ud83d\udfe1','\u94be':'\ud83d\udfe0','\u5149\u7167':'\u2600\ufe0f','\u542b\u6c34\u7387':'\ud83d\udca6','\u76d0\u5206':'\ud83e\uddc2' };
    const COLORS = { '\u6e29\u5ea6':'#f59e0b','\u6e7f\u5ea6':'#3b82f6','PH':'#8b5cf6','\u7535\u5bfc\u7387':'#10b981','\u6c2e':'#22c55e','\u78f7':'#eab308','\u94be':'#f97316' };
    const cards = allRegisters.map(reg => {
      const v = reg.value ?? 0;
      const alarmCls = reg.alarmLevel > 0 ? (reg.alarmLevel >= 3 ? 'alert-danger' : 'alert-warning') : '';
      const alarmSt = reg.alarmLevel > 0 ? (reg.alarmLevel >= 3 ? '\u62a5\u8b66' : '\u9884\u8b66') : '\u6b63\u5e38';
      const alarmColor = reg.alarmLevel > 0 ? (reg.alarmLevel >= 3 ? 'var(--danger)' : 'var(--warning)') : 'var(--success)';
      return `<div class="sensor-card ${alarmCls}">
        <div class="sensor-icon">${ICONS[reg.registerName] || '\ud83d\udcca'}</div>
        <div class="sensor-name">${reg.registerName}</div>
        <div class="sensor-value">${typeof v === 'number' ? v.toFixed(1) : v}<span class="sensor-unit">${reg.unit || ''}</span></div>
        <div class="sensor-status" style="color:${alarmColor}">\u25cf ${alarmSt}</div>
        <div class="sensor-bar"><div class="sensor-bar-fill" style="width:50%;background:${COLORS[reg.registerName] || '#64748b'}"></div></div>
      </div>`;
    }).join('');
    grid.innerHTML = `
      <div style="grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;padding:0 4px">
        <div class="api-data-timestamp"><i class="fa-solid fa-cloud"></i> \u5728\u7ebf\u4f20\u611f\u5668 \u00b7 \u8bbe\u5907 ${addr}</div>
        <div class="api-data-timestamp"><i class="fa-solid fa-clock"></i> \u6570\u636e\u65f6\u95f4 ${timeStr}</div>
      </div>${cards}`;
  },

  // Build sensor cards from a flat { name: value } map (used as fallback)
  _buildSensorCardsFromValues(values) {
    const ICONS = { '\u6e29\u5ea6':'\ud83c\udf21\ufe0f','\u6e7f\u5ea6':'\ud83d\udca7','PH':'\ud83e\uddea','\u7535\u5bfc\u7387':'\u26a1','\u6c2e':'\ud83d\udfe2','\u78f7':'\ud83d\udfe1','\u94be':'\ud83d\udfe0','\u5149\u7167':'\u2600\ufe0f','\u542b\u6c34\u7387':'\ud83d\udca6' };
    const COLORS = { '\u6e29\u5ea6':'#f59e0b','\u6e7f\u5ea6':'#3b82f6','PH':'#8b5cf6','\u7535\u5bfc\u7387':'#10b981','\u6c2e':'#22c55e','\u78f7':'#eab308','\u94be':'#f97316' };
    return Object.entries(values).map(([name, v]) => `
      <div class="sensor-card">
        <div class="sensor-icon">${ICONS[name] || '\ud83d\udcca'}</div>
        <div class="sensor-name">${name}</div>
        <div class="sensor-value">${typeof v === 'number' ? v.toFixed(1) : v}<span class="sensor-unit"></span></div>
        <div class="sensor-status" style="color:var(--success)">\u25cf \u6b63\u5e38</div>
        <div class="sensor-bar"><div class="sensor-bar-fill" style="width:50%;background:${COLORS[name] || '#64748b'}"></div></div>
      </div>`).join('');
  },

  // Render the last-N-readings table for a cloud API device
  _renderApiReadingsTable(dev, readings) {
    const colSet = new Set();
    readings.forEach(r => Object.keys(r.values || {}).forEach(k => colSet.add(k)));
    const cols = Array.from(colSet).sort();
    const thead = document.querySelector('#page-realtime .data-table thead tr');
    if (thead) thead.innerHTML = '<th>\u65f6\u95f4</th><th>\u8bbe\u5907</th>' + cols.map(c => `<th>${c}</th>`).join('');
    const tbody = document.getElementById('rt-table-body');
    if (!tbody) return;
    if (!readings.length) {
      tbody.innerHTML = `<tr><td colspan="${2 + cols.length}" style="text-align:center;padding:30px;color:var(--text-muted)">\u6682\u65e0\u5386\u53f2\u8bb0\u5f55</td></tr>`;
      return;
    }
    tbody.innerHTML = readings.map(r => {
      const time = new Date(r.ts || r.deviceTimestamp || 0).toLocaleString('zh-CN');
      return `<tr><td style="font-family:'JetBrains Mono';font-size:12px">${time}</td><td>${dev.name}</td>${cols.map(c => `<td>${r.values[c] !== undefined ? r.values[c] : '-'}</td>`).join('')}</tr>`;
    }).join('');
  },

  //     VIDEO
  renderVideo() {
    const cams = DataRepository.listDevices().filter(d => d.type==='camera');
    const locMap = Object.fromEntries(DataRepository.listLocations().map(l=>[l.id,l.name]));
    const g = document.getElementById('video-grid');
    if (!cams.length) { g.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><i class="fa-solid fa-video-slash"></i><p>\u6682\u65e0\u6444\u50cf\u5934\u8bbe\u5907</p></div>'; return; }
    g.innerHTML = cams.map(c => `
      <div class="video-slot">
        <div class="video-slot-header"><span><i class="fa-solid fa-video" style="color:var(--accent);margin-right:6px"></i>${c.name}</span>
          <span class="badge ${c.online?'badge-online':'badge-offline'}">${c.online?'\u5728\u7ebf':'\u79bb\u7ebf'}</span></div>
        <div class="video-slot-body"><i class="fa-solid fa-${c.online?'circle-play':'video-slash'}"></i><p>${c.online&&c.streamUrl?'\u63a5\u53e3\u9884\u7559: \u89c6\u9891\u6d41\u5f85\u63a5\u5165':c.online?'\u672a\u914d\u7f6e\u6d41\u5730\u5740':'\u8bbe\u5907\u79bb\u7ebf'}</p></div>
        ${c.streamUrl?`<div class="video-src"><i class="fa-solid fa-link" style="margin-right:4px"></i>${c.streamUrl}</div>`:''}
      </div>`).join('');
  },

  //     HISTORY    
  initHistory() {
    this.populateLocationSelect('hist-location-select', () => this._populateHistDevices());
    document.getElementById('hist-device-select').onchange = () => this.refreshHistoryCharts();
    const rangeSelect = document.getElementById('hist-range');
    if (rangeSelect && rangeSelect.dataset.autoBound !== '1') {
      rangeSelect.dataset.autoBound = '1';
      rangeSelect.onchange = () => this.refreshHistoryCharts();
    }
    const queryBtn = document.querySelector('#page-history button[onclick="app.refreshHistoryCharts()"]');
    if (queryBtn) queryBtn.remove();
    this._populateHistDevices();
  },

  _populateHistDevices() {
    const locId = document.getElementById('hist-location-select')?.value || 'all';
    const devs = DataRepository.listDevices().filter(d => d.type.startsWith('sensor') && (locId === 'all' || d.locationId === locId));
    const sel = document.getElementById('hist-device-select');
    if (!sel) return;
    sel.innerHTML = devs.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
    this.refreshHistoryCharts();
  },
  async refreshHistoryCharts() {
    if (this._historyLoading) {
      this._historyRefreshQueued = true;
      return;
    }
    this._historyLoading = true;
    try {
    const range = document.getElementById('hist-range')?.value || '24h';
    const deviceId = document.getElementById('hist-device-select')?.value;
    const device = DataRepository.listDevices().find(item => item.id === deviceId);
    const grid = document.getElementById('hist-chart-grid');
    if (!grid) return;

    // Load history rows: { ts, values: { channelName: value } }
    let rows = [];
    if (device?.type === 'sensor_soil_api') {
      rows = Store.getDeviceHistoryRows(deviceId) || [];
    } else {
      rows = deviceId ? HistoryStore.getDeviceRecords(deviceId) : [];
    }
    const rangeMs = range === '24h' ? 24 * 3_600_000 : range === '7d' ? 7 * 86_400_000 : 30 * 86_400_000;
    const cutoff = Date.now() - rangeMs;
    rows = rows
      .map(r => ({ ...r, _ts: Number(r.ts || r.deviceTimestamp || r.timestamp || 0) }))
      .filter(r => r._ts && r._ts >= cutoff)
      .sort((a, b) => a._ts - b._ts);

    // Collect unique channel names present in history
    const channelSet = new Set();
    rows.forEach(r => Object.keys(r.values || {}).forEach(k => channelSet.add(k)));
    let channels = Array.from(channelSet).sort();

    // Display name map for simulated device channels
    const PARAM_DISPLAY = {
      temp: '\u7a7a\u6c14\u6e29\u5ea6 (\u00b0C)', humid: '\u7a7a\u6c14\u6e7f\u5ea6 (%)',
      soil: '\u571f\u58e4\u6e7f\u5ea6 (%)', light: '\u5149\u7167\u5f3a\u5ea6 (lux)',
      co2: 'CO\u2082 (ppm)', wind: '\u98ce\u901f (m/s)', pest: '\u866b\u5bb3\u6355\u83b7\u91cf',
    };

    // Fallback channels when history is empty
    if (!channels.length) {
      if (!deviceId || device?.type === 'sensor_soil_api') {
        const msg = !deviceId
          ? '\u8bf7\u9009\u62e9\u8bbe\u5907'
          : '\u6682\u65e0\u5386\u53f2\u8bb0\u5f55\uff0c\u8bf7\u5148\u8865\u5145\u4e91\u7aef\u6570\u636e';
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><i class="fa-solid fa-database"></i><p>${msg}</p></div>`;
        return;
      }
      // Simulated device defaults
      channels = device?.type === 'sensor_pest'
        ? ['pest']
        : ['temp', 'humid', 'soil', 'light', 'co2', 'wind'];
    }

    const labels = rows.length
      ? rows.map(r => new Date(r._ts).toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }))
      : [];

    // Draw one chart point per real reading. No hourly averaging.
    const pointData = (key) => {
      return rows.map(r => {
        const value = r.values?.[key];
        if (value === undefined || value === null || value === '') return null;
        const num = Number(value);
        return Number.isFinite(num) ? Number(num.toFixed(1)) : null;
      });
    };

    // Generate plausible placeholder series for devices with no history yet
    const simulatedFallback = (key) => {
      const pts = range === '24h' ? 24 : range === '7d' ? 7 : 30;
      const SIMS = {
        temp: { base: 28, amp: 8 }, humid: { base: 65, amp: 20 },
        soil: { base: 50, amp: 20 }, light: { base: 25000, amp: 20000 },
        co2:  { base: 480, amp: 80 }, wind: { base: 3, amp: 2 },
        pest: { base: 5, amp: 5 },
      };
      const { base = 50, amp = 10 } = SIMS[key] || {};
      return Array.from({ length: pts }, (_, i) =>
        +(base + Math.sin(i * 0.4) * amp * 0.5 + (Math.random() - 0.5) * amp).toFixed(1)
      );
    };

    const PALETTE = ['#f59e0b','#3b82f6','#10b981','#eab308','#8b5cf6','#ef4444','#f97316','#06b6d4','#84cc16','#ec4899'];
    const hexBg = (hex) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r},${g},${b},0.07)`;
    };

    // Destroy all old chart instances under hist- prefix
    Object.keys(ChartHelper._i || {}).filter(k => k.startsWith('hist-')).forEach(k => ChartHelper.destroy(k));

    // Rebuild chart grid dynamically  - one panel per channel
    grid.innerHTML = channels.map((ch, i) => `
      <div class="glass-panel">
        <div class="panel-header"><span class="panel-title">${PARAM_DISPLAY[ch] || ch}</span></div>
        <div class="chart-wrap"><canvas id="hist-ch-${i}"></canvas></div>
      </div>`).join('');

    channels.forEach((ch, i) => {
      const color = PALETTE[i % PALETTE.length];
      const data = rows.length ? pointData(ch) : simulatedFallback(ch);
      const chartLabels = rows.length ? labels : Array.from({ length: data.length }, (_, idx) => String(idx + 1));
      ChartHelper.line('hist-ch-' + i, chartLabels, [{
        label: PARAM_DISPLAY[ch] || ch,
        data,
        borderColor: color,
        backgroundColor: hexBg(color),
        tension: 0.4,
        fill: true,
        spanGaps: true,
      }]);
    });
    } finally {
      this._historyLoading = false;
      if (this._historyRefreshQueued) {
        this._historyRefreshQueued = false;
        setTimeout(() => this.refreshHistoryCharts(), 0);
      }
    }
  },

  //     PEST DB    
  renderPests(search='',type='all') {
    const q = (document.getElementById('pest-search')?.value||search).trim().toLowerCase();
    const t = document.getElementById('pest-type-filter')?.value||type;
    const filtered = PEST_DB.filter(p => (!q||p.name.includes(q)||p.latin.toLowerCase().includes(q)) && (t==='all'||p.type===t));
    document.getElementById('pest-grid').innerHTML = filtered.length===0
      ? '<div class="empty-state" style="grid-column:1/-1"><i class="fa-solid fa-magnifying-glass"></i><p>\u672a\u627e\u5230\u76f8\u5173\u8bb0\u5f55</p></div>'
      : filtered.map(p=>`
        <div class="pest-card" onclick="app.showPestDetail('${p.id}')">
          <div class="pest-img">${p.emoji}</div>
          <div class="pest-info"><div class="pest-name">${p.name}</div><div class="pest-latin">${p.latin}</div>
          <div class="pest-tags"><span class="pest-tag">${p.type==='pest'?'\u866b\u5bb3':'\u75c5\u5bb3'}</span>
          <span class="pest-tag ${p.severity==='high'?'danger-tag':''}">${p.severity==='high'?'\u9ad8\u98ce\u9669':'\u4e2d\u7b49'}</span>
          ${p.crops.map(c=>`<span class="pest-tag">${c}</span>`).join('')}</div></div>
        </div>`).join('');
  },
  filterPests(v) { this.renderPests(v); },
  showPestDetail(id) {
    const p = PEST_DB.find(x=>x.id===id); if(!p) return;
    document.getElementById('pest-modal-title').textContent = `${p.emoji} ${p.name}`;
    document.getElementById('pest-modal-body').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:12px">
        <div class="form-group"><label>\u5b66\u540d</label><div style="font-style:italic;color:var(--text-secondary)">${p.latin}</div></div>
        <div class="form-group"><label>\u7c7b\u578b</label><div>${p.type==='pest'?'\u866b\u5bb3':'\u75c5\u5bb3'}</div></div>
        <div class="form-group"><label>\u5371\u5bb3\u7b49\u7ea7</label><div style="color:${p.severity==='high'?'var(--danger)':'var(--warning)'}">\u25cf ${p.severity==='high'?'\u9ad8\u98ce\u9669':'\u4e2d\u7b49'}</div></div>
        <div class="form-group"><label>\u9ad8\u53d1\u5b63\u8282</label><div>${p.season}</div></div>
        <div class="form-group"><label>\u5371\u5bb3\u4f5c\u7269</label><div>${p.crops.join('\u3001')}</div></div>
        <div class="form-group"><label>\u9632\u6cbb\u9608\u503c</label><div style="color:var(--warning)">${p.threshold}</div></div>
      </div>
      <div class="form-group"><label>\u4e3a\u5bb3\u75c7\u72b6</label><div style="color:var(--text-secondary);line-height:1.7">${p.symptoms}</div></div>
      <div class="form-group" style="margin-top:8px"><label>\u519c\u4e1a\u9632\u6cbb</label><div style="color:var(--text-secondary);line-height:1.7">${p.prevention}</div></div>
      <div class="form-group" style="margin-top:8px"><label>\u836f\u5242\u9632\u6cbb</label><div style="color:var(--text-secondary);line-height:1.7">${p.control}</div></div>`;
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
          }).join(' \u4e14 ');
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
              result: '\u2705 \u5df2\u6267\u884c (\u6a21\u62df)',
            });
            if (log.length > 50) log.pop();
            DataRepository.saveAutoLog(log);
            console.log(`[\u81ea\u52a8\u5316] ${rule.name}: ${condDesc} \u2192 ${actDesc} (Modbus ${act.action==='on'?'0xFF00':'0x0000'})`);
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
      list.innerHTML = '<div class="empty-state"><i class="fa-solid fa-wand-magic-sparkles"></i><p>\u6682\u65e0\u81ea\u52a8\u5316\u89c4\u5219\uff0c\u70b9\u51fb\u4e0a\u65b9\u6309\u94ae\u521b\u5efa</p></div>';
    } else {
      list.innerHTML = rules.map(rule => {
        const condBlocks = rule.conditions.map(c => `
          <div class="flow-block"><div class="flow-block-label if-label">\u6761\u4ef6</div>
            <div class="flow-block-value">${devMap[c.sourceDeviceId]||'?'}</div>
            <div style="font-size:11px;color:var(--text-muted)">${PARAM_LABELS[c.param]||c.param} ${OP_LABELS[c.operator]||c.operator} ${c.value}</div>
          </div>`).join('<div class="flow-arrow"><i class="fa-solid fa-plus" style="font-size:10px"></i></div>');
        const actBlocks = rule.actions.map(a => `
          <div class="flow-block"><div class="flow-block-label then-label">\u52a8\u4f5c</div>
            <div class="flow-block-value">${devMap[a.targetDeviceId]||'?'}</div>
            <div style="font-size:11px;color:var(--text-muted)">${ACTION_LABELS[a.action]||a.action}</div>
          </div>`).join('');
        return `
          <div class="auto-rule-card ${rule.enabled?'':'disabled'}">
            <div class="auto-rule-header">
              <div class="auto-rule-name"><i class="fa-solid fa-bolt" style="color:var(--warning)"></i> ${rule.name}</div>
              <div class="action-row">
                <button class="btn-icon" title="\u7f16\u8f91" onclick="app.editAutomation('${rule.id}')"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-icon delete" title="\u5220\u9664" onclick="app.confirmDelete('automation','${rule.id}')"><i class="fa-solid fa-trash"></i></button>
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
              <span style="font-size:12px;color:var(--text-muted)">${rule.enabled?'\u89c4\u5219\u5df2\u542f\u7528':'\u89c4\u5219\u5df2\u505c\u7528'}</span>
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
      ? '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-muted)">\u6682\u65e0\u6267\u884c\u8bb0\u5f55</td></tr>'
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

  //     Automation Editor    
  openAutomationEditor(editId) {
    this._tempConditions = [];
    this._tempActions = [];
    document.getElementById('auto-edit-id').value = '';
    document.getElementById('auto-name').value = '';
    document.getElementById('auto-desc').value = '';
    document.getElementById('modal-auto-title').textContent = '\u65b0\u5efa\u81ea\u52a8\u5316\u89c4\u5219';

    if (editId) {
      const rule = DataRepository.listAutomations().find(r=>r.id===editId);
      if (rule) {
        document.getElementById('auto-edit-id').value = rule.id;
        document.getElementById('auto-name').value = rule.name;
        document.getElementById('auto-desc').value = rule.desc || '';
        document.getElementById('modal-auto-title').textContent = '\u7f16\u8f91\u81ea\u52a8\u5316\u89c4\u5219';
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
          ${!ctrls.length?'<option value="">\uff08\u65e0\u63a7\u5236\u5668\u8bbe\u5907\uff09</option>':''}
        </select>
        <select onchange="app._tempActions[${i}].action=this.value">
          <option value="on" ${a.action==='on'?'selected':''}>\u5f00\u542f</option>
          <option value="off" ${a.action==='off'?'selected':''}>\u5173\u95ed</option>
        </select>
        <button class="remove-row-btn" onclick="app._tempActions.splice(${i},1);app.renderActionRows()"><i class="fa-solid fa-xmark"></i></button>
      </div>`).join('');
  },

  saveAutomation() {
    const name = document.getElementById('auto-name').value.trim();
    if (!name) { UI.toast('\u8bf7\u586b\u5199\u89c4\u5219\u540d\u79f0', 'warning'); return; }
    if (!this._tempConditions.length) { UI.toast('\u8bf7\u81f3\u5c11\u6dfb\u52a0\u4e00\u4e2a\u89e6\u53d1\u6761\u4ef6', 'warning'); return; }
    if (!this._tempActions.length) { UI.toast('\u8bf7\u81f3\u5c11\u6dfb\u52a0\u4e00\u4e2a\u6267\u884c\u52a8\u4f5c', 'warning'); return; }

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
    UI.toast('\u81ea\u52a8\u5316\u89c4\u5219\u5df2\u4fdd\u5b58', 'success');
  },

  //     LOCATIONS    
  renderLocations() {
    const locs = DataRepository.listLocations();
    const devices = DataRepository.listDevices();
    const g = document.getElementById('location-grid');
    if (!locs.length) { g.innerHTML = '<div class="empty-state"><i class="fa-solid fa-map"></i><p>\u6682\u65e0\u5730\u5757</p></div>'; return; }
    g.innerHTML = locs.map(loc => {
      const devs = devices.filter(d=>d.locationId===loc.id);
      const ti = { sensor_env:'\ud83c\udf21\ufe0f', sensor_soil:'\ud83c\udf31', sensor_pest:'\ud83e\udd9f', camera:'\ud83d\udcf9', controller_water:'\ud83d\udca7', controller_light:'\ud83d\udca1', controller_fan:'\ud83c\udf00' };
      return `<div class="location-card">
        <div class="location-card-header"><div><div class="location-name">${loc.name}</div><div class="location-type">${loc.type}</div></div>
          <div class="action-row"><button class="btn-icon" onclick="app.editLocation('${loc.id}')"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-icon delete" onclick="app.confirmDelete('location','${loc.id}')"><i class="fa-solid fa-trash"></i></button></div></div>
        <div class="location-stats">
          <div class="loc-stat"><div class="loc-stat-value" style="color:var(--accent)">${loc.area||'-'}</div><div class="loc-stat-label">\u4ea9</div></div>
          <div class="loc-stat"><div class="loc-stat-value" style="color:var(--success)">${devs.length}</div><div class="loc-stat-label">\u53f0\u8bbe\u5907</div></div>
        </div>
        <div class="location-devices">${devs.map(d=>`<span class="badge badge-sensor">${ti[d.type]||'\ud83d\udce1'} ${d.name}</span>`).join('')||'<span style="color:var(--text-muted);font-size:12px">\u6682\u65e0\u8bbe\u5907</span>'}</div>
        ${loc.notes?`<div style="font-size:12px;color:var(--text-muted);border-top:1px solid var(--border);padding-top:10px">${loc.notes}</div>`:''}
      </div>`;
    }).join('');
  },
  openModal(t) {
    const el = document.getElementById(t) || document.getElementById('modal-'+t);
    if (!el) return;
    el.style.display = '';
    el.classList.add('open');
    if (el.id === 'modal-record-detail') document.body.style.overflow = 'hidden';
    if (t === 'location') setTimeout(() => this.initLocMapPicker(), 200);
    if (t === 'device') setTimeout(() => this.initDevMapPicker(), 200);
  },
  closeModal(t) {
    const el = document.getElementById(t) || document.getElementById('modal-'+t);
    if (!el) return;
    el.classList.remove('open');
    if (document.getElementById(t)) el.style.display = 'none';
    if (el.id === 'modal-record-detail') document.body.style.overflow = '';
    if (t === 'location') this._destroyPickerMap('loc');
    if (t === 'device') this._destroyPickerMap('dev');
  },
  saveLocation() {
    const id = document.getElementById('loc-edit-id').value || 'loc-'+uid();
    const name = document.getElementById('loc-name').value.trim();
    if (!name) { UI.toast('\u8bf7\u586b\u5199\u5730\u5757\u540d\u79f0', 'warning'); return; }
    const loc = { id, name, type:document.getElementById('loc-type').value,
      lat:parseFloat(document.getElementById('loc-lat').value)||0,
      lng:parseFloat(document.getElementById('loc-lng').value)||0,
      area:parseInt(document.getElementById('loc-area').value)||0,
      notes:document.getElementById('loc-notes').value.trim() };
    DataRepository.saveLocation(loc);
    this.closeModal('location'); this.clearLocationForm(); this.renderLocations(); this.updateSidebarStatus();
    if (this.currentPage === 'dashboard') this.initDashboard();
    UI.toast('\u5730\u5757\u5df2\u4fdd\u5b58', 'success');
  },
  editLocation(id) {
    const loc = DataRepository.listLocations().find(l=>l.id===id); if(!loc) return;
    document.getElementById('modal-location-title').textContent = '\u7f16\u8f91\u5730\u5757';
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
    document.getElementById('modal-location-title').textContent = '\u6dfb\u52a0\u65b0\u5730\u5757';
    ['loc-edit-id','loc-name','loc-lat','loc-lng','loc-area','loc-notes'].forEach(id=>document.getElementById(id).value='');
  },

  //     DEVICES    
  renderDevices() {
    const filt = document.getElementById('dev-location-filter')?.value||'all';
    const locs = DataRepository.listLocations();
    const locMap = Object.fromEntries(locs.map(l=>[l.id,l.name]));
    const devices = DataRepository.listDevices().filter(d=>filt==='all'||d.locationId===filt);
    const modeMeta = BackendAdapter.getModeMeta();
    const health = BackendAdapter.getHealthSnapshot();
    const filterSel = document.getElementById('dev-location-filter');
    if(filterSel){ const cur=filterSel.value; filterSel.innerHTML=`<option value="all">\u5168\u90e8\u5730\u5757</option>`+locs.map(l=>`<option value="${l.id}" ${l.id===cur?'selected':''}>${l.name}</option>`).join(''); }
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
          <div class="runtime-banner-actions">
            <div class="runtime-banner-meta">\u540e\u7aef\u63a5\u53e3\u9884\u7559: ${endpointMap.devices}</div>
            <button class="btn-ghost btn-sm" onclick="app.toggleDemoMode(${!DataRepository.getRuntimeConfig().demoMode})">
              ${DataRepository.getRuntimeConfig().demoMode ? '\u5173\u95ed\u6f14\u793a\u6a21\u5f0f' : '\u5f00\u542f\u6f14\u793a\u6a21\u5f0f'}
            </button>
          </div>
        </div>
      `);
    }
    const tl = { sensor_env:['\ud83c\udf21\ufe0f \u73af\u5883\u4f20\u611f\u5668','badge-sensor'], sensor_soil:['\ud83c\udf31 \u571f\u58e4\u4f20\u611f\u5668','badge-sensor'], sensor_soil_api:['\ud83d\udd17 \u5728\u7ebf\u4f20\u611f\u5668','badge-cloud'],
      sensor_pest:['\ud83e\udd9f \u866b\u60c5\u76d1\u6d4b\u4eea','badge-sensor'], camera:['\ud83d\udcf9 \u6444\u50cf\u5934','badge-camera'],
      controller_water:['\ud83d\udca7 \u704c\u6e89\u63a7\u5236\u5668','badge-ctrl'], controller_light:['\ud83d\udca1 \u8865\u5149\u63a7\u5236\u5668','badge-ctrl'], controller_fan:['\ud83c\udf00 \u98ce\u673a\u63a7\u5236\u5668','badge-ctrl'] };
    document.getElementById('device-tbody').innerHTML = devices.length===0
      ? '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted)">\u6682\u65e0\u8bbe\u5907</td></tr>'
      : devices.map(d=>{
        const [tLabel,tBadge]=tl[d.type]||['\u672a\u77e5','badge-offline'];
        const addrDisplay = d.type === 'sensor_soil_api' && d.apiConfig ? d.apiConfig.deviceAddr : (d.address || '-');
        const protocolDisplay = d.type === 'sensor_soil_api' ? '\u5728\u7ebf\u8bc6\u522b\u63a5\u5165' : d.protocol;
        return `<tr><td><b>${d.name}</b>${d.notes?`<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${d.notes}</div>`:''}</td>
          <td><span class="badge ${tBadge}">${tLabel}</span></td>
          <td>${locMap[d.locationId]||'<span style="color:var(--text-muted)">\u672a\u5206\u914d</span>'}</td>
          <td><code style="font-family:'JetBrains Mono';font-size:12px;color:var(--accent)">${addrDisplay}</code></td>
          <td><span class="badge ${d.type==='sensor_soil_api'?'badge-cloud':'badge-sensor'}">${protocolDisplay}</span></td>
          <td><span class="badge ${d.online?'badge-online':'badge-offline'}">\u25cf ${d.online?'\u5728\u7ebf':'\u79bb\u7ebf'}</span></td>
          <td><div class="action-row"><button class="btn-icon" onclick="app.editDevice('${d.id}')"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-icon delete" onclick="app.confirmDelete('device','${d.id}')"><i class="fa-solid fa-trash"></i></button></div></td></tr>`;
      }).join('');
  },
  openModal_device_prep() {
    const locs = DataRepository.listLocations();
    document.getElementById('dev-location').innerHTML = `<option value="">-- \u672a\u5206\u914d --</option>`+locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('');
  },
  bindDeviceTypeChange() { document.getElementById('dev-type')?.addEventListener('change',function(){ document.getElementById('stream-url-group').style.display=this.value==='camera'?'flex':'none'; }); },
  saveDevice() {
    const id=document.getElementById('dev-edit-id').value||'dev-'+uid();
    const name=document.getElementById('dev-name').value.trim();
    if(!name){UI.toast('\u8bf7\u586b\u5199\u8bbe\u5907\u540d\u79f0', 'warning');return;}
    const existing = DataRepository.listDevices().find(item => item.id === id);
    const addressInput = document.getElementById('dev-address');
    const resolvedAddress = existing?.address || addressInput.value.trim() || id;
    const dev={id,name,type:document.getElementById('dev-type').value,locationId:document.getElementById('dev-location').value,
      address:resolvedAddress,protocol:document.getElementById('dev-protocol').value,
      streamUrl:document.getElementById('dev-stream-url').value.trim(),notes:document.getElementById('dev-notes').value.trim(),
      lat:parseFloat(document.getElementById('dev-lat').value)||0,lng:parseFloat(document.getElementById('dev-lng').value)||0,
      online: existing?.online ?? true,
      apiConfig: existing?.apiConfig ?? null,
      metadata: existing?.metadata ?? {}};
    DataRepository.saveDevice(dev);
    this.closeModal('device'); this.clearDeviceForm(); this.renderDevices(); this.updateSidebarStatus();
    if (this.currentPage === 'dashboard') this.initDashboard();
    UI.toast('\u8bbe\u5907\u5df2\u4fdd\u5b58', 'success');
  },
  editDevice(id) {
    const dev=DataRepository.listDevices().find(d=>d.id===id);if(!dev)return;
    this.openModal_device_prep();
    const addressInput = document.getElementById('dev-address');
    document.getElementById('modal-device-title').textContent='\u7f16\u8f91\u8bbe\u5907';
    document.getElementById('dev-edit-id').value=dev.id;
    document.getElementById('dev-name').value=dev.name;
    document.getElementById('dev-type').value=dev.type;
    document.getElementById('dev-location').value=dev.locationId;
    document.getElementById('dev-address').value=dev.address;
    if (addressInput) addressInput.readOnly = true;
    document.getElementById('dev-protocol').value=dev.protocol;
    document.getElementById('dev-stream-url').value=dev.streamUrl||'';
    document.getElementById('dev-notes').value=dev.notes||'';
    document.getElementById('dev-lat').value=dev.lat||'';
    document.getElementById('dev-lng').value=dev.lng||'';
    document.getElementById('stream-url-group').style.display=dev.type==='camera'?'flex':'none';
    this.openModal('device');
  },
  clearDeviceForm() {
    const addressInput = document.getElementById('dev-address');
    document.getElementById('modal-device-title').textContent='\u6dfb\u52a0\u65b0\u8bbe\u5907';
    ['dev-edit-id','dev-name','dev-address','dev-stream-url','dev-notes','dev-lat','dev-lng'].forEach(id=>document.getElementById(id).value='');
    if (addressInput) addressInput.readOnly = true;
    document.getElementById('stream-url-group').style.display='none';
  },

  //     DELETE    
  confirmDelete(type,id) {
    const msg = { location:'\u786e\u5b9a\u5220\u9664\u8be5\u5730\u5757\uff1f\u5173\u8054\u8bbe\u5907\u5c06\u53d8\u4e3a"\u672a\u5206\u914d"\u3002', device:'\u786e\u5b9a\u5220\u9664\u8be5\u8bbe\u5907\uff1f', automation:'\u786e\u5b9a\u5220\u9664\u8be5\u81ea\u52a8\u5316\u89c4\u5219\uff1f' };
    document.getElementById('confirm-msg').textContent = msg[type]||'\u786e\u5b9a\u5220\u9664\uff1f';
    document.getElementById('confirm-ok-btn').onclick = async () => {
      if(type==='location') this.deleteLocation(id);
      else if(type==='device'){
        DataRepository.deleteDevice(id);
        this.renderDevices();
        try {
          await SyncService.pushNowForced();
        } catch (err) {
          console.warn('[Delete device sync]', err.message);
          UI.toast('\u8bbe\u5907\u5df2\u5220\u9664\uff0c\u4f46\u540e\u7aef\u540c\u6b65\u5931\u8d25: ' + err.message, 'warning');
        }
      }
      else if(type==='automation'){ DataRepository.deleteAutomation(id); this.renderAutomation(); }
      this.closeModal('confirm'); this.updateSidebarStatus();
      if (this.currentPage === 'dashboard') this.initDashboard();
      UI.toast('\u5220\u9664\u6210\u529f', 'success');
    };
    this.openModal('confirm');
  },
  deleteLocation(id) {
    DataRepository.deleteLocation(id);
    this.renderLocations();
  },

  //     MAP PICKERS    
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

  //     HELPERS    
  sanitize(str) {
    if (typeof str !== 'string') return str;
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;', '/': '&#x2f;' };
    return str.replace(/[&<>"'/]/g, s => map[s]);
  },

  populateLocationSelect(selId, onchange) {
    const locs = DataRepository.listLocations();
    const sel = document.getElementById(selId); if(!sel) return;
    sel.innerHTML = `<option value="all">\u6240\u6709\u5730\u5757</option>`+locs.map(l=>`<option value="${l.id}">${l.name}</option>`).join('');
    if(onchange) sel.onchange = onchange;
  },

  async renderAccounts() {
    const body = document.getElementById('account-tbody');
    if (!body) return;
    if (!AuthService.canManageUsers()) {
      body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:36px;color:var(--text-muted)">\u5f53\u524d\u8d26\u53f7\u6ca1\u6709\u7528\u6237\u7ba1\u7406\u6743\u9650</td></tr>';
      return;
    }
    const renderRows = users => users.map(user => {
      const role = user.role === 'platform_admin' ? '\u5e73\u53f0\u7ba1\u7406\u5458' : '\u5ba2\u6237\u7ba1\u7406\u5458';
      const status = user.status === 'disabled' ? '\u5df2\u505c\u7528' : '\u542f\u7528\u4e2d';
      const statusClass = user.status === 'disabled' ? 'badge-offline' : 'badge-online';
      return '<tr>' +
        '<td><b>' + this.sanitize(user.account || '') + '</b><div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + this.sanitize(user.name || '') + '</div></td>' +
        '<td><span class="badge ' + (user.role === 'platform_admin' ? 'badge-cloud' : 'badge-sensor') + '">' + role + '</span></td>' +
        '<td>' + this.sanitize(user.tenantId || '-') + '</td>' +
        '<td><span class="badge ' + statusClass + '">' + status + '</span></td>' +
        '<td>' + (user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('zh-CN') : '-') + '</td>' +
        '<td><div class="action-row"><button class="btn-icon" title="\u7f16\u8f91" onclick="app.openAccountModal(\'' + user.id + '\')"><i class="fa-solid fa-pen"></i></button>' +
        '<button class="btn-icon delete" title="\u5220\u9664" onclick="app.deleteAccount(\'' + user.id + '\')"><i class="fa-solid fa-trash"></i></button></div></td>' +
      '</tr>';
    }).join('');
    const fallbackUser = AuthService.currentUser || { id: 'user_admin', account: 'admin', name: 'Platform Admin', role: 'platform_admin', status: 'active', tenantId: 'tenant_default' };
    this._accounts = [fallbackUser];
    body.innerHTML = renderRows(this._accounts);
    try {
      const data = await AuthService.request('/users');
      this._accounts = data.users || [];
      body.innerHTML = this._accounts.length === 0
        ? '<tr><td colspan="6" style="text-align:center;padding:36px;color:var(--text-muted)">\u6682\u65e0\u8d26\u53f7</td></tr>'
        : renderRows(this._accounts);
    } catch (err) {
      UI.toast('\u8d26\u53f7\u5217\u8868\u5237\u65b0\u5931\u8d25: ' + err.message, 'warning');
    }
  },

  openAccountModal(userId = '') {
    if (!AuthService.canManageUsers()) return UI.toast('\u5f53\u524d\u8d26\u53f7\u6ca1\u6709\u7528\u6237\u7ba1\u7406\u6743\u9650', 'warning');
    const user = this._accounts.find(item => item.id === userId);
    document.getElementById('account-edit-id').value = user?.id || '';
    document.getElementById('account-account').value = user?.account || '';
    document.getElementById('account-account').disabled = Boolean(user);
    document.getElementById('account-name').value = user?.name || '';
    document.getElementById('account-role').value = user?.role || 'tenant_admin';
    document.getElementById('account-status').value = user?.status || 'active';
    document.getElementById('account-password').value = '';
    document.getElementById('modal-account-title').textContent = user ? '\u7f16\u8f91\u8d26\u53f7' : '\u65b0\u5efa\u8d26\u53f7';
    document.getElementById('account-password-hint').textContent = user ? '\u7559\u7a7a\u5219\u4e0d\u4fee\u6539\u5bc6\u7801' : '\u65b0\u8d26\u53f7\u5fc5\u987b\u8bbe\u7f6e\u521d\u59cb\u5bc6\u7801';
    this.openModal('account');
  },

  async saveAccount() {
    const id = document.getElementById('account-edit-id').value;
    const payload = {
      account: document.getElementById('account-account').value.trim(),
      name: document.getElementById('account-name').value.trim(),
      role: document.getElementById('account-role').value,
      status: document.getElementById('account-status').value,
      password: document.getElementById('account-password').value,
    };
    if (!payload.account) return UI.toast('\u8bf7\u586b\u5199\u8d26\u53f7', 'warning');
    if (!id && !payload.password) return UI.toast('\u8bf7\u8bbe\u7f6e\u521d\u59cb\u5bc6\u7801', 'warning');
    try {
      await AuthService.request(id ? ('/users/' + encodeURIComponent(id)) : '/users', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      this.closeModal('account');
      await this.renderAccounts();
      UI.toast('\u8d26\u53f7\u5df2\u4fdd\u5b58', 'success');
    } catch (err) {
      UI.toast(err.message, 'danger');
    }
  },

  async deleteAccount(userId) {
    const user = this._accounts.find(item => item.id === userId);
    if (!user) return;
    if (!window.confirm('\u786e\u5b9a\u5220\u9664\u8d26\u53f7 ' + user.account + ' \u5417\uff1f')) return;
    try {
      await AuthService.request('/users/' + encodeURIComponent(userId), { method: 'DELETE' });
      await this.renderAccounts();
      UI.toast('\u8d26\u53f7\u5df2\u5220\u9664', 'success');
    } catch (err) {
      UI.toast(err.message, 'danger');
    }
  },

  initCloudSync() {
    this._ensureCloudSyncRangeUI();
    this._normalizeCloudHistoryFilterUI();
    const locs = DataRepository.listLocations();
    const allDevs = DataRepository.listDevices().filter(d => d.type === 'sensor_soil_api');
    const sel = document.getElementById('cs-device-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">\u8bf7\u9009\u62e9\u8981\u540c\u6b65\u7684\u8bbe\u5907...</option>';
    const groups = {};
    allDevs.forEach(d => {
      const loc = locs.find(l => l.id === d.locationId);
      const locName = loc ? loc.name : '\u672a\u5206\u914d\u5730\u5757';
      if (!groups[locName]) groups[locName] = [];
      groups[locName].push(d);
    });
    Object.keys(groups).sort().forEach(locName => {
      const optGroup = document.createElement('optgroup');
      optGroup.label = locName;
      groups[locName].forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.name + ' (' + d.address + ')';
        optGroup.appendChild(opt);
      });
      sel.appendChild(optGroup);
    });
    this.onCloudRangePresetChange();
    this.onCloudDeviceChange();
  },

  _ensureCloudSyncRangeUI() {
    const toolbar = document.querySelector('#page-cloudsync .page-toolbar');
    const syncBtn = document.getElementById('sync-cloud-btn');
    if (!toolbar || !syncBtn) return;
    toolbar.style.alignItems = 'flex-end';
    toolbar.style.gap = '16px';

    let rangeGroup = document.getElementById('cs-sync-range-group');
    if (!rangeGroup) {
      rangeGroup = document.createElement('div');
      rangeGroup.className = 'toolbar-group';
      rangeGroup.id = 'cs-sync-range-group';
      rangeGroup.innerHTML = '' +
        '<label>\u8865\u5145\u8303\u56f4</label>' +
        '<select class="select-input" id="cs-sync-range-preset" style="width:240px" onchange="app.onCloudSyncRangePresetChange()">' +
          '<option value="24h">\u6700\u8fd1 24 \u5c0f\u65f6</option>' +
          '<option value="7d">\u6700\u8fd1 7 \u5929</option>' +
          '<option value="30d">\u6700\u8fd1 30 \u5929</option>' +
          '<option value="custom">\u81ea\u5b9a\u4e49\u65f6\u95f4</option>' +
        '</select>';
      toolbar.insertBefore(rangeGroup, syncBtn);
    }

    let customDates = document.getElementById('cs-sync-custom-dates');
    if (!customDates) {
      customDates = document.createElement('div');
      customDates.id = 'cs-sync-custom-dates';
      customDates.style.display = 'none';
      customDates.style.gap = '12px';
      customDates.style.alignItems = 'flex-end';
      customDates.style.flexWrap = 'wrap';
      customDates.innerHTML = '' +
        '<div class="toolbar-group">' +
          '<label>\u5f00\u59cb\u65f6\u95f4</label>' +
          '<input type="datetime-local" class="text-input" id="cs-sync-start" style="width:200px">' +
        '</div>' +
        '<div class="toolbar-group">' +
          '<label>\u7ed3\u675f\u65f6\u95f4</label>' +
          '<input type="datetime-local" class="text-input" id="cs-sync-end" style="width:200px">' +
        '</div>';
      toolbar.insertBefore(customDates, syncBtn);
    }

    const deviceSelect = document.getElementById('cs-device-select');
    if (deviceSelect) {
      deviceSelect.style.width = '320px';
      deviceSelect.style.minHeight = '46px';
    }
    const syncRange = document.getElementById('cs-sync-range-preset');
    if (syncRange) syncRange.style.minHeight = '46px';

    let actionGroup = document.getElementById('cs-sync-action-group');
    if (!actionGroup) {
      actionGroup = document.createElement('div');
      actionGroup.className = 'toolbar-group';
      actionGroup.id = 'cs-sync-action-group';
      actionGroup.innerHTML = '<label>\u64cd\u4f5c</label>';
      toolbar.insertBefore(actionGroup, syncBtn);
      actionGroup.appendChild(syncBtn);
    }
    syncBtn.style.height = '46px';
    syncBtn.style.padding = '0 24px';

    this.onCloudSyncRangePresetChange();
  },

  onCloudSyncRangePresetChange() {
    const preset = document.getElementById('cs-sync-range-preset')?.value || '24h';
    const customArea = document.getElementById('cs-sync-custom-dates');
    if (!customArea) return;
    if (preset === 'custom') {
      customArea.style.display = 'flex';
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const fmt = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      const startInput = document.getElementById('cs-sync-start');
      const endInput = document.getElementById('cs-sync-end');
      if (startInput && !startInput.value) startInput.value = fmt(yesterday);
      if (endInput && !endInput.value) endInput.value = fmt(now);
    } else {
      customArea.style.display = 'none';
    }
  },

  _normalizeCloudHistoryFilterUI() {
    const preset = document.getElementById('cloud-hist-range-preset');
    if (preset && !preset.dataset.normalized) {
      const selected = preset.value || '24h';
      preset.innerHTML = [
        '<option value="24h">\u6700\u8fd1 24 \u5c0f\u65f6</option>',
        '<option value="7d">\u6700\u8fd1 7 \u5929</option>',
        '<option value="30d">\u6700\u8fd1 30 \u5929</option>',
        '<option value="custom">\u81ea\u5b9a\u4e49\u65f6\u95f4</option>',
      ].join('');
      preset.value = ['24h', '7d', '30d', 'custom'].includes(selected) ? selected : '24h';
      preset.dataset.normalized = '1';
    }

    const setToolbarLabel = (inputId, text) => {
      const input = document.getElementById(inputId);
      const label = input?.closest('.toolbar-group')?.querySelector('label');
      if (label) label.textContent = text;
    };
    setToolbarLabel('cloud-hist-range-preset', '\u663e\u793a\u8303\u56f4');
    setToolbarLabel('cloud-hist-start', '\u5f00\u59cb\u65f6\u95f4');
    setToolbarLabel('cloud-hist-end', '\u7ed3\u675f\u65f6\u95f4');
    setToolbarLabel('cloud-hist-factors-filter', '\u7b5b\u9009');
    ['cloud-hist-start', 'cloud-hist-end'].forEach(id => {
      const input = document.getElementById(id);
      if (input && input.dataset.rangeBound !== '1') {
        input.dataset.rangeBound = '1';
        input.addEventListener('change', () => this._renderCloudHistoryTable());
      }
    });

    const container = document.getElementById('cloud-hist-factors-filter');
    const configBar = container?.closest('div[style*="border-bottom"]');
    const rangeGroup = preset?.closest('.toolbar-group');
    const customDates = document.getElementById('cloud-hist-custom-dates');
    const filterGroup = container?.closest('.toolbar-group');
    const applyButton = document.querySelector('button[onclick="app.applyCloudFilters()"]');
    if (configBar) {
      configBar.classList.add('cloud-hist-config-row');
      configBar.style.display = 'flex';
      configBar.style.alignItems = 'flex-end';
      configBar.style.gap = '16px';
      configBar.style.flexWrap = 'wrap';
      if (rangeGroup && rangeGroup.parentElement !== configBar) configBar.appendChild(rangeGroup);
      if (customDates && customDates.parentElement !== configBar) configBar.appendChild(customDates);
      if (filterGroup && filterGroup.parentElement !== configBar) configBar.appendChild(filterGroup);
    }
    if (rangeGroup) {
      rangeGroup.classList.add('cloud-hist-field');
      rangeGroup.style.flex = '0 0 240px';
      if (preset) preset.style.width = '240px';
      if (preset) preset.style.minHeight = '46px';
    }
    if (customDates) customDates.style.alignItems = 'flex-end';
    if (filterGroup && filterGroup !== rangeGroup) {
      filterGroup.classList.add('cloud-hist-field');
      filterGroup.style.flex = '1';
      filterGroup.style.minWidth = '260px';
      if (container) {
        container.classList.add('cloud-hist-factor-box');
        container.style.minHeight = '46px';
        container.style.height = 'auto';
        container.style.alignItems = 'center';
      }
    }
    if (applyButton) applyButton.remove();
    const panelTitle = document.querySelector('#page-cloudsync .panel-title .fa-sliders')?.closest('.panel-title');
    if (panelTitle) panelTitle.innerHTML = '<i class="fa-solid fa-sliders"></i> \u5386\u53f2\u5b58\u91cf\u6570\u636e\u7b5b\u9009';
  },

  onCloudRangePresetChange() {
    const preset = document.getElementById('cloud-hist-range-preset')?.value;
    const customArea = document.getElementById('cloud-hist-custom-dates');
    if (!customArea) return;
    if (preset === 'custom') {
      customArea.style.display = 'flex';
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const fmt = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      document.getElementById('cloud-hist-start').value = fmt(yesterday);
      document.getElementById('cloud-hist-end').value = fmt(now);
    } else {
      customArea.style.display = 'none';
    }
    this._renderCloudHistoryTable();
  },

  async onCloudDeviceChange() {
    const deviceId = document.getElementById('cs-device-select')?.value;
    if (!deviceId) {
      this._cloudHistoryData = [];
      this._selectedFactors = new Set();
      this._updateFactorCheckboxes();
      this._renderCloudHistoryTable();
      return;
    }
    const rows = Store.getDeviceHistoryRows(deviceId) || [];
    this._cloudHistoryData = rows.map(r => {
      const d = new Date(r.deviceTimestamp || r.ts || r.timestamp);
      const pad = n => String(n).padStart(2, '0');
      const fallbackTime = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
      return {
        ts: d.getTime(),
        time: r.recordTimeStr ? String(r.recordTimeStr) : fallbackTime,
        values: r.values || {},
      };
    }).reverse();
    this._selectedFactors = new Set();
    this._updateFactorCheckboxes();
    this._renderCloudHistoryTable();
  },

  async syncCloudHistory() {
    const deviceId = document.getElementById('cs-device-select')?.value;
    if (!deviceId) { UI.toast('\u8bf7\u5148\u9009\u62e9\u4e00\u4e2a\u8981\u540c\u6b65\u7684\u8bbe\u5907', 'warning'); return; }
    const preset = document.getElementById('cs-sync-range-preset')?.value || '24h';
    const fmt = d => {
      const pad = n => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':00';
    };
    let startTime, endTime;
    if (preset === 'custom') {
      const startValue = document.getElementById('cs-sync-start')?.value;
      const endValue = document.getElementById('cs-sync-end')?.value;
      if (!startValue || !endValue) {
        UI.toast('\u8bf7\u5148\u586b\u5199\u8865\u5145\u7684\u81ea\u5b9a\u4e49\u65f6\u95f4\u8303\u56f4', 'warning');
        return;
      }
      startTime = startValue.replace('T', ' ') + ':00';
      endTime = endValue.replace('T', ' ') + ':00';
    } else {
      const now = new Date();
      const hours = preset === '7d' ? 7 * 24 : preset === '30d' ? 30 * 24 : 24;
      startTime = fmt(new Date(now.getTime() - hours * 3600000));
      endTime = fmt(now);
    }
    const btn = document.getElementById('sync-cloud-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> \u8865\u5145\u4e2d...'; }
    try {
      const res = await fetch('/api/v1/cloud-history-sync?deviceId=' + encodeURIComponent(deviceId) + '&startTime=' + encodeURIComponent(startTime) + '&endTime=' + encodeURIComponent(endTime), { headers: AuthService.authHeaders() });
      const result = await res.json();
      if (!result.ok) throw new Error(result.msg || '\u65e0\u6cd5\u8fde\u63a5\u5230\u4e91\u5e73\u53f0\u6216\u65e0\u6570\u636e');
      try {
        const fresh = await BackendAdapter.getDeviceHistory(deviceId);
        Store.updateDeviceHistoryRows(deviceId, fresh?.rows || []);
      } catch (_) {}
      await this.onCloudDeviceChange();
      UI.toast('\u6210\u529f\u8865\u5145 ' + (result.inserted || 0) + ' \u6761\u65b0\u8bb0\u5f55', 'success');
    } catch (err) {
      UI.toast('\u8865\u5145\u5931\u8d25: ' + err.message, 'danger');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-sync"></i> \u8865\u5145\u4e91\u7aef\u6570\u636e'; }
    }
  },

  _updateFactorCheckboxes() {
    const factors = new Set();
    this._cloudHistoryData.forEach(item => Object.keys(item.values || {}).forEach(f => factors.add(f)));
    const container = document.getElementById('cloud-hist-factors-filter');
    if (!container) return;
    const sorted = Array.from(factors).sort();
    if (!sorted.length) {
      container.innerHTML = '<span style="display:block;width:100%;line-height:30px;padding:0 12px;color:var(--text-muted);font-size:12px;text-align:left">\u6682\u65e0\u672c\u5730\u5386\u53f2\u8bb0\u5f55</span>';
      return;
    }
    container.innerHTML = sorted.map(f => '<label><input type="checkbox" class="factor-checkbox" value="' + this.sanitize(f) + '" ' + (this._selectedFactors.has(f) ? 'checked' : '') + ' onchange="app.applyCloudFilters(true)"> ' + this.sanitize(f) + '</label>').join('');
  },

  applyCloudFilters(silent = false) {
    const next = new Set();
    document.querySelectorAll('.factor-checkbox').forEach(cb => { if (cb.checked) next.add(cb.value); });
    this._selectedFactors = next;
    this._renderCloudHistoryTable();
    if (!silent) UI.toast('\u5df2\u5e94\u7528\u7b5b\u9009\u6761\u4ef6', 'success');
  },

  _getCloudHistoryFactors(data = this._cloudHistoryData || []) {
    const selected = Array.from(this._selectedFactors || []).sort();
    if (selected.length) return selected;
    const factors = new Set();
    data.forEach(item => Object.keys(item.values || {}).forEach(f => factors.add(f)));
    return Array.from(factors).sort();
  },

  _getVisibleCloudHistoryData() {
    const data = this._cloudHistoryData || [];
    const preset = document.getElementById('cloud-hist-range-preset')?.value || '24h';
    let start = 0;
    let end = Date.now();
    if (preset === 'custom') {
      const startValue = document.getElementById('cloud-hist-start')?.value;
      const endValue = document.getElementById('cloud-hist-end')?.value;
      start = startValue ? new Date(startValue).getTime() : 0;
      end = endValue ? new Date(endValue).getTime() : Date.now();
    } else {
      const hours = preset === '7d' ? 7 * 24 : preset === '30d' ? 30 * 24 : 24;
      start = Date.now() - hours * 3600000;
    }
    return data.filter(item => Number.isFinite(item.ts) && item.ts >= start && item.ts <= end);
  },

  _renderCloudHistoryTable() {
    const head = document.getElementById('cloud-hist-table-head');
    const body = document.getElementById('cloud-hist-table-body');
    if (!head || !body) return;
    const data = this._getVisibleCloudHistoryData();
    if (!data.length) {
      head.innerHTML = '';
      body.innerHTML = '<tr><td colspan="100" style="text-align:center;padding:40px;color:var(--text-muted)">\u65e0\u5386\u53f2\u6570\u636e\u8bb0\u5f55</td></tr>';
      return;
    }
    const factors = this._getCloudHistoryFactors(data);
    head.innerHTML = '<tr><th>\u4e0a\u62a5\u65f6\u95f4</th>' + factors.map(f => '<th>' + this.sanitize(f) + '</th>').join('') + '</tr>';
    body.innerHTML = data.map(item => '<tr><td style="font-family:\'JetBrains Mono\';font-size:12px">' + this.sanitize(item.time) + '</td>' + factors.map(f => '<td>' + (item.values[f] !== undefined ? this.sanitize(item.values[f]) : '-') + '</td>').join('') + '</tr>').join('');
  },

  exportCloudHistoryCSV() {
    if (!this._cloudHistoryData.length) { UI.toast('\u6682\u65e0\u53ef\u5bfc\u51fa\u7684\u6570\u636e', 'warning'); return; }
    const data = this._getVisibleCloudHistoryData();
    if (!data.length) { UI.toast('\u5f53\u524d\u663e\u793a\u8303\u56f4\u5185\u6682\u65e0\u6570\u636e', 'warning'); return; }
    const factors = this._getCloudHistoryFactors(data);
    let csv = '\uFEFF\u65f6\u95f4,' + factors.join(',') + '\n';
    data.forEach(item => { csv += item.time + ',' + factors.map(f => item.values[f] ?? '').join(',') + '\n'; });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'cloud-history-' + Date.now() + '.csv';
    link.click();
  },

  //     PHOTO RECORDS
  async renderPhotos() {
    this._selectedCropId = null;
    this._selectedCropName = '';
    this._photoCompressedBase64 = null;
    this._currentWeather = null;
    document.getElementById('records-header').style.display = 'none';
    document.getElementById('records-empty').style.display = 'flex';
    document.getElementById('records-grid').innerHTML = '';
    await Promise.all([
      this._loadPhotoConfigLabel(),
      this._loadCrops(),
    ]);
  },

  _updatePhotoModelLabel(textModel) {
    const el = document.getElementById('photo-model-label');
    if (el) el.textContent = textModel ? `模型：${textModel}` : '';
  },

  async _loadPhotoConfigLabel() {
    try {
      const data = await this._photoRequest('/config');
      this._updatePhotoModelLabel(data.config?.textModel || 'qwen-turbo');
    } catch (e) {
      this._updatePhotoModelLabel('');
    }
  },

  async _photoRequest(path, options = {}) {
    const res = await fetch('/api/v1/photos' + path, {
      ...options,
      headers: AuthService.authHeaders(options.headers || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.msg || data.error || '\u8bf7\u6c42\u5931\u8d25');
    return data;
  },

  async _loadCrops() {
    try {
      const data = await this._photoRequest('/crops');
      this._crops = data.crops || [];
      this._renderCropList(this._crops);
    } catch (e) {
      UI.toast('\u52a0\u8f7d\u519c\u4f5c\u7269\u5931\u8d25', 'danger');
    }
  },

  _renderCropList(crops) {
    const list = document.getElementById('crops-list');
    if (!list) return;
    if (!crops.length) {
      list.innerHTML = '<div class="crops-empty"><i class="fa-solid fa-seedling"></i><p>\u6682\u65e0\u519c\u4f5c\u7269</p></div>';
      return;
    }
    const locMap = Object.fromEntries(DataRepository.listLocations().map(item => [item.id, item.name]));
    list.innerHTML = crops.map(c => `
      <div class="crop-item ${c.id === this._selectedCropId ? 'active' : ''}" data-crop-id="${this.sanitize(c.id)}" data-crop-name="${this.sanitize(c.name || '')}" onclick="app.selectCrop(this.dataset.cropId, this.dataset.cropName)">
        <i class="fa-solid fa-leaf"></i>
        <div class="crop-item-info">
          <div class="crop-item-name">${this.sanitize(c.name || '')}</div>
          ${c.variety ? `<div class="crop-item-sub">${this.sanitize(c.variety)}</div>` : ''}
          ${c.locationId || c.locationDesc ? `<div class="crop-item-sub">${this.sanitize(locMap[c.locationId] || c.locationDesc || '')}</div>` : ''}
        </div>
        <button class="btn-icon crop-delete-btn" title="\u5220\u9664\u519c\u4f5c\u7269" onclick="event.stopPropagation(); app.deleteCrop('${this.sanitize(c.id)}')"><i class="fa-solid fa-trash"></i></button>
      </div>
    `).join('');
  },

  async selectCrop(cropId, cropName) {
    this._selectedCropId = cropId;
    this._selectedCropName = cropName || '';
    document.querySelectorAll('.crop-item').forEach(el => {
      el.classList.toggle('active', el.dataset.cropId === cropId);
    });
    document.getElementById('records-header').style.display = 'flex';
    document.getElementById('records-crop-title').textContent = cropName || '';
    document.getElementById('records-empty').style.display = 'none';
    await this._loadRecords(cropId);
  },

  async _loadRecords(cropId) {
    const grid = document.getElementById('records-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="loading-state"><i class="fa-solid fa-spinner fa-spin"></i></div>';
    try {
      const data = await this._photoRequest('/records?cropId=' + encodeURIComponent(cropId));
      this._renderRecordGrid(data.records || []);
    } catch (e) {
      grid.innerHTML = '<div class="empty-state"><p>\u52a0\u8f7d\u5931\u8d25</p></div>';
    }
  },

  async deleteCrop(cropId) {
    if (!cropId) return;
    if (!window.confirm('\u786e\u5b9a\u5220\u9664\u8be5\u519c\u4f5c\u7269\u53ca\u5176\u5168\u90e8AI\u8bb0\u5f55\u5417\uff1f')) return;
    try {
      await this._photoRequest('/crops?id=' + encodeURIComponent(cropId), { method: 'DELETE' });
      if (this._selectedCropId === cropId) {
        this._selectedCropId = null;
        this._selectedCropName = '';
        this._photoRecordCache = {};
        document.getElementById('records-header').style.display = 'none';
        document.getElementById('records-empty').style.display = 'flex';
        document.getElementById('records-grid').innerHTML = '';
      }
      await this._loadCrops();
      UI.toast('\u519c\u4f5c\u7269\u5df2\u5220\u9664', 'success');
    } catch (e) {
      UI.toast('\u5220\u9664\u5931\u8d25\uff1a' + e.message, 'danger');
    }
  },

  _renderRecordGrid(records) {
    const grid = document.getElementById('records-grid');
    if (!grid) return;
    this._photoRecordCache = Object.fromEntries(records.map(r => [r.id, r]));
    if (!records.length) {
      grid.innerHTML = '<div class="empty-state"><i class="fa-solid fa-camera"></i><p>\u6682\u65e0\u8bb0\u5f55\uff0c\u70b9\u51fb\u65b0\u5efa\u8bb0\u5f55\u5f00\u59cb</p></div>';
      return;
    }
    grid.innerHTML = records.map(r => {
      const d = new Date(r.createdAt);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      const weatherBit = r.weather ? `<span class="record-tag"><i class="fa-solid fa-cloud-sun"></i> ${this.sanitize(String(r.weather.temp))}\u2103 ${this.sanitize(r.weather.condition || '')}</span>` : '';
      const sensorBit = Array.isArray(r.linkedSensors) && r.linkedSensors.length ? `<span class="record-tag"><i class="fa-solid fa-microchip"></i> ${r.linkedSensors.length} \u4e2a\u4f20\u611f\u5668</span>` : '';
      const notes = String(r.userNotes || '');
      const notesPreview = notes ? notes.slice(0, 50) + (notes.length > 50 ? '\u2026' : '') : '';
      const annotationBadge = r.aiAnalysis
        ? '<div class="record-ai-badge done">\u5df2\u6807\u6ce8</div>'
        : '<div class="record-ai-badge pending">\u5f85\u6807\u6ce8</div>';
      return `
        <div class="record-card" onclick="app.openRecordDetail('${this.sanitize(r.id)}')">
          <button class="btn-icon record-delete-btn" title="\u5220\u9664\u8bb0\u5f55" onclick="event.stopPropagation(); app.deletePhotoRecord('${this.sanitize(r.id)}')"><i class="fa-solid fa-trash"></i></button>
          <div class="record-card-img">
            <img data-photo-id="${this.sanitize(r.id)}" alt="\u8bb0\u5f55\u56fe\u7247" loading="lazy">
          </div>
          <div class="record-card-body">
            <div class="record-card-date">${dateStr}</div>
            <div class="record-tags">${weatherBit}${sensorBit}</div>
            ${notesPreview ? `<div class="record-notes-preview">${this.sanitize(notesPreview)}</div>` : ''}
            ${annotationBadge}
          </div>
        </div>
      `;
    }).join('');
    this._hydrateRecordImages(records);
  },

  async deletePhotoRecord(recordId) {
    if (!recordId) return;
    if (!window.confirm('\u786e\u5b9a\u5220\u9664\u8be5\u7530\u95f4\u8bb0\u5f55\u5417\uff1f')) return;
    try {
      await this._photoRequest('/records?id=' + encodeURIComponent(recordId), { method: 'DELETE' });
      delete this._photoRecordCache[recordId];
      if (this._selectedCropId) await this._loadRecords(this._selectedCropId);
      UI.toast('\u8bb0\u5f55\u5df2\u5220\u9664', 'success');
    } catch (e) {
      UI.toast('\u5220\u9664\u5931\u8d25\uff1a' + e.message, 'danger');
    }
  },

  async _loadPhotoImage(record) {
    if (!record?.id || !record.imageUrl) return '';
    if (this._photoImageUrls[record.id]) return this._photoImageUrls[record.id];
    const res = await fetch(record.imageUrl, { headers: AuthService.authHeaders() });
    if (!res.ok) throw new Error('image ' + res.status);
    const objectUrl = URL.createObjectURL(await res.blob());
    this._photoImageUrls[record.id] = objectUrl;
    return objectUrl;
  },

  _hydrateRecordImages(records) {
    records.forEach(record => {
      this._loadPhotoImage(record).then(src => {
        const img = document.querySelector(`img[data-photo-id="${CSS.escape(record.id)}"]`);
        if (img && src) img.src = src;
      }).catch(() => {
        const img = document.querySelector(`img[data-photo-id="${CSS.escape(record.id)}"]`);
        if (img?.parentElement) img.parentElement.innerHTML = '<div class="img-error"><i class="fa-solid fa-image"></i></div>';
      });
    });
  },

  openRecordDetail(recordId) {
    const r = this._photoRecordCache[recordId];
    if (!r) return;
    const d = new Date(r.createdAt);
    let html = `
      <img data-detail-photo-id="${this.sanitize(r.id)}" class="detail-img" alt="">
      <div class="detail-section">
        <div class="detail-label">\u65f6\u95f4</div>
        <div>${d.toLocaleString('zh-CN')}</div>
      </div>
    `;
    if (r.gps) html += `
      <div class="detail-section">
        <div class="detail-label">\u4f4d\u7f6e</div>
        <div>\u7eac\u5ea6 ${Number(r.gps.lat).toFixed(5)}  \u7ecf\u5ea6 ${Number(r.gps.lng).toFixed(5)}\uff08\u7cbe\u5ea6 ${r.gps.accuracy ? Math.round(r.gps.accuracy) + 'm' : '\u672a\u77e5'}\uff09</div>
      </div>
    `;
    if (r.weather) {
      const weatherParts = [];
      if (r.weather.condition) weatherParts.push(this.sanitize(r.weather.condition));
      if (r.weather.temp !== undefined && Number.isFinite(Number(r.weather.temp))) weatherParts.push(`${Number(r.weather.temp)}\u00b0C`);
      if (r.weather.humidity !== undefined && Number.isFinite(Number(r.weather.humidity))) weatherParts.push(`\u6e7f\u5ea6${Number(r.weather.humidity)}%`);
      if (r.weather.windPower) weatherParts.push(`\u98ce\u529b${this.sanitize(String(r.weather.windPower))}\u7ea7`);
      if (r.weather.windDirection) weatherParts.push(`\u98ce\u5411${this.sanitize(String(r.weather.windDirection))}`);
      html += `
        <div class="detail-section">
          <div class="detail-label">\u5929\u6c14</div>
          <div>${weatherParts.join(' ')}</div>
        </div>
      `;
    }
    if (Array.isArray(r.linkedSensors) && r.linkedSensors.length) {
      html += '<div class="detail-section"><div class="detail-label">\u4f20\u611f\u5668\u5feb\u7167</div>';
      r.linkedSensors.forEach(s => {
        html += `<div class="sensor-snapshot-block"><div class="sensor-snapshot-name">${this.sanitize(s.deviceName || s.deviceId)}</div>`;
        if (s.startTime || s.endTime) {
          html += `<div class="sensor-snapshot-time">${new Date(s.startTime).toLocaleString('zh-CN')} - ${new Date(s.endTime).toLocaleString('zh-CN')}</div>`;
        } else if (s.selectedTimestamp) {
          html += `<div class="sensor-snapshot-time">${new Date(s.selectedTimestamp).toLocaleString('zh-CN')}</div>`;
        }
        const snapshots = Array.isArray(s.snapshots) ? s.snapshots : (s.snapshot ? [s.snapshot] : []);
        if (!snapshots.length) {
          html += '<div class="sensor-snapshot-time">\u8be5\u65f6\u95f4\u8303\u56f4\u5185\u6682\u65e0\u8bfb\u6570</div>';
        }
        snapshots.forEach(snapshot => {
          const entries = Object.entries(snapshot.values || {});
          html += `<div class="sensor-snapshot-time">${this.sanitize(snapshot.snapshotTimeStr || '')}</div>`;
          if (entries.length) {
            html += '<table class="snapshot-table"><tbody>' +
              entries.map(([k, v]) => `<tr><td>${this.sanitize(k)}</td><td><strong>${this.sanitize(String(v))}</strong></td></tr>`).join('') +
              '</tbody></table>';
          }
        });
        html += '</div>';
      });
      html += '</div>';
    }
    if (r.userNotes) html += `
      <div class="detail-section">
        <div class="detail-label">\u5907\u6ce8</div>
        <div class="detail-notes">${this.sanitize(r.userNotes)}</div>
      </div>
    `;
    html += `
      <div class="detail-section">
        <div class="detail-label">AI \u5206\u6790</div>
        <div id="record-ai-analysis">${this._renderAnnotation(r)}</div>
      </div>
    `;
    document.getElementById('record-detail-body').innerHTML = html;
    this.openModal('modal-record-detail');
    this._loadPhotoImage(r).then(src => {
      const img = document.querySelector(`img[data-detail-photo-id="${CSS.escape(r.id)}"]`);
      if (img && src) img.src = src;
    }).catch(() => {});
  },

  _renderAnnotation(record) {
    const analysis = record?.aiAnalysis;
    if (!analysis) {
      return `<button class="btn-primary btn-sm" id="btn-ai-annotate-${this.sanitize(record.id)}" onclick="app.annotatePhotoRecord('${this.sanitize(record.id)}')"><i class="fa-solid fa-tags"></i> \u751f\u6210\u6807\u6ce8</button>`;
    }
    if (typeof analysis === 'string') {
      return `<span class="record-ai-badge done">\u5df2\u6807\u6ce8</span><div class="detail-notes">${this.sanitize(analysis)}</div>`;
    }
    const severityLabels = ['\u6b63\u5e38', '\u8f7b\u5fae', '\u4e2d\u7b49', '\u4e25\u91cd'];
    const severity = Number(analysis.severity);
    const severityText = Number.isInteger(severity) && severity >= 0 && severity <= 3 ? severityLabels[severity] : '-';
    const list = value => Array.isArray(value) && value.length
      ? '<ul class="ai-analysis-list">' + value.map(item => `<li>${this.sanitize(String(item))}</li>`).join('') + '</ul>'
      : '<span style="color:var(--text-muted)">-</span>';
    return `
      <div class="ai-analysis-result">
        <span class="record-ai-badge done">\u5df2\u6807\u6ce8</span>
        <div class="sensor-snapshot-block"><div class="sensor-snapshot-name">\u751f\u957f\u9636\u6bb5</div><div>${this.sanitize(analysis.growthStage || '-')}</div></div>
        <div class="sensor-snapshot-block"><div class="sensor-snapshot-name">\u75c7\u72b6</div>${list(analysis.symptoms)}</div>
        <div class="sensor-snapshot-block"><div class="sensor-snapshot-name">\u53d7\u5f71\u54cd\u90e8\u4f4d</div><div>${this.sanitize(analysis.affectedPart || '-')}</div></div>
        <div class="sensor-snapshot-block"><div class="sensor-snapshot-name">\u53ef\u80fd\u539f\u56e0</div><div>${this.sanitize(analysis.possibleCause || '-')}</div></div>
        <div class="sensor-snapshot-block"><div class="sensor-snapshot-name">\u4e25\u91cd\u7a0b\u5ea6</div><div>${severityText}</div></div>
        <div class="sensor-snapshot-block"><div class="sensor-snapshot-name">\u64cd\u4f5c\u5efa\u8bae</div>${list(analysis.actions)}</div>
        <div class="sensor-snapshot-block"><div class="sensor-snapshot-name">\u6807\u7b7e</div>${list(analysis.tags)}</div>
      </div>
    `;
  },

  async annotatePhotoRecord(recordId) {
    const record = this._photoRecordCache[recordId];
    if (!record) return;
    const host = document.getElementById('record-ai-analysis');
    const btn = document.getElementById('btn-ai-annotate-' + recordId);
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> \u6807\u6ce8\u4e2d...';
    }
    if (host && !btn) host.innerHTML = '<div class="record-ai-badge pending">\u6807\u6ce8\u4e2d...</div>';
    try {
      const data = await this._photoRequest('/records/' + encodeURIComponent(recordId) + '/annotate', { method: 'POST' });
      record.aiAnalysis = data.aiAnalysis;
      this._photoRecordCache[recordId] = record;
      if (host) host.innerHTML = this._renderAnnotation(record);
      UI.toast('\u6807\u6ce8\u5df2\u751f\u6210', 'success');
    } catch (e) {
      if (host) host.innerHTML = this._renderAnnotation(record);
      UI.toast('\u6807\u6ce8\u5931\u8d25\uff1a' + e.message, 'danger');
    }
  },

  openNewCropModal() {
    const locations = DataRepository.listLocations();
    if (!locations.length) {
      UI.toast('\u8bf7\u5148\u53bb\u8bbe\u5907\u7ba1\u7406\u6216\u5730\u5757\u7ba1\u7406\u9875\u521b\u5efa\u5730\u5757\uff0c\u518d\u65b0\u5efa\u519c\u4f5c\u7269', 'warning');
      return;
    }
    ['crop-name','crop-variety'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const locSelect = document.getElementById('crop-location-id');
    if (locSelect) {
      locSelect.innerHTML = locations.map(loc => `<option value="${this.sanitize(loc.id)}">${this.sanitize(loc.name)}</option>`).join('');
      locSelect.value = locations[0]?.id || '';
    }
    this.openModal('modal-new-crop');
    setTimeout(() => document.getElementById('crop-name')?.focus(), 50);
  },

  async submitNewCrop() {
    const name = document.getElementById('crop-name').value.trim();
    if (!name) { UI.toast('\u8bf7\u8f93\u5165\u519c\u4f5c\u7269\u540d\u79f0', 'warning'); return; }
    try {
      const data = await this._photoRequest('/crops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          variety: document.getElementById('crop-variety').value.trim(),
          locationId: document.getElementById('crop-location-id')?.value || '',
          locationDesc: DataRepository.listLocations().find(item => item.id === document.getElementById('crop-location-id')?.value)?.name || '',
        }),
      });
      this.closeModal('modal-new-crop');
      UI.toast('\u519c\u4f5c\u7269\u5df2\u521b\u5efa', 'success');
      await this._loadCrops();
      await this.selectCrop(data.crop.id, data.crop.name);
    } catch(e) {
      UI.toast('\u521b\u5efa\u5931\u8d25\uff1a' + e.message, 'danger');
    }
  },

  openNewRecordModal() {
    if (!this._selectedCropId) { UI.toast('\u8bf7\u5148\u9009\u62e9\u519c\u4f5c\u7269', 'warning'); return; }
    this._photoCompressedBase64 = null;
    this._currentWeather = null;
    document.getElementById('photo-upload-area').style.display = 'flex';
    document.getElementById('photo-preview-wrap').style.display = 'none';
    document.getElementById('photo-file-input').value = '';
    document.getElementById('record-lat').value = '';
    document.getElementById('record-lng').value = '';
    document.getElementById('record-notes').value = '';
    document.getElementById('weather-display').style.display = 'none';
    const now = new Date();
    document.getElementById('record-datetime').value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const crop = (this._crops || []).find(item => item.id === this._selectedCropId);
    const location = crop?.locationId ? DataRepository.listLocations().find(item => item.id === crop.locationId) : null;
    const lat = Number(location?.lat);
    const lng = Number(location?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
      document.getElementById('record-lat').value = lat.toFixed(6);
      document.getElementById('record-lng').value = lng.toFixed(6);
      this._fetchWeather(lat, lng);
    }
    this._renderSensorSelectList();
    this.openModal('modal-new-record');
  },

  _renderSensorSelectList() {
    const devices = DataRepository.listDevices().filter(d => d.type.startsWith('sensor'));
    const list = document.getElementById('sensor-select-list');
    if (!list) return;
    if (!devices.length) {
      list.innerHTML = '<div class="sensor-empty">\u6682\u65e0\u4f20\u611f\u5668\u8bbe\u5907</div>';
      return;
    }
    list.innerHTML = devices.map(d => `
      <div class="sensor-select-row" id="sensor-row-${this.sanitize(d.id)}">
        <label class="sensor-check-label">
          <input type="checkbox" class="sensor-checkbox" value="${this.sanitize(d.id)}" data-name="${this.sanitize(d.name || d.id)}" onchange="app.onSensorCheckChange('${this.sanitize(d.id)}')">
          <span>${this.sanitize(d.name || d.id)}</span>
        </label>
        <input type="datetime-local" class="text-input sensor-time-input" id="sensor-time-start-${this.sanitize(d.id)}" style="display:none" title="\u8d77\u59cb\u65f6\u95f4">
        <input type="datetime-local" class="text-input sensor-time-input" id="sensor-time-end-${this.sanitize(d.id)}" style="display:none" title="\u7ed3\u675f\u65f6\u95f4">
      </div>
    `).join('');
  },

  onSensorCheckChange(deviceId) {
    const cb = document.querySelector(`.sensor-checkbox[value="${CSS.escape(deviceId)}"]`);
    const startInput = document.getElementById(`sensor-time-start-${deviceId}`);
    const endInput = document.getElementById(`sensor-time-end-${deviceId}`);
    if (!cb || !startInput || !endInput) return;
    startInput.style.display = cb.checked ? 'inline-block' : 'none';
    endInput.style.display = cb.checked ? 'inline-block' : 'none';
    if (cb.checked) {
      const end = document.getElementById('record-datetime').value
        ? new Date(document.getElementById('record-datetime').value)
        : new Date();
      const start = new Date(end.getTime() - 60 * 60 * 1000);
      const fmt = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      if (!startInput.value) startInput.value = fmt(start);
      if (!endInput.value) endInput.value = fmt(end);
    }
  },

  async handlePhotoSelect(input) {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const base64 = await this._compressImage(file);
      this._photoCompressedBase64 = base64;
      document.getElementById('photo-upload-area').style.display = 'none';
      const preview = document.getElementById('photo-preview');
      preview.src = base64;
      document.getElementById('photo-preview-wrap').style.display = 'block';
      const kb = Math.round(base64.length * 0.75 / 1024);
      document.getElementById('photo-size-info').textContent = `\u538b\u7f29\u540e\u7ea6 ${kb} KB`;
    } catch(e) {
      UI.toast('\u56fe\u7247\u5904\u7406\u5931\u8d25', 'danger');
    }
  },

  _compressImage(file, maxDim = 1200, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w >= h) {
            h = Math.round(h * maxDim / w);
            w = maxDim;
          } else {
            w = Math.round(w * maxDim / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('\u56fe\u7247\u52a0\u8f7d\u5931\u8d25'));
      };
      img.src = url;
    });
  },

  async _fetchWeather(lat, lng) {
    try {
      const data = await this._photoRequest('/weather?lat=' + encodeURIComponent(lat) + '&lng=' + encodeURIComponent(lng));
      this._currentWeather = data.weather;
      const wd = document.getElementById('weather-display');
      wd.style.display = 'flex';
      const windText = [
        data.weather.windPower ? `\u98ce\u529b${this.sanitize(String(data.weather.windPower))}\u7ea7` : '',
        data.weather.windDirection ? `\u98ce\u5411${this.sanitize(String(data.weather.windDirection))}` : '',
      ].filter(Boolean).join(' ');
      wd.innerHTML = `<i class="fa-solid fa-cloud-sun"></i> ${this.sanitize(data.weather.condition || '')} ${this.sanitize(String(data.weather.temp))}\u2103 \u6e7f\u5ea6${this.sanitize(String(data.weather.humidity))}% ${windText}`;
    } catch(e) {
      this._currentWeather = null;
    }
  },

  async submitNewRecord() {
    if (!this._photoCompressedBase64) {
      UI.toast('\u8bf7\u5148\u9009\u62e9\u56fe\u7247', 'warning');
      return;
    }
    const btn = document.getElementById('btn-submit-record');
    btn.disabled = true;
    btn.textContent = '\u4fdd\u5b58\u4e2d...';
    try {
      const linkedSensors = [];
      const checkedBoxes = document.querySelectorAll('.sensor-checkbox:checked');
      for (const cb of checkedBoxes) {
        const deviceId = cb.value;
        const deviceName = cb.dataset.name;
        const startInput = document.getElementById(`sensor-time-start-${deviceId}`);
        const endInput = document.getElementById(`sensor-time-end-${deviceId}`);
        const endDate = endInput?.value ? new Date(endInput.value) : new Date();
        const startDate = startInput?.value ? new Date(startInput.value) : new Date(endDate.getTime() - 60 * 60 * 1000);
        const startTime = startDate.toISOString();
        const endTime = endDate.toISOString();
        try {
          const data = await this._photoRequest('/sensor-range?deviceId=' + encodeURIComponent(deviceId) + '&startTime=' + encodeURIComponent(startTime) + '&endTime=' + encodeURIComponent(endTime));
          linkedSensors.push({
            deviceId,
            deviceName,
            startTime,
            endTime,
            snapshots: data.readings || [],
          });
        } catch(e) {}
      }

      const lat = parseFloat(document.getElementById('record-lat').value);
      const lng = parseFloat(document.getElementById('record-lng').value);
      const dtVal = document.getElementById('record-datetime').value;
      const data = await this._photoRequest('/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cropId: this._selectedCropId,
          imageBase64: this._photoCompressedBase64,
          createdAt: dtVal ? new Date(dtVal).toISOString() : new Date().toISOString(),
          gps: (!Number.isNaN(lat) && !Number.isNaN(lng)) ? { lat, lng, accuracy: null, source: 'location' } : null,
          weather: this._currentWeather || null,
          linkedSensors,
          userNotes: document.getElementById('record-notes').value.trim(),
        }),
      });
      this.closeModal('modal-new-record');
      this._currentWeather = null;
      this._photoCompressedBase64 = null;
      UI.toast('\u8bb0\u5f55\u5df2\u4fdd\u5b58', 'success');
      await this._loadRecords(this._selectedCropId);
    } catch(e) {
      UI.toast('\u4fdd\u5b58\u5931\u8d25\uff1a' + e.message, 'danger');
    } finally {
      btn.disabled = false;
      btn.textContent = '\u4fdd\u5b58\u8bb0\u5f55';
    }
  },

  async openPhotoConfig() {
    try {
      const data = await this._photoRequest('/config');
      if (data.ok) {
        document.getElementById('cfg-amap-key').placeholder = data.config.amapKey ? '\u5df2\u914d\u7f6e\uff08\u8f93\u5165\u65b0\u503c\u53ef\u66f4\u65b0\uff09' : '\u672a\u914d\u7f6e';
        document.getElementById('cfg-vision-model').value = data.config.visionModel || 'qwen-vl-plus';
        document.getElementById('cfg-text-model').value = data.config.textModel || 'qwen-turbo';
        this._updatePhotoModelLabel(data.config.textModel || 'qwen-turbo');
      }
    } catch(e) {}
    this.openModal('modal-photo-config');
  },

  async savePhotoConfig() {
    const payload = {
      amapKey: document.getElementById('cfg-amap-key').value.trim(),
      visionApiKey: document.getElementById('cfg-vision-key').value.trim(),
      visionModel: document.getElementById('cfg-vision-model').value,
      textModel: document.getElementById('cfg-text-model').value.trim() || 'qwen-turbo',
    };
    try {
      await this._photoRequest('/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      this.closeModal('modal-photo-config');
      this._updatePhotoModelLabel(payload.textModel);
      UI.toast('\u914d\u7f6e\u5df2\u4fdd\u5b58', 'success');
    } catch(e) {
      UI.toast('\u4fdd\u5b58\u914d\u7f6e\u5931\u8d25', 'danger');
    }
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
    const apiUrl = 'http://www.0531yun.com';
    const btn = document.getElementById('cloud-login-btn');

    if (!accessCode) {
      this.showCloudError('\u8bf7\u8f93\u5165\u8bc6\u522b\u7801');
      return;
    }

    this.clearCloudError();
    btn.disabled = true;
    btn.innerHTML = '<div class="cloud-spinner" style="width:18px;height:18px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:8px"></div> \u6b63\u5728\u8bc6\u522b...';

    try {
      const devices = await CloudAPI.getDeviceList(accessCode, apiUrl);
      this._cloudDevices = devices || [];

      this._showCloudDeviceList(accessCode);
      this._refreshCloudDeviceRealtimePreview(accessCode);

    } catch (err) {
      this.showCloudError(`\u8bc6\u522b\u5931\u8d25: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> \u8bc6\u522b\u5e76\u83b7\u53d6\u8bbe\u5907\u5217\u8868';
    }
  },

  async _refreshCloudDeviceRealtimePreview(accessCode) {
    const devices = [...(this._cloudDevices || [])];
    for (let i = 0; i < devices.length; i += 4) {
      const batch = devices.slice(i, i + 4);
      await Promise.allSettled(batch.map(dev => CloudAPI.fetchAndCacheRealTime(dev.deviceAddr)));
      if (document.getElementById('cloud-step-devices')?.style.display !== 'none') {
        this._showCloudDeviceList(accessCode);
      }
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
    document.getElementById('cloud-account-display').textContent = `\u8bc6\u522b\u7801 ${accessCode}`;

    // Populate location dropdown
    const locs = DataRepository.listLocations();
    document.getElementById('cloud-import-location').innerHTML =
      '<option value="">-- \u5bfc\u5165\u5230\u5730\u5757(\u53ef\u9009) --</option>' +
      locs.map(l => `<option value="${l.id}">${l.name}</option>`).join('');

    const existingDevs = DataRepository.listDevices();
    const existingAddrs = new Set(existingDevs.filter(d => d.apiConfig).map(d => String(d.apiConfig.deviceAddr)));

    const listEl = document.getElementById('cloud-device-list');
    document.getElementById('cloud-device-count').textContent = `\u5171\u53d1\u73b0 ${this._cloudDevices.length} \u53f0\u8bbe\u5907`;

    listEl.innerHTML = this._cloudDevices.map(dev => {
      const isAdded = existingAddrs.has(String(dev.deviceAddr));
      const renameValue = this._cloudRenameMap[String(dev.deviceAddr)] || dev.deviceName || `\u4f20\u611f\u5668-${dev.deviceAddr}`;
      const cached = SensorEngine.getApiData(dev.deviceAddr);
      const statusBadge = cached
        ? '<span class="badge badge-online">\u25cf \u5728\u7ebf</span>'
        : '<span class="badge badge-offline">\u25cf \u672a\u77e5</span>';

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
            ${isAdded ? '<span class="cloud-already-badge">\u5df2\u5bfc\u5165</span>' : ''}
          </div>
          <div class="cloud-rename-row">
            <label>\u5bfc\u5165\u540d\u79f0</label>
            <input class="text-input cloud-rename-input" type="text" value="${renameValue.replace(/"/g, '&quot;')}" ${isAdded ? 'disabled' : ''}
              onclick="event.stopPropagation()" oninput="app.setCloudDeviceName('${dev.deviceAddr}', this.value)">
          </div>
          <div class="cloud-device-meta">
            <span>\ud83d\udce1 \u8bbe\u5907\u5730\u5740: ${dev.deviceAddr}</span>
            <span>\ud83d\udcca ${factors.length} \u4e2a\u4f20\u611f\u53c2\u6570</span>
          </div>
          <div class="cloud-device-factors">${valueTags}</div>
        </div>
        <div class="cloud-device-status">${statusBadge}</div>
      </div>`;
    }).join('');

    if (this._cloudDevices.length === 0) {
      listEl.innerHTML = '<div class="empty-state"><i class="fa-solid fa-inbox"></i><p>\u5f53\u524d\u8bc6\u522b\u7801\u4e0b\u6682\u65e0\u53ef\u5bfc\u5165\u8bbe\u5907</p></div>';
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

  async cloudImportSelected() {
    if (this._cloudSelected.size === 0) { this.showCloudError('\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u53f0\u8bbe\u5907'); return; }
    this.clearCloudError();
    const importBtn = document.getElementById('cloud-import-btn');
    if (importBtn) {
      importBtn.disabled = true;
      importBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> \u6b63\u5728\u5bfc\u5165...';
    }
    const locationId = document.getElementById('cloud-import-location')?.value || '';
    const devices = DataRepository.listDevices();

    const importedIds = [];
    this._cloudSelected.forEach(addr => {
      const cloudDev = this._cloudDevices.find(d => String(d.deviceAddr) === addr);
      if (!cloudDev) return;

      // Build factor names for the notes
      const factorNames = (cloudDev.factors || []).map(f => f.factorName).filter(Boolean);
      const customName = this._cloudRenameMap[String(addr)]?.trim();

      const newDev = {
        id: String(addr),
        name: customName || cloudDev.deviceName || `\u4f20\u611f\u5668-${addr}`,
        type: 'sensor_soil_api',
        locationId: locationId,
        address: String(addr),
        protocol: 'CloudAPI',
        streamUrl: '',
        notes: `\u5728\u7ebf\u4f20\u611f\u5668 | \u53c2\u6570: ${factorNames.join(', ')}`,
        online: true,
        lat: cloudDev.lat || 0,
        lng: cloudDev.lng || 0,
        apiConfig: {
          deviceAddr: String(addr),
          loginName: cloudDev.apiConfig?.loginName || '',
          password: cloudDev.apiConfig?.password || '',
          apiUrl: cloudDev.apiConfig?.apiUrl || 'http://www.0531yun.com',
          factors: cloudDev.factors || [],
        },
      };
      const existingIdx = devices.findIndex(d => d.id === newDev.id || String(d.apiConfig?.deviceAddr || '') === String(addr));
      if (existingIdx >= 0) devices[existingIdx] = newDev;
      else devices.push(newDev);
      importedIds.push(newDev.id);
    });

    DataRepository.saveDevices(devices);
    try {
      await SyncService.pushNowForced();
    } catch (err) {
      console.warn('[Import sync]', err.message);
      UI.toast('\u8bbe\u5907\u5df2\u5bfc\u5165\uff0c\u4f46\u540e\u7aef\u540c\u6b65\u5931\u8d25: ' + err.message, 'warning');
    }
    this._ensureDeviceCoords();
    this.closeModal('cloud');
    this.renderDevices();
    this.updateSidebarStatus();

    const initialFetchResults = await Promise.allSettled(importedIds.map(async id => {
      const dev = devices.find(item => item.id === id);
      const serverData = await BackendAdapter.getDeviceRealtime(id, { force: true });
      if (dev?.apiConfig && serverData?.ok && serverData?.dataItems) {
        SensorEngine.setApiData(dev.apiConfig.deviceAddr, serverData.dataItems, serverData.timestamp || Date.now());
      }
    }));
    initialFetchResults
      .filter(result => result.status === 'rejected')
      .forEach(result => console.warn('[Import initial fetch]', result.reason?.message || result.reason));
    if (this.currentPage === 'devices') this.renderDevices();
    if (this.currentPage === 'dashboard') this.initDashboard();
    if (this.currentPage === 'realtime') this.initRealtime();
    if (this.currentPage === 'history' || this.currentPage === 'chart') this.initHistory();
    if (this.currentPage === 'cloudsync') this.initCloudSync();
    UI.toast(`\u6210\u529f\u5bfc\u5165 ${this._cloudSelected.size} \u53f0\u8bbe\u5907\uff0c\u9996\u6761\u6570\u636e\u5df2\u5199\u5165`, 'success');
    this._cloudSelected = new Set();
    this._cloudRenameMap = {};
    if (importBtn) {
      importBtn.disabled = false;
      importBtn.innerHTML = '<i class="fa-solid fa-download"></i> \u5bfc\u5165\u9009\u4e2d\u8bbe\u5907 (<span id="cloud-import-count">0</span>)';
    }
  },
};

//     INIT    
document.addEventListener('DOMContentLoaded', () => {
  AuthService.bindLoginForm();
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        const closeBtn = overlay.querySelector('.modal-close');
        if (closeBtn) {
          closeBtn.classList.remove('hint-active');
          void closeBtn.offsetWidth;
          closeBtn.classList.add('hint-active');
          setTimeout(() => closeBtn.classList.remove('hint-active'), 600);
        }
      }
    });
  });
  window.agriRuntime = {
    setMode: (mode, patch) => app.setRuntimeMode(mode, patch),
    getConfig: () => DataRepository.getRuntimeConfig(),
    getEndpoints: () => DataRepository.getEndpointMap(),
  };
  app.init().catch(error => {
    console.error('[AppInit]', error);
    document.body.classList.remove('auth-pending');
    UI.toast('\u521d\u59cb\u5316\u5931\u8d25\uff0c\u8bf7\u5237\u65b0\u91cd\u8bd5', 'danger');
  });
});
