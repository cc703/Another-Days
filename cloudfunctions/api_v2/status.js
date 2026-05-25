const {
  buildMissingCollectionResponse,
  checkContent,
  db,
  isCollectionMissingError,
  normalizeDateString,
  requireUser,
  toSafeNumber
} = require('./shared');

function normalizeStatusPayload(event) {
  const mood = String((event && event.mood) || '').trim().slice(0, 24);
  const customMood = String((event && event.customMood) || '').trim().slice(0, 24);
  const note = String((event && event.note) || '').trim().slice(0, 120);
  const energy = Math.max(0, Math.min(100, toSafeNumber(event && event.energy)));
  const tags = Array.isArray(event && event.tags)
    ? event.tags.map((tag) => String(tag || '').trim().slice(0, 20)).filter(Boolean).slice(0, 8)
    : [];

  return {
    mood,
    customMood,
    note,
    energy,
    tags
  };
}

async function getDailyStatus(event) {
  const ensured = await requireUser();
  if (!ensured.success) {
    return ensured;
  }

  const date = normalizeDateString((event && event.date) || Date.now());

  try {
    const result = await db.collection('daily_status')
      .where({
        _openid: ensured.openid,
        date
      })
      .limit(1)
      .get();

    return {
      success: true,
      date,
      status: result.data && result.data[0] ? result.data[0] : null,
      collectionMissing: false
    };
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return {
        success: true,
        date,
        status: null,
        collectionMissing: true,
        message: '请先创建 daily_status 集合。'
      };
    }

    throw error;
  }
}

async function saveDailyStatus(event) {
  const ensured = await requireUser();
  if (!ensured.success) {
    return ensured;
  }

  const date = normalizeDateString((event && event.date) || Date.now());
  const payload = normalizeStatusPayload(event);

  if (!payload.mood && !payload.customMood && !payload.note) {
    return {
      success: false,
      error: 'EMPTY_STATUS',
      message: '请先选择或填写今日状态'
    };
  }

  const textForCheck = [payload.mood, payload.customMood, payload.note, ...payload.tags]
    .filter(Boolean)
    .join(' ');
  const check = await checkContent(textForCheck);
  if (!check.safe) {
    return {
      success: false,
      error: check.error,
      message: check.message
    };
  }

  const now = Date.now();

  try {
    const existing = await db.collection('daily_status')
      .where({
        _openid: ensured.openid,
        date
      })
      .limit(1)
      .get();
    const row = existing.data && existing.data[0] ? existing.data[0] : null;
    const data = {
      ...payload,
      date,
      updatedAt: now
    };

    if (row) {
      await db.collection('daily_status').doc(row._id).update({
        data
      });

      return {
        success: true,
        date,
        status: {
          ...row,
          ...data
        }
      };
    }

    const addResult = await db.collection('daily_status').add({
      data: {
        _openid: ensured.openid,
        ...data,
        createdAt: now
      }
    });

    return {
      success: true,
      date,
      status: {
        _id: addResult._id,
        _openid: ensured.openid,
        ...data,
        createdAt: now
      }
    };
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return buildMissingCollectionResponse('daily_status');
    }

    throw error;
  }
}

module.exports = {
  getDailyStatus,
  saveDailyStatus
};
