const {
  checkContent,
  db,
  isCollectionMissingError,
  listByOpenIdAndDate,
  normalizeDateString,
  requireUser
} = require('./shared');

async function listMoodTraces(event) {
  const ensured = await requireUser();
  if (!ensured.success) {
    return ensured;
  }

  const date = normalizeDateString(event && event.date);
  const result = await listByOpenIdAndDate('mood_traces', ensured.openid, date, 30, 'createdAt');

  return {
    success: true,
    date,
    traces: result.rows,
    collectionMissing: result.collectionMissing
  };
}

async function logMoodTrace(event) {
  const ensured = await requireUser();
  if (!ensured.success) {
    return ensured;
  }

  const content = String((event && event.content) || '').trim();

  if (!content) {
    return {
      success: false,
      error: 'EMPTY_MOOD',
      message: '请先写下一点心情'
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

  const safeContent = content.slice(0, 120);
  const createdAt = Date.now();
  const date = normalizeDateString((event && event.date) || createdAt);

  try {
    await db.collection('mood_traces').add({
      data: {
        _openid: ensured.openid,
        content: safeContent,
        date,
        createdAt,
        source: 'hole',
        transformed: true
      }
    });
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return {
        success: false,
        error: 'COLLECTION_MISSING',
        message: '请先创建 mood_traces 集合。'
      };
    }

    throw error;
  }

  return {
    success: true,
    date,
    trace: {
      content: safeContent,
      date,
      createdAt,
      transformed: true
    },
    message: '坏心情已被存进情绪档案'
  };
}

module.exports = {
  listMoodTraces,
  logMoodTrace
};
