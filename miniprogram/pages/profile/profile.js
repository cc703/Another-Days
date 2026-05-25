const { syncTabBar } = require('../../utils/tabbar.js');
const { clearToast, showChaosToast } = require('../../utils/toast.js');
const { buildProfileSummary } = require('../../services/session.js');
const reminderConfig = require('../../config/reminder.js');
const {
  applyPageReset,
  clearDelayedTask,
  createRequestToken,
  isActiveRequest,
  scheduleDelayedTask
} = require('../../utils/page-helpers.js');

const app = getApp();
const EXPERIENCE_PER_LEVEL = 100;
const STUDY_REMINDER_TEMPLATE_ID = reminderConfig.studyReminderTemplateId || '';
const DEFAULT_SETTINGS = {
  dailyReminderEnabled: false,
  reminderTime: '21:30',
  feedbackReplyNotice: true,
  reminderTemplateId: '',
  reminderSubscriptionAcceptedAt: 0
};

function isCloudFileId(value) {
  return String(value || '').trim().indexOf('cloud://') === 0;
}

function clampPercent(value) {
  return `${Math.max(0, Math.min(100, Math.round(Number(value) || 0)))}%`;
}

function buildStatsSnapshot(stats) {
  const raw = stats || {};
  const experience = Math.max(0, Number(raw.experience) || 0);
  const level = Math.max(1, Number(raw.level) || Math.floor(experience / EXPERIENCE_PER_LEVEL) + 1);
  const experienceProgress = Math.max(0, Number(raw.experienceProgress) || experience % EXPERIENCE_PER_LEVEL);
  const experienceToNext = Math.max(0, Number(raw.experienceToNext) || EXPERIENCE_PER_LEVEL - experienceProgress || EXPERIENCE_PER_LEVEL);
  const totalLevelExp = experienceProgress + experienceToNext || EXPERIENCE_PER_LEVEL;

  return {
    level,
    experience,
    experienceProgress,
    experienceToNext,
    totalLevelExp,
    xpProgressWidth: clampPercent(totalLevelExp > 0 ? (experienceProgress / totalLevelExp) * 100 : 0),
    xpText: `${experienceProgress} / ${totalLevelExp} XP`,
    xpRuleText: '成长规则：打卡 +10 XP，专注按时长奖励 XP；新用户从 0 XP 开始。',
    currentStreak: Number(raw.currentStreak || 0),
    totalFocusMinutes: Number(raw.totalFocusMinutes || 0),
    totalDiaries: Number(raw.totalDiaries || 0),
    totalCheckIns: Number(raw.totalCheckIns || 0)
  };
}

function buildSettingsState(settings) {
  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {})
  };
}

function hasUsableReminderTemplateId() {
  return Boolean(
    STUDY_REMINDER_TEMPLATE_ID &&
    STUDY_REMINDER_TEMPLATE_ID !== 'REPLACE_WITH_REAL_TEMPLATE_ID'
  );
}

function buildReminderStatus(settings, templateReady) {
  return {
    title: '作者正在加急开发中',
    detail: '每日学习提醒暂时搁置，后续完善后再开放。',
    tone: 'pending'
  };
}

function buildReminderDisabledSettings(settings) {
  return buildSettingsState({
    ...(settings || {}),
    dailyReminderEnabled: false,
    reminderTemplateId: '',
    reminderSubscriptionAcceptedAt: 0
  });
}

function createInitialState() {
  return {
    toastVisible: false,
    toastMessage: '',
    profileLoading: false,
    profileSyncing: false,
    nicknameFocus: false,
    settingsModalVisible: false,
    settingsSaving: false,
    reminderTemplateReady: hasUsableReminderTemplateId(),
    reminderStatus: buildReminderStatus(DEFAULT_SETTINGS, hasUsableReminderTemplateId()),
    isLoggedIn: false,
    avatarPreviewUrl: '',
    userInfo: {
      nickName: '备考残像',
      avatarUrl: ''
    },
    profileSummary: {
      hasAvatarAuth: false,
      hasNickNameAuth: false,
      missingAvatar: true,
      missingNickName: true,
      statusText: '点击头像选择微信头像，填写昵称后会同步微信昵称。'
    },
    statsSnapshot: buildStatsSnapshot({}),
    settings: buildSettingsState(),
    feedbackText: ''
  };
}

Page({
  data: createInitialState(),

  onShow() {
    syncTabBar(this, 'profile');
    this.hydrateProfileShell();
    this.scheduleProfileRefresh();
  },

  onHide() {
    clearToast(this);
    this.clearProfileRefreshTimer();
  },

  onUnload() {
    clearToast(this);
    this.clearProfileRefreshTimer();
  },

  clearProfileRefreshTimer() {
    clearDelayedTask(this, '_profileRefreshTimer');
  },

  scheduleProfileRefresh(forceRefresh) {
    this.clearProfileRefreshTimer();

    const hasUser = app.globalData && app.globalData.userInfo && app.globalData.isLoggedIn;
    const isFresh = !forceRefresh && hasUser && this._profileLoadedAt && Date.now() - this._profileLoadedAt < 15000;

    if (isFresh) {
      return;
    }

    scheduleDelayedTask(this, '_profileRefreshTimer', hasUser ? 32 : 72, () => {
      this.loadProfile();
    });
  },

  async refreshAvatarPreview(avatarUrl, options) {
    const rawAvatarUrl = String(avatarUrl || '').trim();
    const silent = !!(options && options.silent);
    const requestId = createRequestToken(this, '_avatarPreviewRequestId');

    if (!rawAvatarUrl) {
      this._avatarPreviewRetrying = false;
      if (isActiveRequest(this, '_avatarPreviewRequestId', requestId)) {
        this.setData({ avatarPreviewUrl: '' });
      }
      return '';
    }

    if (!isCloudFileId(rawAvatarUrl)) {
      this._avatarPreviewRetrying = false;
      if (isActiveRequest(this, '_avatarPreviewRequestId', requestId)) {
        this.setData({ avatarPreviewUrl: rawAvatarUrl });
      }
      return rawAvatarUrl;
    }

    if (!wx.cloud || !wx.cloud.getTempFileURL) {
      this._avatarPreviewRetrying = false;
      if (isActiveRequest(this, '_avatarPreviewRequestId', requestId)) {
        this.setData({ avatarPreviewUrl: '' });
      }
      return '';
    }

    try {
      const result = await wx.cloud.getTempFileURL({
        fileList: [rawAvatarUrl]
      });
      const item = result && result.fileList && result.fileList[0];
      const nextUrl = item && item.tempFileURL ? String(item.tempFileURL).trim() : '';

      this._avatarPreviewRetrying = false;
      if (isActiveRequest(this, '_avatarPreviewRequestId', requestId)) {
        this.setData({ avatarPreviewUrl: nextUrl });
      }
      return nextUrl;
    } catch (error) {
      console.warn('[version2/profile] 头像临时链接刷新失败:', error);
      this._avatarPreviewRetrying = false;
      if (isActiveRequest(this, '_avatarPreviewRequestId', requestId)) {
        this.setData({ avatarPreviewUrl: '' });
      }
      if (!silent) {
        showChaosToast(this, '头像链接已失效，请重新选择头像。', 2200);
      }
      return '';
    }
  },

  hydrateProfileShell(profileOverride) {
    const profile = profileOverride || (app.globalData && app.globalData.userInfo) || {};
    const summary = buildProfileSummary(profile);
    const rawAvatarUrl = summary.avatarUrl;
    const stats = profile.stats || {};

    this.setData({
      userInfo: {
        nickName: summary.rawNickName || summary.nickName,
        avatarUrl: rawAvatarUrl
      },
      avatarPreviewUrl: isCloudFileId(rawAvatarUrl) ? '' : rawAvatarUrl,
      profileSummary: summary,
      nicknameFocus: false,
      isLoggedIn: Boolean(profile && profile._openid),
      statsSnapshot: buildStatsSnapshot(stats),
      settings: buildSettingsState(profile.settings),
      reminderStatus: buildReminderStatus(buildSettingsState(profile.settings), hasUsableReminderTemplateId())
    });

    this.refreshAvatarPreview(rawAvatarUrl, { silent: true });
  },

  async loadProfile() {
    this.setData({ profileLoading: true });

    try {
      if (app.isUserSignedOut && app.isUserSignedOut()) {
        this.hydrateProfileShell({});
        return;
      }

      const user = app.globalData && app.globalData.isLoggedIn
        ? await app.refreshUserSession()
        : await app.ensureUserSession();

      if (user) {
        this._profileLoadedAt = Date.now();
        this.hydrateProfileShell(user);
      }
    } catch (error) {
      console.error('[version2/profile] 资料加载失败:', error);
      showChaosToast(this, '资料加载失败，请检查云函数部署。', 2200);
    } finally {
      this.setData({ profileLoading: false });
    }
  },

  async ensureProfileRecord() {
    try {
      if (app.globalData && app.globalData.userInfo && app.globalData.isLoggedIn) {
        this.hydrateProfileShell(app.globalData.userInfo);
        return {
          success: true,
          user: app.globalData.userInfo
        };
      }

      const loginResult = await app.loginUser({});
      if (!loginResult || !loginResult.success || !loginResult.user) {
        throw new Error((loginResult && loginResult.message) || 'LOGIN_FAILED');
      }

      const user = loginResult.user;
      this.hydrateProfileShell(user);
      return {
        success: true,
        user
      };
    } catch (error) {
      console.error('[version2/profile] 登录失败:', error);
      throw error;
    }
  },

  async syncProfilePatch(patch) {
    let result = await app.api.user.updateProfile(patch || {});

    if (result && !result.success && result.error === 'USER_NOT_FOUND') {
      const loginResult = await app.loginUser({});
      if (!loginResult || !loginResult.success || !loginResult.user) {
        throw new Error((loginResult && loginResult.message) || 'LOGIN_FAILED');
      }

      result = await app.api.user.updateProfile(patch || {});
    }

    if (!result || !result.success) {
      throw new Error((result && result.message) || 'UPDATE_PROFILE_FAILED');
    }

    if (result.user) {
      const nextUser = app.hydrateUserSession(result.user);
      this.hydrateProfileShell(nextUser);
      return nextUser;
    }

    const refreshedUser = await app.refreshUserSession();
    const nextUser = refreshedUser || app.updateUserSession(patch || {});
    this.hydrateProfileShell(nextUser);
    return nextUser;
  },

  onFeedbackInput(e) {
    this.setData({
      feedbackText: e.detail.value
    });
  },

  onOpenAbstractCard(e) {
    const { route, title } = e.currentTarget.dataset || {};

    if (!route) {
      showChaosToast(this, `${title || '该功能'}在赶来的路上。`, 1800);
      return;
    }

    if (route === '/pages/stats/stats' && app.warmUserStats) {
      app.warmUserStats({ maxAge: 15000 }).catch(() => null);
      wx.navigateTo({
        url: route,
        fail: () => {
          showChaosToast(this, `${title || '该功能'}在赶来的路上。`, 1800);
        }
      });
      return;
    }

    wx.navigateTo({
      url: route,
      fail: () => {
        showChaosToast(this, `${title || '该功能'}在赶来的路上。`, 1800);
      }
    });
  },

  async onSendFeedback() {
    const content = this.data.feedbackText.trim();

    if (!content) {
      showChaosToast(this, '先写点意见，不然电波发不出去。');
      return;
    }

    if (this._feedbackSubmitting) {
      return;
    }

    if (!app.globalData || !app.globalData.isLoggedIn) {
      showChaosToast(this, '请先点头像或名字完成登录，再发送反馈。');
      return;
    }

    this._feedbackSubmitting = true;

    try {
      await this.ensureProfileRecord();
      const result = app.api.user && app.api.user.submitFeedback
        ? await app.api.user.submitFeedback({ content })
        : await app.api.call('user/feedback', { content });

      if (!result || !result.success) {
        throw new Error((result && result.message) || 'FEEDBACK_FAILED');
      }

      this.setData({ feedbackText: '' });
      showChaosToast(this, '反馈已提交，后续有回复会通过小程序通知提醒你。');
    } catch (error) {
      console.error('[version2/profile] 反馈提交失败:', error);
      showChaosToast(
        this,
        error && error.message === 'LOGIN_FAILED'
          ? '资料准备失败，请检查网络后重试。'
          : (error && error.message) || '反馈发送失败，请稍后重试。',
        2200
      );
    } finally {
      this._feedbackSubmitting = false;
    }
  },

  onOpenSettings() {
    this.setData({ settingsModalVisible: true });
  },

  onCloseSettingsModal() {
    if (!this.data.settingsModalVisible) {
      return;
    }

    this.setData({ settingsModalVisible: false });
  },

  async persistSettings(nextSettings, successMessage) {
    if (this.data.settingsSaving) {
      return;
    }

    if (!app.globalData || !app.globalData.isLoggedIn) {
      showChaosToast(this, '请先点头像或名字完成登录，再保存设置。');
      return;
    }

    this.setData({
      settingsSaving: true,
      settings: buildSettingsState(nextSettings),
      reminderStatus: buildReminderStatus(buildSettingsState(nextSettings), this.data.reminderTemplateReady)
    });

    try {
      await this.ensureProfileRecord();
      const result = await app.api.user.updateSettings(nextSettings);

      if (!result || !result.success) {
        throw new Error((result && result.message) || 'SETTINGS_SAVE_FAILED');
      }

      const savedSettings = buildSettingsState(result.settings || nextSettings);
      if (result.user && app.hydrateUserSession) {
        app.hydrateUserSession(result.user);
      } else if (app.updateUserSession) {
        app.updateUserSession({ settings: savedSettings });
      }

      this.setData({ settings: savedSettings });
      this.setData({
        settings: savedSettings,
        reminderStatus: buildReminderStatus(savedSettings, this.data.reminderTemplateReady)
      });
      showChaosToast(this, successMessage || '设置已保存。', 1800);
    } catch (error) {
      console.error('[version2/profile] 设置保存失败:', error);
      this.hydrateProfileShell(app.globalData && app.globalData.userInfo);
      showChaosToast(
        this,
        error && error.message === 'LOGIN_FAILED'
          ? '资料准备失败，请检查网络后重试。'
          : '设置保存失败，请稍后重试。',
        2200
      );
    } finally {
      this.setData({ settingsSaving: false });
    }
  },

  onReminderSwitchChange(e) {
    showChaosToast(this, '作者正在加急开发中', 1800);
    this.setData({
      settings: buildReminderDisabledSettings(this.data.settings),
      reminderStatus: buildReminderStatus()
    });
  },

  onReminderTimeChange(e) {
    showChaosToast(this, '作者正在加急开发中', 1800);
  },

  async requestReminderSubscription() {
    showChaosToast(this, '作者正在加急开发中', 1800);
  },

  onFeedbackNoticeSwitchChange(e) {
    const checked = !!(e.detail && e.detail.value);
    this.persistSettings({
      ...this.data.settings,
      feedbackReplyNotice: checked
    }, checked ? '反馈回复提醒已开启。' : '反馈回复提醒已关闭。');
  },

  noop() { },

  async onChooseAvatar(e) {
    const detail = e.detail || {};
    const filePath = detail.avatarUrl;

    if (!filePath || this.data.profileSyncing) {
      return;
    }

    const needsNickName = !this.data.profileSummary.hasNickNameAuth;

    this.setData({ profileSyncing: true });

    try {
      await this.ensureProfileRecord();

      if (!wx.cloud || !wx.cloud.uploadFile) {
        throw new Error('CLOUD_UPLOAD_UNAVAILABLE');
      }

      const cloudPath = `version2/avatar/${Date.now()}-${Math.random().toString(16).slice(2, 8)}.png`;
      const uploadResult = await wx.cloud.uploadFile({
        cloudPath,
        filePath
      });

      if (!uploadResult || !uploadResult.fileID) {
        throw new Error('AVATAR_UPLOAD_FAILED');
      }

      await this.syncProfilePatch({
        avatarUrl: uploadResult.fileID
      });
      this.setData({
        nicknameFocus: needsNickName
      });
      showChaosToast(
        this,
        needsNickName
          ? '微信头像已接入，继续补一下昵称。'
          : '微信头像已接入，残像外壳更新完成。'
      );
    } catch (error) {
      console.error('[version2/profile] 头像更新失败:', error);
      showChaosToast(
        this,
        error && error.message === 'LOGIN_FAILED'
          ? '资料准备失败，请检查网络后重试。'
          : error && error.message === 'CLOUD_UPLOAD_UNAVAILABLE'
            ? '当前环境未启用云上传，头像暂时无法同步。'
            : '头像同步失败，请稍后重试。'
      );
    } finally {
      this.setData({ profileSyncing: false });
    }
  },

  onAvatarError(e) {
    const detail = (e && e.detail) || {};
    const errMsg = String(detail.errMsg || detail.errorMessage || '');

    if (errMsg.indexOf('chooseAvatar:fail cancel') >= 0) {
      return;
    }

    console.error('[version2/profile] chooseAvatar 组件异常:', e);
    showChaosToast(this, '头像选择暂时不可用，请稍后重试。', 2200);
  },

  async onAvatarImageError() {
    const rawAvatarUrl = String((this.data.userInfo && this.data.userInfo.avatarUrl) || '').trim();

    if (!rawAvatarUrl) {
      this.setData({ avatarPreviewUrl: '' });
      return;
    }

    if (isCloudFileId(rawAvatarUrl) && !this._avatarPreviewRetrying) {
      this._avatarPreviewRetrying = true;
      const refreshedUrl = await this.refreshAvatarPreview(rawAvatarUrl, { silent: true });
      if (refreshedUrl) {
        return;
      }
    }

    this._avatarPreviewRetrying = false;
    this.setData({ avatarPreviewUrl: '' });
    showChaosToast(this, '当前头像地址已失效，请重新选择头像。', 2200);
  },

  async onNicknameChange(e) {
    const nickName = String((e.detail && e.detail.value) || '').trim();

    if (!nickName || this.data.profileSyncing) {
      return;
    }

    this.setData({ profileSyncing: true });

    try {
      await this.ensureProfileRecord();
      await this.syncProfilePatch({
        nickName
      });
      this.setData({ nicknameFocus: false });
      showChaosToast(this, '微信昵称已同步，残像称呼更新完成。');
    } catch (error) {
      console.error('[version2/profile] 昵称更新失败:', error);
      showChaosToast(
        this,
        error && error.message === 'LOGIN_FAILED'
          ? '资料准备失败，请检查网络后重试。'
          : '昵称同步失败，请检查内容后重试。'
      );
    } finally {
      this.setData({ profileSyncing: false });
    }
  },

  onNicknameBlur() {
    if (this.data.nicknameFocus) {
      this.setData({ nicknameFocus: false });
    }
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后会清空当前本地登录状态，需要重新点头像或名字再同步资料。',
      confirmText: '退出',
      confirmColor: '#b42318',
      success: (res) => {
        if (!res.confirm) {
          return;
        }

        app.clearUserSession();
        showChaosToast(this, '已退出登录。');
      }
    });
  },

  resetProfileState() {
    this._avatarPreviewRequestId = 0;
    this._avatarPreviewRetrying = false;
    this._profileLoadedAt = 0;
    this._profileRefreshTimer = null;
    applyPageReset(this, createInitialState);
  },

  onAppLogout() {
    this.resetProfileState();
  }
});
