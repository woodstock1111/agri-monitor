const config = {
  baseURL: '',
  apiPrefix: '/api/v1',
  useMock: true,
  tokenKey: 'agri_access_token',
  // “小薯”助手走真实服务器（展示模式：开发者工具需勾选“不校验合法域名”）
  agentBaseUrl: 'http://47.116.46.214',
  // 微信云托管网关（cloudrun/gateway）：填了 env 就通过 wx.cloud.callContainer 访问服务器，正式版也能用（不需要域名和备案）；
  // env 留空则直连 agentBaseUrl（只在开发者工具或打开“开发调试”的开发版/体验版里能用）
  cloud: {
    env: 'agri-gateway-d0go1d0k14d563146',
    service: 'agri-gateway'
  }
}

module.exports = config
