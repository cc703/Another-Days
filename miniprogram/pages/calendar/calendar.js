const {
  addMonths,
  formatDate,
  getMonthMeta,
  getMonthStart,
  getTodayString,
  parseDate
} = require('../../utils/date.js');
const { clearToast, showChaosToast } = require('../../utils/toast.js');
const { syncTabBar } = require('../../utils/tabbar.js');
const {
  applyPageReset,
  clearRequestToken,
  createRequestToken,
  isActiveRequest,
  withLoginGate
} = require('../../utils/page-helpers.js');

const app = getApp();
const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

function formatDisplayDate(dateString) {
  const date = parseDate(dateString);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatMonthStamp(dateString) {
  const date = parseDate(dateString);
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function buildCalendarCells(month, checkedMap, selectedDate, todayDate) {
  const cells = [];
  const monthPrefix = `${month.year}-${String(month.month).padStart(2, '0')}`;

  for (let index = 0; index < month.firstWeekday; index += 1) {
    cells.push({
      key: `empty-start-${index}`,
      empty: true
    });
  }

  for (let day = 1; day <= month.daysInMonth; day += 1) {
    const date = `${monthPrefix}-${String(day).padStart(2, '0')}`;
    const checked = Boolean(checkedMap[date]);
    const today = date === todayDate;
    const future = date > todayDate;

    cells.push({
      key: date,
      date,
      label: String(day),
      empty: false,
      checked,
      selected: date === selectedDate,
      today,
      future,
      missed: !checked && date < todayDate,
      badgeText: checked ? '亮' : (today ? '今' : ''),
      tagText: today ? (checked ? '已亮' : '渡劫') : ''
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({
      key: `empty-end-${cells.length}`,
      empty: true
    });
  }

  return cells;
}

function buildSelectedState(date, checkedMap, todayDate) {
  const checked = Boolean(checkedMap[date]);
  const isFuture = date > todayDate;
  const isToday = date === todayDate;

  if (checked) {
    return {
      selectedTitle: formatDisplayDate(date),
      selectedStatus: '已给面子',
      selectedDesc: isToday
        ? '不错，今天已经成功伪装成了一个有在认真生活的人。'
        : '这一天已经被你点亮，轨迹已经老老实实躺进赛博案底里了。',
      selectedCanCheckIn: false,
      selectedActionLabel: '已经打卡',
      selectedTone: 'done'
    };
  }

  if (isFuture) {
    return {
      selectedTitle: formatDisplayDate(date),
      selectedStatus: '未来留白',
      selectedDesc: '未来日期先别提前糊弄，等那一天真的来了再盖章。',
      selectedCanCheckIn: false,
      selectedActionLabel: '暂不可打卡',
      selectedTone: 'locked'
    };
  }

  return {
    selectedTitle: formatDisplayDate(date),
    selectedStatus: isToday ? '濒临罢工' : '等待补记',
    selectedDesc: isToday
      ? '今天还没留下一丝挣扎的痕迹，点一下给生活盖个章。'
      : '这一天还空着，现在可以补记，把它勉强点亮。',
    selectedCanCheckIn: true,
    selectedActionLabel: isToday ? '敷衍地亮一下' : '补记这天',
    selectedTone: 'pending'
  };
}

function buildRecentLogs(items) {
  return (items || []).map((item, index) => ({
    key: item._id || `${item.date}-${index}`,
    displayDate: formatDisplayDate(item.date),
    text: `[${formatDisplayDate(item.date)}] 已把这一天点亮，至少留过一点挣扎痕迹。`
  }));
}

function formatEntryTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '--:--';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function normalizeImages(images) {
  return (Array.isArray(images) ? images : []).map((item, index) => {
    if (typeof item === 'string') {
      return {
        key: item || `image-${index}`,
        url: item
      };
    }

    const fileID = item && (item.fileID || item.fileId || item.id);
    const url = fileID || (item && (item.url || item.tempFilePath || item.path));
    return {
      key: (item && item.key) || url || `image-${index}`,
      url: url || ''
    };
  }).filter((item) => item.url);
}

function buildDiaryRecords(items) {
  return (items || []).map((item, index) => ({
    key: item._id || item.createdAt || `diary-${index}`,
    time: formatEntryTime(item.createdAt),
    mood: item.mood || '',
    content: item.content || '',
    tags: item.tags || [],
    images: normalizeImages(item.images || item.imageIds || item.imagePaths || [])
  }));
}

function buildCompletedTasks(items) {
  return (items || [])
    .filter((item) => item && (item.completed || item.status === 'done'))
    .map((item, index) => ({
      key: item._id || item.id || `task-${index}`,
      title: item.title || item.label || '未命名任务',
      focusMinutes: Number(item.focusMinutes || item.duration || 0)
    }));
}

function buildFocusDetail(result, selectedDate, todayDate) {
  if (!result || !result.success) {
    return {
      focusMinutes: 0,
      focusSessions: 0,
      focusNote: '专注数据暂时不可用'
    };
  }

  const isToday = selectedDate === todayDate;
  const minutes = Number(result.focusMinutes || result.todayMinutes || 0);
  const sessions = Number(result.focusSessions || result.todaySessions || 0);

  return {
    focusMinutes: minutes,
    focusSessions: sessions,
    focusNote: isToday ? '' : '已按所选日期同步历史专注明细。'
  };
}

function createInitialState() {
  return {
    loading: false,
    submitting: false,
    toastVisible: false,
    toastMessage: '',
    weekLabels: WEEK_LABELS,
    anchorDate: '',
    todayDate: getTodayString(),
    monthLabel: '',
    monthKpiText: 'KPI: 0 / 0',
    monthMeta: null,
    calendarCells: [],
    checkedMap: {},
    checkedCountText: '0 / 0',
    streakText: '连续 0 天',
    totalCheckInsText: '累计 0 次',
    selectedDate: '',
    selectedTitle: '',
    selectedStatus: '',
    selectedDesc: '',
    selectedCanCheckIn: false,
    selectedActionLabel: '敷衍地亮一下',
    selectedTone: 'pending',
    selectedLoading: false,
    completedTasks: [],
    completedTaskCountText: '0 项完成',
    focusMinutes: 0,
    focusSessions: 0,
    focusNote: '',
    diaryRecords: [],
    selectedDiary: null,
    diaryModalVisible: false,
    recentLogs: [],
    logCountText: '0 条记录'
  };
}

Page({
  data: createInitialState(),

  async onShow() {
    syncTabBar(this, 'calendar');
    const anchorDate = this.data.anchorDate || getTodayString();
    await this.loadDashboard(anchorDate);
  },

  onUnload() {
    clearToast(this);
    this._dashboardRequestId = 0;
    this._selectedDetailRequestId = 0;
  },

  onHide() {
    clearToast(this);
    this._dashboardRequestId = 0;
    this._selectedDetailRequestId = 0;
  },

  async loadDashboard(anchorDate, selectedDateOverride) {
    if (!withLoginGate(this, {
      mode: 'passive',
      message: '请先登录后再查看打卡日历。',
      resetLoadingField: 'loading'
    })) {
      return;
    }

    this.setData({ loading: true });
    const requestId = createRequestToken(this, '_dashboardRequestId');

    try {
      const user = await app.ensureUserSession();
      if (!user || !isActiveRequest(this, '_dashboardRequestId', requestId)) {
        throw new Error('SESSION_INIT_FAILED');
      }

      const result = await app.api.habit.getDashboard(anchorDate);
      if (!isActiveRequest(this, '_dashboardRequestId', requestId)) {
        return;
      }

      if (!result || !result.success) {
        throw new Error((result && result.message) || 'CALENDAR_LOAD_FAILED');
      }

      const checkedDates = result.checkedDates || [];
      const checkedMap = (checkedDates || []).reduce((acc, item) => {
        acc[item] = true;
        return acc;
      }, {});
      const todayDate = result.todayDate || getTodayString();
      const month = result.month || {};
      const selectedDate = selectedDateOverride || result.date;
      const recentLogs = buildRecentLogs(result.recentCheckIns || []);
      const selectedState = buildSelectedState(selectedDate, checkedMap, todayDate);
      const monthLabel = month.monthLabel || formatMonthStamp(result.date);

      this.setData({
        anchorDate: result.date,
        todayDate,
        monthLabel,
        monthKpiText: `KPI: ${checkedDates.length} / ${month.daysInMonth || 0}`,
        monthMeta: month,
        checkedMap,
        checkedCountText: `${checkedDates.length} / ${month.daysInMonth || 0}`,
        streakText: `连续 ${result.stats && result.stats.currentStreak ? result.stats.currentStreak : 0} 天`,
        totalCheckInsText: `累计 ${result.stats && result.stats.totalCheckIns ? result.stats.totalCheckIns : 0} 次`,
        calendarCells: buildCalendarCells(month, checkedMap, selectedDate, todayDate),
        selectedDate,
        recentLogs,
        logCountText: `${recentLogs.length} 条记录`,
        ...selectedState
      });
      this.loadSelectedDayDetail(selectedDate);
    } catch (error) {
      console.error('[version2/calendar] 日历加载失败:', error);
      showChaosToast(this, '打卡日历加载失败，请检查云函数部署。', 2200);
    } finally {
      this.setData({ loading: false });
    }
  },

  onSelectDay(e) {
    const { date } = e.currentTarget.dataset;
    if (!date || !this.data.monthMeta) {
      return;
    }

    if (date > (this.data.todayDate || getTodayString())) {
      showChaosToast(this, '未来日期暂不支持打开。', 1500);
      return;
    }

    const nextState = buildSelectedState(date, this.data.checkedMap || {}, this.data.todayDate);

    this.setData({
      selectedDate: date,
      calendarCells: buildCalendarCells(this.data.monthMeta, this.data.checkedMap || {}, date, this.data.todayDate),
      ...nextState
    });
    this.loadSelectedDayDetail(date);
  },

  async loadSelectedDayDetail(date) {
    if (!date || !withLoginGate(this, { mode: 'passive', resetLoadingField: 'selectedLoading' })) {
      return;
    }

    const requestId = createRequestToken(this, '_selectedDetailRequestId');
    this.setData({ selectedLoading: true });

    try {
      const detailResult = app.api.calendar && app.api.calendar.getDetail
        ? await app.api.calendar.getDetail(date)
        : await app.api.daily.getDetail(date);

      if (!isActiveRequest(this, '_selectedDetailRequestId', requestId)) {
        return;
      }

      if (!detailResult || !detailResult.success) {
        throw new Error((detailResult && detailResult.message) || 'CALENDAR_DETAIL_FAILED');
      }

      const completedTasks = buildCompletedTasks(detailResult.tasks || []);
      const focusSummary = detailResult.focusSummary || {};
      const focusDetail = buildFocusDetail({
        success: true,
        focusMinutes: focusSummary.totalMinutes,
        focusSessions: focusSummary.totalSessions
      }, date, this.data.todayDate || getTodayString());
      const diaryRecords = buildDiaryRecords(detailResult.diaryEntries || detailResult.diaries || []);

      this.setData({
        completedTasks,
        completedTaskCountText: `${completedTasks.length} 项完成`,
        focusMinutes: focusDetail.focusMinutes,
        focusSessions: focusDetail.focusSessions,
        focusNote: focusDetail.focusNote,
        diaryRecords,
        selectedLoading: false
      });
    } catch (error) {
      console.error('[version2/calendar] 日期详情加载失败:', error);
      if (isActiveRequest(this, '_selectedDetailRequestId', requestId)) {
        this.setData({
          selectedLoading: false,
          completedTasks: [],
          completedTaskCountText: '0 项完成',
          focusMinutes: 0,
          focusSessions: 0,
          focusNote: '日期详情加载失败',
          diaryRecords: []
        });
      }
    }
  },

  onOpenDiaryRecord(e) {
    const { key } = e.currentTarget.dataset;
    const record = (this.data.diaryRecords || []).find((item) => item.key === key);
    if (!record) return;
    this.setData({
      selectedDiary: record,
      diaryModalVisible: true
    });
  },

  onCloseDiaryRecord() {
    this.setData({
      selectedDiary: null,
      diaryModalVisible: false
    });
  },

  noop() {},

  onPrevMonth() {
    const nextDate = addMonths(this.data.anchorDate || getTodayString(), -1);
    this.loadDashboard(nextDate, nextDate);
  },

  onNextMonth() {
    const currentMonthStart = getMonthStart(this.data.todayDate || getTodayString());
    const nextDate = addMonths(this.data.anchorDate || getTodayString(), 1);

    if (getMonthStart(nextDate) > currentMonthStart) {
      showChaosToast(this, '未来月份先别偷看了。', 1800);
      return;
    }

    this.loadDashboard(nextDate, nextDate);
  },

  onSelectToday() {
    const today = this.data.todayDate || getTodayString();
    this.loadDashboard(today, today);
  },

  async onCheckIn() {
    if (!this.data.selectedCanCheckIn || this.data.submitting) {
      return;
    }

    if (!withLoginGate(this, { mode: 'action' })) {
      return;
    }

    this.setData({ submitting: true });

    try {
      const result = await app.api.habit.checkIn(this.data.selectedDate);
      if (!result || !result.success) {
        showChaosToast(this, (result && result.message) || '打卡失败，请稍后重试。', 2200);
        return;
      }

      showChaosToast(this, result.message || '打卡成功。', 1800);
      await this.loadDashboard(this.data.anchorDate, this.data.selectedDate);
    } catch (error) {
      console.error('[version2/calendar] 打卡失败:', error);
      showChaosToast(this, error && error.message ? error.message : '打卡失败，请稍后重试。', 2200);
    } finally {
      this.setData({ submitting: false });
    }
  },

  onAppLogout() {
    applyPageReset(this, createInitialState, (page) => {
      clearRequestToken(page, '_dashboardRequestId');
      clearRequestToken(page, '_selectedDetailRequestId');
    });
  },

  onBack() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({
          url: '/pages/profile/profile'
        });
      }
    });
  }
});
