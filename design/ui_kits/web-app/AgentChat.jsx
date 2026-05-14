// AgentChat.jsx — floating "小薯" chat FAB + drawer

const AgentChat = () => {
  const [open, setOpen] = React.useState(false);
  const [msgs, setMsgs] = React.useState([
    { from: 'agent', text: '你好！我是小薯，你的智慧农业AI助手。你可以问我关于传感器数据、作物状况、病虫害防治等问题。' },
  ]);
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const scrollRef = React.useRef(null);

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs, open]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setMsgs(m => [...m, { from: 'user', text }]);
    setDraft('');
    setBusy(true);
    try {
      const reply = await window.claude.complete({
        messages: [
          { role: 'user', content: `你叫"小薯"，是中文智慧农业 AI 助手。简短中文回答（不超过2句）。问题：${text}` }
        ]
      });
      setMsgs(m => [...m, { from: 'agent', text: reply || '（未能获取回复）' }]);
    } catch (e) {
      setMsgs(m => [...m, { from: 'agent', text: '抱歉，连接超时。' }]);
    }
    setBusy(false);
  };

  return (
    <>
      <button onClick={() => setOpen(o => !o)} style={{
        position: 'fixed', bottom: 24, right: 24, width: 60, height: 60,
        borderRadius: '50%', border: 'none', cursor: 'pointer',
        background: 'linear-gradient(135deg,#1070e0,#7c3aed)', color: '#fff',
        boxShadow: '0 10px 28px rgba(16,112,224,0.42)',
        display: 'grid', placeItems: 'center', zIndex: 50,
      }} title="小薯 · AI 助手">
        <img src="../../assets/agent-sweet-potato.png" style={{ width: 36, height: 36, imageRendering: 'pixelated' }} />
      </button>

      {open && (
        <div style={{
          position: 'fixed', bottom: 100, right: 24, width: 360, height: 480,
          borderRadius: 20, background: 'rgba(255,255,255,0.96)',
          boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.92), inset -1px -1px 0 rgba(0,0,0,0.08), 0 16px 48px rgba(0,0,0,0.18)',
          display: 'flex', flexDirection: 'column', zIndex: 50,
          animation: 'scaleIn 0.2s cubic-bezier(0.4,0,0.2,1)'
        }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="../../assets/agent-sweet-potato.png" style={{ width: 28, height: 28, imageRendering: 'pixelated' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>小薯 · AI 农业助手</div>
              <div style={{ fontSize: 10, color: 'rgba(28,33,45,0.5)', fontFamily: 'var(--font-mono)' }}>Powered by Haiku</div>
            </div>
            <IconBtn icon="fa-solid fa-xmark" onClick={() => setOpen(false)} />
          </div>

          <div ref={scrollRef} style={{ flex: 1, padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {msgs.map((m, i) => (
              <div key={i} style={{ alignSelf: m.from === 'user' ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
                <div style={{
                  padding: '8px 12px', borderRadius: 14, fontSize: 13, lineHeight: 1.5,
                  background: m.from === 'user' ? '#1070e0' : '#f1f5f9',
                  color: m.from === 'user' ? '#fff' : 'rgba(22,26,38,0.94)',
                  borderBottomRightRadius: m.from === 'user' ? 4 : 14,
                  borderBottomLeftRadius:  m.from === 'agent' ? 4 : 14,
                }}>{m.text}</div>
              </div>
            ))}
            {busy && <div style={{ alignSelf: 'flex-start', padding: '8px 12px', background: '#f1f5f9', borderRadius: 14 }}><Spinner /></div>}
          </div>

          <div style={{ padding: 10, borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', gap: 6 }}>
            <Input placeholder="问问小薯…" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} style={{ flex: 1 }} />
            <Button kind="primary" icon="fa-solid fa-paper-plane" onClick={send} style={{ padding: '9px 12px' }}></Button>
          </div>
        </div>
      )}
    </>
  );
};

window.AgentChat = AgentChat;
