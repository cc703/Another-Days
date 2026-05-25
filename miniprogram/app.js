const cloudConfig = require('./config/cloud.js');
const { createApi } = require('./services/api.js');
const {
  buildProfileSummary,
  clearSignedOutMark,
  clearStoredUser,
  getStoredUser,
  isUserSignedOut,
  markUserSignedOut,
  setStoredUser
} = require('./services/session.js');

App({
  globalData: {
    versionLabel: 'version2.design-shell',
    startedAt: '2026-04-01',
    userInfo: null,
    isLoggedIn: false,
    userStatsCache: null,
    userStatsCacheAt: 0
  },

  api: null,
  sessionPromise: null,
  statsPromise: null,

  onLaunch() {
    this.initCloud();
    this.api = createApi();
    this.restoreSession();
  },

  onHide(reason) {
    // 息屏（reason === 'system'）不暂停计时；切出小程序才暂停
    if (reason === 'system') {
      return;
    }
    const pages = getCurrentPages();
    for (const page of pages) {
      if (typeof page.onAppBackground === 'function') {
        page.onAppBackground();
      }
    }
  },

  onShow() {
    const pages = getCurrentPages();
    for (const page of pages) {
      if (typeof page.onAppForeground === 'function') {
        page.onAppForeground();
      }
    }
  },

  initCloud() {
    if (!wx.cloud) {
      return;
    }

    wx.cloud.init({
      env: cloudConfig.env,
      traceUser: cloudConfig.traceUser
    });
  },

  restoreSession() {
    if (isUserSignedOut()) {
      return null;
    }

    const storedUser = getStoredUser();
    if (!storedUser) {
      return null;
    }

    this.globalData.userInfo = storedUser;
    this.globalData.isLoggedIn = true;
    return storedUser;
  },

  hydrateUserSession(user) {
    if (!user) {
      return null;
    }

    clearSignedOutMark();
    this.globalData.userInfo = user;
    this.globalData.isLoggedIn = true;
    setStoredUser(user);
    return user;
  },

  updateUserSession(patch) {
    const current = this.globalData.userInfo || {};
    const nextUser = {
      ...current,
      ...patch,
      settings: {
        ...(current.settings || {}),
        ...((patch && patch.settings) || {})
      },
      stats: {
        ...(current.stats || {}),
        ...((patch && patch.stats) || {})
      }
    };

    return this.hydrateUserSession(nextUser);
  },

  setCachedUserStats(result) {
    if (!result || !result.success) {
      return null;
    }

    this.globalData.userStatsCache = result;
    this.globalData.userStatsCacheAt = Date.now();
    return result;
  },

  getCachedUserStats(maxAge) {
    const cached = this.globalData.userStatsCache;
    if (!cached || !cached.success) {
      return null;
    }

    const safeMaxAge = typeof maxAge === 'number' ? maxAge : 15000;
    const cachedAt = Number(this.globalData.userStatsCacheAt || 0);

    if (safeMaxAge >= 0 && cachedAt && Date.now() - cachedAt > safeMaxAge) {
      return null;
    }

    return cached;
  },

  clearUserStatsCache() {
    this.globalData.userStatsCache = null;
    this.globalData.userStatsCacheAt = 0;
    this.statsPromise = null;
  },

  clearUserSession() {
    this.globalData.userInfo = null;
    this.globalData.isLoggedIn = false;
    this.sessionPromise = null;
    this.clearUserStatsCache();
    clearStoredUser();
    markUserSignedOut();

    // Notify all active pages to clean up their state
    const pages = getCurrentPages();
    for (const page of pages) {
      if (typeof page.onAppLogout === 'function') {
        page.onAppLogout();
      }
    }
  },

  async loginUser(userInfo) {
    const loginResult = await this.api.user.login(userInfo || {});

    if (loginResult && loginResult.success && loginResult.user) {
      const user = this.hydrateUserSession(loginResult.user);

      return {
        ...loginResult,
        user,
        profile: user
      };
    }

    return loginResult || {
      success: false,
      error: 'LOGIN_FAILED',
      message: '登录失败，请重试'
    };
  },

  async ensureUserSession(forceRefresh) {
    if (!forceRefresh && this.globalData.userInfo && this.globalData.isLoggedIn) {
      return this.globalData.userInfo;
    }

    if (!forceRefresh && isUserSignedOut()) {
      return null;
    }

    if (!forceRefresh) {
      const storedUser = this.restoreSession();
      if (storedUser) {
        return storedUser;
      }
    }

    if (this.sessionPromise) {
      return this.sessionPromise;
    }

    this.sessionPromise = (async () => {
      const loginResult = await this.loginUser({});
      if (loginResult && loginResult.success && loginResult.user) {
        return loginResult.user;
      }

      const profileResult = await this.api.user.getProfile();
      if (profileResult && profileResult.success && profileResult.user) {
        return this.hydrateUserSession(profileResult.user);
      }

      return null;
    })();

    try {
      return await this.sessionPromise;
    } finally {
      this.sessionPromise = null;
    }
  },

  async warmUserStats(options) {
    const config = options || {};
    const forceRefresh = !!config.forceRefresh;
    const maxAge = typeof config.maxAge === 'number' ? config.maxAge : 15000;

    if (!forceRefresh) {
      const cached = this.getCachedUserStats(maxAge);
      if (cached) {
        return cached;
      }
    }

    if (this.statsPromise) {
      return this.statsPromise;
    }

    this.statsPromise = (async () => {
      const user = await this.ensureUserSession();
      if (!user) {
        return null;
      }

      const result = await this.api.user.getStats();
      if (result && result.success) {
        return this.setCachedUserStats(result);
      }

      return result || null;
    })();

    try {
      return await this.statsPromise;
    } finally {
      this.statsPromise = null;
    }
  },

  async refreshUserSession() {
    if (isUserSignedOut()) {
      return null;
    }

    const profileResult = await this.api.user.getProfile();
    if (profileResult && profileResult.success && profileResult.user) {
      return this.hydrateUserSession(profileResult.user);
    }

    if (profileResult && profileResult.error === 'USER_NOT_FOUND') {
      const loginResult = await this.loginUser({});
      if (loginResult && loginResult.success && loginResult.user) {
        return loginResult.user;
      }
    }

    return null;
  },

  getProfileSummary() {
    return buildProfileSummary(this.globalData.userInfo || {});
  },

  isUserSignedOut() {
    return isUserSignedOut();
  }
});