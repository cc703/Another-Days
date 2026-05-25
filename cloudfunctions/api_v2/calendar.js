const {
  db,
  isCollectionMissingError,
  listByOpenIdAndDate,
  normalizeDateString,
  requireUser,
  toSafeNumber
} = require('./shared');

async function getDailyStatus(openid, date) {
  try {
    const result = await db.collection('daily_status')
      .where({
        _openid: openid,
        date
      })
      .limit(1)
      .get();

    return {
      row: result.data && result.data[0] ? result.data[0] : null,
      collectionMissing: false
    };
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return {
        row: null,
        collectionMissing: true
      };
    }

    throw error;
  }
}

function summarizeFocusSessions(sessions) {
  return {
    totalMinutes: sessions.reduce((sum, item) => sum + toSafeNumber(item.duration), 0),
    totalSessions: sessions.length
  };
}

async function getCalendarDetail(event) {
  const ensured = await requireUser();
  if (!ensured.success) {
    return ensured;
  }

  const date = normalizeDateString((event && event.date) || Date.now());
  const [taskResult, focusResult, diaryResult, statusResult] = await Promise.all([
    listByOpenIdAndDate('goal_items', ensured.openid, date, 100, 'createdAt'),
    listByOpenIdAndDate('focus_sessions', ensured.openid, date, 100, 'createdAt'),
    listByOpenIdAndDate('diary_entries', ensured.openid, date, 100, 'createdAt'),
    getDailyStatus(ensured.openid, date)
  ]);
  const missingCollections = [];

  if (taskResult.collectionMissing) {
    missingCollections.push('goal_items');
  }
  if (focusResult.collectionMissing) {
    missingCollections.push('focus_sessions');
  }
  if (diaryResult.collectionMissing) {
    missingCollections.push('diary_entries');
  }
  if (statusResult.collectionMissing) {
    missingCollections.push('daily_status');
  }

  const focusSummary = summarizeFocusSessions(focusResult.rows);

  return {
    success: true,
    date,
    tasks: taskResult.rows,
    focusSessions: focusResult.rows,
    focusSummary,
    diaries: diaryResult.rows,
    diaryEntries: diaryResult.rows,
    dailyStatus: statusResult.row,
    collectionMissing: missingCollections.length > 0,
    missingCollections
  };
}

module.exports = {
  getCalendarDetail
};
