'use strict';
// WeChat mini program sign-in: exchanges a wx.login code for the user's openid (code2Session).
// Rules from the official docs: a code is valid for 5 minutes and can be used once; session_key must never reach the client,
// so it is dropped here (nothing we do needs it). Errors are mapped to HTTP statuses the mini program can act on.
const { requestJson } = require('./http');

const CODE = /^[A-Za-z0-9_-]{8,128}$/;

class WechatError extends Error {
    constructor(status, msg, errcode) {
        super(msg);
        this.status = status;
        this.errcode = errcode;
    }
}

function createWechatMini({ appId = process.env.WECHAT_MINI_APPID, secret = process.env.WECHAT_MINI_SECRET, request = requestJson, timeoutMs = 5000 } = {}) {
    return {
        configured: () => !!(appId && secret),
        async code2Session(code) {
            if (!appId || !secret) throw new WechatError(503, '服务器还没有配置小程序 AppSecret。');
            if (typeof code !== 'string' || !CODE.test(code)) throw new WechatError(400, '登录码无效，请重新打开小程序。');
            const url = 'https://api.weixin.qq.com/sns/jscode2session?' + new URLSearchParams({ appid: appId, secret, js_code: code, grant_type: 'authorization_code' });
            let res;
            try {
                res = await request(url, { method: 'GET', timeout: timeoutMs });
            } catch (e) {
                throw new WechatError(503, '微信服务暂时连不上，请稍后重试。');
            }
            const d = res.data || {};
            if (d.errcode === 40029 || d.errcode === 40163) throw new WechatError(401, '登录码已失效，请重新登录。', d.errcode);
            if (d.errcode === 45011) throw new WechatError(429, '登录太频繁，请稍后再试。', d.errcode);
            if (d.errcode === 40226) throw new WechatError(403, '微信判定该账号存在风险，暂时无法登录。', d.errcode);
            if (d.errcode === -1) throw new WechatError(503, '微信系统繁忙，请稍后重试。', d.errcode);
            if (d.errcode || typeof d.openid !== 'string' || !d.openid) throw new WechatError(502, '微信登录失败，请稍后重试。', d.errcode);
            return { openid: d.openid, unionid: typeof d.unionid === 'string' ? d.unionid : null };
        },
    };
}

module.exports = { createWechatMini, WechatError };
