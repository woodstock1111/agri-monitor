# 传感器看板字段映射表

| 后端契约字段 | mock 字段 | 页面使用 |
|---|---|---|
| `GET /api/v1/app-state -> devices[]` | `devices[]` | 设备 chip 列表 |
| `device.id` | `id` | 设备选择、实时/历史查询参数 |
| `device.name` | `name` | chip 名称、摘要卡设备名 |
| `device.type` | `type: "sensor_soil_api"` | 过滤云传感器 |
| `device.locationId` | `locationId` | 保留租户/位置关联 |
| `device.online` | `online` | 在线/离线灰态与缓存态 |
| `device.apiConfig.deviceAddr` | `apiConfig.deviceAddr` | 保留云平台设备地址 |
| `device.apiConfig.factors[]` | `apiConfig.factors[]` | 因子列表与小数位 |
| `factor.factorName` | `factorName` | 卡片标题、匹配实时/历史值 |
| `factor.unit` | `unit` | 单位展示 |
| `factor.digits` | `digits` | 数值格式化 |
| `GET /device-realtime -> deviceTimestamp` | `deviceTimestamp` | 最近设备时间 |
| `GET /device-realtime -> receivedAt` | `receivedAt` | 摘要卡更新时间 |
| `GET /device-realtime -> values` | `values` | `dataItems` 缺失时兜底 |
| `dataItems[].registerItem[]` | `dataItems[].registerItem[]` | 优先渲染的实时寄存器 |
| `registerName` | `registerName` | 因子名 |
| `value` | `value` | 主数值 |
| `unit` | `unit` | 实时单位，优先于 factor.unit |
| `alarmLevel` | `alarmLevel` | 唯一警告依据，0 正常、1-2 预警、>=3 报警 |
| `GET /device-history -> rows[]` | `rows[]` | mini 折线数据 |
| `row.ts` | `ts` | 历史时间序列排序依据 |
| `row.values` | `values` | 每个因子的折线点 |

说明：mock 响应不新增展示专用字段；卡片状态、趋势、图标、缓存标签都在页面 view model 中派生。
