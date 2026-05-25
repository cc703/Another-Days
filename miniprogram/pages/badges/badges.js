const { clearToast, showChaosToast } = require('../../utils/toast.js');
const { applyPageReset, withLoginGate } = require('../../utils/page-helpers.js');

const app = getApp();

function clampWidth(value) {
  const safe = Math.max(6, Math.min(100, Math.round(Number(value) || 0)));
  return `${safe}%`;
}

function enhanceBadge(item) {
  const earned = Boolean(item.earned);

  return {
    ...item,
    stateText: earned ? 'UNLOCKED' : 'LOCKED',
    progressText: earned ? '已达成' : `${item.progress}/${item.target}`,
    progressWidth: clampWidth(item.progressPercent)
  };
}

function sortBadges(list) {
  return (list || []).slice().sort((left, right) => {
    if (left.earned !== right.earned) {
      return left.earned ? -1 : 1;
    }

    return (right.progressPercent || 0) - (left.progressPercent || 0);
  });
}

function createInitialState() {
  return {
    loading: false,
    toastVisible: false,
    toastMessage: '',
    heroTitle: '0 / 0',
    heroDesc: '勋章墙同步中...',
    heroTagLeft: '等级 Lv.1',
    heroTagCenter: '专注 0 分钟',
    heroTagRight: '连击 0 天',
    earnedBadges: [],
    lockedBadges: []
  };
}

Page({
  data: createInitialState(),

  onShow() {
    this.loadBadges();
  },

  onHide() {
    clearToast(this);
  },

  onUnload() {
    clearToast(this);
  },

  async loadBadges() {
    if (!withLoginGate(this, {
      mode: 'passive',
      message: '请先登录后再查看成就。',
      resetLoadingField: 'loading'
    })) {
      return;
    }

    this.setData({ loading: true });

    try {
      const user = await app.ensureUserSession();
      if (!user) {
        throw new Error('SESSION_INIT_FAILED');
      }

      const result = await app.api.user.getStats();
      if (!result || !result.success) {
        throw new Error((result && result.message) || 'BADGES_LOAD_FAILED');
      }

      const stats = result.stats || {};
      const badges = sortBadges((result.badges || []).map(enhanceBadge));
      const earnedBadges = badges.filter((item) => item.earned);
      const lockedBadges = badges.filter((item) => !item.earned);

      this.setData({
        heroTitle: `${stats.totalAchievements || 0} / ${badges.length || 0}`,
        heroDesc: earnedBadges.length
          ? '已经点亮的勋章会留在上半区，还差一点的会继续挂在下半区催你。'
          : '勋章墙还是空的，先去打卡或者坐一轮专注。',
        heroTagLeft: `等级 Lv.${stats.level || 1}`,
        heroTagCenter: `专注 ${stats.totalFocusMinutes || 0} 分钟`,
        heroTagRight: `最长 ${stats.longestStreak || 0} 天`,
        earnedBadges,
        lockedBadges
      });
    } catch (error) {
      console.error('[version2/badges] 勋章加载失败:', error);
      showChaosToast(this, '成就展柜同步失败，请检查云函数部署。', 2200);
    } finally {
      this.setData({ loading: false });
    }
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
    applyPageReset(this, createInitialState);
  }
});
