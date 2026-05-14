# Agri Monitor (智慧农业监测平台 / AI 智慧农业 Agent)

> A LoRa-based smart-agriculture monitoring & control platform built for tropical-crop research stations. Pulls realtime sensor data from cloud-connected field devices (the "0531yun" cloud), displays it in a Chinese-language dashboard, and runs IF-THEN automation against irrigation, lighting, and ventilation controllers. Identity is fronted by a friendly pixel-art sweet-potato AI agent named **小薯 (Xiǎo Shǔ — "Little Sweet Potato")**.

## Sources

- **Code repo:** `woodstock1111/agri-monitor` (default branch: `main`).
  - `index.html` — single-page app shell, all modals, login.
  - `style.css` — full visual system (two cascading layers; the second one — labelled `iOS 17/18 Liquid Glass Redesign Overrides` — is the **current visual design**).
  - `app.js` (≈284k) — all frontend logic. Not imported here; we lifted patterns from `index.html` markup instead.
  - `server.js` — Node API. Not relevant to design.
  - `ARCHITECTURE.md`, `CURRENT_STATUS.md`, `DEPLOYMENT.md` — context docs.
  - `assets/agent-sweet-potato.png` — mascot.
  - `logo.jpg` — institute crest (tropical crops genetic resources institute, est. 1958).
- **No Figma, no design system file, no slide template were provided.** The design system here is **reverse-engineered from the live CSS + DOM**, which is the source of truth.

## What this product does

1. **Login** — single-tenant admin login (`admin / admin123456` default), token-based.
2. **System overview (系统总览)** — KPI strip + Leaflet map of field devices + realtime alert feed.
3. **Farm tasks (农事计划)** — AI-generated and user-authored daily task lists.
4. **Realtime data (实时数据)** — sensor cards with live values (温度/湿度/土壤/光照/CO₂) and a recent-readings table.
5. **Video monitoring (视频监控)** — placeholders for RTSP / HLS / WebRTC camera streams.
6. **Charts (曲线图表)** — Chart.js line graphs, one per sensor channel.
7. **History records (历史记录)** — local stored readings with filter chips per parameter, plus a "supplement from cloud" sync button.
8. **Pest & disease database (病害虫数据库)** — searchable cards.
9. **AI photo records (AI记录)** — user uploads field photos against a crop, gets AI labels back.
10. **Automation (自动化流程)** — IF-THEN rule editor (sensor reading triggers controller action), plus a 20-row execution log.
11. **Locations / Devices / Accounts** — admin CRUD with map pickers.
12. **Persistent floating chat** — "小薯" agent FAB in the bottom-right of every page.

## Audience & voice

Operators are Chinese-speaking agronomists and field managers at a tropical-crops research institute. The tone is **direct, technical, friendly** — no marketing fluff. Microcopy explains what a feature does in one sentence, then gets out of the way. Status language leans on color + an icon, not adjectives.

---

## Content fundamentals

**Language:** primary **Simplified Chinese (zh-CN)**. Latin script appears only for monospace runtime values (timestamps, IDs, IPs, sensor units like `lux`, `ppm`, `°C`, `%`) and for one branded English curl: the kicker `TROPICAL CROPS GENETIC RESOURCES INSTITUTE` on the institute crest. **Never auto-translate UI strings to English** — the app's audience reads Chinese.

**Voice & person:** second-person where the system addresses the user (`欢迎使用…`, `你好！我是小薯`, `请输入密码`); imperative for buttons (`登录`, `保存`, `导入选中设备`, `应用筛选`); declarative for state (`已识别到传感器`, `正在读取本地历史参数...`).

**Sentence shape:** short. Most strings are 2–8 Chinese characters. Help text and notices run one sentence, max two. The agent chat is the only place you'll see multi-sentence prose (e.g. "你好！我是小薯，你的智慧农业AI助手。你可以问我关于传感器数据、作物状况、病虫害防治等问题。").

**Casing & punctuation:**
- All-uppercase eyebrows are reserved for **Latin** labels — `LIVE`, `IF`, `THEN`, monospace timestamps, the two nav-group labels in their override styling. Chinese strings never get fake "casing".
- `·` (middle dot) is the canonical separator inside a single label: `海口市 · 示范区`, `小薯 · AI 农业助手`, `已识别到传感器 · admin`. **Do not** use `-`, `–`, or `|` for that role.
- Required fields use a trailing space + `*` (`地块名称 *`).
- Optional/hint suffix uses parens with muted text: `备注 (可选)`, `视觉 AI API Key （暂未启用）`.
- Empty states are full sentences ending in `。` or fragments without trailing punctuation; both are present, fragments are more common.

**Number formatting:**
- Numeric values are tabular (`font-variant-numeric: tabular-nums`).
- Sensor values keep one decimal place (`5.4`, not `5.400000095367432`).
- Units sit in a smaller, muted span beside the value (`26.0` + `°C`).
- Time strings are **`recordTimeStr` first** (the device's own clock), with `receivedAt` reserved for debug logs. Timestamps display in `JetBrains Mono`, accent blue.

**Emoji & unicode glyph use:**
- Emoji are used **deliberately and sparingly** as inline label-icons in select menus and form hints — `🗺️ 全部地块`, `📍 在地图上点击选择位置`, `🔗 在线传感器`. They are **not** used in body copy, headlines, marketing surfaces, or empty states (those use Font Awesome icons instead). Treat emoji as a discoverability hint inside dense form controls, not as decoration.
- Subscripts via unicode are accepted for chemistry/units: `CO₂`.

**Examples — copy in the wild**

| Surface | String |
| --- | --- |
| Login hero | `欢迎使用` / `AI 智慧农业 Agent` |
| Login subhead | `登录后继续管理农田数据、图像标注和智能分析。` |
| Sidebar group | `数据展示` · `智能控制` · `系统管理` |
| Live badge | `LIVE` (Latin) / `模拟数据实时更新中` (Chinese) |
| Cloud connect button | `识别并获取设备列表` |
| Confirm dialog | `确认删除` · `确定要删除吗？` · `取消` / `确认删除` |
| Empty list | `请先选择或新建农作物` |
| Toast (success) | green pill, no leading icon, just the verb-phrase |
| Agent intro | `你好！我是小薯，你的智慧农业AI助手。` |

When writing new UI in this system, **default to Simplified Chinese**, mirror the rhythm above (`{动词}{宾语}` button labels, `{字段名} *` required markers, `·` separators), and lean on Font Awesome icons before emoji.

---

## Visual foundations

The app shipped in **two design eras** (both still live in the cascade). Always design against **Era 2**.

- **Era 1 — Light theme:** flat panels (`#f8fafc` on `#e8edf3`), 1px hairline borders (`#e2e8f0`), 12px radii, micro shadows (`0 1px 2px rgba(0,0,0,0.05)`), Inter typeface. Clean, professional, business-software vibe.
- **Era 2 — iOS 17/18 Liquid Glass override (current):** soft pastel field of cyan/blue/mint radial gradients, white-92%-alpha "glass" surfaces with double-bezel inset shadows + 32px ambient drop, **20px** rounded corners on cards, **24px** on the floating sidebar, **28px** on hero surfaces. SF Pro Display/Text. Animations switched to `cubic-bezier(0.4, 0, 0.2, 1)`. Accent + status colors swapped to iOS hues (`#1070e0` blue, `#34c759` green, `#ff9f0a` orange, `#ff3b30` red).

### Color
- **Primary accent:** `#1070e0` (iOS blue). Used for primary buttons, links, focus rings (`0 0 0 3px rgba(16,112,224,0.10)`), active nav state inflection, and the cyan glow on monospace timestamps.
- **Secondary accents:** `#059669` agriculture green (only used for `--accent-2` references and the `_·1958` mark on the institute logo), `#7c3aed` violet (camera badge, third tier).
- **Status:** iOS green / orange / red / blue. Each status has a paired tinted background (`--success-bg #ecfdf5`, etc.) used for chip pills, inline alerts, and sensor-card alert states.
- **Text:** all text is rendered as `rgba(22,26,38, α)` — α 0.94 / 0.72 / 0.50 for primary / secondary / muted. This is what gives Era 2 its signature softness; pure `#000` is never used.
- **Sidebar (dark contrast inverse):** `#1b2a4a` deep navy with `rgba(255,255,255, α)` text — Era 2 keeps the sidebar visually distinct as a floating dark island over the pastel field.
- **Avoid:** raw `#000`, raw `#fff` for text, the bluish-purple cloud gradient (`#667eea → #764ba2`) outside its narrow legitimate use (`btn-cloud`, cloud factor tags) — it's a deliberate signal that "this control talks to the device cloud."

### Type
- **Family:** `'SF Pro Display', 'SF Pro Text', -apple-system, BlinkMacSystemFont, sans-serif`. Chinese falls through to system Chinese (PingFang on Apple, Noto Sans SC otherwise — both are imported from Google Fonts).
- **Mono:** `JetBrains Mono` for timestamps, IDs, IP/URL strings, the `_·1958` etched line on the brand mark.
- **Scale:** display 34 / kpi-value 26 / modal-header 18 / panel-title 16 / body 15 / dense 13 / form-label 12 / table-header 11 / badge 10. Display + breadcrumb get `letter-spacing: -0.5px`; eyebrows get `+0.06em` and uppercase.
- **Numeric:** `font-variant-numeric: tabular-nums` is applied to every numeric class (KPI value, sensor value, time, table cells) so columns line up.

### Backgrounds & surfaces
- **App bg:** the pastel radial-gradient field defined in `:root`. Fixed; doesn't scroll.
- **Cards:** `rgba(255,255,255,0.92)` glass on top of that field, with the `--glass-bezel` triple-shadow stack. Borders are zero — the bezel does the work.
- **No** full-bleed photography, **no** repeating patterns, **no** hand-drawn illustrations beyond the single sweet-potato mascot.

### Animation
- **Duration:** 200ms for hover/focus, 280ms for page transitions, 320ms for the map's "fullscreen" expand (with `cubic-bezier(0.34, 1.56, 0.64, 1)` for a small overshoot).
- **Easing:** `ease` for utility, `cubic-bezier(0.4, 0, 0.2, 1)` (Material/iOS standard) for sidebar + page enters.
- **Loops:** the LIVE badge blinks (2s), the green status dot pulses with an expanding ring (2s), the cloud spinner is a 0.8s linear rotate.
- **Card hover:** translateY(-2px) + shadow swap. Pest cards do -3px. KPI cards lift on hover. Buttons **do not** lift — only the cloud button does (translateY(-1px)).
- **Modal enter:** `scaleIn` 0.96 → 1.00 over 200ms.

### States
- **Hover** on chrome buttons (icon button, alert btn, sidebar toggle): swap border + text color to the relevant accent (blue for default, warning for alerts, danger for delete).
- **Hover** on `.btn-primary`: solid color shift to `#0c60c4` (no transform).
- **Hover** on cards: shadow gets heavier; some cards translateY(-2/-3px).
- **Focus** on inputs: border becomes `--accent`; a 3px `rgba(16,112,224,0.10)` halo appears.
- **Active** nav link: white-10% panel + a 3px tall green (`--success`) bar pinned to the left edge from y=8 to y=8-from-bottom. The bar uses `--success`, **not** the accent — it reads as "live / running."
- **Disabled inputs:** `#f1f5f9` fill, `--text-muted` color, `not-allowed` cursor.
- **Press** state isn't custom — relies on the browser default.

### Borders, shadows, glass
- **Era 2 cards drop borders entirely** and lean on the bezel triple-shadow:
  ```
  inset  1px  1px 0 rgba(255,255,255,0.92),
  inset -1px -1px 0 rgba(0,0,0,0.08),
  0 8px 32px rgba(0,0,0,0.08);
  ```
- Era 1 cards use a single `1px solid #e2e8f0` border + `--shadow-sm`. Both styles are present in the cascade; new components should use Era 2 unless re-skinning a small inline control (chips, table headers, the rule-section sub-panel).
- **Capsules** (badges, live-badge, pest tags) use background tint of the relevant status color + matching foreground; no border, or a border at 20% alpha of the same color. Border-radius 10–12px so they read as pills.

### Layout rules
- **App shell:** floating sidebar (240px, 24px radius, 14px outer margin) on the left; main wrap is `padding: 0 14px 14px`; inner page area is centered, `min(1200px, calc(100% - 8px))`, padded 34px top / 32px bottom.
- **Topbar height:** 66px. Sidebar collapses to 68px wide.
- **Grid templates** in use: KPI strip = `repeat(auto-fit, minmax(200px, 1fr))`; sensor grid = same at 200px; dashboard = `2fr 1fr`; chart grid = `1fr 1fr`; pest/location grids = `auto-fill, minmax(260–300px, 1fr)`.
- **Modals:** centered, max-width 560px (default) / 720px (wide) / 420px (sm); 90vh max-height; `rgba(30,41,59,0.62)` overlay with **12px backdrop-blur** — the blur is part of the brand language.

### Transparency & blur
- The two places blur is used: **modal overlay** (12px) and the underlying glass surfaces (implicit, via the 92% alpha on a pastel field). The sidebar is 60% white in Era 2, deliberately more transparent than panels.
- Avoid additional `backdrop-filter` use elsewhere — it would compound and look messy.

### Imagery
- **One mascot:** `assets/agent-sweet-potato.png` — pixel-art kawaii sweet potato in front of a laptop. Used at 36px in sidebar, 24px in agent chat header, ~80px on login. Pixel-art is intentional — never apply CSS smoothing filters to it; preserve crisp pixels (`image-rendering: pixelated`).
- **One crest:** `assets/logo.jpg` — circular green mark of the Tropical Crops Genetic Resources Institute. Used as a 420px-wide background watermark on the login screen behind a dark navy overlay (`linear-gradient(115deg, rgba(13,25,48,0.84), rgba(13,25,48,0.62))`).
- No stock photography. No hand-drawn illustration beyond the mascot. If a feature genuinely needs imagery, ask the user — don't invent it.

### Corner radii
- 28px hero surfaces, 24px sidebar, 20px panels & cards, 14px medium controls, 12px buttons + small chips, 10–12px badges, 6px tight controls (icon buttons, table-row inputs).

---

## Iconography

**Primary system: Font Awesome 6 Free (Solid)**, loaded via CDN:
```
https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css
```
This is the **canonical icon set** for Agri Monitor. Every glyph in nav, toolbar buttons, badges, cloud flow, and empty states is a `<i class="fa-solid fa-…">`. Recreations and new components should use the same.

Common icons used in the app, by surface:
- **Sidebar nav:** `gauge-high` (overview), `seedling` (farm tasks), `wave-square` (realtime / cloud), `video`, `chart-line` (charts), `list-ul` (history), `bug` (pest), `camera` (photo records), `wand-magic-sparkles` (automation), `map-marked-alt` (locations), `microchip` (devices), `users-gear` (accounts).
- **Topbar:** `bars` (sidebar toggle), `location-dot`, `clock`, `circle-user`, `bell`.
- **Status & feedback:** `circle-check` (success/connected), `circle-info`, `triangle-exclamation` (warning), `circle-info` (info banners), `database` (empty data), `file-excel` (export).
- **Actions:** `plus` (add), `xmark` (close), `rotate` / `sync` (refresh), `pause`, `right-to-bracket` / `arrow-right-to-bracket` (login / submit), `download`, `filter`, `sliders`, `bolt` (IF), `play` (THEN), `clock-rotate-left` (logs), `gear`, `paper-plane` (chat send), `expand`, `image`.

**Pest grid:** the pest cards display the pest's emoji or a single character as their hero glyph at 60px — this is the **only** place the system uses emoji as content rather than as inline microcopy decoration.

**Brand mark:** the sweet-potato mascot is a raster PNG, used wherever the AI agent has a presence (login lockup, sidebar brand, chat FAB & header, welcome card).

**No icon font of its own. No bundled SVG sprite.** If a needed glyph isn't in Font Awesome 6 Free Solid, prefer adding it from FA Pro / FA Brands first; only sub in another set (Lucide, Heroicons) as a last resort and **flag it to the user**.

**Unicode characters used decoratively:** the `·` middle dot (separator), the `→` (in flow diagrams), and `📍`/`🗺️`/`🔗` inline emoji labels (see the Content Fundamentals section). That's the entire vocabulary — do not introduce new emoji ad-hoc.

---

## Index of this design system

```
README.md                  ← you are here
SKILL.md                   ← claude-code skill manifest

colors_and_type.css        ← all CSS custom properties (color, type, radii, shadows, glass)

assets/
  agent-sweet-potato.png   ← 小薯 mascot (pixel art)
  logo.jpg                 ← Tropical Crops Genetic Resources Institute crest

preview/                   ← Design-system-tab cards (registered as assets)
  colors-*.html
  type-*.html
  spacing-*.html
  components-*.html
  brand-*.html

ui_kits/
  web-app/                 ← The Agri Monitor web app
    README.md
    index.html
    AppShell.jsx
    Dashboard.jsx
    components/*.jsx
```

## Caveats and limits

- This system was reverse-engineered from CSS + DOM. There is no Figma source and no design tokens file in the upstream repo.
- **SF Pro Display/Text** is referenced as the primary family but isn't bundled (Apple licensing). On non-Apple devices the cascade falls through to `Plus Jakarta Sans` (imported) and then system sans. If you need pixel-perfect parity with the live app on Windows/Linux, sub in **Inter** (very close metrics) and flag the swap.
- The two-era cascade in `style.css` is intentional but messy. **Era 2 wins** in every place the two collide — design against the Era 2 values exposed in `colors_and_type.css`.
