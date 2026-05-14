// AppShell.jsx — sidebar + topbar layout

const NAV = [
  { group: '数据展示', items: [
    { id: 'dashboard', label: '系统总览',   icon: 'fa-gauge-high' },
    { id: 'tasks',     label: '农事计划',   icon: 'fa-seedling' },
    { id: 'realtime',  label: '实时数据',   icon: 'fa-wave-square' },
    { id: 'video',     label: '视频监控',   icon: 'fa-video' },
    { id: 'charts',    label: '曲线图表',   icon: 'fa-chart-line' },
    { id: 'history',   label: '历史记录',   icon: 'fa-list-ul' },
  ]},
  { group: '智能控制', items: [
    { id: 'rules',  label: '自动化流程', icon: 'fa-wand-magic-sparkles' },
    { id: 'pests',  label: '病害虫数据库', icon: 'fa-bug' },
    { id: 'photos', label: 'AI 记录', icon: 'fa-camera' },
  ]},
  { group: '系统管理', items: [
    { id: 'locations', label: '地块管理', icon: 'fa-map-marked-alt' },
    { id: 'devices',   label: '设备管理', icon: 'fa-microchip' },
    { id: 'accounts',  label: '账号管理', icon: 'fa-users-gear' },
  ]},
];

const Sidebar = ({ active, onNavigate }) => (
  <aside style={{
    width: 240, flex: 'none',
    background: '#1b2a4a', color: '#fff',
    borderRadius: 24, padding: '14px 0',
    margin: 14, marginRight: 0,
    boxShadow: '0 12px 40px rgba(13,25,48,0.20)',
    display: 'flex', flexDirection: 'column',
    height: 'calc(100vh - 28px)',
    position: 'sticky', top: 14,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 16px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)', margin: '0 4px 8px' }}>
      <img src="../../assets/agent-sweet-potato.png" style={{ width: 36, height: 36, imageRendering: 'pixelated', borderRadius: 8, background: 'rgba(255,255,255,0.1)' }} />
      <div>
        <div style={{
          fontWeight: 700, fontSize: 15,
          background: 'linear-gradient(90deg,#7dd3fc,#c4b5fd,#67e8f9)',
          WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent'
        }}>智慧农业 · 小薯</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>v0.531 · 1958</div>
      </div>
    </div>

    <div style={{ flex: 1, overflowY: 'auto', padding: '0 4px' }}>
      {NAV.map(group => (
        <div key={group.group}>
          <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', padding: '12px 14px 6px' }}>{group.group}</div>
          {group.items.map(it => (
            <div key={it.id} onClick={() => onNavigate(it.id)} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '9px 14px', fontSize: 13,
              color: active === it.id ? '#fff' : 'rgba(255,255,255,0.78)',
              background: active === it.id ? 'rgba(255,255,255,0.10)' : 'transparent',
              borderRadius: 10, position: 'relative', cursor: 'pointer',
              transition: '0.18s'
            }}>
              {active === it.id && <span style={{ position: 'absolute', left: -4, top: 8, bottom: 8, width: 3, background: '#34c759', borderRadius: '0 2px 2px 0' }} />}
              <i className={`fa-solid ${it.icon}`} style={{ width: 16, textAlign: 'center' }}></i>
              {it.label}
            </div>
          ))}
        </div>
      ))}
    </div>

    <div style={{ padding: '12px 18px 4px', borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--font-mono)' }}>
      Tropical Crops · Hai Kou
    </div>
  </aside>
);

const Topbar = ({ location, onLocation, onLogout }) => (
  <header style={{
    height: 66, padding: '0 22px',
    display: 'flex', alignItems: 'center', gap: 14,
    background: 'rgba(255,255,255,0.92)', borderRadius: 20, margin: '14px 14px 0 14px',
    boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.92), inset -1px -1px 0 rgba(0,0,0,0.08), 0 8px 32px rgba(0,0,0,0.06)'
  }}>
    <IconBtn icon="fa-solid fa-bars" />
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(28,33,45,0.72)' }}>
      <i className="fa-solid fa-location-dot" style={{ color: '#1070e0' }}></i>
      <select value={location} onChange={e => onLocation(e.target.value)} style={{
        border: 'none', background: 'transparent', font: 'inherit', cursor: 'pointer', color: 'rgba(22,26,38,0.94)'
      }}>
        <option>🗺️ 海口示范区</option>
        <option>🗺️ 三亚 A 园</option>
        <option>🗺️ 全部地块</option>
      </select>
    </div>
    <div style={{ flex: 1 }}></div>
    <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'rgba(28,33,45,0.50)' }}>
      <i className="fa-solid fa-clock" style={{ marginRight: 6 }}></i>
      2026-05-03 14:08:21
    </span>
    <IconBtn icon="fa-solid fa-bell" />
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px 4px 4px', background: '#fff', borderRadius: 999, boxShadow: 'inset 0 0 0 1px #e2e8f0' }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#1070e0', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>A</div>
      <span style={{ fontSize: 12, fontWeight: 600 }}>admin</span>
    </div>
    <IconBtn icon="fa-solid fa-arrow-right-from-bracket" onClick={onLogout} title="退出" />
  </header>
);

const AppShell = ({ children, active, onNavigate, location, onLocation, onLogout }) => (
  <div style={{ display: 'flex', minHeight: '100vh' }}>
    <Sidebar active={active} onNavigate={onNavigate} />
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <Topbar location={location} onLocation={onLocation} onLogout={onLogout} />
      <main style={{ padding: '22px 28px 32px', flex: 1, maxWidth: 1240, width: '100%', margin: '0 auto' }}>
        {children}
      </main>
    </div>
    <AgentChat />
  </div>
);

window.AppShell = AppShell;
