// RealtimeData.jsx — sensor grid + recent readings table

const sensors = [
  { name: 'A-3 温度',      value: '26.4', unit: '°C',  tone: 'success', icon: 'fa-temperature-half', color: '#ff9f0a' },
  { name: 'A-3 空气湿度',  value: '68.2', unit: '%',   tone: 'success', icon: 'fa-droplet',          color: '#3b82f6' },
  { name: 'A-3 土壤湿度',  value: '42.0', unit: '%',   tone: 'warning', icon: 'fa-glass-water',      color: '#06b6d4' },
  { name: 'A-3 光照',      value: '12,480', unit: 'lux', tone: 'success', icon: 'fa-sun',           color: '#fbbf24' },
  { name: 'A-3 CO₂',       value: '412',   unit: 'ppm', tone: 'success', icon: 'fa-leaf',          color: '#34c759' },
  { name: 'B-2 温度',      value: '32.6',  unit: '°C',  tone: 'danger',  icon: 'fa-temperature-half', color: '#ff3b30' },
];

const readings = [
  ['14:08:21', 'A-3', '温度',     '26.4 °C',  'success'],
  ['14:08:18', 'A-3', '湿度',     '68.2 %',   'success'],
  ['14:08:16', 'B-2', '温度',     '32.6 °C',  'danger'],
  ['14:08:11', 'A-3', '土壤湿度', '42.0 %',   'warning'],
  ['14:08:08', 'A-3', '光照',     '12,480 lux','success'],
  ['14:07:55', 'C-3', 'CO₂',      '418 ppm',  'success'],
  ['14:07:42', 'A-4', '温度',     '25.9 °C',  'success'],
];

const RealtimeData = ({ location }) => {
  const [filter, setFilter] = React.useState('全部');
  const filters = ['全部', '温度', '湿度', '光照', 'CO₂'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <Eyebrow>{location} · 实时数据</Eyebrow>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.5px', margin: '6px 0 0' }}>传感器读数</h1>
          <div style={{ fontSize: 13, color: 'rgba(28,33,45,0.72)', marginTop: 6, display: 'flex', gap: 10, alignItems: 'center' }}>
            <LiveBadge />模拟数据实时更新中 · 6 路在线
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button kind="secondary" icon="fa-solid fa-filter">筛选</Button>
          <Button kind="secondary" icon="fa-solid fa-file-excel">导出</Button>
          <Button kind="cloud"     icon="fa-solid fa-cloud-arrow-down">从云端补充</Button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {sensors.map((s, i) => (
          <Card key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 12, color: 'rgba(28,33,45,0.50)', fontWeight: 500 }}>{s.name}</div>
                <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                  {s.value}<span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(28,33,45,0.50)', marginLeft: 4 }}>{s.unit}</span>
                </div>
              </div>
              <div style={{ width: 36, height: 36, borderRadius: 12, background: s.color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 15 }}>
                <i className={`fa-solid ${s.icon}`}></i>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Pill tone={s.tone}>{s.tone === 'danger' ? '超阈值' : s.tone === 'warning' ? '注意' : '正常'}</Pill>
              <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#1070e0' }}>5s 前</span>
            </div>
          </Card>
        ))}
      </div>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Eyebrow>最近读数</Eyebrow>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>recordTimeStr 倒序</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {filters.map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                fontFamily: 'inherit', cursor: 'pointer', border: 'none',
                background: filter === f ? '#1070e0' : '#fff',
                color: filter === f ? '#fff' : '#475569',
                boxShadow: filter === f ? 'none' : 'inset 0 0 0 1px #cbd5e1'
              }}>{f}</button>
            ))}
          </div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
              {['时间', '设备', '参数', '读数', '状态'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 18px', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(28,33,45,0.5)', fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {readings.filter(r => filter === '全部' || r[2].includes(filter)).map((r, i) => (
              <tr key={i} style={{ borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                <td style={{ padding: '10px 18px', fontFamily: 'var(--font-mono)', color: '#1070e0' }}>{r[0]}</td>
                <td style={{ padding: '10px 18px', fontWeight: 600 }}>{r[1]}</td>
                <td style={{ padding: '10px 18px', color: 'rgba(28,33,45,0.72)' }}>{r[2]}</td>
                <td style={{ padding: '10px 18px', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{r[3]}</td>
                <td style={{ padding: '10px 18px' }}><Pill tone={r[4]}>{r[4] === 'success' ? '正常' : r[4] === 'warning' ? '注意' : '超阈值'}</Pill></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
};

window.RealtimeData = RealtimeData;
