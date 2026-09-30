# 登录与账号方案（网页 + 微信小程序）· 设计稿

状态：**第 0–3 步已实现**（2026-09-29）。已确认：账号由管理员开通（不开放自助注册）；一个账号最多绑定 5 个微信；手机号一键登录、网页 Cookie 暂不做。
尚未实现：网页端查看/解绑已绑定微信的界面（接口 `GET /auth/me`、`DELETE /auth/wechat/binding` 已有）。

**2026-09-29 调整：小程序游客模式（绑定改为可选）。** 小程序会有很多人只是来看，所以没绑定的微信不再被拦住：
`/auth/wechat/login` 给它发一个游客会话（`sessions.user_id` 为空，只记 `wechat_openid`）。游客看小程序内置的演示数据，
可以使用收成预测的土壤、天气接口（`requireViewer`，每个微信 10 分钟最多 120 次）；设备、农事、用户等私有接口仍然只认账号。
绑定了账号的微信，小程序的数据层（`miniprogram/utils/api.js`）自动改读这个账号在服务器上的真实地块、设备和农事。
绑定页 `pages/bind/bind` 保留，暂时还没有入口按钮。下文 4.4 流程图里“未绑定 → 返回 unbound”一支已改为“未绑定 → 游客会话”。

## 一、结论

1. **一个账号，多种登录方式。** 网页用账号密码登录，小程序用微信登录，两者落到同一个用户、同一个农场（租户），看到同一份数据。小程序不另建用户体系。
2. **令牌改成服务器端会话。** 现在的令牌是签名后发给客户端的，服务器收不回来。改成随机令牌，数据库只存它的哈希值，可以随时注销、踢下线，有效期随使用自动延长。
3. **小程序打开即自动登录。** 用 `wx.login` 换 openid：已绑定就直接进，用户无感；第一次使用时，用网页账号密码绑定一次。企业认证后可以加"手机号一键登录"，作为可选项。
4. **用户数据搬到 PostgreSQL。** `001_init.sql` 里已经建好了 `users`、`tenants` 表，只是还没启用。会话表需要和用户表关联，所以这次一起启用。
5. **不直接照搬别人的代码，只借鉴设计。** 原因见第三节。自己写约 500 行，每一步都配测试。

## 二、现状与问题

| 现状 | 问题 |
|---|---|
| 登录后发 HMAC 签名令牌（`signToken`），8 小时有效 | 发出去就收不回：退出登录、改密码都无法让旧令牌失效（只有禁用账号能挡住，因为每次请求会查用户状态） |
| `verifyToken` 用 `timingSafeEqual` 比较签名 | 签名长度不对时 `timingSafeEqual` 会抛异常，请求返回 **500 并带出错误信息**，应该是 401。已用 Node 验证 |
| 网页把令牌存在 `localStorage` | 页面一旦有 XSS 漏洞，令牌可以被脚本直接读走 |
| 用户存在 `app-state.json`，通过内存缓存读写 | 单进程时可以工作；但会话表需要关联用户，将来多进程部署也需要数据库 |
| 登录失败限流在内存里：同一 IP 失败 5 次锁 15 分钟，同一账号失败 10 次锁定 | 做法本身是对的，和下面参考的 rate-limiter-flexible 思路一致，保留 |
| 密码用 PBKDF2-SHA256 12 万次迭代，异步计算 | OWASP 现在的建议是 60 万次。可以在用户下次登录成功时自动升级 |
| 小程序没有登录 | 收成预测的土壤、天气接口要求登录，所以小程序读不到 |

## 三、参考了哪些项目，各借鉴什么

| 项目 | 规模 / 许可 | 借鉴 | 不借鉴 |
|---|---|---|---|
| [芋道 ruoyi-vue-pro](https://github.com/YunaiV/ruoyi-vue-pro) | 3.9 万星，MIT；国内最常用的后台框架之一，自带小程序登录 | ① 社交账号（openid）和用户分表，用一张绑定表关联（`SocialUserDO` / `SocialUserBindDO`）② 小程序登录：`loginCode` 换 openid，`phoneCode` 换手机号，按手机号找到或创建用户后再绑定（`MemberAuthServiceImpl.weixinMiniAppLogin`）③ 令牌存在服务器端（数据库 + 缓存），可以注销 | 它的 `bindSocialUser` 会**静默把微信从原账号解绑、改绑到新账号**，我们改成必须明确确认。它是 Java/Spring，代码无法直接用 |
| [Better Auth](https://github.com/better-auth/better-auth) | 3 万星，MIT；TypeScript 生态当前最流行的认证框架 | 表结构：`user` / `session` / `account` / `verification`。每种登录方式是一条 account 记录，以（登录方式，第三方ID）唯一，指向同一个 user。关联新的登录方式时要求明确确认（`disableImplicitLinking`） | 整体引入它：它要按自己的框架方式接入，没有内置微信小程序登录，我们的服务器是原生 `http`，接入成本比自己写还高。以后换框架时可以再评估 |
| [The Copenhagen Book](https://thecopenhagenbook.com/sessions)（Lucia 作者写的认证指南） | 业内常被引用的会话设计指南 | 令牌要足够长且随机；数据库只存哈希值；30 天有效，使用时自动延长；退出、改密码、权限变化时让会话失效；网页优先用 HttpOnly Cookie | — |
| [rate-limiter-flexible](https://github.com/animir/node-rate-limiter-flexible) | Node 最常用的限流库 | 登录防爆破分两层：按 IP 限总失败次数，按（账号，IP）限连续失败次数，登录成功后清零 | 暂不引入这个库：现有内存实现已是同样思路，多进程部署时再换成它的 Postgres 版 |
| 微信官方文档：[code2Session](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html)、[手机号快速验证](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getPhoneNumber.html)、[getStableAccessToken](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/mp-access-token/getStableAccessToken.html) | 官方规则 | code 5 分钟有效、只能用一次；`session_key` 不能发给客户端；手机号快速验证**每次 0.03 元（总共免费 1000 次），只有完成认证的非个人主体能用**；多台服务器共用接口调用凭证时要用 stable_token 接口 | — |

**为什么不"直接复制代码"：** 真正做得好的项目，要么是 Java（芋道），要么是深度绑定自己框架的 TypeScript 库（Better Auth），代码放不进我们这个原生 Node 服务器。值得抄的是**表结构、流程和安全规则**，上面都已经吸收进来。自己实现的代码量不大，好处是每一行都看得懂、测得到。没有复制任何代码，所以不需要新增第三方许可声明。

## 四、方案

### 4.1 表结构（新增迁移 `003_auth.sql`）

```sql
-- users、tenants 在 001 已建好：启用它们，数据从 app-state.json 一次性导入
ALTER TABLE users ADD COLUMN phone text UNIQUE;          -- 以后接手机号登录时用，现在为空

-- 一种登录方式 = 一行（参照 Better Auth 的 account 表、芋道的 social_user_bind）
CREATE TABLE user_identities (
    id           text PRIMARY KEY,
    user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider     text NOT NULL CHECK (provider IN ('wechat_mini')),  -- 密码仍存在 users.password_hash
    provider_uid text NOT NULL,                  -- openid
    unionid      text,                           -- 接入微信开放平台后才会有
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    UNIQUE (provider, provider_uid)              -- 同一个微信只能绑定一个账号
);
CREATE INDEX user_identities_user ON user_identities (user_id);

-- 服务器端会话（参照 Copenhagen Book / Lucia）
CREATE TABLE sessions (
    id           text PRIMARY KEY,               -- sha256(令牌) 的十六进制；令牌原文从不落库
    user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client       text NOT NULL CHECK (client IN ('web', 'miniprogram')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    ip           text,
    user_agent   text
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);
```

### 4.2 会话令牌

- 令牌：32 字节随机数，base64url 编码，256 位。数据库只存 `sha256(令牌)`：即使数据库泄露，也拿不到能用的令牌。
- 有效期：网页 7 天，小程序 30 天。剩余时间少于一半时，在这次请求里顺便续期（只在续期时写库，平时每个请求只读不写）。
- 失效：退出登录删当前会话；改密码、禁用账号、改权限时删该用户的全部会话。
- 每个请求的校验：先查内存缓存（有效期 60 秒），没命中才查一次数据库（主键查询）。退出或禁用时同时清掉缓存。以后多进程部署，状态最多滞后 60 秒。
- 平滑过渡：上线后的 8 小时内，旧的 HMAC 令牌仍然接受，已登录的人不会被突然踢出；8 小时后删除旧代码。

### 4.3 网页登录

接口保持 `POST /api/v1/auth/login {account, password}` 不变，返回的 `accessToken` 换成会话令牌，前端存取方式不变。另外：
- 新增 `POST /api/v1/auth/logout`：删除当前会话。网页端的"退出登录"要改成先调这个接口，再清本地存储；这是网页端唯一需要改的地方。
- 密码哈希在登录成功时自动升级到 60 万次迭代。继续在线程池里异步算：默认 4 个线程，天然限制了同时计算密码的数量，不会拖慢其他请求。
- 现有的登录失败限流保持不变。
- 第二步（可选）：令牌从 `localStorage` 改成 HttpOnly Cookie，配合 `SameSite=Lax` 防 CSRF。改动涉及前端每个请求，单独做。

### 4.4 小程序登录

```
小程序启动 ──wx.login──▶ code
   │
   ▼
POST /api/v1/auth/wechat/login {code}
   │  服务器调 code2Session 得到 openid（session_key 丢弃，不存、不下发）
   ├─ openid 已绑定  ──▶ {ok, accessToken, user}          ← 日常：用户无感
   └─ 未绑定        ──▶ {ok:false, status:'unbound', bindTicket}
                           │  bindTicket：10 分钟有效、只能用一次的随机票据，
                           │  服务器端记着它对应哪个 openid（客户端拿不到也伪造不了 openid）
                           ▼
          绑定页：输入网页账号 + 密码
                           ▼
POST /api/v1/auth/wechat/bind {bindTicket, account, password}
   ├─ 密码对，且这个微信没绑过别的账号 ──▶ 绑定 + {ok, accessToken, user}
   └─ 这个微信已绑其他账号 ──▶ 409 "请先在原账号里解绑"（不静默改绑）
```

- 退出 / 解绑：`POST /api/v1/auth/logout`；`DELETE /api/v1/auth/wechat/binding`，解绑同时删掉该用户的小程序会话。网页的"账号设置"里也能看到并解绑。
- 微信接口出错时对应的返回：40029（code 无效）→ 401 让小程序重新 `wx.login`；45011（调用太频繁）→ 429；-1（微信系统繁忙）→ 503 并提示重试。调微信接口统一 5 秒超时。
- 手机号一键登录（可选，第二步）：绑定页上加一个"手机号快速验证"按钮，用 `phoneCode` 换手机号，再按 `users.phone` 找到账号。前提是小程序完成企业认证，并且账号里存了手机号；按次收费。需要用接口调用凭证，统一用 stable_token 接口获取，按"单一请求刷新"缓存。

### 4.5 小程序端

- 新增 `utils/auth.js` 的 `ensureLogin()`：同一时间只允许一次登录。多个请求同时发现没登录，只会触发一次 `wx.login`，其余请求等它完成。这是小程序登录最常见的坑。
- `utils/api.js` 的请求统一带上 `Authorization`。收到 401 时重新登录一次，然后重试原请求，只重试一次，避免死循环。
- 新增绑定页 `pages/bind/bind`：账号、密码、说明文字。
- 收成预测改用这套请求方法，不再需要"放开权限"。

### 4.6 并发与防刷汇总

| 场景 | 处理 |
|---|---|
| 同时大量登录 | 密码计算在线程池里异步进行，不阻塞其他请求；登录失败按 IP 和账号限流（沿用现有逻辑） |
| 每个请求校验令牌 | 内存缓存 60 秒，加主键查询；只在续期时写库 |
| 小程序多个请求同时触发登录 | 客户端只允许一次登录同时进行，收到 401 只重试一次 |
| 同一个微信同时绑两个账号 | `UNIQUE (provider, provider_uid)` 在数据库层面保证，并发时后到的请求得到 409 |
| 微信接口调用凭证 | stable_token，内存缓存到过期前 5 分钟，同一时间只刷新一次 |
| 绑定票据被重放 | 只能用一次、10 分钟有效；用过立即作废 |

### 4.7 接口清单

| 接口 | 说明 |
|---|---|
| `POST /api/v1/auth/login` | 不变（返回会话令牌） |
| `POST /api/v1/auth/logout` | 新增 |
| `GET /api/v1/auth/me` | 不变，另外返回已绑定的微信（只返回是否绑定和绑定时间，不返回 openid） |
| `POST /api/v1/auth/wechat/login` | 新增 |
| `POST /api/v1/auth/wechat/bind` | 新增 |
| `DELETE /api/v1/auth/wechat/binding` | 新增 |

服务器 `.env` 新增 `WECHAT_MINI_APPID`、`WECHAT_MINI_SECRET`，由你配置。

## 五、分步实施（每一步都能单独上线、单独回滚）

0. **修 `verifyToken` 的 500**：签名长度不对或格式错误时返回 401。十几行，可以马上做。
1. **用户和租户迁到 PostgreSQL**：新增 `lib/user-store.js`；启动时如果 PG 里没有用户，就从 `app-state.json` 导入一次（可以重复执行，结果不变），原文件保留作为备份；用户管理相关的 21 处读写改用它。
2. **服务器端会话**：会话表、登录和退出、令牌校验、8 小时新旧令牌过渡。
3. **微信登录**：三个新接口，加小程序的 `ensureLogin`、请求封装和绑定页。
4. （可选）手机号快速验证；网页改用 HttpOnly Cookie。

## 六、测试

- 单元测试：令牌生成与哈希；过期与续期；退出后失效；改密码后全部失效；格式错误的令牌返回 401 而不是 500；code2Session 各种错误码的处理（用模拟的微信接口）；绑定票据只能用一次、会过期；同一个微信并发绑两个账号时只有一个成功。
- 数据库测试：沿用 `tests/pg-stores.test.js` 的方式，在 `agri_test` 库里跑迁移和用户存储的读写。
- 导入测试：用一份真实结构的 `app-state.json` 副本导入两次，结果相同。
- 小程序：开发者工具里验证首次绑定、再次打开自动登录、令牌过期后自动重新登录、多个请求同时发起只登录一次。

## 七、需要你决定

1. **小程序是企业认证还是个人主体？** 这决定能不能用手机号一键登录。个人主体不能用，只能用账号密码绑定。
2. **第一次用小程序、还没有网页账号的人怎么办？** 现在的账号都由管理员创建，没有自助注册。建议先保持这样：没有账号就提示联系管理员。要支持自助注册、自动建新农场，需要另外设计防刷规则。
3. **一个账号能绑几个微信？** 如果一个农场账号是一家人或几个工人共用，就要允许一个账号绑多个微信（建议上限 5 个）。如果每人一个账号，就限一个。表结构两种都支持，只是规则不同。
4. **网页令牌要不要换成 HttpOnly Cookie？** 更安全，但要改前端每个请求。建议放在第 4 步单独做。

## 八、工作量（粗估）

| 步骤 | 估计 |
|---|---|
| 0 修 500 | 半小时 |
| 1 用户迁到 PG | 1 天 |
| 2 服务器端会话 | 半天 |
| 3 微信登录（含小程序端） | 1 天 |
| 4 可选项 | 各半天到 1 天 |
