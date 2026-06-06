const api = require('../../utils/api.js')

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function pad(num) {
  return String(num).padStart(2, '0')
}

function getDateParts(dateString) {
  const parts = dateString.split('-').map(Number)
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
  return {
    year: parts[0],
    month: parts[1],
    day: parts[2],
    weekday: WEEKDAYS[date.getUTCDay()]
  }
}

function normalizeCompletedAt(value) {
  if (!value) return null
  if (typeof value === 'number') return new Date(value)
  if (/^\d+$/.test(String(value))) return new Date(Number(value))
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function displayCompletedAt(value) {
  const date = normalizeCompletedAt(value)
  if (!date) return ''
  const bj = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return `${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}`
}

function splitCategory(category) {
  const parts = String(category || '').split('|')
  return {
    plot: parts[0] || '',
    time: parts[1] || '',
    ownerLabel: parts[2] ? `${parts[2]} 负责` : '',
    ownerShort: parts[3] || ''
  }
}

function decorateTask(task, todayString, completingMap) {
  const category = splitCategory(task.category)
  const done = task.status === 'done'
  const overdue = task.date < todayString && task.status === 'pending'
  const phase = completingMap[task.id] || (done ? 'done' : 'idle')
  return {
    ...task,
    ...category,
    done,
    overdue,
    donePhase: phase,
    completedTime: displayCompletedAt(task.completedAt),
    ownerText: overdue && category.ownerLabel ? `${category.ownerLabel} · 需补登` : category.ownerLabel
  }
}

Page({
  data: {
    today: '',
    selectedDate: '',
    dates: [],
    sections: [],
    loading: true,
    toastOpen: false,
    toastText: '',
    undoTask: null,
    completingId: '',
    completingMap: {}
  },

  timers: [],

  onLoad() {
    const today = api.getBeijingDateString()
    this.setData({
      today,
      selectedDate: today,
      dates: this.buildDateStrip(today, {})
    })
    this.loadCalendarAndTasks(today)
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ selected: 0 })
  },

  onUnload() {
    this.clearTimers()
  },

  clearTimers() {
    this.timers.forEach(timer => clearTimeout(timer))
    this.timers = []
  },

  setTimer(fn, delay) {
    const timer = setTimeout(fn, delay)
    this.timers.push(timer)
    return timer
  },

  buildDateStrip(selectedDate, calendar) {
    const today = this.data.today || api.getBeijingDateString()
    return [-3, -2, -1, 0, 1, 2].map(offset => {
      const date = api.addDays(today, offset)
      const parts = getDateParts(date)
      const count = calendar[date] || 0
      return {
        key: date,
        weekday: date === today ? '今天' : parts.weekday,
        day: parts.day,
        count,
        hasTask: count > 0,
        isToday: date === today,
        active: date === selectedDate
      }
    })
  },

  async loadCalendarAndTasks(date) {
    this.setData({ loading: true })
    const parts = getDateParts(date)
    try {
      const [calendarRes, tasksRes] = await Promise.all([
        api.getFarmTaskCalendar(parts.year, parts.month),
        api.getFarmTasks(date)
      ])
      const calendar = (calendarRes && calendarRes.calendar) || {}
      const tasks = (tasksRes && tasksRes.tasks) || []
      this.setData({
        dates: this.buildDateStrip(date, calendar),
        sections: this.buildSections(tasks),
        loading: false
      })
    } catch (err) {
      this.setData({ loading: false })
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  buildSections(tasks) {
    const today = this.data.today || api.getBeijingDateString()
    const completingMap = this.data.completingMap || {}
    const decorated = tasks.map(task => decorateTask(task, today, completingMap))
    if (!decorated.length) return []

    const aiRec = decorated.filter(task => task.type === 'ai' && task.aiReason && task.status === 'pending')
    const aiAuto = decorated.filter(task => task.type === 'ai' && !task.aiReason && task.status === 'pending')
    const user = decorated.filter(task => task.type === 'user')

    return [
      {
        key: 'ai-rec',
        title: 'AI 每日推荐',
        icon: '★',
        count: `${aiRec.length} 条`,
        action: '↻ 刷新',
        flavor: 'rec',
        cool: false,
        tasks: aiRec
      },
      {
        key: 'ai-auto',
        title: 'AI 农事',
        icon: '⚙',
        count: '系统排程 · 待确认',
        action: '',
        flavor: 'ai',
        cool: true,
        tasks: aiAuto
      },
      {
        key: 'user',
        title: '自己的农事',
        icon: '✦',
        count: `${user.length} 条`,
        action: '+ 添加',
        flavor: 'user',
        cool: false,
        tasks: user
      }
    ].filter(section => section.tasks.length > 0 || section.key === 'user')
  },

  onSectionAction(event) {
    const key = event.currentTarget.dataset.key
    if (key === 'ai-rec') {
      this.onRefreshRecommendations()
      return
    }
    this.onAddTask()
  },

  async onPickDate(event) {
    const date = event.currentTarget.dataset.date
    if (!date || date === this.data.selectedDate) return
    this.clearTimers()
    this.setData({
      selectedDate: date,
      completingId: '',
      completingMap: {},
      toastOpen: false,
      undoTask: null
    })
    await this.loadCalendarAndTasks(date)
  },

  onRefreshRecommendations() {
    wx.showToast({ title: '已刷新推荐', icon: 'none' })
  },

  onAddTask() {
    wx.showToast({ title: '添加任务入口预留', icon: 'none' })
  },

  async onAdoptTask(event) {
    const task = this.findTask(event.currentTarget.dataset.id)
    if (!task) return
    this.vibrate('light')
    await api.createFarmTask({
      title: task.title,
      date: this.data.selectedDate,
      category: task.category,
      type: 'user'
    })
    wx.showToast({ title: '已加入自己的农事', icon: 'none' })
    await this.loadCalendarAndTasks(this.data.selectedDate)
  },

  onIgnoreTask() {
    wx.showToast({ title: '已忽略本条推荐', icon: 'none' })
  },

  onConvertTask() {
    wx.showToast({ title: '转人工入口预留', icon: 'none' })
  },

  onSkipTask() {
    wx.showToast({ title: '已跳过本次排程', icon: 'none' })
  },

  async onDoneTask(event) {
    const id = event.currentTarget.dataset.id
    const task = this.findTask(id)
    if (!task || task.status === 'done') return
    await this.runCompleteTask(task, false)
  },

  async skipCompletionAnimation() {
    const id = this.data.completingId
    if (!id) return
    const task = this.findTask(id)
    if (!task) return
    this.clearTimers()
    await this.runCompleteTask(task, true)
  },

  async runCompleteTask(task, skipAnimation) {
    if (this.data.completingId && !skipAnimation) return
    const phaseMap = { ...this.data.completingMap, [task.id]: skipAnimation ? 'done' : 'press' }
    this.setData({ completingId: task.id, completingMap: phaseMap, sections: this.patchTaskPhase(task.id, phaseMap[task.id]) })

    if (!skipAnimation) {
      this.setTimer(() => {
        this.vibrate('light')
        const reboundMap = { ...this.data.completingMap, [task.id]: 'rebound' }
        this.setData({ completingMap: reboundMap, sections: this.patchTaskPhase(task.id, 'rebound') })
      }, 130)

      await new Promise(resolve => {
        this.setTimer(resolve, 460)
      })
    } else {
      this.vibrate('light')
    }

    const completedAt = Date.now()
    await api.updateFarmTask(task.id, { status: 'done', completedAt })
    const doneMap = { ...this.data.completingMap, [task.id]: 'done' }
    this.setData({
      completingId: '',
      completingMap: doneMap,
      sections: this.updateTaskState(task.id, { status: 'done', completedAt, completedTime: displayCompletedAt(completedAt), done: true, donePhase: 'done' })
    })
    this.openUndoToast(task)
  },

  patchTaskPhase(id, phase) {
    return this.data.sections.map(section => ({
      ...section,
      tasks: section.tasks.map(task => task.id === id ? { ...task, donePhase: phase } : task)
    }))
  },

  updateTaskState(id, patch) {
    return this.data.sections.map(section => ({
      ...section,
      tasks: section.tasks.map(task => task.id === id ? { ...task, ...patch } : task)
    }))
  },

  openUndoToast(task) {
    this.setData({
      toastOpen: true,
      toastText: `已完成 · ${task.title}`,
      undoTask: task
    })
    this.setTimer(() => {
      this.setData({ toastOpen: false, undoTask: null })
    }, 3000)
  },

  async onUndoTask() {
    const task = this.data.undoTask
    if (!task) return
    this.clearTimers()
    await api.updateFarmTask(task.id, { status: 'pending', completedAt: null })
    this.setData({
      toastOpen: false,
      undoTask: null,
      completingId: '',
      completingMap: {}
    })
    await this.loadCalendarAndTasks(this.data.selectedDate)
  },

  onAskAgent() {
    wx.showToast({ title: '小薯聊天页稍后接入', icon: 'none' })
  },

  findTask(id) {
    let found = null
    this.data.sections.forEach(section => {
      section.tasks.forEach(task => {
        if (task.id === id) found = task
      })
    })
    return found
  },

  vibrate(type) {
    if (!wx.vibrateShort) return
    wx.vibrateShort({ type })
  }
})
