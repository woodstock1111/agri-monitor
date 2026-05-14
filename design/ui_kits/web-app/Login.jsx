// Login.jsx — branded login screen

const Login = ({ onLogin }) => {
  const [user, setUser] = React.useState('admin');
  const [pwd, setPwd] = React.useState('admin123456');
  const [err, setErr] = React.useState('');
  const submit = (e) => {
    e.preventDefault();
    if (user === 'admin' && pwd === 'admin123456') onLogin();
    else setErr('账号或密码错误');
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'grid', placeItems: 'center',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* watermark crest */}
      <img src="../../assets/logo.jpg" alt="" style={{
        position: 'absolute', width: 460, height: 460, borderRadius: '50%',
        right: -40, top: '50%', transform: 'translateY(-50%)',
        filter: 'saturate(1.2)', opacity: 0.18, pointerEvents: 'none'
      }} />
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(115deg, rgba(13,25,48,0.84), rgba(13,25,48,0.52))'
      }} />

      <Card style={{
        position: 'relative', width: 420, padding: '32px 36px',
        animation: 'scaleIn 0.28s cubic-bezier(0.4,0,0.2,1)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <img src="../../assets/agent-sweet-potato.png" alt="" style={{
            width: 56, height: 56, imageRendering: 'pixelated', borderRadius: 12
          }} />
          <div>
            <Eyebrow>Tropical Crops · 1958</Eyebrow>
            <div style={{
              fontSize: 22, fontWeight: 700, lineHeight: 1.1, marginTop: 4,
              background: 'linear-gradient(90deg,#2563eb,#7c3aed,#06b6d4)',
              WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent'
            }}>欢迎使用</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>AI 智慧农业 Agent</div>
          </div>
        </div>

        <div style={{ fontSize: 13, color: 'rgba(28,33,45,0.72)', marginBottom: 18, lineHeight: 1.55 }}>
          登录后继续管理农田数据、图像标注和智能分析。
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="账号" required>
            <Input value={user} onChange={e => setUser(e.target.value)} placeholder="admin" />
          </Field>
          <Field label="密码" required>
            <Input type="password" value={pwd} onChange={e => setPwd(e.target.value)} />
          </Field>
          {err && <div style={{ fontSize: 12, color: '#a63029', display: 'flex', gap: 6, alignItems: 'center' }}>
            <i className="fa-solid fa-triangle-exclamation"></i>{err}
          </div>}
          <Button kind="primary" icon="fa-solid fa-arrow-right-to-bracket" style={{ marginTop: 4, justifyContent: 'center' }}>登录</Button>
        </form>

        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(0,0,0,0.06)', fontSize: 11, color: 'rgba(28,33,45,0.50)', fontFamily: 'var(--font-mono)' }}>
          热带作物种质资源研究所 · 海口
        </div>
      </Card>
    </div>
  );
};

window.Login = Login;
