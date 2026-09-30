# agri-gateway（微信云托管）

小程序通过 `wx.cloud.callContainer` 调用本服务：不需要域名和 ICP 备案。本服务不存数据，只把小程序用到的接口转发到主服务器，
并附上微信注入的 openid 和用户真实 IP，用 `FORWARD_SECRET` 签名。设计见 `docs/auth-design.md`。

部署（云托管控制台 → 自定义部署 / 发布新版本）：
- 代码包：本目录（`index.js` + `Dockerfile`），端口 `80`
- 规格：0.25 核 / 0.5 GB；实例数最小 0（便宜，冷启动慢几秒）或 1（常驻）
- 公网访问：关闭（只允许小程序调用）
- 环境变量：
  - `UPSTREAM_URL`：主服务器地址，目前 `http://47.116.46.214`；迁移服务器时只改这里
  - `FORWARD_SECRET`：与主服务器 `.env` 里的 `MINI_GATEWAY_SECRET` 相同的随机长字符串

主服务器只在密钥匹配时才信任网关带来的 openid 和 IP。
