# Web → 小程序 等价替换清单

本清单覆盖 Web 端 `style.css` 在微信小程序原生 wxss 中无法 1:1 实现的写法，与本项目采用的等价方案。

| # | Web 端写法 | 小程序限制 | 本项目等价方案 |
|---|-----------|-----------|---------------|
| 1 | `:hover` 伪类 | 小程序仅支持 `hover-class` 属性 | 在 wxml 上声明 `hover-class="btn--primary-press"`，hover-stay-time 设为 80ms。规则名以 `--press` 后缀区分 |
| 2 | `::before / ::after` 伪元素 | 小程序大部分组件不支持伪元素 | 改用真实 view 节点。逾期任务左边条用 `<view class="card-alert-bar"/>`；nav.active 左竖线同理 |
| 3 | `backdrop-filter: blur()` | 小程序仅 cover-view、个别基础库支持 | 模态遮罩降级为 `rgba(30,41,59,0.45)` 纯色蒙层；顶部 tabbar 改为 `rgba(255,255,255,0.96)` 不透明白 |
| 4 | `position: sticky` | 兼容性较差 | 用 `scroll-view` + 顶部 fixed view 模拟（日期切换条在 `scroll-into-view` 容器外） |
| 5 | `vh / 100vw` | iOS/Android 表现不一致 | 用 `100%` + `flex` 撑满；安全区用 `env(safe-area-inset-bottom)` |
| 6 | CSS Grid `grid-template-columns: repeat(auto-fit, minmax(...))` | 老版小程序不稳 | 改 `display: flex; flex-wrap: wrap;` 每张卡 `width: calc(50% - 12rpx)` |
| 7 | `mix-blend-mode / filter: drop-shadow(svg)` | 不可靠 | 直接用 `box-shadow`；svg 阴影在素材里烘焙 |
| 8 | `cursor: pointer` | 无意义 | 移除 |
| 9 | `:checked / :focus-within` | 不支持 | 用 `wx:if` + 类切换，或 `focus` 属性配合 data |
| 10 | `transition: all` | 性能差 | 显式列出属性：`transform, opacity, background-color` |
| 11 | `::-webkit-scrollbar` 自定义滚动条 | 被屏蔽 | 移除；用 scroll-view 自带 |
| 12 | `gap`（在 flex 容器中）| 部分老基础库失效 | 项目最低基础库 ≥ 2.16，可用；保留 |
| 13 | `font-family` Google Fonts | 加载不到 | 仅声明系统栈：`-apple-system, "PingFang SC", sans-serif`；中文走系统字 |
| 14 | `<button>` 默认蓝边 / 微信按钮默认样式 | 微信注入了 button 默认样式 | 在 app.wxss 全局重置 `button::after { border: none; }` 并自定义 `.btn` 类 |
| 15 | `Font Awesome` 图标 (`<i class="fa-solid …">`) | 小程序加载 web font 困难 | 改用：iconfont symbol 模式 + `<icon-font name="seedling"/>` 自定义组件，或本地 png（@2x/@3x） |
| 16 | `inset: 0` | 老基础库不识别 | 拆为 `top:0;right:0;bottom:0;left:0;` |
| 17 | `<a href>` 链接 | 不支持 | 改为 `<navigator url="...">` 或 `<view bindtap>` |
| 18 | DOM 事件 `onclick` 内联函数 | 不支持 JS in markup | wxml `bindtap="handleDone"` + js 中 method |
| 19 | `<form>` 原生提交 | 走 `<form bindsubmit>` | 重写表单逻辑（本期 UI 设计不涉及） |
| 20 | `select / datalist` | 体验差 | 用 `<picker>` 或自定义底部抽屉 |
| 21 | localStorage / IndexedDB | 不支持 | 用 `wx.setStorageSync`；UI 层无感 |
| 22 | `@keyframes` 全局命名 | wxss 支持，但样式隔离需注意 | 全部写在 `app.wxss`，组件页 wxss 直接引用名字 |
| 23 | `:root { --var: … }` | 小程序需写在 `page` 选择器 | 已在 `app.wxss` 用 `page { --bg-base: … }` 写法 |
| 24 | SVG `<path>` 直接 inline | 支持但需注意闭合 | 完成对勾用 inline svg 节点（cover-image 兼容性好） |
| 25 | iframe / web-view 嵌入 | 用 `<web-view>`，但 tabbar 页不能嵌 | 本期不涉及 |
| 26 | CSS animation `animation-play-state: paused` | 可用 | 长动画的"跳过"用 wx:if 卸载节点替代 |
| 27 | `pointer-events: none` | 部分组件无效 | 加遮罩 view 拦截事件 |
| 28 | `text-overflow: ellipsis` 多行 | 用 `-webkit-line-clamp` | wxss 中保留 webkit 前缀，主流基础库可用 |

## 注意事项

- 所有 `px` 在小程序里用 `rpx`，仅 `1px` 边框保留 `1rpx`（小屏可能不显示，已接受）。
- 阴影颜色尽量低饱和，避免在某些机型出现灰边。
- 动画曲线全局统一 `cubic-bezier(0.4, 0, 0.2, 1)`，不允许各页面自创。
- 字体最小 28rpx，关键数值 56rpx 起，对比度 ≥ 4.5:1。
