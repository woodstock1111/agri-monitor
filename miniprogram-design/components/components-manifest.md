# 组件清单（Components Manifest）

> 所有组件仅含视觉壳与 props 协定，业务逻辑（数据获取、状态机）由开发阶段补齐。
> 真实接入时建议拆分到 `components/<name>/<name>.wxml + .wxss + .js + .json`，
> 设计 review 阶段统一用 `components/components.wxml` 的 `<template>` 形式集中查阅。

## 组件总览

| # | 名称 | 用途 | 主要 props |
|---|---|---|---|
| 1 | `base-card` | 所有卡片基底（区块大卡 / 任务卡 / 传感器卡） | `tone`, `alert` |
| 2 | `prim-btn` | 主按钮（4 态） | `type`, `loading`, `disabled`, `text` |
| 3 | `done-btn` | 农事卡专用大圆完成按钮 | `phase` (`idle / press / rebound / done`) |
| 4 | `date-strip` | 日期 chip 横滑切换条 | `dates[]`, `onPickDate` |
| 5 | `section-head` | 区块标题（图标 + 文本 + 计数 + 操作） | `title`, `ico`, `count`, `actText`, `flavor` |
| 6 | `task-card` | 任务卡（推荐 / AI 自动 / 用户三模） | `task` |
| 7 | `sensor-card` | 传感器单参数卡 | `s` (含 `value, unit, alert, trend`) |
| 8 | `chip-strip` | 设备 chip 选择器 | `devices[]`, `onPickDevice` |
| 9 | `empty-state` | 空态展示 | `illus, title, sub, ctaText` |
| 10 | `chat-bubble` | 消息气泡（用户 / 小薯） | `msg` |
| 11 | `typing-dots` | 思考中三点 | — |
| 12 | `bottom-sheet` | 底部抽屉（加号 / 添加任务） | `open, items[]` |
| 13 | `toast` | 通用 toast / 撤销 toast | `open, text, action` |
| 14 | `tabbar` | 自定义 TabBar | `tabs[]` |
| 15 | `chat-head` | 聊天页顶部状态条 | `name, statusText` |

## 各组件视觉契约

### `base-card`
- 圆角 `--radius` (24rpx)
- 边框 `1rpx solid var(--border)`
- 内边距 `--gap-md` (32rpx)
- 阴影 `--shadow-sm`
- 变体：`tone="cool"` 用 `--bg-cool`；`alert=true` 左侧 8rpx 警示边

### `prim-btn`
- 高度 72rpx
- 圆角 `--radius-sm` (16rpx)
- 字号 `--fs-body` (28rpx) 600
- 4 态颜色（见 `app.wxss` 的 `.btn--*`）

### `done-btn`
- 96rpx × 96rpx 圆形
- 阴影带主色辉光 `0 8rpx 20rpx var(--accent-glow)`
- 阶段类：`btn-done-press / btn-done-rebound`

### `date-strip`
- 单 chip 56rpx 宽 × 96rpx 高，圆角 `--radius`
- 今日 chip 主色填充 + 底部小圆点

### `task-card`
- 内圆角 20rpx (子卡)，与外区块圆角形成层次
- meta chip 用 `--accent-light` 底色 + `--accent` 文字
- 逾期左侧 8rpx 边条 (`--danger`) + meta 中"已逾期"chip 改 `--danger-bg`
- done 后整卡 opacity 0.6、translateY 8rpx，左侧 50rpx 处显示 SVG 对勾

### `sensor-card`
- 高度最少 168rpx，宽度 `calc(50% - 12rpx)`
- 中央数值 72rpx 700，与左下 mini 折线、右下趋势 chip 三段式
- 告警态：边框 `--danger`、底色 `--danger-bg`、数值染色 `--danger`、脉动圆点
- `wide=true` 占整行（用于风速等带 24h 趋势）

### `chip-strip`
- 单 chip 圆角 999rpx，padding 12rpx 28rpx
- 选中：`--accent` 填充
- 离线：文字 + dot 改 `--text-muted`

### `empty-state`
- 插画 280rpx × 280rpx (svg / lottie)
- 主标题 `--fs-md` 30rpx，副标 `--fs-body` 28rpx
- CTA 用主色填充按钮 + 主色辉光阴影

### `chat-bubble`
- 圆角 12px (与卡片同源)，发送方向小角 4px
- 用户：`--accent` 底白字；小薯：白底深字 + 32rpx 头像
- 内嵌 `msg-card` 用于结构化数据，避免气泡内堆字

### `bottom-sheet`
- 圆角顶部 32rpx，遮罩 `rgba(30,41,59,0.45)`
- 列表项 80rpx 高，分隔线 `--border`
- 底部"取消"按钮独立一块

### `tabbar`
- 高度 120rpx + 安全区
- 4 项：计划 / 看板 / 小薯 / 我的
- 选中色 `--accent`，未选中 `--text-muted`

## 文件路径建议

```
miniprogram/
├── app.wxss                      ← 全局变量与基础 class
├── app.json
├── pages/
│   ├── farmtasks/
│   │   ├── index.wxml
│   │   ├── index.wxss
│   │   └── index.js
│   ├── chat/
│   └── dashboard/
├── components/
│   ├── base-card/
│   ├── prim-btn/
│   ├── done-btn/
│   ├── date-strip/
│   ├── section-head/
│   ├── task-card/
│   ├── sensor-card/
│   ├── chip-strip/
│   ├── empty-state/
│   ├── chat-bubble/
│   ├── typing-dots/
│   ├── bottom-sheet/
│   ├── toast/
│   ├── tabbar/
│   └── chat-head/
└── assets/
    ├── sweet-potato.svg          ← 小薯头像
    ├── empty-potato.svg          ← 空态插画
    └── icons/                     ← iconfont symbol
```

## 状态机契约

每个交互组件需实现以下视觉状态：

| 状态 | 视觉表达 | 触发 |
|------|---------|-----|
| default | 默认 | 初始 |
| press | 按压（scale 0.97 / bg 染色） | `hover-class` |
| disabled | opacity 0.45 + 点击拦截 | `disabled` 属性 |
| loading | 内置 spinner，文字隐藏 | `loading` 属性 |
| error | 边框 `--danger`，下方红色 hint 文案 | data 异常 |
| empty | 走 `empty-state` 组件 | data.length === 0 |
