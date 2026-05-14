// primitives.jsx — shared visual atoms used across the kit

const Card = ({ children, style, className = '', onClick }) => (
  <div className={className} onClick={onClick} style={{
    background: 'rgba(255,255,255,0.92)',
    borderRadius: 20,
    boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.92), inset -1px -1px 0 rgba(0,0,0,0.08), 0 8px 32px rgba(0,0,0,0.08)',
    padding: 18,
    ...style
  }}>{children}</div>
);

const Eyebrow = ({ children, style }) => (
  <div style={{
    fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
    textTransform: 'uppercase', color: 'rgba(28,33,45,0.50)', ...style
  }}>{children}</div>
);

const btnBase = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '9px 16px', borderRadius: 12, border: 'none',
  fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer',
  transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
};
const Button = ({ kind = 'primary', icon, children, style, ...rest }) => {
  const map = {
    primary:   { background: '#1070e0', color: '#fff' },
    secondary: { background: '#fff', color: '#1070e0', boxShadow: 'inset 0 0 0 1px #cbd5e1' },
    danger:    { background: '#ff3b30', color: '#fff' },
    ghost:     { background: 'transparent', color: 'rgba(28,33,45,0.72)' },
    cloud:     { background: 'linear-gradient(135deg,#667eea,#764ba2)', color: '#fff', boxShadow: '0 4px 12px rgba(118,75,162,0.28)' },
  };
  return (
    <button {...rest} style={{ ...btnBase, ...map[kind], ...style }}>
      {icon && <i className={icon}></i>}
      {children}
    </button>
  );
};

const IconBtn = ({ icon, onClick, title }) => (
  <button title={title} onClick={onClick} style={{
    width: 36, height: 36, padding: 0, borderRadius: 10,
    background: '#fff', color: 'rgba(28,33,45,0.72)',
    border: 'none', boxShadow: 'inset 0 0 0 1px #e2e8f0',
    cursor: 'pointer', display: 'grid', placeItems: 'center',
    fontSize: 14, transition: 'all 0.2s'
  }}>
    <i className={icon}></i>
  </button>
);

const Pill = ({ tone = 'info', children, style }) => {
  const map = {
    success: { bg: '#ecfdf5', fg: '#1f8d3e' },
    warning: { bg: '#fffbeb', fg: '#a86200' },
    danger:  { bg: '#fef2f2', fg: '#a63029' },
    info:    { bg: '#eff6ff', fg: '#1f5fb6' },
    accent:  { bg: '#e8f0fe', fg: '#1070e0' },
    neutral: { bg: '#f1f5f9', fg: '#475569' },
  };
  const t = map[tone] || map.info;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 999,
      fontSize: 11, fontWeight: 600,
      background: t.bg, color: t.fg, ...style
    }}>{children}</span>
  );
};

const LiveBadge = () => (
  <span style={{
    padding: '3px 9px 3px 9px', borderRadius: 8, fontSize: 10, letterSpacing: '0.08em',
    fontWeight: 700, background: '#34c759', color: '#fff',
    display: 'inline-flex', alignItems: 'center', gap: 6
  }}>
    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', animation: 'pulse 2s infinite' }} />
    LIVE
  </span>
);

const Field = ({ label, hint, required, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 500, color: 'rgba(28,33,45,0.72)' }}>
    <span>{label}{required && ' *'}{hint && <span style={{ color: 'rgba(28,33,45,0.50)', fontWeight: 400, marginLeft: 6 }}>({hint})</span>}</span>
    {children}
  </label>
);

const Input = ({ style, ...rest }) => (
  <input {...rest} style={{
    padding: '10px 12px', fontSize: 14, fontFamily: 'inherit',
    borderRadius: 12, border: '1px solid #e2e8f0', background: '#fff',
    color: 'rgba(22,26,38,0.94)', outline: 'none', transition: '0.2s',
    ...style
  }}
  onFocus={e => { e.target.style.borderColor = '#1070e0'; e.target.style.boxShadow = '0 0 0 3px rgba(16,112,224,0.10)'; }}
  onBlur={e => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; }}
  />
);

const KPI = ({ label, value, unit, delta, deltaUp, color, icon }) => (
  <Card>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: 'rgba(28,33,45,0.72)', fontWeight: 500 }}>{label}</span>
      <div style={{
        width: 32, height: 32, borderRadius: 10, background: color,
        display: 'grid', placeItems: 'center', color: '#fff', fontSize: 14
      }}>
        <i className={icon}></i>
      </div>
    </div>
    <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
      {value}
      {unit && <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(28,33,45,0.50)', marginLeft: 4 }}>{unit}</span>}
    </div>
    {delta && (
      <div style={{ fontSize: 11, fontWeight: 600, marginTop: 8, color: deltaUp ? '#1f8d3e' : '#a63029' }}>
        {deltaUp ? '▲' : '▼'} {delta}
      </div>
    )}
  </Card>
);

const Spinner = ({ size = 16 }) => (
  <span style={{
    display: 'inline-block', width: size, height: size,
    border: `2px solid rgba(16,112,224,0.20)`, borderTopColor: '#1070e0',
    borderRadius: '50%', animation: 'spin 0.8s linear infinite'
  }} />
);

// global keyframes
if (!document.getElementById('__agri_kf')) {
  const s = document.createElement('style');
  s.id = '__agri_kf';
  s.textContent = `
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
    @keyframes scaleIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  `;
  document.head.appendChild(s);
}

Object.assign(window, { Card, Eyebrow, Button, IconBtn, Pill, LiveBadge, Field, Input, KPI, Spinner });
