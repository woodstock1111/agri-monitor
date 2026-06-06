Component({
  data: {
    selected: 0,
    list: [
      {
        pagePath: '/pages/farmtasks/farmtasks',
        text: '计划',
        icon: 'plan'
      },
      {
        pagePath: '/pages/dashboard/dashboard',
        text: '看板',
        icon: 'dashboard'
      }
    ]
  },

  methods: {
    switchTab(event) {
      const index = event.currentTarget.dataset.index
      const item = this.data.list[index]
      if (!item || index === this.data.selected) return
      wx.switchTab({ url: item.pagePath })
    }
  }
})
