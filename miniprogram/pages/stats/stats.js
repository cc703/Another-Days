const { clearToast, showChaosToast } = require('../../utils/toast.js');
const {
  applyPageReset,
  clearDelayedTask,
  scheduleDelayedTask,
  withLoginGate
} = require('../../utils/page-helpers.js');
const { syncTabBar } = require('../../utils/tabbar.js');

const app = getApp();
const STATS_FETCH_DELAY = 72;
const STATS_CACHE_MAX_AGE = 15000;
const STATS_STALE_MAX_AGE = 60000;
const PERIODS = [
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' },
  { key: 'total', label: '累计' }
];

function clampPercent(value) {
  const safe = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return `${safe}%`;
}

function buildMetricCards(result, period) {
  const stats = result.stats || {};
  const today = result.today || {};
  const focus = result.focusStats || {};
  const periodMinutes = Number(focus.periodMinutes || focus.focusMinutes || 0);
  const periodSessions = Number(focus.periodSessions || focus.focusSessions || 0);
  const isWeek = period === 'week';
  const isMonth = period === 'month';
  const isTotal = period === 'total';
  const displayMinutes = isTotal ? stats.totalFocusMinutes || 0 : periodMinutes || stats.totalFocusMinutes || 0;
  const displaySessions = isTotal ? stats.totalFocusSessions || 0 : periodSessions || stats.totalFocusSessions || 0;

  return [
    {
      key: 'today-focus',
      className: 'stats-metric-card--yellow',
      title: isWeek ? '今日精神内耗' : isMonth ? '本月专注时长' : '累计专注时长',
      value: String(isWeek ? today.focusMinutes || 0 : displayMinutes),
      unit: 'MIN',
      note: isWeek
        ? (today.focusMinutes ? `${today.focusSessions || 0} 轮，还算有点动静` : '其实脑子里已经学完了')
        : `${displaySessions} 轮记录`
    },
    {
      key: 'streak',
      className: 'stats-metric-card--green',
      title: isMonth ? '本月连续性' : '连续苟活',
      value: String(stats.currentStreak || 0),
      unit: 'DAY',
      note: stats.longestStreak ? `最长连击：${stats.longestStreak} 天` : '最长连击：就在梦里'
    },
    {
      key: 'total-focus',
      className: 'stats-metric-card--blue',
      title: isMonth ? '本月专注记录' : '此生累计努力',
      value: String(isMonth ? periodMinutes || 0 : stats.totalFocusMinutes || 0),
      unit: 'MIN',
      note: `${isMonth ? periodSessions || 0 : stats.totalFocusSessions || 0} 轮次${stats.totalFocusSessions ? '' : ' (太纯净了)'}`
    },
    {
      key: 'badges',
      className: 'stats-metric-card--ink',
      title: '废柴鉴定章',
      value: String(stats.totalAchievements || 0),
      unit: '枚',
      note: `打卡 ${stats.totalCheckIns || 0} 次${stats.totalCheckIns ? '攒出来的' : '也能白嫖'}`
    }
  ];
}

function buildWeekTrend(items, maxScore) {
  const safeMax = Math.max(1, Number(maxScore) || 0);

  return (items || []).map((item, index) => {
    const score = Number(item.score || 0);
    return {
      key: item.date || String(index),
      weekday: item.weekday || '--',
      dateLabel: item.label || '--',
      valueLabel: item.focusMinutes ? `${item.focusMinutes}m` : '--',
      statusLabel: item.checkIn ? '微动' : '留白',
      barHeight: `${Math.max(score > 0 ? Math.round((score / safeMax) * 180) : 0, 10)}rpx`,
      maskedBarHeight: '10rpx'
    };
  });
}

function buildPeriodTrend(result, period) {
  if (period === 'week') {
    return buildWeekTrend(result.weekTrend || [], result.weekTrendMax);
  }

  const focusTrend = result.focusStats && result.focusStats.trend;
  if (focusTrend && focusTrend.length) {
    const maxScore = focusTrend.reduce((max, item) => Math.max(max, Number(item.score || item.focusMinutes || 0)), 0);
    return buildWeekTrend(focusTrend, maxScore);
  }

  return [];
}

function buildBadgePreview(badges) {
  return (badges || [])
    .filter((item) => item.earned)
    .slice(0, 3)
    .map((item) => ({
      key: item.key,
      title: item.title,
      desc: item.desc
    }));
}

function buildViewModel(result, period) {
  const stats = result.stats || {};
  const badges = result.badges || [];
  const today = result.today || {};
  const focus = result.focusStats || {};
  const activePeriod = period || 'week';
  const isWeek = activePeriod === 'week';
  const isMonth = activePeriod === 'month';
  const experienceProgress = Number(stats.experienceProgress || 0);
  const experienceToNext = Number(stats.experienceToNext || 100);
  const totalLevelExp = experienceProgress + experienceToNext || 100;
  const totalFocusValue = isWeek
    ? stats.totalFocusMinutes || 0
    : activePeriod === 'total'
      ? stats.totalFocusMinutes || 0
      : Number(focus.periodMinutes || focus.focusMinutes || 0) || 0;

  return {
    activePeriod,
    periodTabs: PERIODS.map((item) => ({
      ...item,
      active: item.key === activePeriod
    })),
    levelText: `Lv.${stats.level || 1}`,
    xpText: `${experienceProgress} / ${totalLevelExp} XP`,
    xpRemainingText: `还差 ${experienceToNext} XP 升到 Lv.${(stats.level || 1) + 1} (别做梦了)`,
    xpProgressWidth: clampPercent(totalLevelExp > 0 ? (experienceProgress / totalLevelExp) * 100 : 0),
    statusTagText: '基层牛马 STATUS',
    realityHintText: (today && today.checkedIn)
      ? '今天已经糊弄成功，至少在纸面上看起来很稳定。'
      : '全是 0，看不看都一样，但今天最好还是糊弄一下。',
    topTags: [
      (today && today.checkedIn) ? '今天已点亮' : '今天还没糊弄',
      `总发呆 ${stats.totalFocusMinutes || 0} 分钟`,
      `破铜烂铁 ${stats.totalAchievements || 0} / ${badges.length || 0}`
    ],
    metricCards: buildMetricCards(result, activePeriod),
    weekTrend: buildPeriodTrend(result, activePeriod),
    chartTitle: isWeek ? '本周学习时长曲线' : isMonth ? '本月学习概览' : '累计学习概览',
    totalFocusValue: String(totalFocusValue),
    emptyTrendText: isWeek ? '还没有形成一周趋势，先去完成一次专注或打卡。' : '这个周期还没有可展示的专注曲线。',
    trendHintText: isWeek
      ? ((today && today.checkedIn)
        ? '波平如镜，今天也算是硬着头皮动了一下。'
        : '波平如镜，今天也没动静，说明情绪非常稳定。')
      : isMonth
        ? '本月统计来自云端月度专注记录和账号累计数据。'
        : '累计数据来自当前账号全部已同步记录。',
    badgePreview: buildBadgePreview(badges),
    badgeCountText: `${stats.totalAchievements || 0} / ${badges.length || 0}`
  };
}

function createInitialState() {
  return {
    loading: false,
    toastVisible: false,
    toastMessage: '',
    isRealityBlurred: false,
    activePeriod: 'week',
    periodTabs: PERIODS.map((item) => ({
      ...item,
      active: item.key === 'week'
    })),
    levelText: 'Lv.1',
    xpText: '0 / 100 XP',
    xpRemainingText: '还差 100 XP 升到 Lv.2 (别做梦了)',
    xpProgressWidth: '0%',
    statusTagText: '基层牛马 STATUS',
    realityHintText: '全是 0，看不看都一样。',
    topTags: ['今天还没糊弄', '总发呆 0 分钟', '破铜烂铁 0 / 0'],
    metricCards: [],
    weekTrend: [],
    chartTitle: '本周学习时长曲线',
    totalFocusValue: '0',
    emptyTrendText: '还没有形成一周趋势，先去完成一次专注或打卡。',
    trendHintText: '波平如镜，今天也没动静。',
    badgePreview: [],
    badgeCountText: '0 / 0'
  };
}

Page({
  data: createInitialState(),

  onShow() {
    syncTabBar(this, 'stats');
    this.primeStatsView();
    this.scheduleStatsLoad();
  },

  onHide() {
    clearToast(this);
    this.clearStatsLoadTimer();
  },

  onUnload() {
    clearToast(this);
    this.clearStatsLoadTimer();
  },

  clearStatsLoadTimer() {
    clearDelayedTask(this, '_statsLoadTimer');
  },

  primeStatsView() {
    if (this.data.activePeriod !== 'week') {
      return false;
    }

    if (!app.getCachedUserStats) {
      return false;
    }

    const cached = app.getCachedUserStats(STATS_STALE_MAX_AGE);
    if (!cached || !cached.success) {
      return false;
    }

    this.setData({
      ...buildViewModel(cached, 'week'),
      loading: false
    });
    return true;
  },

  scheduleStatsLoad(forceRefresh) {
    const hasCache = this.primeStatsView();
    this.clearStatsLoadTimer();

    if (!hasCache) {
      this.setData({ loading: true });
    }

    scheduleDelayedTask(this, '_statsLoadTimer', hasCache ? 24 : STATS_FETCH_DELAY, () => {
      this.loadStats({ forceRefresh: !!forceRefresh });
    });
  },

  async loadStats(options) {
    if (this._statsLoading) {
      return;
    }

    if (!withLoginGate(this, {
      mode: 'passive',
      message: '请先登录后再查看统计数据。',
      resetLoadingField: 'loading'
    })) {
      return;
    }

    this._statsLoading = true;

    try {
      let result = null;

      if (app.warmUserStats) {
        result = await app.warmUserStats({
          forceRefresh: !!(options && options.forceRefresh) || this.data.activePeriod !== 'week',
          maxAge: STATS_CACHE_MAX_AGE
        });
      } else {
        const user = await app.ensureUserSession();
        if (!user) {
          throw new Error('SESSION_INIT_FAILED');
        }

        result = await app.api.user.getStats();
      }

      if (!result || !result.success) {
        throw new Error((result && result.message) || 'STATS_LOAD_FAILED');
      }

      const period = this.data.activePeriod || 'week';
      if (period !== 'week' && app.api && app.api.focus && app.api.focus.getStats) {
        const focusStats = await app.api.focus.getStats(period === 'total' ? 'all' : period);
        if (focusStats && focusStats.success) {
          result = {
            ...result,
            focusStats
          };
        }
      }

      this.setData({
        ...buildViewModel(result, period),
        loading: false
      });
    } catch (error) {
      console.error('[version2/stats] 数据加载失败:', error);
      showChaosToast(this, '统计页同步失败，请检查云函数部署。', 2200);
      this.setData({ loading: false });
    } finally {
      this._statsLoading = false;
    }
  },

  onToggleRealityBlur() {
    this.setData({
      isRealityBlurred: !this.data.isRealityBlurred
    });
  },

  onSelectPeriod(e) {
    const period = String((e.currentTarget.dataset && e.currentTarget.dataset.period) || 'week');

    if (period === this.data.activePeriod || this._statsLoading) {
      return;
    }

    this.setData({
      activePeriod: period,
      periodTabs: PERIODS.map((item) => ({
        ...item,
        active: item.key === period
      })),
      loading: true,
      weekTrend: []
    });
    this.scheduleStatsLoad(true);
  },

  onOpenCalendar() {
    wx.switchTab({
      url: '/pages/calendar/calendar'
    });
  },

  onOpenBadges() {
    wx.navigateTo({
      url: '/pages/badges/badges'
    });
  },

  onOpenDiary() {
    wx.switchTab({
      url: '/pages/diary/diary'
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
  },

  onAppLogout() {
    this.clearStatsLoadTimer();
    this._statsLoading = false;
    applyPageReset(this, createInitialState);
  }
});
