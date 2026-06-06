# Agri Monitor 微信小程序 · UI 设计交付

> 与 Web 端 `style.css` 视觉语言完全对齐。所有色值、圆角、阴影、字号阶梯均沿用现有 CSS 变量映射。

## 0. 一键预览

| 文件 | 看什么 | 怎么看 |
|------|--------|--------|
| `previews/01-farmtasks.html` | 农事计划页（默认 / 完成动画三阶段 / 撤销 / 空态） | 浏览器直接打开 |
| `previews/02-chat.html` | 和小薯聊天页（默认 / 图片预填 / 加号抽屉） | 浏览器直接打开 |
| `previews/03-dashboard.html` | 传感器看板页（默认告警 / 离线缓存） | 浏览器直接打开 |
| `previews/04-motion-prototype.html` | 6 个关键动效**可点击**演示 | 浏览器直接打开 |

每个预览文件用 iPhone 14 Pro 视口（390×812）模拟小程序屏，多状态横向并排。

## 1. 文件结构

```
mp-design/
├── README.md                                ← 本文件
├── styles/
│   ├── app.wxss                             ← 小程序全局样式（CSS 变量映射）
│   └── equivalence-map.md                   ← Web → 小程序 等价替换清单
├── animations/
│   └── motion-spec.md                       ← 动效规范（曲线、时长、触感）
├── components/
│   ├── components.wxml                      ← 15 个 wxml 组件骨架
│   └── components-manifest.md               ← 组件清单文档（props、状态机）
└── previews/
    ├── 01-farmtasks.html
    ├── 02-chat.html
    ├── 03-dashboard.html
    └── 04-motion-prototype.html
```

## 2. 与 Web 端的对应关系

| Web `style.css` | 小程序 `app.wxss` | 备注 |
|---|---|---|
| `--bg-base #e8edf3` | `--bg-base #e8edf3` | 完全一致 |
| `--bg-surface / --bg-panel #f8fafc` | 同上 | 卡片基底 |
| `--accent #1070e0` | 同上 | 主色 |
| `--accent-light #e8f0fe` | 同上 | 徽章/低饱和按压 |
| `--success / --warning / --danger` | 同上 | 状态色直接复用 |
| `--text-primary #1e293b` | 同上 | 文字主色 |
| `--border #e2e8f0` | 同上 | 卡片边框 |
| `--radius 12px` | `--radius 24rpx` | 单位换算 |
| `--radius-sm 8px` | `--radius-sm 16rpx` | 单位换算 |
| `--shadow-sm/--shadow/--shadow-lg` | rpx 换算后的等价值 | 阴影三档保留 |

**新增的小程序专属变量**（仅这两处对 Web 进行了扩充）：

| 变量 | 值 | 用途 |
|---|---|---|
| `--bg-cool #eef3fb` | 浅蓝灰 | "AI 农事"区背景，区分系统排程与用户任务 |
| `--accent-press #0c60c4` | Web 端 `:hover` 同色 | 按压态显式命名 |

## 3. 字号阶梯（rpx）

```
--fs-caption  22rpx   非关键辅助（数据卡 unit、时间戳）
--fs-body     28rpx   正文最小线
--fs-md       30rpx
--fs-lg       36rpx
--fs-title    40rpx   区块标题
--fs-display  56rpx   关键数值最小线
--fs-display-xl 72rpx 传感器主数值
```

## 4. 三页核心交互一览

### 页面一 · 农事计划
- 顶部 6 chip 日期切换条（默认今日填充主色 + 圆点）
- 三大区块卡，间距 32rpx，背景层次：白 → 冷蓝 → 白
- 任务卡圆角 20rpx 内嵌、外卡圆角 24rpx 形成层次
- 完成动画 5 阶段（按压 → 回弹 → 波纹 → 对勾 → 沉降）
- 逾期：左侧 8rpx 警示边条（不染整张卡片）
- 空态：小薯插画 + "问问小薯"主色 CTA

### 页面二 · 和小薯聊天
- 顶部头像 + 在线绿点 + "第 3 代农事 Agent" 副标
- 用户气泡主色右靠、小薯气泡白底左靠（圆角 12px，发送方向小角 4px）
- 输入区：加号 / 输入框 / 发送（输入空时变语音）
- 加号底部抽屉 3 选项（相册 / 拍照 / 关联农事记录）
- 上传缩略图带进度蒙层
- 思考中三跳点 → 流式词级输出 → 末尾闪烁主色光标
- 结构化数据走 `msg-card` 内嵌卡，避免气泡堆字

### 页面三 · 传感器看板
- 顶部设备 chip 选择器（含离线灰态）
- 摘要卡（主色渐变背景）+ 2 列数据卡网格
- 单卡视觉锚点：72rpx 主数值
- mini 折线无刻度，渐变填充暗示量级
- 告警三连：边框染色 + 数值染色 + 脉动圆点（呼吸 2s）
- 下拉刷新用小薯弹跳，不用系统圈
- 离线缓存：整体 55% 透明 + "缓存"标签

## 5. 全局动画规范（速记）

```
曲线：cubic-bezier(0.4, 0, 0.2, 1)  统一
微交互：120-150ms
状态切换：250-300ms
页面转场：350-400ms
> 500ms 必须可跳过

触感：完成/采纳/删除  wx.vibrateShort({type:'light'})
      错误/危险      wx.vibrateShort({type:'medium'})
```

详见 `animations/motion-spec.md`。

## 6. 不做清单（与需求一致）

- ❌ 不重新设计配色 / 品牌语言（沿用 Web 端 CSS 变量）
- ❌ 不引入 vant-weapp / tdesign 等第三方 UI 库的视觉
- ❌ 不堆砌动画（每个动效都过"消失会让用户更懵吗"测试）
- ❌ 不照搬 Web 端复杂表格（小程序场景下信息层级已重新组织）
- ❌ 暗色模式（本期不做）

## 7. 关键决策日志

| 决策 | 理由 |
|------|------|
| 新增 `--bg-cool` | "AI 农事"需要与"AI 推荐 / 自己的农事"在背景层级上区分，原 Web 端无此场景 |
| 完成对勾用 inline SVG path 绘制动画 | 比静态 icon 更有反馈感，且可控制时长 |
| 逾期用左边条而非红底 | 田间强光下红底卡会"灼眼"，违反户外可读性硬指标 |
| 下拉刷新用小薯 logo | 强化品牌人格化，且系统 loading 圈在某些机型偏小、辨识度差 |
| 输入框为空时显示语音按钮 | 与微信原生输入习惯对齐，降低农户学习成本 |
| 数据卡 mini 折线无刻度 | 田间用户不需要精确读数，趋势感>精度，避免视觉污染 |
| 告警圆点用呼吸而非闪烁 | 闪烁在户外被误读为"故障灯"，呼吸（opacity 0.4↔1.0）足以引起注意 |

## 8. 后续接入注意

1. 真实接入时把 `app.wxss` 内容拷到项目根，自定义 TabBar 配置 `app.json` 设 `"custom": true`。
2. 字体：小程序不能加载 Google Fonts，已声明系统栈 `-apple-system, "PingFang SC"`。
3. 图标：用 iconfont symbol 模式或本地 PNG，不要 Font Awesome web font。
4. 折线图：UI 阶段用 inline svg；接入用 `<canvas type="2d">` 或 `ec-canvas`。
5. 触感反馈：本期 UI 中已规范化触发位，开发阶段补 `wx.vibrateShort` 调用即可。

## 9. 验收清单

- [x] CSS 变量 1:1 映射，新增变量有理由
- [x] 卡片 / 按钮 / 模态 / tab 视觉模式与 Web 端同源
- [x] 三个页面所有要求状态都覆盖（默认 / 按压 / 加载 / 空态 / 错误 / 逾期 / 告警）
- [x] 完成动画 5 阶段 + 撤销 toast
- [x] AI 推荐采纳的过渡动画
- [x] 聊天思考中 + 流式输出
- [x] 阈值告警三连 + 呼吸圆点
- [x] 下拉刷新小薯弹跳
- [x] 等价替换清单 28 项
- [x] 15 个组件骨架 + 视觉契约
- [x] 动效规范文档
