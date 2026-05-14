// App.jsx — top-level state machine

const App = () => {
  const [authed, setAuthed] = React.useState(false);
  const [page, setPage] = React.useState('dashboard');
  const [location, setLocation] = React.useState('🗺️ 海口示范区');

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;

  let body;
  if (page === 'dashboard') body = <Dashboard location={location} />;
  else if (page === 'realtime') body = <RealtimeData location={location} />;
  else body = (
    <Card style={{ padding: 40, textAlign: 'center' }}>
      <Eyebrow>WIP</Eyebrow>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8 }}>该页面在 UI 套件中暂未实现</div>
      <div style={{ fontSize: 13, color: 'rgba(28,33,45,0.72)', marginTop: 8 }}>
        请查看「系统总览」或「实时数据」获取代表性页面。
      </div>
      <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center', gap: 8 }}>
        <Button kind="secondary" onClick={() => setPage('dashboard')}>返回总览</Button>
        <Button kind="primary"   onClick={() => setPage('realtime')}>实时数据</Button>
      </div>
    </Card>
  );

  return (
    <AppShell active={page} onNavigate={setPage} location={location} onLocation={setLocation} onLogout={() => setAuthed(false)}>
      {body}
    </AppShell>
  );
};

window.App = App;
