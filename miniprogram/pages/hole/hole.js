const { syncTabBar } = require('../../utils/tabbar.js');
const { clearToast, showChaosToast } = require('../../utils/toast.js');
const { getTodayString } = require('../../utils/date.js');
const {
  applyPageReset,
  clearDelayedTask,
  clearManagedTimeoutQueue,
  clearRequestToken,
  createRequestToken,
  isActiveRequest,
  queueManagedTimeout,
  scheduleDelayedTask,
  withLoginGate
} = require('../../utils/page-helpers.js');

const app = getApp();

const POSITIVE_WORDS = [
  '你可以的',
  '你是最棒的',
  '人间值得',
  '干就完了',
  '奖励一顿火锅',
  '好运加持',
  '未来可期',
  '闪闪发光',
  '保持可爱',
  '今天真好看',
  '加油牛马',
  '你可以永远相信自己',
  '会有好事发生',
  '冲鸭',
  '元气满满',
  '爱自己'
];

const PARTICLE_SYMBOLS = ['❤', '✨', '⭐', '☀'];
const TRANSFORM_RESPONSES = [
  '坏心情已被转化为多巴胺。',
  '这点阴霾已经被压成小甜点。',
  '你刚刚手动给大脑补了一针元气。',
  '碎掉的那部分，已经被拿去换快乐了。'
];
const TICKER_TEXT = '多巴胺工厂满负荷运转中 ... 你真的很棒 ... 又是元气满满的一天 ... 拒绝内耗，从我做起 ... 世界由于你而更精彩 ... 保持微笑，好运自来 ...';

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatTraceTime(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }

  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatTraceDateLabel(dateString) {
  if (!dateString) {
    return '今天';
  }

  const today = getTodayString();
  if (dateString === today) {
    return '今天';
  }

  const [year, month, day] = String(dateString).split('-');
  if (!year || !month || !day) {
    return dateString;
  }

  return `${year} 年 ${month} 月 ${day} 日`;
}

function normalizeTraceList(list) {
  return (list || []).map((item, index) => ({
    id: item._id || `${item.createdAt || Date.now()}-${index}`,
    content: String(item.content || '').trim() || '没有留下具体内容',
    timeText: formatTraceTime(item.createdAt),
    createdAt: Number(item.createdAt) || Date.now()
  }));
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function createFloatingWord() {
  const id = `${Date.now()}-${Math.floor(Math.random() * 9999)}`;
  const left = Math.round(Math.random() * 78 + 2);
  const fontSize = Math.round(Math.random() * 18 + 26);
  const duration = Math.round(Math.random() * 6000 + 12000);

  return {
    id,
    word: pickRandom(POSITIVE_WORDS),
    style: `left:${left}%; font-size:${fontSize}rpx; animation-duration:${duration}ms;`
  };
}

function createParticle(index) {
  const id = `${Date.now()}-${index}-${Math.floor(Math.random() * 9999)}`;
  const left = Math.round(28 + Math.random() * 44);
  const top = Math.round(30 + Math.random() * 32);
  const delay = Math.round(Math.random() * 120);
  const fontSize = Math.round(Math.random() * 14 + 24);

  return {
    id,
    symbol: pickRandom(PARTICLE_SYMBOLS),
    style: `left:${left}%; top:${top}%; font-size:${fontSize}rpx; animation-delay:${delay}ms;`
  };
}

function createInitialState() {
  return {
    toastVisible: false,
    toastMessage: '',
    tickerText: TICKER_TEXT,
    floatingWords: [],
    particles: [],
    moodText: '',
    moodTextCount: 0,
    rechargeCount: 0,
    superChargeActive: false,
    brainActive: false,
    latestReward: '点击大脑合成快乐，或投递坏心情。',
    latestMood: '此刻还没有新的小阴霾。',
    todayDate: getTodayString(),
    selectedTraceDate: getTodayString(),
    selectedTraceDateLabel: '今天',
    traceLoading: false,
    traceCollectionMissing: false,
    traceList: [],
    traceCount: 0
  };
}

Page({
  data: createInitialState(),

  onShow() {
    syncTabBar(this, 'hole');
    this.scheduleHoleBoot();
  },

  onHide() {
    clearToast(this);
    this.clearHoleBootTimer();
    this.clearTraceLoadTimer();
    this.stopFloatingWords();
    this.clearTimers();
    this._traceRequestId = 0;
  },

  onUnload() {
    clearToast(this);
    this.clearHoleBootTimer();
    this.clearTraceLoadTimer();
    this.stopFloatingWords();
    this.clearTimers();
    this._traceRequestId = 0;
  },

  clearHoleBootTimer() {
    clearDelayedTask(this, '_holeBootTimer');
  },

  clearTraceLoadTimer() {
    clearDelayedTask(this, '_traceLoadTimer');
  },

  scheduleHoleBoot(forceRefresh) {
    this.clearHoleBootTimer();
    scheduleDelayedTask(this, '_holeBootTimer', 32, () => {
      this.startFloatingWords();
      this.scheduleMoodTraceLoad(this.data.selectedTraceDate || getTodayString(), forceRefresh);
    });
  },

  scheduleMoodTraceLoad(dateString, forceRefresh) {
    const targetDate = dateString || getTodayString();
    const sameDate = targetDate === (this._lastTraceDate || '');
    const isFresh = !forceRefresh && sameDate && this._lastTraceLoadedAt && Date.now() - this._lastTraceLoadedAt < 15000;

    this.clearTraceLoadTimer();

    if (isFresh) {
      this.setData({
        todayDate: getTodayString(),
        selectedTraceDate: targetDate,
        selectedTraceDateLabel: formatTraceDateLabel(targetDate)
      });
      return;
    }

    scheduleDelayedTask(this, '_traceLoadTimer', sameDate && (this.data.traceList || []).length ? 24 : 64, () => {
      this.loadMoodTraces(targetDate);
    });
  },

  queueTimer(callback, delay) {
    return queueManagedTimeout(this, '_timers', callback, delay);
  },

  clearTimers() {
    clearManagedTimeoutQueue(this, '_timers');
  },

  startFloatingWords() {
    if (this._floatingWordTimer) {
      return;
    }

    const initialWords = Array.from({ length: 5 }).map(() => createFloatingWord());
    this.setData({
      floatingWords: initialWords
    });
    initialWords.forEach((item) => this.scheduleFloatingWordRemoval(item, 18000));

    this._floatingWordTimer = setInterval(() => {
      this.spawnFloatingWord();
    }, 1100);
  },

  stopFloatingWords() {
    if (this._floatingWordTimer) {
      clearInterval(this._floatingWordTimer);
      this._floatingWordTimer = null;
    }

    this.setData({
      floatingWords: [],
      particles: []
    });
  },

  scheduleFloatingWordRemoval(item, duration) {
    this.queueTimer(() => {
      this.setData({
        floatingWords: (this.data.floatingWords || []).filter((word) => word.id !== item.id)
      });
    }, duration);
  },

  spawnFloatingWord(count) {
    const amount = count || 1;
    const newItems = [];

    for (let index = 0; index < amount; index += 1) {
      const item = createFloatingWord();
      newItems.push(item);
      this.scheduleFloatingWordRemoval(item, 18500);
    }

    const merged = (this.data.floatingWords || []).concat(newItems).slice(-18);
    this.setData({
      floatingWords: merged
    });
  },

  flashBrain() {
    this.setData({ brainActive: true });
    this.queueTimer(() => {
      this.setData({ brainActive: false });
    }, 220);
  },

  spawnParticles(count) {
    const amount = count || 4;
    const newParticles = Array.from({ length: amount }).map((_, index) => createParticle(index));
    const merged = (this.data.particles || []).concat(newParticles).slice(-20);

    this.setData({ particles: merged });

    this.queueTimer(() => {
      const ids = newParticles.map((item) => item.id);
      this.setData({
        particles: (this.data.particles || []).filter((item) => ids.indexOf(item.id) < 0)
      });
    }, 920);
  },

  async loadMoodTraces(dateString) {
    const targetDate = dateString || getTodayString();

    if (!withLoginGate(this, {
      mode: 'passive',
      resetLoadingField: 'traceLoading'
    })) {
      this.setData({
        traceLoading: false,
        traceCollectionMissing: false,
        traceList: [],
        traceCount: 0,
        latestMood: '此刻还没有新的小阴霾。'
      });
      return;
    }

    const requestId = createRequestToken(this, '_traceRequestId');

    const keepCurrent = targetDate === this.data.selectedTraceDate && (this.data.traceList || []).length > 0;

    this.setData({
      todayDate: getTodayString(),
      selectedTraceDate: targetDate,
      selectedTraceDateLabel: formatTraceDateLabel(targetDate),
      traceLoading: !keepCurrent,
      traceCollectionMissing: false
    });

    try {
      const user = await app.ensureUserSession();
      if (!user || !isActiveRequest(this, '_traceRequestId', requestId)) {
        throw new Error('USER_SESSION_UNAVAILABLE');
      }

      const result = await app.api.hole.listByDate(targetDate);
      if (!isActiveRequest(this, '_traceRequestId', requestId)) {
        return;
      }

      if (!result || !result.success) {
        throw new Error((result && result.message) || '读取情绪档案失败');
      }

      const traceList = normalizeTraceList(result.traces);
      this._lastTraceDate = targetDate;
      this._lastTraceLoadedAt = Date.now();
      const patch = {
        traceLoading: false,
        traceCollectionMissing: !!result.collectionMissing,
        traceList,
        traceCount: traceList.length
      };

      if (targetDate === getTodayString() && traceList.length) {
        patch.latestMood = traceList[0].content;
      }

      this.setData(patch);
    } catch (error) {
      if (!isActiveRequest(this, '_traceRequestId', requestId)) {
        return;
      }

      this.setData({
        traceLoading: false,
        traceCollectionMissing: false,
        traceList: [],
        traceCount: 0
      });
      showChaosToast(this, '情绪档案读取失败，稍后再试。', 1800);
    }
  },

  onRechargeBrain() {
    const nextCount = Number(this.data.rechargeCount || 0) + 1;

    this.flashBrain();
    this.spawnParticles(3);
    this.spawnFloatingWord(2);
    this.setData({
      rechargeCount: nextCount,
      latestReward: `${pickRandom(POSITIVE_WORDS)}，快乐库存 +1`
    });
  },

  onMoodInput(e) {
    const value = e.detail.value;
    this.setData({
      moodText: value,
      moodTextCount: String(value || '').length
    });
  },

  async onTransformMood() {
    const moodText = String(this.data.moodText || '').trim();

    if (!moodText) {
      showChaosToast(this, '先写下一点阴霾，大脑才知道该消化什么。', 1800);
      return;
    }

    if (!withLoginGate(this, { mode: 'action' })) {
      return;
    }

    const today = getTodayString();

    this.flashBrain();
    this.spawnParticles(8);
    this.spawnFloatingWord(5);
    this.setData({
      latestMood: moodText,
      latestReward: pickRandom(TRANSFORM_RESPONSES)
    });

    try {
      const user = await app.ensureUserSession();
      if (!user) {
        throw new Error('USER_SESSION_UNAVAILABLE');
      }

      const result = await app.api.hole.logMood({
        content: moodText,
        date: today
      });

      if (result && result.success) {
        this.setData({ moodText: '', moodTextCount: 0 });
        showChaosToast(this, '坏心情已被转化并存档！', 1600);
        if ((this.data.selectedTraceDate || today) === today) {
          this.scheduleMoodTraceLoad(today, true);
        }
        return;
      }

      if (result && result.error === 'COLLECTION_MISSING') {
        this.setData({
          traceCollectionMissing: true,
          traceList: [],
          traceCount: 0,
          traceLoading: false
        });
        showChaosToast(this, result.message || '请先创建 mood_traces 集合。', 2000);
        return;
      }

      showChaosToast(this, (result && result.message) || '坏心情已转化，但存档失败。', 2000);
    } catch (error) {
      showChaosToast(this, '坏心情已转化，但云端存档失败。', 2000);
    }
  },

  async onPickTraceDate(e) {
    const nextDate = e && e.detail ? e.detail.value : '';
    if (!nextDate || nextDate === this.data.selectedTraceDate) {
      return;
    }

    this.scheduleMoodTraceLoad(nextDate, true);
  },

  onSuperCharge() {
    if (this._superChargeLocked) {
      return;
    }

    this._superChargeLocked = true;
    this.setData({
      superChargeActive: true,
      latestReward: '强行积极模式已开启，快乐工厂正在超频。'
    });

    this.flashBrain();
    this.spawnParticles(10);
    this.spawnFloatingWord(8);
    showChaosToast(this, '强行积极模式已开启！冲！', 1600);

    this.queueTimer(() => {
      this.setData({
        superChargeActive: false
      });
      this._superChargeLocked = false;
    }, 1800);
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
          url: '/pages/home/home'
        });
      }
    });
  },

  onAppLogout() {
    this.stopFloatingWords();
    this.clearTimers();
    this.clearHoleBootTimer();
    this.clearTraceLoadTimer();
    this._superChargeLocked = false;
    this._lastTraceLoadedAt = 0;
    this._lastTraceDate = '';
    applyPageReset(this, createInitialState, (page) => clearRequestToken(page, '_traceRequestId'));
  }
});
