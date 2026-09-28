const api = require('../../utils/api.js')

let seq = 0
function uid() { return 'm' + (++seq) }

Page({
  data: {
    messages: [],
    text: '',
    pendingImage: '',     // 预览用 tempFilePath
    pendingDataUrl: '',   // 发送用 base64 dataURL
    sending: false,
    scrollTo: '',
    safeBottom: 0
  },

  onLoad() {
    const info = wx.getSystemInfoSync()
    const safeBottom = info.screenHeight - (info.safeArea ? info.safeArea.bottom : info.screenHeight)
    this.setData({
      safeBottom: safeBottom > 0 ? safeBottom : 0,
      messages: [{
        id: uid(),
        role: 'assistant',
        text: '你好，我是小薯🍠 木薯和红薯的事都可以问我～也可以拍张照片发我，帮你看看是什么虫、什么草，怎么防治。'
      }]
    })
  },

  onInput(e) {
    this.setData({ text: e.detail.value })
  },

  chooseImage() {
    if (this.data.sending) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles[0]
        wx.getFileSystemManager().readFile({
          filePath: file.tempFilePath,
          encoding: 'base64',
          success: (r) => {
            this.setData({
              pendingImage: file.tempFilePath,
              pendingDataUrl: 'data:image/jpeg;base64,' + r.data
            })
          },
          fail: () => wx.showToast({ title: '读取图片失败', icon: 'none' })
        })
      }
    })
  },

  removeImage() {
    this.setData({ pendingImage: '', pendingDataUrl: '' })
  },

  scrollToId(id) {
    this.setData({ scrollTo: 'msg-' + id })
  },

  async send() {
    if (this.data.sending) return
    const text = (this.data.text || '').trim()
    const dataUrl = this.data.pendingDataUrl
    if (!text && !dataUrl) return

    const userMsg = { id: uid(), role: 'user', text, image: this.data.pendingImage || '' }
    const thinkId = uid()
    const history = this.data.messages
      .filter(m => m.text && !m.thinking)
      .map(m => ({ role: m.role, text: m.text }))

    this.setData({
      messages: this.data.messages.concat([userMsg, { id: thinkId, role: 'assistant', thinking: true }]),
      text: '',
      pendingImage: '',
      pendingDataUrl: '',
      sending: true
    })
    this.scrollToId(thinkId)

    try {
      const res = await api.agentChat({ text, image: dataUrl || undefined, history })
      const reply = (res && res.reply) || '（没有返回内容）'
      this.replaceMsg(thinkId, { id: thinkId, role: 'assistant', text: reply })
    } catch (err) {
      this.replaceMsg(thinkId, { id: thinkId, role: 'assistant', text: '小薯开小差了：' + (err.message || '请求失败') })
    } finally {
      this.setData({ sending: false })
      this.scrollToId(thinkId)
    }
  },

  replaceMsg(id, msg) {
    this.setData({ messages: this.data.messages.map(m => (m.id === id ? msg : m)) })
  }
})
