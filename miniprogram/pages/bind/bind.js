const auth = require('../../utils/auth.js')

Page({
  data: {
    state: 'checking', // checking | form | done | error
    account: '',
    password: '',
    submitting: false,
    message: ''
  },

  _ticket: '',

  onLoad() {
    this.refreshTicket()
  },

  // 先用微信身份试一次：已经绑定过就直接回去；是游客就拿到绑定票据，显示表单
  async refreshTicket() {
    this.setData({ state: 'checking', message: '' })
    try {
      const r = await auth.loginWithWechat({ bind: true })
      if (!r.guest) {
        this.finish('已登录')
        return
      }
      this._ticket = r.bindTicket
      this.setData({ state: 'form' })
    } catch (e) {
      this.setData({ state: 'error', message: e.message || '连不上服务器，请稍后重试。' })
    }
  },

  onInput(e) {
    this.setData({ [e.currentTarget.dataset.key]: e.detail.value, message: '' })
  },

  async onSubmit() {
    if (this.data.submitting) return
    const account = this.data.account.trim()
    const password = this.data.password
    if (!account || !password) {
      this.setData({ message: '请填写账号和密码。' })
      return
    }
    this.setData({ submitting: true, message: '' })
    try {
      let r = await auth.bind(this._ticket, account, password)
      if (!r.ok && r.status === 'ticket_expired') {
        // 票据 10 分钟有效；过期就静默换一张再试一次
        const again = await auth.loginWithWechat({ bind: true })
        if (!again.guest) { this.finish('已登录'); return }
        this._ticket = again.bindTicket
        r = await auth.bind(this._ticket, account, password)
      }
      if (r.ok) {
        wx.vibrateShort({ type: 'light' })
        this.finish('绑定成功')
        return
      }
      this.setData({ message: r.msg })
    } catch (e) {
      this.setData({ message: e.message || '网络错误，请重试。' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  finish(title) {
    this.setData({ state: 'done' })
    wx.showToast({ title, icon: 'success' })
    setTimeout(() => {
      if (getCurrentPages().length > 1) wx.navigateBack()
      else wx.reLaunch({ url: '/pages/cover/cover' })
    }, 700)
  }
})
