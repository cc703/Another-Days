const {
  addDays,
  RECENT_FOCUS_LIMIT,
  awardUserStats,
  buildLevelStats,
  buildMissingCollectionResponse,
  buildWeekTrend,
  checkContent,
  db,
  isCollectionMissingError,
  listAllByOpenId,
  listRecentByOpenId,
  normalizeDateString,
  requireUser,
  toSafeNumber
} = require('./shared');

const DAY_MS = 24 * 60 * 60 * 1000;

function resolvePeriodRange(period, event, todayDate) {
  const explicitDate = event && event.date;
  if (explicitDate) {
    const date = normalizeDateString(explicitDate);
    return {
      startDate: date,
      endDate: date
    };
  }

  if (period === 'month') {
    const startDate = todayDate.slice(0, 8) + '01';
    return {
      startDate,
      endDate: todayDate
    };
  }

  if (period === 'all' || period === 'total') {
    return {
      startDate: '1970-01-01',
      endDate: todayDate
    };
  }

  return {
    startDate: addDays(todayDate, -6),
    endDate: todayDate
  };
}

function buildFocusTrend(sessions, startDate, endDate) {
  const trendMap = {};
  const trend = [];
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const days = Math.max(1, Math.min(31, Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1));

  for (let index = 0; index < days; index += 1) {
    const date = addDays(startDate, index);
    trendMap[date] = {
      date,
      label: date.slice(5),
      weekday: date.slice(5),
      checkIn: false,
      focusMinutes: 0,
      focusSessions: 0,
      score: 0
    };
    trend.push(trendMap[date]);
  }

  (sessions || []).forEach((item) => {
    if (!item || !trendMap[item.date]) {
      return;
    }
    trendMap[item.date].focusMinutes += toSafeNumber(item.duration);
    trendMap[item.date].focusSessions += 1;
  });

  trend.forEach((item) => {
    item.score = item.focusMinutes;
  });

  const maxScore = trend.reduce((max, item) => Math.max(max, item.score), 0);
  return {
    trend,
    maxScore: maxScore || 1
  };
}

async function getFocusStats(event) {
  const ensured = await requireUser();
  if (!ensured.success) {
    return ensured;
  }

  const { openid, user } = ensured;
  const period = String((event && event.period) || 'day').trim() || 'day';
  const todayDate = normalizeDateString();
  const needsFullRange = period === 'month' || period === 'all' || period === 'total' || !!(event && event.date);
  const sessions = needsFullRange
    ? await listAllByOpenId('focus_sessions', openid, 'createdAt', 'desc')
    : await listRecentByOpenId('focus_sessions', openid, RECENT_FOCUS_LIMIT, 'createdAt');
  const todaySessions = sessions.filter((item) => item.date === todayDate);
  const weekMeta = buildWeekTrend([], sessions, todayDate);
  const range = resolvePeriodRange(period, event, todayDate);
  const periodSessions = sessions.filter((item) =>
    item && item.date >= range.startDate && item.date <= range.endDate
  );
  const focusTrend = buildFocusTrend(periodSessions, range.startDate, range.endDate);
  const stats = buildLevelStats(user.stats || {});
  const periodMinutes = periodSessions.reduce((sum, item) => sum + toSafeNumber(item.duration), 0);

  return {
    success: true,
    period,
    startDate: range.startDate,
    endDate: range.endDate,
    todayMinutes: todaySessions.reduce((sum, item) => sum + toSafeNumber(item.duration), 0),
    todaySessions: todaySessions.length,
    focusMinutes: periodMinutes,
    focusSessions: periodSessions.length,
    periodMinutes,
    periodSessions: periodSessions.length,
    totalMinutes: stats.totalFocusMinutes,
    totalSessions: stats.totalFocusSessions,
    trend: period === 'week' || period === 'day' ? weekMeta.trend : focusTrend.trend,
    trendMax: period === 'week' || period === 'day' ? weekMeta.maxScore : focusTrend.maxScore
  };
}

async function logFocus(event) {
  const ensured = await requireUser();
  if (!ensured.success) {
    return ensured;
  }

  const { openid, user } = ensured;
  const duration = Math.max(1, Math.min(240, toSafeNumber(event && event.duration)));
  const task = String((event && event.task) || '').trim().slice(0, 40);
  const category = String((event && event.category) || '学习').trim().slice(0, 20);
  const mode = String((event && event.mode) || 'pomodoro').trim().slice(0, 20);
  const startTime = Number(event && event.startTime) || Date.now();
  const date = normalizeDateString(startTime);
  const todayDate = normalizeDateString();
  const maxPastDate = normalizeDateString(Date.now() - 31 * 24 * 60 * 60 * 1000);

  if (date > todayDate || date < maxPastDate) {
    return {
      success: false,
      error: 'INVALID_DATE',
      message: '专注记录日期超出范围'
    };
  }

  if (task) {
    const check = await checkContent(task);
    if (!check.safe) {
      return {
        success: false,
        error: check.error,
        message: check.message
      };
    }
  }

  try {
    await db.collection('focus_sessions').add({
      data: {
        _openid: openid,
        date,
        duration,
        task,
        category,
        mode,
        startTime,
        createdAt: Date.now()
      }
    });
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return buildMissingCollectionResponse('focus_sessions');
    }

    throw error;
  }

  const currentStats = buildLevelStats(user.stats || {});
  const { stats: finalStats } = await awardUserStats(user, {
    totalFocusMinutes: currentStats.totalFocusMinutes + duration,
    totalFocusSessions: currentStats.totalFocusSessions + 1,
    experience: currentStats.experience + Math.max(6, Math.round(duration / 5) * 2)
  });

  return {
    success: true,
    stats: finalStats,
    message: '专注记录已保存'
  };
}

module.exports = {
  getFocusStats,
  logFocus
};
