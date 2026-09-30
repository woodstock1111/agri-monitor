/* 小程序登录（docs/auth-design.md §4.4–4.5）
 * - 第一次需要服务器数据时自动 wx.login → /auth/wechat/login，用户无感：
 *   已绑定账号的微信拿到账号会话；没绑定的拿到“游客”会话，只能用收成预测这类公开数据接口，不需要绑定。
 * - 同一时间只跑一次登录：多个请求同时发现没登录，只触发一次 wx.login，其余等它。
 * - 收到 401（令牌过期或被注销）时重新登录一次并重试原请求，只重试一次。
 * - 绑定账号（pages/bind/bind）是可选的，以后看自己农场的数据时才需要。 */
const config = require('./config.js')

const TOKEN_KEY = config.tokenKey
const USER_KEY = 'agri_current_user' // 游客为 null
let loginPromise = null
let cloudReady = false

function viaGateway() {
  return !!(config.cloud && config.cloud.env)
}

// 发到服务器：有云托管环境就走 callContainer（微信在请求里注入 openid），否则直连 agentBaseUrl。
// options: { path（/api/v1 之后的部分）, method, data, header, timeout }；返回 { statusCode, data }。
function send(options) {
  const { path, method = 'GET', data, header = {}, timeout } = options
  return new Promise((resolve, reject) => {
    const fail = err => reject(new Error((err && err.errMsg) || '网络错误'))
    if (viaGateway()) {
      if (!cloudReady) {
        wx.cloud.init({ env: config.cloud.env })
        cloudReady = true
      }
      wx.cloud.callContainer({
        config: { env: config.cloud.env },
        path: `${config.apiPrefix}${path}`,
        method,
        data,
        header: { ...header, 'X-WX-SERVICE': config.cloud.service },
        timeout,
        success: res => resolve(res),
        fail
      })
      return
    }
    wx.request({ url: `${config.agentBaseUrl}${config.apiPrefix}${path}`, method, data, header, timeout, success: res => resolve(res), fail })
  })
}

function wxLoginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: res => (res.code ? resolve(res.code) : reject(new Error('微信登录失败，请重试。'))),
      fail: err => reject(new Error((err && err.errMsg) || '微信登录失败，请重试。'))
    })
  })
}

function readToken() {
  try { return wx.getStorageSync(TOKEN_KEY) || '' } catch (e) { return '' }
}

function saveSession(data) {
  wx.setStorageSync(TOKEN_KEY, data.accessToken)
  wx.setStorageSync(USER_KEY, data.user || null)
}

function clearSession() {
  try {
    wx.removeStorageSync(TOKEN_KEY)
    wx.removeStorageSync(USER_KEY)
  } catch (e) {}
}

function messageOf(res, fallback) {
  return (res && res.data && res.data.msg) || fallback
}

// 用微信身份登录。返回 { guest, user, bindTicket }；bind 为 true（绑定页）时游客还会拿到一次性的绑定票据。
// 走云托管时微信已替我们验证身份，不需要 wx.login。
async function loginWithWechat({ bind = false } = {}) {
  const res = viaGateway()
    ? await send({ path: '/auth/wechat/gateway-login', method: 'POST', data: { bind }, timeout: 15000 })
    : await send({ path: '/auth/wechat/login', method: 'POST', data: { code: await wxLoginCode(), bind }, timeout: 15000 })
  const d = res.data || {}
  if (res.statusCode === 200 && d.ok && d.accessToken) {
    saveSession(d)
    return { guest: !!d.guest, user: d.user || null, bindTicket: d.bindTicket || '' }
  }
  throw new Error(messageOf(res, '登录失败，请稍后重试。'))
}

// 保证有可用令牌（账号或游客）。并发调用共享同一次登录。
function ensureLogin({ force = false } = {}) {
  if (!force && readToken()) return Promise.resolve()
  if (!loginPromise) {
    if (force) clearSession()
    loginPromise = loginWithWechat().then(() => {}).finally(() => { loginPromise = null })
  }
  return loginPromise
}

// 带登录的请求：path 以 /api/v1 之后的部分传入，例如 '/harvest/soil?lat=..'。返回 wx.request 的 res。
async function request(options) {
  const attempt = () => send({ ...options, header: { ...(options.header || {}), Authorization: `Bearer ${readToken()}` } })
  await ensureLogin()
  let res = await attempt()
  if (res.statusCode === 401) {
    await ensureLogin({ force: true })
    res = await attempt()
  }
  return res
}

// 绑定页：用网页账号密码把当前微信绑定上去。
async function bind(bindTicket, account, password) {
  const res = await send({ path: '/auth/wechat/bind', method: 'POST', data: { bindTicket, account, password }, timeout: 20000 })
  const d = res.data || {}
  if (res.statusCode === 200 && d.ok && d.accessToken) {
    saveSession(d)
    return { ok: true, user: d.user }
  }
  return { ok: false, status: d.status || '', msg: messageOf(res, '绑定失败，请稍后重试。') }
}

// 退出登录（下次打开会自动重新登录）；unbind 为 true 时同时解除本微信与账号的绑定。
async function logout({ unbind = false } = {}) {
  const token = readToken()
  if (token) {
    try {
      const header = { Authorization: `Bearer ${token}` }
      if (unbind) {
        // 走云托管时服务器用网关带来的 openid；直连时用一次新的 wx.login code 证明是这个微信本人
        const path = viaGateway() ? '/auth/wechat/binding' : `/auth/wechat/binding?code=${encodeURIComponent(await wxLoginCode())}`
        await send({ path, method: 'DELETE', header })
      } else {
        await send({ path: '/auth/logout', method: 'POST', header })
      }
    } catch (e) {}
  }
  clearSession()
}

function currentUser() {
  try { return wx.getStorageSync(USER_KEY) || null } catch (e) { return null }
}

module.exports = {
  ensureLogin,
  loginWithWechat,
  request,
  bind,
  logout,
  currentUser
}
