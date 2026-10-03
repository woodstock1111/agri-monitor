// 数据层：地块、设备、天气从哪来，摆放位置存到哪。
//   演示模式（默认）：本地生成的 20 块示例地，拖进去的设备不保存。
//   真实模式（管理员在「账号管理」给账号打开）：读网页的地块和设备（app-state），
//   写入一律交给父页面的 FarmBridge（app.js），和网页其他地方共用一个写入方，不会两份快照互相覆盖。
// 页面直接打开 /farm/index.html（不在网页里）时没有 FarmBridge，只能是演示模式。
import { plotShape, STAGE_NAMES } from './plotgeo.js';
import { mulberry32, CN_NUM } from './util.js';

export const MAX_PLOTS = 20;

const SENSOR = (d) => String(d.type || '').startsWith('sensor');
const CAMERA = (d) => d.type === 'camera';
const IRRIGATION = (d) => d.type === 'controller_water';

function bridge() {
  try { return window.parent !== window ? window.parent.FarmBridge || null : null; } catch { return null; }
}

// ---------- 读数 ----------
function registerItems(rt) {
  return rt?.dataItems?.flatMap((n) => n.registerItem || []) || [];
}
// 土壤湿度：优先「土壤…湿」，其次任何带「湿」或「含水」的通道
function moistureItem(items) {
  return items.find((i) => /土壤.*(湿|含水)/.test(i.registerName)) || items.find((i) => /湿|含水/.test(i.registerName)) || null;
}
const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

// 甘薯生育期：按定植后天数（大致：缓苗 30 天、分枝结薯到 60 天、封垄到 100 天，之后膨大）
function stageFromPlantDate(date) {
  const t = Date.parse(date);
  if (!Number.isFinite(t)) return null;
  const days = (Date.now() - t) / 86400000;
  if (days < 0) return null;
  return days < 30 ? 'seedling' : days < 60 ? 'growing' : days < 100 ? 'lush' : 'ripening';
}

function validCoords(lat, lng) {
  const y = num(lat), x = num(lng);
  return y != null && x != null && Math.abs(y) <= 90 && Math.abs(x) <= 180 && !(y === 0 && x === 0) ? { lat: y, lng: x } : null;
}

// ---------- 演示数据 ----------
const VARIETIES = ['烟薯25', '西瓜红', '普薯32', '济薯26', '商薯19', '桥头地瓜'];
const ALERT_DEFS = {
  pest: { title: '虫情预警', short: '虫情', detail: '测报灯捕获斜纹夜蛾 23 头/夜，田间幼虫约 6 头/㎡', advice: '建议傍晚喷施甲维盐，已通知老张' },
  dry: { title: '土壤缺水', short: '缺水', detail: '20cm 墒情 13.8%，低于阈值 18%', advice: '建议浇水 20 分钟，浇完自动解除' },
  disease: { title: '病害风险', short: '病害', detail: '图像识别疑似甘薯黑斑病，叶片褐斑 4 处', advice: '建议拔除病株并喷施多菌灵' },
};
const ALERT_PLAN = { 1: 'pest', 4: 'dry', 7: 'disease', 11: 'dry', 14: 'pest', 17: 'disease' };

function demoPlot(i) {
  const shape = plotShape(i);
  const rng = mulberry32(700 + i * 37);
  const alert = ALERT_PLAN[i];
  const b = shape.blocks[shape.blocks.length - 1];
  return {
    id: `demo-${i}`, slot: i, demo: true,
    name: `${CN_NUM[i]}号地`,
    variety: VARIETIES[i % VARIETIES.length],
    stageKey: null,
    stage: STAGE_NAMES[shape.stage],
    areaMu: (shape.blocks.reduce((a, x) => a + x.w * x.d, 0) * 9 / 666.7).toFixed(1),
    coords: null,
    moisture: alert === 'dry' ? 13.8 : 20 + rng() * 9,
    alerts: alert ? [{ type: alert, ...ALERT_DEFS[alert] }] : [],
    devices: [{ id: `SP-${String(i + 1).padStart(2, '0')}`, type: 'probe', name: '土壤传感器', online: true, placed: { x: b.x + b.w * 0.25, z: b.z - b.d * 0.2 } }],
    weatherPlaced: null,
    irrigation: [],
  };
}

// ---------- 真实数据 ----------
function realPlot(loc, slot, devices, realtime) {
  const meta = loc.metadata || {};
  const stageKey = stageFromPlantDate(meta.plantDate);
  const mine = devices.filter((d) => d.locationId === loc.id);
  const alerts = [];
  let moisture = null;
  const list = [];
  for (const d of mine) {
    if (!SENSOR(d) && !CAMERA(d)) continue;
    const scene = d.metadata?.farmScene;
    // 设备换了地块，旧位置就不算了
    const placed = scene && scene.locationId === loc.id && Number.isFinite(scene.x) && Number.isFinite(scene.z) ? { x: scene.x, z: scene.z } : null;
    const rt = realtime[d.id] || null;
    const items = registerItems(rt);
    if (SENSOR(d)) {
      if (moisture == null) moisture = num(moistureItem(items)?.value);
      for (const it of items) {
        const lv = Number(it.alarmLevel) || 0;
        if (lv < 1) continue;
        alerts.push({
          type: 'sensor', short: lv >= 3 ? '报警' : '预警',
          title: `${d.name || '传感器'} ${lv >= 3 ? '报警' : '预警'}`,
          detail: `${it.registerName} ${it.value ?? '—'}${it.unit || ''}`,
          advice: '按传感器平台里设置的阈值判断',
        });
      }
    }
    list.push({
      id: d.id, type: SENSOR(d) ? 'probe' : 'camera', name: d.name || (SENSOR(d) ? '传感器' : '摄像头'),
      online: d.online !== false, placed, items, updatedAt: rt?.receivedAt || rt?.deviceTimestamp || null, streamUrl: d.streamUrl || '',
    });
  }
  const ws = meta.farmScene?.weather;
  return {
    id: loc.id, slot,
    name: loc.name || `地块${slot + 1}`,
    variety: meta.variety || loc.type || '未填写品种',
    stageKey,
    stage: stageKey ? STAGE_NAMES[stageKey] : '未填定植日期',
    areaMu: num(loc.area) ? num(loc.area) : null,
    coords: validCoords(loc.lat, loc.lng),
    moisture, alerts, devices: list,
    weatherPlaced: ws && Number.isFinite(ws.x) && Number.isFinite(ws.z) ? { x: ws.x, z: ws.z } : null,
    // 灌溉控制器：现在还没有，浇水只播动画；接上以后 FarmActions.water 用它开阀
    irrigation: mine.filter(IRRIGATION).map((d) => d.id),
  };
}

// 每块地在岛上的位置（slot）存在 location.metadata.farmScene.slot，删一块地不会让别的地挪位。
// 还没有 slot 的地块按顺序补到空位并保存；和别的地撞了（平台管理员能看到所有客户的地）只临时挪开，不改别人的数据。
function assignSlots(locations, b) {
  const out = new Array(MAX_PLOTS).fill(null);
  const pending = [];
  for (const loc of locations) {
    const s = loc.metadata?.farmScene?.slot;
    if (Number.isInteger(s) && s >= 0 && s < MAX_PLOTS && !out[s]) out[s] = loc;
    else pending.push([loc, Number.isInteger(s)]);
  }
  let extra = 0;
  for (const [loc, hadSlot] of pending) {
    const free = out.indexOf(null);
    if (free < 0) { extra++; continue; }
    out[free] = loc;
    if (!hadSlot) b.saveLocationScene(loc.id, { slot: free });
  }
  return { bySlot: out, extra };
}

// ---------- 对外 ----------
export function createDataSource() {
  const b = bridge();
  const mode = b && b.mode() === 'real' ? 'real' : 'demo';
  const weatherCache = new Map(); // plotId -> { at, promise, value, error }

  const src = {
    mode,
    extra: 0, // 超过 20 块、没上图的地块数

    // 返回长度 20 的数组，没启用的位置是 null。演示模式下 n 是启用几块
    plots(n = 12) {
      if (mode === 'demo') return Array.from({ length: MAX_PLOTS }, (_, i) => (i < n ? demoPlot(i) : null));
      const snap = b.snapshot();
      const { bySlot, extra } = assignSlots(snap.locations, b);
      src.extra = extra;
      return bySlot.map((loc, i) => (loc ? realPlot(loc, i, snap.devices, snap.realtime) : null));
    },

    // 真实模式：重新拉一遍上了图的传感器的读数（服务器缓存，不会去打设备平台）
    async refresh(plots) {
      if (mode === 'demo') return;
      const ids = plots.flatMap((p) => p?.devices.filter((d) => d.type === 'probe').map((d) => d.id) || []);
      if (ids.length) await b.refreshRealtime(ids);
    },

    placeDevice(plot, id, x, z) {
      if (mode === 'real') b.saveDeviceScene(id, { locationId: plot.id, x: +x.toFixed(2), z: +z.toFixed(2) });
    },
    unplaceDevice(plot, id) {
      if (mode === 'real') b.saveDeviceScene(id, null);
    },
    placeWeather(plot, x, z) {
      if (mode === 'real') b.saveLocationScene(plot.id, { weather: { x: +x.toFixed(2), z: +z.toFixed(2) } });
    },
    unplaceWeather(plot) {
      if (mode === 'real') b.saveLocationScene(plot.id, { weather: null });
    },

    // 地块当地的实时天气（高德，按地块经纬度），15 分钟内不重复请求
    weather(plot) {
      if (mode === 'demo' || !plot.coords) return null;
      let c = weatherCache.get(plot.id);
      if (!c || Date.now() - c.at > 15 * 60 * 1000) {
        c = { at: Date.now(), value: null, error: null };
        c.promise = b.weather(plot.coords.lat, plot.coords.lng).then((w) => { c.value = w; }, (e) => { c.error = e.message || '天气暂时取不到'; });
        weatherCache.set(plot.id, c);
      }
      return c;
    },
  };
  return src;
}

// 浇水：现在没有灌溉控制器，只播动画、不真的开阀。
// 接控制器时在这里按 plot.irrigation（controller_water 设备）下发开阀，失败就 reject，页面会提示。
export const FarmActions = {
  async water({ plot }) {
    return { simulated: true, controllers: plot.irrigation };
  },
};
