// Dashboard.jsx — system overview page

const Dashboard = ({ location }) => {
  const alerts = [
    { time: '14:08:21', tone: 'warning', icon: 'fa-temperature-half', text: 'A-3 温室温度高于阈值', detail: '32.6 °C · 阈值 32.0' },
    { time: '13:55:02', tone: 'success', icon: 'fa-cloud-arrow-down', text: '0531yun · 已同步 12 条记录', detail: 'admin · CLOUD' },
    { time: '13:42:11', tone: 'info',    icon: 'fa-droplet',          text: 'B-2 自动灌溉 启动', detail: '土壤湿度 < 40%' },
    { time: '13:18:44', tone: 'success', icon: 'fa-circle-check',     text: '设备 SN 4f-2e3a 在线', detail: 'RSSI -68 dBm' },
    { time: '12:50:00', tone: 'danger',  icon: 'fa-plug-circle-xmark',text: 'C-1 控制器离线 18 分钟', detail: '已尝试重连 3 次' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <Eyebrow>{location} · 系统总览</Eyebrow>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.5px', margin: '6px 0 0' }}>今日田间状态</h1>
          <div style={{ fontSize: 13, color: 'rgba(28,33,45,0.72)', marginTop: 6 }}>
            12 个传感器在线 · 3 个控制器待命 · <LiveBadge />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button kind="secondary" icon="fa-solid fa-rotate">刷新</Button>
          <Button kind="cloud" icon="fa-solid fa-cloud-arrow-down">从云端补充</Button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        <KPI label="温度"   value="26.4"   unit="°C"  delta="1.2 vs 1h" deltaUp color="#ff9f0a" icon="fa-solid fa-temperature-half" />
        <KPI label="湿度"   value="68.2"   unit="%"   delta="2.0"      color="#3b82f6" icon="fa-solid fa-droplet" />
        <KPI label="光照"   value="12,480" unit="lux" delta="320" deltaUp color="#fbbf24" icon="fa-solid fa-sun" />
        <KPI label="CO₂"    value="412"    unit="ppm" delta="8"   deltaUp color="#34c759" icon="fa-solid fa-leaf" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
        <Card style={{ padding: 0, overflow: 'hidden', minHeight: 320 }}>
          <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <div>
              <Eyebrow>设备地图</Eyebrow>
              <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>海口示范区 · 12 设备</div>
            </div>
            <IconBtn icon="fa-solid fa-expand" title="全屏" />
          </div>
          {/* fake map */}
          <div style={{
            height: 280, background:
              'radial-gradient(circle at 30% 30%, #d4ecd1, transparent 40%),' +
              'radial-gradient(circle at 70% 60%, #cfe5ff, transparent 40%),' +
              'linear-gradient(135deg,#eaf5ec,#dee9f5)',
            position: 'relative'
          }}>
            {[
              [22, 38, 'success', 'A-3'],
              [44, 28, 'success', 'A-4'],
              [62, 54, 'warning', 'B-2'],
              [78, 38, 'success', 'B-5'],
              [38, 70, 'danger',  'C-1'],
              [70, 78, 'success', 'C-3'],
            ].map(([x, y, tone, label], i) => {
              const c = { success: '#34c759', warning: '#ff9f0a', danger: '#ff3b30' }[tone];
              return (
                <div key={i} style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, transform: 'translate(-50%,-50%)' }}>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: c, boxShadow: `0 0 0 6px ${c}33, 0 0 0 12px ${c}1a` }} />
                  <div style={{ fontSize: 10, marginTop: 2, fontFamily: 'var(--font-mono)', color: 'rgba(22,26,38,0.78)', textAlign: 'center' }}>{label}</div>
                </div>
              );
            })}
            <div style={{ position: 'absolute', bottom: 12, right: 14, fontSize: 10, color: 'rgba(22,26,38,0.5)', fontFamily: 'var(--font-mono)' }}>
              19.99°N, 110.34°E · LEAFLET PLACEHOLDER
            </div>
          </div>
        </Card>

        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <Eyebrow>实时告警</Eyebrow>
              <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>最近 1 小时</div>
            </div>
            <Pill tone="warning">2 待处理</Pill>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {alerts.map((a, i) => {
              const tone = { warning:'#ff9f0a', success:'#34c759', info:'#3b82f6', danger:'#ff3b30' }[a.tone];
              return (
                <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 18px', borderBottom: i < alerts.length - 1 ? '1px solid rgba(0,0,0,0.04)' : 'none' }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: tone + '22', color: tone, display: 'grid', placeItems: 'center', flex: 'none' }}>
                    <i className={`fa-solid ${a.icon}`}></i>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{a.text}</div>
                    <div style={{ fontSize: 11, color: 'rgba(28,33,45,0.5)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>{a.time} · {a.detail}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
};

window.Dashboard = Dashboard;
