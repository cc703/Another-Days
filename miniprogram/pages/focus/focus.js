const { syncTabBar } = require('../../utils/tabbar.js');
const { clearToast, showChaosToast } = require('../../utils/toast.js');
const {
  applyPageReset,
  clearDelayedTask,
  clearManagedInterval,
  scheduleDelayedTask,
  startManagedInterval,
  withLoginGate
} = require('../../utils/page-helpers.js');
const { getTodayString } = require('../../utils/date.js');

const app = getApp();

const DEFAULT_DURATION = 25;
const DEFAULT_TASK_NAME = '专注吧！同学';
const FOCUS_STATS_REFRESH_GAP = 15000;
const DURATION_OPTIONS = [
  { value: 15, label: '微型挣扎' },
  { value: 25, label: '间歇性努力' },
  { value: 45, label: '垂死惊坐起' },
  { value: 60, label: '回光返照' },
  { value: -1, label: '自定义' }
];

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatDurationTarget(minutes) {
  return `${minutes} 分钟`;
}

function getRingUiData(progress) {
  const safeProgress = Math.max(0, Math.min(1, Number(progress || 0)));
  const ringAngle = Math.round(safeProgress * 360);
  return {
    ringAngle,
    ringPercent: Math.round(safeProgress * 100),
    ringStyle: `background: conic-gradient(#82a888 ${ringAngle}deg, #ebe6dd 0deg);`
  };
}

function extractMinutes(label) {
  const match = String(label || '').match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function getTaskFooterLabel(taskName) {
  return String(taskName || '').trim() ? '有目标' : '未命名';
}

function resolveMainButtonLabel(runtime) {
  const total = Number(runtime.selectedDuration || DEFAULT_DURATION) * 60;
  const remaining = Number(runtime.timeLeft || 0);

  if (runtime.isActive) {
    return runtime.timerMode === 'countup' ? '完成记录' : '暂停一下';
  }

  if (remaining <= 0) {
    return '再来一轮';
  }

  if (remaining < total) {
    return '继续硬撑';
  }

  return '勉强学一下';
}

function createInitialState() {
  return {
    loading: false,
    toastVisible: false,
    toastMessage: '',
    isActive: false,
    focusState: 'idle',
    timerMode: 'countdown',
    statusBadge: 'PROCRASTINATING',
    stateLabel: '随时准备开溜',
    stateCopy: '现在还没开始，但至少舞台已经搭好了。',
    footerFocusLabel: '待机',
    mainButtonLabel: '勉强学一下',
    selectedDuration: DEFAULT_DURATION,
    durationOptions: DURATION_OPTIONS,
    customDuration: '',
    isCustomDurationActive: false,
    taskName: '',
    taskDisplayName: DEFAULT_TASK_NAME,
    taskFooterLabel: '未命名',
    timeLeft: DEFAULT_DURATION * 60,
    elapsedSeconds: 0,
    displayTime: formatTime(DEFAULT_DURATION * 60),
    ringAngle: 0,
    ringPercent: 0,
    ringStyle: 'background: conic-gradient(#82a888 0deg, #ebe6dd 0deg);',
    targetLabel: formatDurationTarget(DEFAULT_DURATION),
    endTimeLabel: '--:--',
    pauseButtonLabel: '暂停一下',
    todayFocusLabel: '0 分钟',
    todaySessions: 0,
    todaySessionsLabel: '0 次'
  };
}

Page({
  data: createInitialState(),

  timer: null,
  startedAt: 0,

  onShow() {
    syncTabBar(this, 'focus');
    this.resumeTimerIfNeeded();
    this.scheduleFocusStatsLoad();
  },

  onHide() {
    clearToast(this);
    this.clearFocusStatsTimer();
    // 页面 onHide 时也清掉 interval，避免重复创建定时器
    this.clearTimer();
  },

  onAppBackground() {
    // 小程序切后台（非息屏），暂停计时
    if (this.data.isActive) {
      this._pausedByAppHide = true;
      this.clearTimer();
    }
  },

  onAppForeground() {
    // 小程序回到前台，恢复计时
    this.resumeTimerIfNeeded();
  },

  onUnload() {
    this.clearTimer();
    clearToast(this);
    this.clearFocusStatsTimer();
  },

  clearFocusStatsTimer() {
    clearDelayedTask(this, '_focusStatsTimer');
  },

  scheduleFocusStatsLoad(forceRefresh) {
    this.clearFocusStatsTimer();

    if (!forceRefresh && this._focusStatsLoadedAt && Date.now() - this._focusStatsLoadedAt < FOCUS_STATS_REFRESH_GAP) {
      return;
    }

    scheduleDelayedTask(this, '_focusStatsTimer', 48, () => {
      this.loadFocusStats();
    });
  },

  getFocusStatePayload(state) {
    const map = {
      idle: {
        focusState: 'idle',
    statusBadge: 'PROCRASTINATING',
    stateLabel: '随时准备开溜',
    stateCopy: '现在还没开始，但至少舞台已经搭好了。',
    footerFocusLabel: '待机'
      },
      active: {
        focusState: 'active',
        statusBadge: 'SUFFERING',
        stateLabel: '正在进行虚假的勤奋...',
        stateCopy: '现在别回消息，别切出去，把这段时间硬撑过去。',
        footerFocusLabel: '坐牢中'
      },
      complete: {
        focusState: 'complete',
        statusBadge: 'ROUND CLEAR',
        stateLabel: '这轮真的撑过去了',
        stateCopy: '这一轮已经熬完了，先喘口气，再决定要不要继续。',
        footerFocusLabel: '通关'
      }
    };

    return map[state] || map.idle;
  },

  getRuntimeSnapshot(overrides = {}) {
    const has = Object.prototype.hasOwnProperty;
    return {
      isActive: has.call(overrides, 'isActive') ? overrides.isActive : this.data.isActive,
      timeLeft: has.call(overrides, 'timeLeft') ? overrides.timeLeft : this.data.timeLeft,
      elapsedSeconds: has.call(overrides, 'elapsedSeconds') ? overrides.elapsedSeconds : this.data.elapsedSeconds,
      selectedDuration: has.call(overrides, 'selectedDuration') ? overrides.selectedDuration : this.data.selectedDuration,
      taskName: has.call(overrides, 'taskName') ? overrides.taskName : this.data.taskName,
      timerMode: has.call(overrides, 'timerMode') ? overrides.timerMode : this.data.timerMode,
      isCustomDurationActive: has.call(overrides, 'isCustomDurationActive') ? overrides.isCustomDurationActive : this.data.isCustomDurationActive
    };
  },

  buildUiData(state, overrides = {}) {
    const runtime = this.getRuntimeSnapshot(overrides);
    const timeLeft = Object.prototype.hasOwnProperty.call(overrides, 'timeLeft') ? overrides.timeLeft : runtime.timeLeft;
    const elapsedSeconds = Object.prototype.hasOwnProperty.call(overrides, 'elapsedSeconds') ? overrides.elapsedSeconds : runtime.elapsedSeconds;
    const totalSeconds = Math.max(1, Number(runtime.selectedDuration || DEFAULT_DURATION) * 60);
    const progress = runtime.timerMode === 'countup'
      ? Math.max(0, Math.min(1, Number(elapsedSeconds || 0) / totalSeconds))
      : Math.max(0, Math.min(1, 1 - Number(timeLeft || 0) / totalSeconds));
    const ringUiData = getRingUiData(progress);
    return {
      ...this.getFocusStatePayload(state),
      ...overrides,
      mainButtonLabel: resolveMainButtonLabel(runtime),
      taskFooterLabel: getTaskFooterLabel(runtime.taskName),
      pauseButtonLabel: runtime.isActive ? '暂停一下' : resolveMainButtonLabel(runtime),
      showResetControl: runtime.timerMode === 'countdown',
      showBottomMeta: false,
      showCustomDurationInput: !runtime.isActive && (!runtime.selectedDuration || runtime.isCustomDurationActive),
      ...ringUiData,
      targetLabel: runtime.timerMode === 'countup'
        ? `正计时 ${formatDurationTarget(runtime.selectedDuration)} · ${ringUiData.ringPercent}%`
        : `目标 ${formatDurationTarget(runtime.selectedDuration)}`
    };
  },

  formatEndTimeLabel() {
    if (!this._plannedEndAt) {
      return '--:--';
    }
    const date = new Date(this._plannedEndAt);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  },

  async loadFocusStats() {
    if (this._focusStatsLoading) {
      return;
    }

    if (!withLoginGate(this, {
      mode: 'passive',
      resetLoadingField: 'loading'
    })) {
      this.setData({ loading: false });
      return;
    }

    this._focusStatsLoading = true;
    this.setData({ loading: true });

    try {
      const user = await app.ensureUserSession();
      if (!user) {
        throw new Error('SESSION_INIT_FAILED');
      }

      const result = await app.api.focus.getStats('day');
      if (!result || !result.success) {
        throw new Error((result && result.message) || 'FOCUS_STATS_FAILED');
      }

      const minutes = Number(result.todayMinutes || 0);
      const sessions = Number(result.todaySessions || 0);

      this._focusStatsLoadedAt = Date.now();
      this.setData({
        todayFocusLabel: `${minutes} 分钟`,
        todaySessions: sessions,
        todaySessionsLabel: `${sessions} 次`
      });
    } catch (error) {
      console.error('[version2/focus] 统计加载失败:', error);
      showChaosToast(this, 'version2 专注统计暂时没接上。', 2200);
    } finally {
      this._focusStatsLoading = false;
      this.setData({ loading: false });
    }
  },

  onToggleTimer() {
    if (this.data.isActive) {
      if (this.data.timerMode === 'countup') {
        this.finishCountupSession();
      } else {
        this.pauseTimer();
      }
      return;
    }

    this.startTimer();
  },

  onResetTimer() {
    const resetTime = this.data.selectedDuration * 60;
    this.clearTimer();
    this.startedAt = 0;
    this._plannedEndAt = 0;
    this.setData(
      this.buildUiData('idle', {
        isActive: false,
        timeLeft: resetTime,
        elapsedSeconds: 0,
        displayTime: formatTime(resetTime),
        endTimeLabel: '--:--'
      })
    );
    showChaosToast(this, '时间已经归零，重新挑一轮折磨。', 1800);
  },

  onDurationPick(e) {
    if (this.data.isActive) {
      return;
    }

    const { duration } = e.currentTarget.dataset;
    const safeDuration = Number(duration || DEFAULT_DURATION);

    if (safeDuration === -1) {
      this.setData({
        isCustomDurationActive: true
      });
      return;
    }

    this.startedAt = 0;
    this._plannedEndAt = 0;
    const patch = this.buildUiData('idle', {
      isActive: false,
      selectedDuration: safeDuration,
      isCustomDurationActive: false,
      timeLeft: safeDuration * 60,
      elapsedSeconds: 0,
      displayTime: this.data.timerMode === 'countup' ? formatTime(0) : formatTime(safeDuration * 60),
      endTimeLabel: '--:--'
    });
    this.setData({ ...patch, customDuration: '' });
  },

  onTaskInput(e) {
    const taskName = e.detail.value;
    this.setData({
      taskName,
      taskDisplayName: String(taskName || '').trim() || DEFAULT_TASK_NAME,
      taskFooterLabel: getTaskFooterLabel(taskName)
    });
  },

  onTimerModeSelect(e) {
    if (this.data.isActive) {
      showChaosToast(this, '计时中不能切换模式。', 1400);
      return;
    }

    const mode = e.currentTarget.dataset.mode === 'countup' ? 'countup' : 'countdown';
    const resetTime = this.data.selectedDuration * 60;
    this.startedAt = 0;
    this._plannedEndAt = 0;
    this.setData(
      this.buildUiData('idle', {
        timerMode: mode,
        isActive: false,
        isCustomDurationActive: mode === 'countup' ? this.data.isCustomDurationActive : this.data.isCustomDurationActive,
        timeLeft: resetTime,
        elapsedSeconds: 0,
        displayTime: mode === 'countup' ? formatTime(0) : formatTime(resetTime),
        endTimeLabel: '--:--'
      })
    );
  },

  onCustomDurationInput(e) {
    this.setData({
      customDuration: e.detail.value,
      isCustomDurationActive: true
    });
  },

  onCustomDurationConfirm() {
    const minutes = parseInt(this.data.customDuration, 10) || 0;
    if (minutes < 1 || minutes > 240 || this.data.isActive) {
      showChaosToast(this, '请输入 1-240 之间的有效时长。', 1500);
      return;
    }
    this.startedAt = 0;
    this._plannedEndAt = 0;
    const resetTime = minutes * 60;
    this.setData(
      this.buildUiData('idle', {
        selectedDuration: minutes,
        customDuration: String(minutes),
        isCustomDurationActive: true,
        isActive: false,
        timeLeft: resetTime,
        elapsedSeconds: 0,
        displayTime: this.data.timerMode === 'countup' ? formatTime(0) : formatTime(resetTime),
        endTimeLabel: '--:--'
      })
    );
    showChaosToast(this, `已设定 ${minutes} 分钟。`, 1500);
  },

  startTimer() {
    if (!withLoginGate(this, { mode: 'action' })) {
      return;
    }

    this.clearTimer();

    const fullTime = this.data.selectedDuration * 60;

    if (this.data.timerMode === 'countup') {
      this.startCountupTimer();
      return;
    }

    const nextTime = this.data.timeLeft > 0 ? this.data.timeLeft : fullTime;

    if (!this.startedAt || nextTime === fullTime) {
      this.startedAt = Date.now();
      this._plannedEndAt = Date.now() + nextTime * 1000;
    }

    const remaining = Math.max(0, Math.ceil((this._plannedEndAt - Date.now()) / 1000));

    this.setData(
      this.buildUiData('active', {
        isActive: true,
        timeLeft: remaining,
        displayTime: formatTime(remaining),
        endTimeLabel: this.formatEndTimeLabel()
      })
    );
    showChaosToast(this, '计时开始，今天先假装自己很自律。', 1600);

    this.startCountdownTicker();
  },

  startCountupTimer() {
    this.clearTimer();
    this.startedAt = Date.now() - Number(this.data.elapsedSeconds || 0) * 1000;
    this._plannedEndAt = 0;

    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000));
    this.setData(
      this.buildUiData('active', {
        isActive: true,
        elapsedSeconds,
        displayTime: formatTime(elapsedSeconds),
        endTimeLabel: '--:--'
      })
    );
    showChaosToast(this, '正计时开始，结束时会保存本轮记录。', 1600);

    this.startCountupTicker();
  },

  pauseTimer() {
    this.clearTimer();
    this.startedAt = 0;
    this._plannedEndAt = 0;
    this.setData(
      this.buildUiData('idle', {
        isActive: false,
        endTimeLabel: '--:--'
      })
    );
    showChaosToast(this, '先停一下，至少刚才不是完全在摸。', 1800);
  },

  resumeTimerIfNeeded() {
    if (!this.data.isActive || !this._plannedEndAt) {
      if (this.data.isActive && this.data.timerMode === 'countup' && this.startedAt) {
        this.startCountupTicker();
      }
      return;
    }

    this.clearTimer();
    const remaining = Math.max(0, Math.ceil((this._plannedEndAt - Date.now()) / 1000));
    const progress = 1 - remaining / Math.max(1, this.data.selectedDuration * 60);

    if (remaining <= 0) {
      // 离开期间已经到期，直接结算
      const savedStartedAt = this.startedAt;
      this.startedAt = 0;
      this._plannedEndAt = 0;
      this.handleFocusComplete(savedStartedAt);
      return;
    }

    this.setData({
      timeLeft: remaining,
      displayTime: formatTime(remaining),
      ...getRingUiData(progress),
      endTimeLabel: this.formatEndTimeLabel()
    });

    this.startCountdownTicker();
  },

  startCountdownTicker() {
    this.clearTimer();
    startManagedInterval(this, 'timer', () => {
      const remaining = Math.max(0, Math.ceil((this._plannedEndAt - Date.now()) / 1000));

      if (remaining <= 0) {
        this.clearTimer();
        this.handleFocusComplete();
        return;
      }
      const progress = 1 - remaining / Math.max(1, this.data.selectedDuration * 60);

      this.setData({
        timeLeft: remaining,
        displayTime: formatTime(remaining),
        ...getRingUiData(progress),
        endTimeLabel: this.formatEndTimeLabel()
      });
    }, 1000);
  },

  startCountupTicker() {
    this.clearTimer();
    startManagedInterval(this, 'timer', () => {
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000));
      this.setData(
        this.buildUiData('active', {
          isActive: true,
          elapsedSeconds,
          displayTime: formatTime(elapsedSeconds)
        })
      );
    }, 1000);
  },

  clearTimer() {
    clearManagedInterval(this, 'timer');
  },

  onAppLogout() {
    this.clearTimer();
    this.clearFocusStatsTimer();
    this.startedAt = 0;
    this._plannedEndAt = 0;
    this._focusStatsLoadedAt = 0;
    applyPageReset(this, createInitialState);
  },

  async handleFocusComplete(resumedStartTime) {
    const duration = Number(this.data.selectedDuration || DEFAULT_DURATION);
    const startTime = resumedStartTime || this.startedAt || Date.now() - duration * 60 * 1000;

    await this.saveFocusSession({
      duration,
      startTime,
      mode: 'pomodoro',
      completionState: 'complete'
    });
  },

  async finishCountupSession() {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - (this.startedAt || Date.now())) / 1000));
    const duration = Math.max(1, Math.round(elapsedSeconds / 60));
    this.clearTimer();

    if (elapsedSeconds < 60) {
      this.startedAt = 0;
      this.setData(
        this.buildUiData('idle', {
          isActive: false,
          elapsedSeconds,
          displayTime: formatTime(elapsedSeconds)
        })
      );
      showChaosToast(this, '正计时至少满 1 分钟再保存。', 1700);
      return;
    }

    await this.saveFocusSession({
      duration,
      startTime: this.startedAt || Date.now() - duration * 60 * 1000,
      mode: 'countup',
      completionState: 'manual'
    });
  },

  async saveFocusSession(options) {
    const duration = Number(options.duration || DEFAULT_DURATION);
    const startTime = options.startTime || Date.now() - duration * 60 * 1000;
    const taskTitle = String(this.data.taskName || '').trim();

    this.setData(
      this.buildUiData('complete', {
        isActive: false,
        timeLeft: 0,
        elapsedSeconds: duration * 60,
        displayTime: '00:00',
        endTimeLabel: '--:--'
      })
    );
    this.startedAt = 0;
    this._plannedEndAt = 0;

    try {
      const result = await app.api.focus.logSession({
        startTime,
        duration,
        task: taskTitle,
        category: '学习',
        mode: options.mode || 'pomodoro'
      });

      if (!result || !result.success) {
        showChaosToast(this, (result && result.message) || '专注记录保存失败。', 2400);
        return;
      }

      const nextMinutes = extractMinutes(this.data.todayFocusLabel) + duration;
      const nextSessions = this.data.todaySessions + 1;

      await this.upsertCompletedCloudTask(taskTitle, duration);
      this._focusStatsLoadedAt = Date.now();
      this.setData({
        todayFocusLabel: `${nextMinutes} 分钟`,
        todaySessions: nextSessions,
        todaySessionsLabel: `${nextSessions} 次`,
        taskName: '',
        taskDisplayName: DEFAULT_TASK_NAME,
        taskFooterLabel: '未命名',
        timeLeft: this.data.selectedDuration * 60,
        elapsedSeconds: 0,
        targetLabel: this.data.timerMode === 'countup'
          ? `正计时 ${formatDurationTarget(this.data.selectedDuration)} · 0%`
          : `目标 ${formatDurationTarget(this.data.selectedDuration)}`
      });
      showChaosToast(this, '这轮完成，专注记录已经写回云端。', 2600);
    } catch (error) {
      console.error('[version2/focus] 专注记录保存失败:', error);
      showChaosToast(this, '专注记录保存失败。', 2400);
    }
  },

  async upsertCompletedCloudTask(taskTitle, duration) {
    if (!taskTitle) {
      return;
    }

    try {
      if (!app.api || !app.api.task) {
        return;
      }

      const date = getTodayString();
      const listResult = await app.api.task.list(date);
      const tasks = listResult && listResult.success ? (listResult.goals || []) : [];
      const existing = tasks.find((item) => String(item.title || item.label || '').trim() === taskTitle);

      if (existing && existing._id) {
        await app.api.task.update({
          id: existing._id,
          title: taskTitle,
          date,
          completed: true,
          focusMinutes: Number(existing.focusMinutes || existing.duration || 0) + duration,
          source: existing.source || 'focus',
          category: existing.category || '学习'
        });
      } else {
        await app.api.task.create({
          title: taskTitle,
          date,
          completed: true,
          focusMinutes: duration,
          source: 'focus',
          category: '学习'
        });
      }
    } catch (error) {
      console.warn('[version2/focus] 同步专注任务到云端失败:', error);
    }
  }
});
