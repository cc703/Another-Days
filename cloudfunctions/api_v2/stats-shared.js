const { addDays, parseDate } = require('./date-shared');

const EXPERIENCE_PER_LEVEL = 100;
const RECENT_FOCUS_LIMIT = 180;
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

function toSafeNumber(value) {
  return Math.max(0, Number(value) || 0);
}

function buildLevelStats(stats) {
  const raw = stats || {};
  const experience = toSafeNumber(raw.experience);
  const experienceProgress = experience % EXPERIENCE_PER_LEVEL;

  return {
    totalCheckIns: toSafeNumber(raw.totalCheckIns),
    currentStreak: toSafeNumber(raw.currentStreak),
    longestStreak: toSafeNumber(raw.longestStreak),
    totalFocusMinutes: toSafeNumber(raw.totalFocusMinutes),
    totalFocusSessions: toSafeNumber(raw.totalFocusSessions),
    totalDiaries: toSafeNumber(raw.totalDiaries),
    totalAchievements: toSafeNumber(raw.totalAchievements),
    experience,
    level: Math.floor(experience / EXPERIENCE_PER_LEVEL) + 1,
    experienceProgress,
    experienceToNext: experienceProgress === 0 ? EXPERIENCE_PER_LEVEL : EXPERIENCE_PER_LEVEL - experienceProgress
  };
}

function countConsecutiveTail(sortedDates) {
  if (!sortedDates.length) {
    return 0;
  }

  let count = 1;

  for (let index = sortedDates.length - 1; index > 0; index -= 1) {
    if (addDays(sortedDates[index - 1], 1) === sortedDates[index]) {
      count += 1;
      continue;
    }

    break;
  }

  return count;
}

function buildCheckInStats(dates, todayDate) {
  const uniqueDates = Array.from(new Set((dates || []).filter(Boolean))).sort();

  if (!uniqueDates.length) {
    return {
      totalCheckIns: 0,
      currentStreak: 0,
      longestStreak: 0
    };
  }

  let longestStreak = 1;
  let running = 1;

  for (let index = 1; index < uniqueDates.length; index += 1) {
    if (addDays(uniqueDates[index - 1], 1) === uniqueDates[index]) {
      running += 1;
      if (running > longestStreak) {
        longestStreak = running;
      }
      continue;
    }

    running = 1;
  }

  const lastDate = uniqueDates[uniqueDates.length - 1];
  const yesterday = addDays(todayDate, -1);
  const currentStreak = (lastDate === todayDate || lastDate === yesterday)
    ? countConsecutiveTail(uniqueDates)
    : 0;

  return {
    totalCheckIns: uniqueDates.length,
    currentStreak,
    longestStreak
  };
}

function isGeneratedNickName(nickName) {
  return /^用户[\da-zA-Z]{6}$/.test(String(nickName || '').trim());
}

function hasProfileBadge(user) {
  const safeNickName = String((user && user.nickName) || '').trim();
  const avatarUrl = String((user && user.avatarUrl) || '').trim();
  const hasName = safeNickName && safeNickName !== '备考残像' && safeNickName !== '微信用户' && !isGeneratedNickName(safeNickName);

  return Boolean(avatarUrl && hasName);
}

function buildAchievements(stats, user) {
  const profileReady = hasProfileBadge(user) ? 1 : 0;
  const list = [
    { key: 'first_checkin', title: '第一滴鸡血', desc: '完成 1 次打卡', tone: 'amber', current: stats.totalCheckIns, target: 1 },
    { key: 'streak_3', title: '连着挣扎三天', desc: '连续打卡达到 3 天', tone: 'mint', current: stats.longestStreak, target: 3 },
    { key: 'focus_100', title: '坐牢一百分钟', desc: '累计专注时长达到 100 分钟', tone: 'hot', current: stats.totalFocusMinutes, target: 100 },
    { key: 'focus_sessions_10', title: '十轮硬撑', desc: '累计完成 10 次专注轮次', tone: 'cool', current: stats.totalFocusSessions, target: 10 },
    { key: 'level_3', title: '残像升级', desc: '等级达到 Lv.3', tone: 'violet', current: stats.level, target: 3 },
    { key: 'profile_ready', title: '有脸有名', desc: '同步头像和昵称', tone: 'paper', current: profileReady, target: 1 }
  ];

  const achievements = list.map((item) => {
    const progress = Math.min(item.current, item.target);
    const progressPercent = item.target > 0
      ? Math.min(100, Math.round((progress / item.target) * 100))
      : 100;

    return {
      ...item,
      progress,
      progressPercent,
      earned: item.current >= item.target
    };
  });

  return {
    achievements,
    earnedCount: achievements.filter((item) => item.earned).length
  };
}

function applyAchievementCount(stats, user) {
  const levelStats = buildLevelStats(stats);
  const achievementMeta = buildAchievements(levelStats, user);

  return buildLevelStats({
    ...levelStats,
    totalAchievements: achievementMeta.earnedCount
  });
}

function buildWeekTrend(checkIns, sessions, todayDate) {
  const dateList = [];
  const trendMap = {};

  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = addDays(todayDate, -offset);
    const weekday = WEEKDAY_LABELS[parseDate(date).getDay()];

    dateList.push(date);
    trendMap[date] = {
      date,
      label: date.slice(5),
      weekday,
      checkIn: false,
      focusMinutes: 0,
      focusSessions: 0,
      score: 0
    };
  }

  (checkIns || []).forEach((item) => {
    if (item && trendMap[item.date]) {
      trendMap[item.date].checkIn = true;
    }
  });

  (sessions || []).forEach((item) => {
    if (item && trendMap[item.date]) {
      trendMap[item.date].focusMinutes += toSafeNumber(item.duration);
      trendMap[item.date].focusSessions += 1;
    }
  });

  const trend = dateList.map((date) => {
    const item = trendMap[date];
    item.score = item.focusMinutes + (item.checkIn ? 20 : 0);
    return item;
  });

  const maxScore = trend.reduce((max, item) => Math.max(max, item.score), 0);

  return {
    trend,
    maxScore: maxScore || 1
  };
}

module.exports = {
  RECENT_FOCUS_LIMIT,
  applyAchievementCount,
  buildAchievements,
  buildCheckInStats,
  buildLevelStats,
  buildWeekTrend,
  toSafeNumber
};
