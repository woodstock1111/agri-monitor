# 小薯实时农场（farm/）

网页右下角小薯 AI 上方的入口打开的 3D 海岛农场：全屏窗口里现建一个同源 iframe 加载 `/farm/index.html`；点右上角 ✕（或按 Esc）关闭时先调 `farmDispose()` 停掉渲染、交还 WebGL，再把 iframe 整个拿掉，不占资源。入口和窗口在 `index.html` 的 `#farm-fab` / `#farm-overlay`，逻辑在 app.js 的 `FarmView`。

## 数据从哪来

- **演示 / 真实**：默认演示（本地生成的示例地块，拖进去的设备不保存）。管理员在「账号管理」编辑账号，勾选「小薯实时农场用真实数据」后，这个账号看到自己的地块和设备（`users.farm_real_data`，迁移 004）。
- **地块** = app-state 的 `locations`，最多 20 块（岛上只压平了 20 个位置），超出的在面板里提示。每块地占的位置存在 `location.metadata.farmScene.slot`，删一块地别的地不挪位。
- **传感器** = 这块地上 `type` 以 `sensor` 开头的设备，读数取服务器缓存的实时数据（`serverRealtime`，每分钟刷新）；告警只看通道的 `alarmLevel`。
- **摄像头** = `type: 'camera'`。视频流还没接，悬停显示设备状态，不渲染假画面。
- **气象站** 不是设备：显示地块经纬度所在区县的高德实时天气（`/api/v1/photos/weather`，服务器按约 1 km 缓存 15 分钟）。每块地一个，位置存在地块的 `farmScene.weather`。
- **摆放位置**：设备 `metadata.farmScene = { v, locationId, x, z }`（地块局部坐标）；设备换了地块，旧位置自动失效。「✕」只是从田里收回，不删设备。

所有写入都走父页面的 `FarmBridge`（app.js）→ `DataRepository` → `SyncService`，iframe 自己不推 app-state。

## 留着的口子

- **浇水**：还没有灌溉控制器，按钮一直能点，只播动画。接控制器时改 `js/data.js` 的 `FarmActions.water`：用 `plot.irrigation`（这块地的 `controller_water` 设备）开阀，失败就 throw，页面会提示。
- 小程序的园区地图还是按地块顺序排位置，没读 `farmScene.slot`，两边的位置不一定一样。

## 文件

`js/app.js` 页面和交互 · `js/data.js` 数据层 · `js/slot.js` 单块地的 3D · `js/plotgeo.js` 地块几何 · `js/terrain.js` 地形和水 · `js/props.js` 摆设 · `js/post.js` 描线后期 · `vendor/three/` 本地托管的 three.js r170（国内不依赖 CDN）· `assets/fonts/` 裁剪过的马善政字体。

调试：`?debug` 把报错显示在页面上并暴露 `window.__farm`；`?skip` 跳过开场镜头。

## 设备适配

电脑和 iPad：触屏上单指拖动平移（进地块后是旋转），双指缩放，点设备看数据、点空地收起。宽度 ≤ 900px（iPad 竖屏）时面板在底部，镜头中心上移、拉远。需要 iPadOS / Safari 16.4 以上（import map）。手机没有专门适配。
