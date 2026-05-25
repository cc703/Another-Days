const { addDays, getMonthMeta, normalizeDateString } = require('./date-shared');
const {
  RECENT_FOCUS_LIMIT,
  applyAchievementCount,
  buildAchievements,
  buildCheckInStats,
  buildLevelStats,
  buildWeekTrend,
  toSafeNumber
} = require('./stats-shared');
const {
  buildMissingCollectionResponse,
  db,
  findOneByCondition,
  isCollectionMissingError,
  listAllByOpenId,
  listByOpenIdAndDate,
  listRecentByOpenId
} = require('./db-shared');
const { checkContent, requireUser } = require('./user-guard');

async function persistUserStats(user, nextStats, extraPatch) {
  const payload = {
    stats: nextStats,
    updatedAt: Date.now(),
    ...(extraPatch || {})
  };

  await db.collection('users').doc(user._id).update({
    data: payload
  });

  return {
    ...user,
    ...extraPatch,
    stats: nextStats,
    updatedAt: payload.updatedAt
  };
}

async function persistStatsIfChanged(user, nextStats, extraPatch) {
  if (JSON.stringify(user.stats || {}) === JSON.stringify(nextStats)) {
    return {
      ...user,
      ...(extraPatch || {}),
      stats: nextStats
    };
  }

  return persistUserStats(user, nextStats, extraPatch);
}

async function awardUserStats(user, patch, extraPatch) {
  const currentStats = buildLevelStats(user.stats || {});
  const nextStats = applyAchievementCount({
    ...currentStats,
    ...(patch || {})
  }, user);
  const nextUser = await persistUserStats(user, nextStats, extraPatch);

  return {
    user: nextUser,
    stats: nextStats
  };
}

module.exports = {
  RECENT_FOCUS_LIMIT,
  addDays,
  applyAchievementCount,
  awardUserStats,
  buildAchievements,
  buildCheckInStats,
  buildLevelStats,
  buildMissingCollectionResponse,
  buildWeekTrend,
  checkContent,
  db,
  findOneByCondition,
  getMonthMeta,
  isCollectionMissingError,
  listAllByOpenId,
  listByOpenIdAndDate,
  listRecentByOpenId,
  normalizeDateString,
  persistStatsIfChanged,
  requireUser,
  toSafeNumber
};
