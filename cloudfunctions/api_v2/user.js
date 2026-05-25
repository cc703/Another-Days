const {
  applyAchievementCount,
  buildAchievements,
  buildCheckInStats,
  buildLevelStats,
  buildWeekTrend,
  checkContent,
  db,
  listAllByOpenId,
  listRecentByOpenId,
  normalizeDateString,
  persistStatsIfChanged,
  requireUser,
  toSafeNumber,
  RECENT_FOCUS_LIMIT
} = require('./shared');
const { buildChinaReminderSchedule } = require('./notification');

const REMINDER_OUTBOX_COLLECTION = 'reminder_outbox';
const REMINDER_CHANNEL = 'study_reminder';
const DEFAULT_REMINDER_PAGE = 'pages/profile/profile';
const DEFAULT_REMINDER_FIELD_MAP = {
  title: 'thing1',
  time: 'date3',
  phrase: 'thing4'
};

function buildReminderSchedule(reminderTime, now) {
  return buildChinaReminderSchedule(reminderTime, now);
}

function normalizeReminderFieldMap(fieldMap) {
  const source = fieldMap && typeof fieldMap === 'object' ? fieldMap : {};
  return {
    title: String(source.title || DEFAULT_REMINDER_FIELD_MAP.title).trim(),
    time: String(source.time || DEFAULT_REMINDER_FIELD_MAP.time).trim(),
    phrase: String(source.phrase || DEFAULT_REMINDER_FIELD_MAP.phrase).trim()
  };
}

async function getUserStats() {
  const ensured = await requireUser();
  if (!ensured.success) {
    return ensured;
  }

  const { openid } = ensured;
  let { user } = ensured;
  const todayDate = normalizeDateString();
  const checkIns = await listAllByOpenId('habit_checkins', openid, 'date', 'desc');
  const sessions = await listRecentByOpenId('focus_sessions', openid, RECENT_FOCUS_LIMIT, 'createdAt');
  const streakStats = buildCheckInStats(checkIns.map((item) => item.date), todayDate);
  const baseStats = buildLevelStats({
    ...(user.stats || {}),
    ...streakStats
  });
  const nextStats = applyAchievementCount(baseStats, user);
  user = await persistStatsIfChanged(user, nextStats);

  const todaySessions = sessions.filter((item) => item.date === todayDate);
  const weekMeta = buildWeekTrend(checkIns, sessions, todayDate);

  return {
    success: true,
    stats: nextStats,
    today: {
      date: todayDate,
      checkedIn: checkIns.some((item) => item.date === todayDate),
      focusMinutes: todaySessions.reduce((sum, item) => sum + toSafeNumber(item.duration), 0),
      focusSessions: todaySessions.length
    },
    weekTrend: weekMeta.trend,
    weekTrendMax: weekMeta.maxScore,
    badges: buildAchievements(nextStats, user).achievements,
    recentCheckIns: checkIns.slice(0, 6),
    settings: user.settings || {}
  };
}

async function updateSettings(event) {
  const ensured = await requireUser();
  if (!ensured.success) {
    return ensured;
  }

  const { user } = ensured;
  const incomingSettings = event && typeof event.settings === 'object' ? event.settings : null;

  if (!incomingSettings) {
    return {
      success: false,
      error: 'INVALID_SETTINGS',
      message: '请提供有效设置'
    };
  }

  const nextSettings = {
    ...(user.settings || {}),
    ...incomingSettings
  };

  await db.collection('users').doc(user._id).update({
    data: {
      settings: nextSettings,
      updatedAt: Date.now()
    }
  });

  await syncReminderOutbox(ensured.openid, user._id, nextSettings);

  return {
    success: true,
    settings: nextSettings,
    user: {
      ...user,
      settings: nextSettings
    }
  };
}

async function syncReminderOutbox(openid, userId, settings) {
  const reminderTime = String((settings && settings.reminderTime) || '').trim();
  const reminderEnabled = Boolean(settings && settings.dailyReminderEnabled);
  const templateId = String((settings && settings.reminderTemplateId) || '').trim();

  try {
    const existing = await db.collection(REMINDER_OUTBOX_COLLECTION)
      .where({
        _openid: openid,
        channel: REMINDER_CHANNEL
      })
      .limit(1)
      .get();

    const existingRow = existing.data && existing.data[0] ? existing.data[0] : null;
    const now = Date.now();
    const scheduledAt = buildReminderSchedule(reminderTime, now);
    const basePayload = {
      reminderTime,
      title: '学习提醒',
      phrase: '到点了，回来学习。',
      page: String((settings && settings.reminderPage) || DEFAULT_REMINDER_PAGE).trim() || DEFAULT_REMINDER_PAGE,
      fieldMap: normalizeReminderFieldMap(settings && settings.reminderFieldMap)
    };

    if (!reminderEnabled || !reminderTime || !templateId) {
      if (existingRow && existingRow._id) {
        await db.collection(REMINDER_OUTBOX_COLLECTION).doc(existingRow._id).update({
          data: {
            status: 'disabled',
            updatedAt: now,
            payload: basePayload
          }
        });
      }
      return;
    }

    if (existingRow && existingRow._id) {
      await db.collection(REMINDER_OUTBOX_COLLECTION).doc(existingRow._id).update({
          data: {
            userId,
            status: 'pending',
            scheduledAt,
            updatedAt: now,
            payload: basePayload
          }
      });
      return;
    }

    await db.collection(REMINDER_OUTBOX_COLLECTION).add({
      data: {
        _openid: openid,
        userId,
        channel: REMINDER_CHANNEL,
        type: 'daily_reminder',
        status: 'pending',
        scheduledAt,
        createdAt: now,
        updatedAt: now,
        payload: basePayload
      }
    });
  } catch (error) {
    console.warn('[version2/api] 提醒出站队列同步失败:', error);
  }
}

async function getSettings() {
  const ensured = await requireUser();
  if (!ensured.success) {
    return ensured;
  }

  return {
    success: true,
    settings: ensured.user.settings || {}
  };
}

async function createNotificationOutbox(openid, feedback, createdAt, event) {
  const safeFeedback = feedback && typeof feedback === 'object' ? feedback : {};
  const channel = String((event && event.channel) || 'owner_email').trim().slice(0, 40);
  const target = String((event && event.target) || '').trim().slice(0, 120);

  try {
    await db.collection('notification_outbox').add({
      data: {
        _openid: openid,
        type: 'feedback',
        channel,
        target,
        status: 'pending',
        payload: {
          feedbackId: String(safeFeedback.feedbackId || '').slice(0, 120),
          content: String(safeFeedback.content || '').slice(0, 500),
          contact: String(safeFeedback.contact || '').slice(0, 80),
          page: String(safeFeedback.page || '').slice(0, 80)
        },
        createdAt,
        updatedAt: createdAt
      }
    });

    return true;
  } catch (error) {
    const message = String((error && (error.message || error.errMsg)) || '').toLowerCase();
    if (message.includes('collection') && (message.includes('not exist') || message.includes('不存在'))) {
      console.warn('[version2/api] notification_outbox 集合未创建，反馈已保存但未排队通知。');
      return false;
    }

    console.warn('[version2/api] 通知出站队列写入失败:', error);
    return false;
  }
}

async function submitFeedback(event) {
  const ensured = await requireUser();
  if (!ensured.success) {
    return ensured;
  }

  const content = String((event && event.content) || '').trim();

  if (!content) {
    return {
      success: false,
      error: 'EMPTY_FEEDBACK',
      message: '请先填写反馈内容'
    };
  }

  const check = await checkContent(content);
  if (!check.safe) {
    return {
      success: false,
      error: check.error,
      message: check.message
    };
  }

  const safeContent = content.slice(0, 500);
  const contact = String((event && event.contact) || '').trim().slice(0, 80);
  const page = String((event && event.page) || '').trim().slice(0, 80);
  const createdAt = Date.now();
  let feedbackId = '';
  let notificationQueued = false;

  try {
    const addResult = await db.collection('user_feedback').add({
      data: {
        _openid: ensured.openid,
        content: safeContent,
        contact,
        page,
        createdAt,
        status: 'new'
      }
    });
    feedbackId = addResult._id || '';
    notificationQueued = await createNotificationOutbox(
      ensured.openid,
      {
        feedbackId,
        content: safeContent,
        contact,
        page
      },
      createdAt,
      event
    );

    return {
      success: true,
      feedbackId,
      notificationQueued,
      message: '反馈已收到'
    };
  } catch (error) {
    console.warn('[version2/api] 反馈集合写入失败，改为写入 users 兜底字段:', error);

    await db.collection('users').doc(ensured.user._id).update({
      data: {
        lastFeedback: {
          content: safeContent,
          contact,
          page,
          createdAt,
          status: 'new',
          source: 'fallback'
        },
        updatedAt: createdAt
      }
    });
    notificationQueued = await createNotificationOutbox(
      ensured.openid,
      {
        feedbackId: 'fallback-user-lastFeedback',
        content: safeContent,
        contact,
        page
      },
      createdAt,
      event
    );

    return {
      success: true,
      feedbackId,
      notificationQueued,
      message: '反馈已收到'
    };
  }
}

module.exports = {
  getSettings,
  getUserStats,
  submitFeedback,
  updateSettings
};
