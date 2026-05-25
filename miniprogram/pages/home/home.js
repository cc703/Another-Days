const { syncTabBar } = require('../../utils/tabbar.js');
const { clearToast, showChaosToast } = require('../../utils/toast.js');
const {
  applyPageReset,
  clearDelayedTask,
  clearManagedTimeoutQueue,
  queueManagedTimeout,
  withLoginGate
} = require('../../utils/page-helpers.js');
const { getTodayString } = require('../../utils/date.js');

const app = getApp();
const WOODFISH_AUDIO_FILENAME = 'home-woodfish-hit-v2.wav';
const DEFAULT_TODAY_TASKS = [
  { title: '英语阅读 20min', source: 'preset', category: '学习' },
  { title: '专业课背诵', source: 'preset', category: '学习' },
  { title: '政治选择题', source: 'preset', category: '学习' }
];
const TODAY_STATUS_OPTIONS = [
  { key: 'charged', label: '充满电', title: '充满电', copy: '今天可以先推进一个明确的小目标。' },
  { key: 'tired', label: '有点累', title: '有点累', copy: '把目标切小一点，先完成一个不费劲的动作。' },
  { key: 'emo', label: 'emo中', title: 'emo中', copy: '状态不好也可以记录下来，别让它变成空白。' }
];
const FLOATING_WORDS = [
  '呼！',
  '吸！',
  '还没挂',
  '混一下',
  '就这？',
  '呃...',
  '算了吧',
  '（虚无）',
  '好累',
  '不想动',
  '滴...',
  '打卡',
  '空',
  '。',
  '又在混',
  '无所谓',
  '累了',
  '再躺会儿',
  '就这样吧',
  '问题不大',
  '稳住',
  '还能苟',
  '先活着',
  '慢慢来',
  '不急',
  '有点烦',
  '想下班',
  '摸鱼中',
  '别催',
  '已宕机',
  '加载中...',
  '缓存清理',
  '重启失败',
  '内存不足',
  '信号丢失',
  '正在缓冲',
  '电量1%',
  '系统维护',
  '断网中',
  '无响应',
  '正在发呆'
];

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

function createWoodfishWavBuffer() {
  const sampleRate = 24000;
  const durationSeconds = 0.36;
  const samples = Math.floor(sampleRate * durationSeconds);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const blockAlign = 2;
  const byteRate = sampleRate * blockAlign;

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, samples * 2, true);

  let offset = 44;
  let seed = 2463534242;

  function nextNoise() {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) / 4294967295) * 2 - 1;
  }

  for (let index = 0; index < samples; index += 1) {
    const time = index / sampleRate;
    const hitNoise = nextNoise() * 0.18 * Math.exp(-180 * time);
    const hitClick = Math.sin(2 * Math.PI * 1480 * time) * 0.08 * Math.exp(-120 * time);
    const lowKnock = Math.sin(2 * Math.PI * 132 * time) * 0.38 * Math.exp(-15 * time);
    const bodyMain = Math.sin(2 * Math.PI * 246 * time) * 0.72 * Math.exp(-8.5 * time);
    const bodyWarm = Math.sin(2 * Math.PI * 311 * time + 0.2) * 0.42 * Math.exp(-10.5 * time);
    const ringOne = Math.sin(2 * Math.PI * 492 * time + 0.4) * 0.26 * Math.exp(-14 * time);
    const ringTwo = Math.sin(2 * Math.PI * 738 * time + 0.7) * 0.14 * Math.exp(-18 * time);
    const air = Math.sin(2 * Math.PI * 980 * time) * 0.05 * Math.exp(-26 * time);
    const bodyEnvelope = 1 - Math.exp(-120 * time);

    let sample =
      hitNoise +
      hitClick +
      (lowKnock + bodyMain + bodyWarm + ringOne + ringTwo + air) * bodyEnvelope;

    sample *= Math.exp(-1.8 * time);
    sample = Math.tanh(sample * 1.35) * 0.9;

    view.setInt16(offset, sample * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

function ensureWoodfishAudioFile() {
  const fs = wx.getFileSystemManager();
  const audioPath = `${wx.env.USER_DATA_PATH}/${WOODFISH_AUDIO_FILENAME}`;

  try {
    if (typeof fs.accessSync === 'function') {
      fs.accessSync(audioPath);
    } else {
      fs.statSync(audioPath);
    }
    return audioPath;
  } catch (error) {
    fs.writeFileSync(audioPath, createWoodfishWavBuffer());
    return audioPath;
  }
}

function createInitialState() {
  return {
    loading: false,
    toastVisible: false,
    toastMessage: '',
    survivalCount: 0,
    lifePercentage: '0.02',
    lifePercentageInt: 0,
    lifeRemaining: 100,
    todayTaskCount: 3,
    gaugeAngle: -180,
    muyuCracking: false,
    floatingInks: [],
    todayMoodTitle: '平稳推进',
    todayMoodCopy: '今天已经把节奏慢慢接起来了。',
    streakDays: 0,
    diaryCount: 0,
    homeFocusMinutes: 0,
    todayTasks: DEFAULT_TODAY_TASKS.map((task, index) => normalizeTask({
      id: `preset-fallback-${index}`,
      ...task
    }, index)),
    newTaskTitle: '',
    selectedStatusKey: 'charged',
    statusOptions: TODAY_STATUS_OPTIONS,
    customStatusText: ''
  };
}

function normalizeTask(task, index) {
  const label = String(task && (task.label || task.title) || '').trim();
  if (!label) {
    return null;
  }

  return {
    id: String(task._id || task.id || `task-${index}`),
    _id: task._id || task.id || '',
    label,
    done: Boolean(task.done || task.completed || task.status === 'done'),
    duration: Number(task.duration || task.minutes || task.focusMinutes || 0),
    source: task.source || 'manual',
    createdAt: task.createdAt || Date.now()
  };
}

Page({
  data: createInitialState(),

  onShow() {
    syncTabBar(this, 'home');
    this.prepareWoodfishAudio();
    this.startLifeTicker();
    this.scheduleHomeRefresh();
  },

  onReady() {
    this.prepareWoodfishAudio();
  },

  onHide() {
    this.clearTimers();
    this.stopWoodfishAudio();
    this.setData({ floatingInks: [] });
    this.clearLifeTicker();
    this.clearHomeRefreshTimer();
  },

  onUnload() {
    clearToast(this);
    this.clearTimers();
    this.destroyWoodfishAudio();
    this.clearLifeTicker();
    this.clearHomeRefreshTimer();
  },

  clearHomeRefreshTimer() {
    clearDelayedTask(this, '_homeRefreshTimer');
  },

  scheduleHomeRefresh(forceRefresh) {
    this.clearHomeRefreshTimer();
    if (!forceRefresh && this._homeLoadedAt && Date.now() - this._homeLoadedAt < 15000) {
      return;
    }

    clearDelayedTask(this, '_homeRefreshTimer');
    this._homeRefreshTimer = setTimeout(() => {
      this.loadHomeSummary();
    }, 48);
  },

  async ensureDefaultTasks(existingTasks) {
    const tasks = (existingTasks || []).map(normalizeTask).filter(Boolean);
    const existingPresetTitles = tasks
      .filter((task) => task.source === 'preset')
      .map((task) => task.label);
    const missingPresets = DEFAULT_TODAY_TASKS.filter((task) =>
      existingPresetTitles.indexOf(task.title) < 0
    );

    if (!missingPresets.length || !app.api || !app.api.task || !app.api.task.create) {
      return tasks;
    }

    const created = [];
    for (let index = 0; index < missingPresets.length; index += 1) {
      const preset = missingPresets[index];
      try {
        const result = await app.api.task.create({
          title: preset.title,
          date: getTodayString(),
          source: preset.source,
          category: preset.category
        });
        if (result && result.success && result.goal) {
          created.push(normalizeTask(result.goal, index));
        }
      } catch (error) {
        console.warn('[version2/home] 默认任务创建失败:', error);
      }
    }

    return tasks.concat(created).filter(Boolean);
  },

  applyStatsHintsToTasks(baseTasks, focusMinutes, checkedIn) {
    const tasks = baseTasks && baseTasks.length
      ? baseTasks
      : DEFAULT_TODAY_TASKS.map((task, index) => normalizeTask({
        id: `preset-fallback-${index}`,
        ...task
      }, index));

    return tasks.map((task) => {
      if (task.source !== 'preset') {
        return task;
      }

      if (task.label === '英语阅读 20min') {
        return { ...task, done: task.done || focusMinutes >= 20 };
      }

      if (task.label === '专业课背诵') {
        return { ...task, done: task.done || focusMinutes >= 40 };
      }

      if (task.label === '政治选择题') {
        return { ...task, done: task.done || Boolean(checkedIn) };
      }

      return task;
    });
  },

  async loadHomeSummary() {
    if (this._homeLoading) {
      return;
    }

    if (!withLoginGate(this, {
      mode: 'passive',
      resetLoadingField: 'loading'
    })) {
      this.setData({ loading: false });
      return;
    }

    this._homeLoading = true;
    this.setData({ loading: true });

    try {
      const [result, taskResult, statusResult] = await Promise.all([
        app.warmUserStats
          ? app.warmUserStats({ maxAge: 15000 })
          : app.api.user.getStats(),
        app.api && app.api.task ? app.api.task.list(getTodayString()) : Promise.resolve(null),
        app.api && app.api.daily ? app.api.daily.getStatus(getTodayString()) : Promise.resolve(null)
      ]);

      if (!result || !result.success) {
        throw new Error((result && result.message) || 'HOME_STATS_FAILED');
      }

      const stats = result.stats || {};
      const today = result.today || {};
      const focusMinutes = Number(today.focusMinutes || 0);
      const diaryCount = Number(stats.totalDiaries || 0);
      const streakDays = Number(stats.currentStreak || 0);
      const persistedTasks = await this.ensureDefaultTasks(taskResult && taskResult.success ? taskResult.goals : []);
      const tasks = this.applyStatsHintsToTasks(persistedTasks, focusMinutes, today.checkedIn);
      const doneCount = tasks.filter((item) => item.done).length;
      const statusRow = statusResult && statusResult.success && statusResult.status ? statusResult.status : null;
      const selectedStatusKey = statusRow && statusRow.mood;
      const customText = statusRow && (statusRow.customMood || statusRow.note);
      const selectedStatus = TODAY_STATUS_OPTIONS.find((item) => item.key === selectedStatusKey) || TODAY_STATUS_OPTIONS[0];

      this._homeLoadedAt = Date.now();
      this.setData({
        loading: false,
        todayTasks: tasks,
        todayTaskCount: tasks.length,
        survivalCount: streakDays,
        streakDays,
        diaryCount,
        homeFocusMinutes: focusMinutes,
        selectedStatusKey: selectedStatus.key,
        customStatusText: customText || '',
        todayMoodTitle: customText || (today.checkedIn ? '稳住节奏' : selectedStatus.title),
        todayMoodCopy: today.checkedIn
          ? '今天已经留下进度痕迹，继续把这口气接住。'
          : selectedStatus.copy,
        lifePercentage: String(Math.max(0.02, Math.min(99.99, 18 + doneCount * 22 + Math.min(focusMinutes, 120) * 0.2)).toFixed(2))
      });
      this.tickLifePercentage(0);
    } catch (error) {
      console.error('[version2/home] 首页摘要加载失败:', error);
      showChaosToast(this, '首页摘要同步失败，稍后再试。', 1800);
      this.setData({ loading: false });
    } finally {
      this._homeLoading = false;
    }
  },

  clearTimers() {
    if (this._crackTimer) {
      clearTimeout(this._crackTimer);
      this._crackTimer = null;
    }

    if (this._inkTimers && this._inkTimers.length) {
      clearManagedTimeoutQueue(this, '_inkTimers');
    }
  },

  queueInkTimer(callback, delay) {
    queueManagedTimeout(this, '_inkTimers', callback, delay);
  },

  prepareWoodfishAudio() {
    try {
      const audioPath = ensureWoodfishAudioFile();

      if (!this._woodfishAudio) {
        this._woodfishAudio = wx.createInnerAudioContext();
        this._woodfishAudio.obeyMuteSwitch = false;
        this._woodfishAudio.loop = false;
        this._woodfishAudio.volume = 0.92;
      }

      this._woodfishAudio.src = audioPath;
      return true;
    } catch (error) {
      console.warn('[version2/home] 木鱼音效准备失败:', error);
      return false;
    }
  },

  stopWoodfishAudio() {
    if (this._woodfishAudio) {
      this._woodfishAudio.stop();
    }
  },

  destroyWoodfishAudio() {
    if (this._woodfishAudio) {
      this._woodfishAudio.destroy();
      this._woodfishAudio = null;
    }
  },

  playWoodfishAudio() {
    try {
      const prepared = this._woodfishAudio || this.prepareWoodfishAudio();
      if (!prepared || !this._woodfishAudio) {
        return;
      }

      this._woodfishAudio.stop();
      if (typeof this._woodfishAudio.seek === 'function') {
        this._woodfishAudio.seek(0);
      }
      this._woodfishAudio.play();
    } catch (error) {
      console.warn('[version2/home] 木鱼音效播放失败:', error);
    }
  },

  onKnockMuyu() {
    const nextCount = this.data.survivalCount + 1;
    this.playWoodfishAudio();

    this.setData({ survivalCount: nextCount });
    this.tickLifePercentage();

    this.measureMuyuCenter().then((position) => {
      if (position) {
        this.spawnFloatingInks(position);
      }
    });

    if (this._crackTimer) {
      clearTimeout(this._crackTimer);
    }

    this.setData({ muyuCracking: true });
    this._crackTimer = setTimeout(() => {
      this.setData({ muyuCracking: false });
      this._crackTimer = null;
    }, 320);
  },

  startLifeTicker() {
    this.clearLifeTicker();
    this._lifeTicker = setInterval(() => {
      this.tickLifePercentage(0.01);
    }, 3000);
  },

  clearLifeTicker() {
    if (this._lifeTicker) {
      clearInterval(this._lifeTicker);
      this._lifeTicker = null;
    }
  },

  tickLifePercentage(delta) {
    const current = parseFloat(this.data.lifePercentage) || 0;
    const step = typeof delta === 'number' ? delta : (Math.random() * 0.03 + 0.01);
    const next = Math.min(current + step, 99.99);
    const percentInt = Math.max(0, Math.min(100, Math.round(next)));
    this.setData({
      lifePercentage: next.toFixed(2),
      lifePercentageInt: percentInt,
      lifeRemaining: Math.max(0, 100 - percentInt),
      gaugeAngle: -180 + percentInt * 1.8
    });
  },

  measureMuyuCenter() {
    return new Promise((resolve) => {
      const query = wx.createSelectorQuery().in(this);
      query.select('.soft-container').boundingClientRect();
      query.select('.home-action--focus').boundingClientRect();
      query.exec((res) => {
        const altarRect = res && res[0];
        const muyuRect = res && res[1];

        if (!altarRect || !muyuRect) {
          resolve(null);
          return;
        }

        resolve({
          left: muyuRect.left - altarRect.left + muyuRect.width / 2,
          top: muyuRect.top - altarRect.top + muyuRect.height / 2
        });
      });
    });
  },

  spawnFloatingInks(position) {
    const burstCount = 8 + Math.floor(Math.random() * 6);
    const newItems = Array.from({ length: burstCount }).map((_, index) =>
      this.createFloatingInk(position, index)
    );
    const currentItems = this.data.floatingInks || [];
    const initialItems = currentItems.concat(newItems.map((item) => ({
      ...item,
      animationData: wx.createAnimation({ duration: 0 }).opacity(0).export()
    })));

    this.setData({ floatingInks: initialItems }, () => {
      const mergedItems = (this.data.floatingInks || []).map((item) => {
        const target = newItems.find((ink) => ink.id === item.id);
        return target ? { ...item, animationData: target.animationData } : item;
      });

      this.setData({ floatingInks: mergedItems });
    });

    newItems.forEach((item) => {
      this.queueInkTimer(() => {
        this.setData({
          floatingInks: (this.data.floatingInks || []).filter((ink) => ink.id !== item.id)
        });
      }, item.lifetime);
    });
  },

  createFloatingInk(position, index) {
    const angle = Math.random() * Math.PI * 2;
    const distance = 120 + Math.random() * 180;
    const dx = Math.round(Math.cos(angle) * distance);
    const dy = Math.round(Math.sin(angle) * distance);
    const rotate = Math.round((Math.random() - 0.5) * 60);
    const fontSize = Math.round(16 + Math.random() * 20);
    const lifetime = 1020;
    const id = `${Date.now()}-${index}-${Math.floor(Math.random() * 9999)}`;
    const animation = wx.createAnimation({
      duration: 1000,
      timingFunction: 'cubic-bezier(0.19, 1, 0.22, 1)',
      transformOrigin: '50% 50%'
    });

    animation.opacity(1).scale(1.4).step({ duration: 140 });
    animation.opacity(0).translate(dx, dy).rotate(rotate).scale(1).step({ duration: 860 });

    return {
      id,
      text: FLOATING_WORDS[Math.floor(Math.random() * FLOATING_WORDS.length)],
      left: Math.round(position.left),
      top: Math.round(position.top),
      fontSize,
      lifetime,
      animationData: animation.export()
    };
  },

  onReset() {
    this.clearTimers();
    applyPageReset(this, createInitialState);
    this.scheduleHomeRefresh(true);
  },

  onOpenFocus() {
    wx.switchTab({
      url: '/pages/focus/focus'
    });
  },

  onOpenHole() {
    wx.navigateTo({
      url: '/pages/hole/hole'
    });
  },

  onOpenDiary() {
    wx.switchTab({
      url: '/pages/diary/diary'
    });
  },

  onNewTaskInput(e) {
    this.setData({ newTaskTitle: e.detail.value });
  },

  async onAddTodayTask() {
    const title = String(this.data.newTaskTitle || '').trim();
    if (!title) {
      showChaosToast(this, '先写一个今天要做的小任务。', 1500);
      return;
    }

    try {
      const result = await app.api.task.create({
        title,
        date: getTodayString(),
        source: 'manual',
        category: '学习'
      });

      if (!result || !result.success) {
        throw new Error((result && result.message) || 'TASK_CREATE_FAILED');
      }

      const nextTasks = (this.data.todayTasks || []).concat(normalizeTask(result.goal, this.data.todayTasks.length));
      this.setData({
        todayTasks: nextTasks,
        todayTaskCount: nextTasks.length,
        newTaskTitle: ''
      });
      showChaosToast(this, '已加入今日任务。', 1400);
    } catch (error) {
      console.error('[version2/home] 新增任务失败:', error);
      showChaosToast(this, error && error.message ? error.message : '新增任务失败。', 1800);
    }
  },

  async onToggleTodayTask(e) {
    const { id } = e.currentTarget.dataset;
    const task = (this.data.todayTasks || []).find((item) => item.id === id || item._id === id);
    if (!task) {
      return;
    }

    const nextTasks = (this.data.todayTasks || []).map((task) =>
      task.id === id ? { ...task, done: !task.done } : task
    );
    const doneCount = nextTasks.filter((item) => item.done).length;

    this.setData({
      todayTasks: nextTasks,
      lifePercentage: String(Math.max(0.02, Math.min(99.99, 18 + doneCount * 22 + Math.min(this.data.homeFocusMinutes, 120) * 0.2)).toFixed(2))
    });
    this.tickLifePercentage(0);
    try {
      const result = await app.api.task.update({
        id: task._id || task.id,
        title: task.label,
        date: getTodayString(),
        completed: !task.done,
        source: task.source || 'manual',
        category: '学习',
        focusMinutes: Number(task.duration || 0)
      });
      if (!result || !result.success) {
        throw new Error((result && result.message) || 'TASK_TOGGLE_FAILED');
      }
    } catch (error) {
      console.error('[version2/home] 任务状态保存失败:', error);
      this.scheduleHomeRefresh(true);
      showChaosToast(this, '任务状态保存失败，已重新同步。', 1800);
    }
  },

  async onStatusSelect(e) {
    const { key } = e.currentTarget.dataset;
    const selectedStatus = TODAY_STATUS_OPTIONS.find((item) => item.key === key) || TODAY_STATUS_OPTIONS[0];
    const status = {
      key: selectedStatus.key,
      customText: this.data.customStatusText
    };

    this.setData({
      selectedStatusKey: selectedStatus.key,
      todayMoodTitle: status.customText || selectedStatus.title,
      todayMoodCopy: selectedStatus.copy
    });
    await this.saveDailyStatus(status);
  },

  onCustomStatusInput(e) {
    this.setData({ customStatusText: e.detail.value });
  },

  async onCustomStatusConfirm() {
    const text = String(this.data.customStatusText || '').trim();
    const selectedStatus = TODAY_STATUS_OPTIONS.find((item) => item.key === this.data.selectedStatusKey) || TODAY_STATUS_OPTIONS[0];
    const status = {
      key: selectedStatus.key,
      customText: text
    };

    this.setData({
      customStatusText: text,
      todayMoodTitle: text || selectedStatus.title,
      todayMoodCopy: selectedStatus.copy
    });
    await this.saveDailyStatus(status);
    showChaosToast(this, text ? '今日状态已更新。' : '已恢复默认状态文案。', 1400);
  },

  async saveDailyStatus(status) {
    if (!app.api || !app.api.daily || !app.api.daily.saveStatus) {
      return;
    }

    try {
      const result = await app.api.daily.saveStatus({
        date: getTodayString(),
        mood: status.key,
        customMood: status.customText,
        note: status.customText,
        energy: status.key === 'charged' ? 80 : status.key === 'tired' ? 35 : 45
      });
      if (result && result.success === false) {
        console.warn('[version2/home] 今日状态保存失败:', result);
      }
    } catch (error) {
      console.warn('[version2/home] 今日状态保存异常:', error);
    }
  },

  onAppLogout() {
    this.onReset();
  }
});
