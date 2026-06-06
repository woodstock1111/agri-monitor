# 动效规范（Motion Spec）

## 0. 总原则

> 克制、有目的、绝不炫技。每个动画都要服务于"让用户知道发生了什么"。

通过的检验问题：**这个动效消失会让用户更懵吗？** 否则砍掉。

## 1. 全局参数

| 参数 | 值 | 说明 |
|------|----|----|
| 缓动曲线 | `cubic-bezier(0.4, 0, 0.2, 1)` | Material Standard，唯一允许的曲线 |
| 微交互 | 120–150 ms | 按钮按压、chip 切换、hover-class |
| 状态切换 | 250–300 ms | 卡片展开、tab 切换、消息入场 |
| 页面转场 | 350–400 ms | 日期切换、tab 切换、模态弹出 |
| 长动画兜底 | > 500 ms 必须可跳过 / 即时完成 | 通过 `wx:if` 卸载节点或提前回调 |

## 2. 完成动画（核心）

| 阶段 | 时长 | 关键属性 | 触感 |
|---|---|---|---|
| ① 按压 | 130 ms | `transform: scale(0.92)` | — |
| ② 回弹 | 230 ms | `scale 0.92 → 1.05 → 1.0` | `wx.vibrateShort({type:'light'})` |
| ③ 波纹 | 300 ms | `radial-gradient` 从按钮中心扩散，最终消散 | — |
| ④ 对勾绘制 | 320 ms | SVG `stroke-dashoffset 30 → 0` | — |
| ⑤ 沉降 | 360 ms | `opacity 1→0.6, translateY 0→8rpx` | — |
| ⑥ 撤销 toast | 250 ms 入场，3000 ms 自动隐藏 | `opacity 0→1, translateY 16→0` | — |

总时长约 1.0 s，但用户感知点在 ②③④ 同步完成的 ~ 320 ms 内。

## 3. 采纳过渡（AI 推荐 → 自己的农事）

```
原项收起：max-height 80→0, padding 10→0, opacity 1→0   (360ms)
新项飞入：translateY -12→0, opacity 0→1                (360ms)
错峰      stagger 80ms （原项先开始，新项稍后）
触发     wx.vibrateShort
```

## 4. 聊天动效

| 元素 | 动画 |
|---|---|
| 新消息入场 | `opacity 0→1, translateY 8rpx→0` (250ms) |
| 思考中 | 3 个圆点 1.2s 循环弹跳，错峰 200ms |
| 流式输出 | 词级 append，60–80 ms 间隔；末尾 2px 主色光标，1s steps(2) blink |

## 5. 阈值告警

| 元素 | 动画 |
|---|---|
| 卡片状态切换 | border-color / bg / value-color 280 ms 平滑过渡 |
| 脉动圆点 | `opacity 0.4↔1.0, scale 1↔1.3`，2s ease infinite |

> 注意：脉动 ≠ 闪烁。透明度永不归零，避免在户外被误读为故障灯。

## 6. 下拉刷新

```
小薯 logo：translateY(0→-10→0) + rotate(0→-15→8→0)，1.2s ease infinite
释放后：sliding-up 250ms 退出
```

不使用系统默认 loading 圈。

## 7. 日期切换

```
chip 高亮：background / color 280ms
内容区：translateX ±20rpx → 0, opacity 0→1, 350ms（方向跟随手势）
```

## 8. 触感反馈

| 场景 | API |
|---|---|
| 完成 / 采纳 / 删除 | `wx.vibrateShort({ type: 'light' })` |
| 错误 / 危险确认 | `wx.vibrateShort({ type: 'medium' })` 或 `wx.vibrateLong()` |

## 9. 跳过 / 完成入口

任何超过 500 ms 的动画必须满足以下任一：

1. 用户点击屏幕任意区域，立即结算到终态；
2. 系统级"减弱动效"开关（`wx.getSystemInfo().enableAccessibility`）打开时全部跳过；
3. 关键流程提供 `skipAnimation: true` 参数。

## 10. 实施位置

| 文件 | 作用 |
|---|---|
| `app.wxss` | 全局 keyframes（`fadeUp`, `ripple`, `drawCheck`, `pulse`, `btnSpin`） |
| 各页 `.wxss` | 页面级动画（仅在该页才会出现的） |
| `04-motion-prototype.html` | 可交互演示（review 用） |

## 11. Lottie 资源（可选）

如果后续需要更复杂的小薯角色动画，建议导出为 Lottie JSON：

| 资源 | 用途 | 触发 |
|---|---|---|
| `potato-bounce.json` | 下拉刷新 | scroll 触发 |
| `potato-think.json` | 长思考（>2s） | 替代三点 |
| `potato-cheer.json` | 任务全部完成时的庆祝 | empty 切换为"全部完成"态 |

接入方式：小程序使用 `lottie-miniprogram` 库（Skyline 渲染下原生支持）。本期 UI 不强制使用，先用 wxss + svg 实现。
