// 独立页面只承载收成预测组件；园区地图里用同一个组件做底部抽屉
Page({
  data: { plotId: '', height: 600 },
  onLoad(options) {
    this.setData({ plotId: (options && options.plotId) || '', height: wx.getSystemInfoSync().windowHeight })
  }
})
