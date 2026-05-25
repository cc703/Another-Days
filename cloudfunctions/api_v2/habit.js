const {
  awardUserStats,
  buildCheckInStats,
  buildLevelStats,
  buildMissingCollectionResponse,
  db,
  findOneByCondition,
  getMonthMeta,
  isCollectionMissingError,
  listAllByOpenId,
  normalizeDateString,
  persistStatsIfChanged,
  requireUser
} = require('./shared');

async function getHabitDashboard(event) {
  const ensured = await requireUser();
  if (!ensured.success) {
    return ensured;
  }

  const { openid, user } = ensured;
  const anchorDate = normalizeDateString((event && event.date) || Date.now());
  const todayDate = normalizeDateString();
  const allCheckIns = await listAllByOpenId('habit_checkins', openid, 'date', 'desc');
  const monthMeta = getMonthMeta(anchorDate);
  const monthCheckIns = allCheckIns.filter(
    (item) => item.date >= monthMeta.firstDate && item.date <= monthMeta.lastDate
  );
  const streakStats = buildCheckInStats(allCheckIns.map((item) => item.date), todayDate);
  const nextStats = buildLevelStats({
    ...(user.stats || {}),
    ...streakStats
  });

  await persistStatsIfChanged(user, nextStats);

  return {
    success: true,
    date: anchorDate,
    todayDate,
    month: monthMeta,
    checkedDates: monthCheckIns.map((item) => item.date),
    todayCheckedIn: allCheckIns.some((item) => item.date === todayDate),
    selectedCheckedIn: allCheckIns.some((item) => item.date === anchorDate),
    recentCheckIns: allCheckIns.slice(0, 8),
    stats: nextStats
  };
}

async function checkIn(event) {
  const ensured = await requireUser();
  if (!ensured.success) {
    return ensured;
  }

  const { openid, user } = ensured;
  const targetDate = normalizeDateString((event && event.date) || Date.now());
  const todayDate = normalizeDateString();

  if (targetDate > todayDate) {
    return {
      success: false,
      error: 'FUTURE_DATE',
      message: '不能为未来日期打卡'
    };
  }

  const existing = await findOneByCondition('habit_checkins', {
    _openid: openid,
    date: targetDate
  });

  if (existing) {
    return {
      success: true,
      alreadyCheckedIn: true,
      message: '这天已经打过卡了'
    };
  }

  try {
    await db.collection('habit_checkins').add({
      data: {
        _openid: openid,
        date: targetDate,
        createdAt: Date.now()
      }
    });
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return buildMissingCollectionResponse('habit_checkins');
    }

    throw error;
  }

  const allCheckIns = await listAllByOpenId('habit_checkins', openid, 'date', 'desc');
  const streakStats = buildCheckInStats(allCheckIns.map((item) => item.date), todayDate);
  const currentStats = buildLevelStats(user.stats || {});
  const { stats: finalStats } = await awardUserStats(user, {
    ...streakStats,
    experience: currentStats.experience + 12
  });

  return {
    success: true,
    date: targetDate,
    stats: finalStats,
    message: targetDate === todayDate ? '今日打卡成功' : '补记成功'
  };
}

module.exports = {
  checkIn,
  getHabitDashboard
};
