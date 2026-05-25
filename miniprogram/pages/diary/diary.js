const { syncTabBar } = require('../../utils/tabbar.js');
const { clearToast, showChaosToast } = require('../../utils/toast.js');
const { addMonths, getMonthMeta, getTodayString, parseDate } = require('../../utils/date.js');
const {
  applyPageReset,
  clearRequestToken,
  createRequestToken,
  isActiveRequest,
  withLoginGate
} = require('../../utils/page-helpers.js');

const app = getApp();
const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
const MOOD_OPTIONS = [
  { key: 'calm', label: '平静', icon: '￣' },
  { key: 'anxious', label: '焦虑', icon: '≋' },
  { key: 'motivated', label: '打鸡血', icon: '▲' },
  { key: 'exhausted', label: '透支', icon: '▽' },
  { key: 'confused', label: '懵', icon: '？' },
  { key: 'numb', label: '麻木', icon: '─' }
];
const DEFAULT_DIARY_TAGS = ['备考中', '焦虑发作', '摸鱼', '间歇性努力', '深夜emo', '咖啡因过量', 'ddl战士', '社交恐惧', '摆烂', '回光返照'];
const MAX_TAG_COUNT = 8;
const MAX_IMAGE_COUNT = 4;

function formatDisplayDate(dateString) {
  const date = parseDate(dateString);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatDisplayWeekday(dateString) {
  const date = parseDate(dateString);
  return '周' + WEEK_LABELS[date.getDay()];
}

function formatEntryTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '--:--';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function buildCalendarCells(month, diaryDates, selectedDate, todayDate) {
  const cells = [];
  const monthPrefix = `${month.year}-${String(month.month).padStart(2, '0')}`;

  for (let index = 0; index < month.firstWeekday; index += 1) {
    cells.push({ key: `empty-start-${index}`, empty: true });
  }

  for (let day = 1; day <= month.daysInMonth; day += 1) {
    const date = `${monthPrefix}-${String(day).padStart(2, '0')}`;
    const hasDiary = diaryDates.indexOf(date) >= 0;
    const today = date === todayDate;
    const future = date > todayDate;

    cells.push({
      key: date,
      date,
      label: String(day),
      empty: false,
      hasDiary,
      selected: date === selectedDate,
      today,
      future
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ key: `empty-end-${cells.length}`, empty: true });
  }

  return cells;
}

function buildEntryList(items) {
  return (items || []).map((item) => ({
    key: item._id || item.createdAt,
    date: formatDisplayDate(item.date),
    weekday: formatDisplayWeekday(item.date),
    time: formatEntryTime(item.createdAt),
    mood: item.mood || '',
    moodLabel: MOOD_OPTIONS.find((m) => m.key === item.mood)?.label || '',
    content: item.content || '',
    tags: item.tags || [],
    images: normalizeImages(item.images || item.imageIds || item.imagePaths || [])
  }));
}

function normalizeTag(value) {
  return String(value || '')
    .replace(/^#+/, '')
    .trim()
    .slice(0, 18);
}

function mergeTags() {
  const seen = {};
  const tags = [];
  Array.prototype.forEach.call(arguments, (group) => {
    (group || []).forEach((item) => {
      const tag = normalizeTag(item);
      if (tag && !seen[tag] && tags.length < MAX_TAG_COUNT) {
        seen[tag] = true;
        tags.push(tag);
      }
    });
  });
  return tags;
}

function formatTagDraft(value) {
  return String(value || '').replace(/^#+/, '').trim().slice(0, 18);
}

function extractContentTags(content) {
  const matches = String(content || '').match(/#[\w\u4e00-\u9fa5-]{1,18}/g) || [];
  return matches.map(normalizeTag);
}

function normalizeImages(images) {
  return (Array.isArray(images) ? images : []).map((item, index) => {
    if (typeof item === 'string') {
      return {
        key: item || `image-${index}`,
        fileID: item,
        cloudPath: '',
        tempFilePath: item,
        url: item,
        uploading: false
      };
    }

    const fileID = item && (item.fileID || item.fileId || item.id);
    const tempFilePath = item && (item.tempFilePath || item.path || item.url);
    return {
      key: (item && item.key) || fileID || tempFilePath || `image-${index}`,
      fileID: fileID || '',
      cloudPath: (item && item.cloudPath) || '',
      tempFilePath: tempFilePath || '',
      url: fileID || tempFilePath || '',
      uploading: !!(item && item.uploading)
    };
  }).filter((item) => item.url || item.tempFilePath || item.fileID);
}

function createImageItem(filePath) {
  const path = String(filePath || '');
  return {
    key: `local-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    fileID: '',
    cloudPath: '',
    tempFilePath: path,
    url: path,
    uploading: false
  };
}

function buildDailySummaryText(date, detailResult) {
  const detail = detailResult && detailResult.success ? detailResult : {};
  const tasks = Array.isArray(detail.tasks) ? detail.tasks : [];
  const completedTasks = tasks.filter((item) => item && (item.completed || item.status === 'done'));
  const focusSummary = detail.focusSummary || {};
  const focusMinutes = Number(focusSummary.totalMinutes || detail.focusMinutes || 0);
  const focusSessions = Number(focusSummary.totalSessions || detail.focusSessions || 0);
  const parts = [];

  if (completedTasks.length) {
    parts.push(`已完成 ${completedTasks.length}/${tasks.length} 项：${completedTasks.slice(0, 3).map((item) => item.label || item.title).filter(Boolean).join('、')}`);
  } else if (tasks.length) {
    parts.push(`${date} 任务 0/${tasks.length} 项完成`);
  } else {
    parts.push(`${date} 还没有任务清单`);
  }

  if (focusMinutes > 0 || focusSessions > 0) {
    parts.push(`专注 ${focusMinutes} 分钟 / ${focusSessions} 次`);
  }

  return parts.join('；');
}

function buildCompletedItems(detailResult) {
  const detail = detailResult && detailResult.success ? detailResult : {};
  const tasks = Array.isArray(detail.tasks) ? detail.tasks : [];
  const completedTasks = tasks.filter((item) => item && (item.completed || item.status === 'done'));
  const focusSummary = detail.focusSummary || {};
  const items = completedTasks.map((task) => ({
    type: 'task',
    title: task.title || task.label || '未命名任务',
    focusMinutes: Number(task.focusMinutes || task.duration || 0)
  }));

  if (Number(focusSummary.totalMinutes || 0) > 0 || Number(focusSummary.totalSessions || 0) > 0) {
    items.push({
      type: 'focus-summary',
      title: '专注汇总',
      focusMinutes: Number(focusSummary.totalMinutes || 0),
      sessions: Number(focusSummary.totalSessions || 0)
    });
  }

  return items.slice(0, 30);
}

function createInitialState() {
  return {
    loading: false,
    submitting: false,
    toastVisible: false,
    toastMessage: '',
    monthLabel: '',
    calendarCells: [],
    diaryDates: [],
    selectedDate: getTodayString(),
    todayDate: getTodayString(),
    editorVisible: false,
    editorContent: '',
    editorContentCount: 0,
    editorMood: '',
    customMood: '',
    editorTags: [],
    tagDraft: '',
    editorImages: [],
    completedItems: [],
    summaryText: '正在同步今日完成摘要...',
    moodOptions: MOOD_OPTIONS,
    diaryTags: DEFAULT_DIARY_TAGS,
    entryList: [],
    entryCountText: '0 条记录',
    totalDiariesText: '0',
    streakText: '连续 0 天'
  };
}

Page({
  data: createInitialState(),

  onShow() {
    syncTabBar(this, 'diary');
    this.loadDiaryDashboard(this.data.selectedDate);
  },

  onHide() {
    clearToast(this);
  },

  onUnload() {
    clearToast(this);
    this._diaryRequestId = 0;
  },

  async loadDiaryDashboard(selectedDate) {
    if (!withLoginGate(this, {
      mode: 'passive',
      message: '请先登录后再查看日记。',
      resetLoadingField: 'loading'
    })) {
      return;
    }

    this.setData({ loading: true });
    const requestId = createRequestToken(this, '_diaryRequestId');

    try {
      const user = await app.ensureUserSession();
      if (!user || !isActiveRequest(this, '_diaryRequestId', requestId)) {
        throw new Error('SESSION_INIT_FAILED');
      }

      const [result, detailResult] = await Promise.all([
        app.api.diary.getList(selectedDate),
        app.api.calendar && app.api.calendar.getDetail
          ? app.api.calendar.getDetail(selectedDate)
          : app.api.daily.getDetail(selectedDate)
      ]);
      if (!isActiveRequest(this, '_diaryRequestId', requestId)) return;

      if (!result || !result.success) {
        throw new Error((result && result.message) || 'DIARY_LOAD_FAILED');
      }

      const stats = result.stats || {};
      const month = getMonthMeta(selectedDate);
      const diaryDates = (result.diaryDates || []);
      const entryList = buildEntryList(result.recentEntries || []);
      const cells = buildCalendarCells(month, diaryDates, selectedDate, getTodayString());

      this.setData({
        selectedDate,
        monthLabel: month.monthLabel,
        calendarCells: cells,
        diaryDates,
        entryList,
        entryCountText: `${entryList.length} 条记录`,
        totalDiariesText: String(stats.totalDiaries || 0),
        streakText: `连续 ${stats.currentStreak || 0} 天`,
        summaryText: buildDailySummaryText(selectedDate, detailResult),
        completedItems: buildCompletedItems(detailResult),
        loading: false
      });
    } catch (error) {
      console.error('[version2/diary] 加载失败:', error);
      showChaosToast(this, '日记本加载失败，稍后再试。', 2200);
      this.setData({ loading: false });
    }
  },

  onSelectDay(e) {
    const { date } = e.currentTarget.dataset;
    if (!date) return;

    const cells = this.data.calendarCells.map((cell) => {
      if (cell.key === date) {
        return { ...cell, selected: true };
      }
      if (cell.selected) {
        return { ...cell, selected: false };
      }
      return cell;
    });

    this.setData({ selectedDate: date, calendarCells: cells });
    this.loadDiaryDashboard(date);
  },

  onPrevMonth() {
    const nextDate = addMonths(this.data.selectedDate, -1);
    this.loadDiaryDashboard(nextDate);
  },

  onNextMonth() {
    const currentMonthStart = getTodayString().slice(0, 7);
    const nextDate = addMonths(this.data.selectedDate, 1);
    if (nextDate.slice(0, 7) > currentMonthStart) {
      showChaosToast(this, '未来月份先别偷看。', 1500);
      return;
    }
    this.loadDiaryDashboard(nextDate);
  },

  onOpenEditor() {
    if (!withLoginGate(this, { mode: 'action' })) return;
    this.setData({
      editorVisible: false
    });
  },

  onCloseEditor() {
    this.setData({ editorVisible: false });
  },

  noop() {},

  onEditorInput(e) {
    const value = e.detail.value;
    const nextTags = mergeTags(this.data.editorTags, extractContentTags(value));
    this.setData({
      editorContent: value,
      editorContentCount: String(value || '').length,
      editorTags: nextTags
    });
  },

  onMoodPick(e) {
    const { mood } = e.currentTarget.dataset;
    this.setData({
      editorMood: this.data.editorMood === mood ? '' : mood,
      customMood: ''
    });
  },

  onCustomMoodInput(e) {
    const value = String(e.detail.value || '').slice(0, 12);
    this.setData({
      customMood: value,
      editorMood: value ? 'custom' : this.data.editorMood
    });
  },

  onTagToggle(e) {
    const { tag } = e.currentTarget.dataset;
    const normalized = normalizeTag(tag);
    if (!normalized) {
      return;
    }
    const tags = this.data.editorTags.slice();
    const idx = tags.indexOf(normalized);
    if (idx >= 0) {
      tags.splice(idx, 1);
    } else if (tags.length < MAX_TAG_COUNT) {
      tags.push(normalized);
    }
    this.setData({ editorTags: tags });
  },

  onTagDraftInput(e) {
    this.setData({ tagDraft: formatTagDraft(e.detail.value) });
  },

  onTagDraftConfirm() {
    const tag = formatTagDraft(this.data.tagDraft);
    if (!tag) {
      return;
    }

    if ((this.data.editorTags || []).indexOf(tag) >= 0) {
      this.setData({ tagDraft: '' });
      return;
    }

    if ((this.data.editorTags || []).length >= MAX_TAG_COUNT) {
      showChaosToast(this, `最多保留 ${MAX_TAG_COUNT} 个标签。`, 1500);
      return;
    }

    this.setData({
      editorTags: (this.data.editorTags || []).concat(tag),
      tagDraft: ''
    });
  },

  async onChooseImages() {
    if (this.data.editorImages.length >= MAX_IMAGE_COUNT) {
      showChaosToast(this, '最多先贴 4 张图。', 1500);
      return;
    }

    const remainCount = MAX_IMAGE_COUNT - this.data.editorImages.length;

    try {
      const result = await new Promise((resolve, reject) => {
        const options = {
          count: remainCount,
          sizeType: ['compressed'],
          sourceType: ['album', 'camera'],
          success: resolve,
          fail: reject
        };

        if (wx.chooseMedia) {
          wx.chooseMedia({
            count: remainCount,
            mediaType: ['image'],
            sourceType: ['album', 'camera'],
            sizeType: ['compressed'],
            success: resolve,
            fail: reject
          });
        } else {
          wx.chooseImage(options);
        }
      });

      const files = result.tempFiles || (result.tempFilePaths || []).map((path) => ({ path }));
      const nextImages = this.data.editorImages.concat(
        files.slice(0, remainCount).map((file) => createImageItem(file.tempFilePath || file.path))
      );

      this.setData({ editorImages: nextImages });
    } catch (error) {
      if (error && String(error.errMsg || '').indexOf('cancel') >= 0) {
        return;
      }
      console.error('[version2/diary] 选择图片失败:', error);
      showChaosToast(this, '图片选择失败，稍后再试。', 1800);
    }
  },

  onRemoveImage(e) {
    const { key } = e.currentTarget.dataset;
    this.setData({
      editorImages: (this.data.editorImages || []).filter((item) => item.key !== key)
    });
  },

  async uploadDiaryImages() {
    const images = this.data.editorImages || [];
    if (!images.length) {
      return [];
    }

    if (!wx.cloud || !wx.cloud.uploadFile) {
      throw new Error('CLOUD_UPLOAD_UNAVAILABLE');
    }

    const uploaded = [];
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      if (image.fileID) {
        uploaded.push(image);
        continue;
      }

      const filePath = image.tempFilePath || image.url;
      if (!filePath) {
        continue;
      }

      const extensionMatch = filePath.match(/\.(\w+)(?:\?|$)/);
      const extension = extensionMatch ? extensionMatch[1] : 'jpg';
      const cloudPath = `version2/diary/${this.data.selectedDate}/${Date.now()}-${index}-${Math.random().toString(16).slice(2, 8)}.${extension}`;
      const uploadResult = await wx.cloud.uploadFile({ cloudPath, filePath });
      if (!uploadResult || !uploadResult.fileID) {
        throw new Error('DIARY_IMAGE_UPLOAD_FAILED');
      }

      uploaded.push({
        ...image,
        fileID: uploadResult.fileID,
        cloudPath,
        url: uploadResult.fileID
      });
    }

    return uploaded;
  },

  async onSubmitDiary() {
    const content = this.data.editorContent.trim();
    if (!content) {
      showChaosToast(this, '先写点什么，不然病历是空的。', 1500);
      return;
    }

    if (this.data.submitting) return;

    this.setData({ submitting: true });

    try {
      const uploadedImages = await this.uploadDiaryImages();
      const tags = mergeTags(this.data.editorTags, extractContentTags(content));
      const moodText = String(this.data.customMood || '').trim();
      const result = await app.api.diary.save({
        content,
        mood: moodText || this.data.editorMood,
        customMood: moodText,
        tags,
        completedItems: this.data.completedItems,
        imageIds: uploadedImages.map((item) => item.fileID).filter(Boolean),
        imagePaths: uploadedImages.map((item) => item.cloudPath || item.tempFilePath).filter(Boolean),
        images: uploadedImages.map((item) => ({
          fileID: item.fileID,
          cloudPath: item.cloudPath,
          tempFilePath: item.tempFilePath
        })),
        date: this.data.selectedDate
      });

      if (!result || !result.success) {
        throw new Error((result && result.message) || 'DIARY_SAVE_FAILED');
      }

      showChaosToast(this, '病历已归档。', 1600);
      this.setData({
        submitting: false,
        editorImages: uploadedImages,
        editorTags: tags,
        tagDraft: '',
        editorContent: '',
        editorContentCount: 0,
        editorMood: '',
        customMood: '',
        editorImages: []
      });
      this.loadDiaryDashboard(this.data.selectedDate);
    } catch (error) {
      console.error('[version2/diary] 保存失败:', error);
      showChaosToast(this, '归档失败，稍后再试。', 2000);
      this.setData({ submitting: false });
    }
  },

  onAppLogout() {
    applyPageReset(this, createInitialState, (page) => clearRequestToken(page, '_diaryRequestId'));
  },

  onBack() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({ url: '/pages/profile/profile' });
      }
    });
  }
});
