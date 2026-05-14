# Agri Monitor · Web App UI kit

A click-thru recreation of the core Agri Monitor admin SPA, mirroring the live `index.html` + Era-2 (`Liquid Glass`) styling from `style.css` in the upstream repo.

## Files

- `index.html` — entry. Loads React 18 + Babel + Font Awesome 6 + design tokens, then renders the `<App>` from `App.jsx`.
- `App.jsx` — top-level state machine: login → main app, holds the active page + selected location.
- `AppShell.jsx` — sidebar + topbar layout shell.
- `Login.jsx` — branded login screen (institute crest watermark + sweet-potato lockup).
- `Dashboard.jsx` — the system-overview page (KPI strip + alert feed + device map placeholder).
- `RealtimeData.jsx` — sensor grid + recent-readings table.
- `AgentChat.jsx` — floating "小薯" chat FAB + drawer.
- `primitives.jsx` — Card / Button / Pill / Field / Modal / KPI / Eyebrow / Spinner used across pages.

## Coverage

- ✅ Login, sidebar nav, topbar, dashboard, realtime data, agent chat
- ✅ Buttons / inputs / badges / KPI / table / modal primitives
- ⚠️ Map (Leaflet) is a static placeholder
- ⚠️ Pages beyond Dashboard + Realtime are **stubbed** (the kit picks 2 representative pages rather than rebuilding all 12)
- ⚠️ Charts not implemented (Chart.js usage is single-purpose; not core to the visual system)

## Notes

The agent floating chat is wired with `window.claude.complete` so you can actually talk to "小薯". Disable by removing `<AgentChat />` from `AppShell.jsx`.
