const {
  awardUserStats,
  buildLevelStats,
  buildMissingCollectionResponse,
  checkContent,
  db,
  isCollectionMissingError,
  normalizeDateString,
  requireUser,
  toSafeNumber
} = require('./shared');

function normalizeStatus(value, fallback) {
  const status = String(value || fallback || 'pending').trim();
  return status === 'done' || status === 'completed' ? 'done' : 'pending';
}

function normalizeGoalPatch(event, options) {
  const source = event || {};
  const patch = {};

  if (Object.prototype.hasOwnProperty.call(source, 'title')) {
    patch.title = String(source.title || '').trim().slice(0, 40);
  }

  if (Object.prototype.hasOwnProperty.call(source, 'date')) {
    patch.date = normalizeDateString(source.date || Date.now());
  }

  if (Object.prototype.hasOwnProperty.call(source, 'status')) {
    patch.status = normalizeStatus(source.status);
    patch.completed = patch.status === 'done';
  }

  if (Object.prototype.hasOwnProperty.call(source, 'completed')) {
    patch.completed = !!source.completed;
    patch.status = patch.completed ? 'done' : 'pending';
    patch.completedAt = patch.completed ? Date.now() : null;
  }

  if (Object.prototype.hasOwnProperty.call(source, 'focusMinutes')) {
    patch.focusMinutes = Math.max(0, Math.min(1440, toSafeNumber(source.focusMinutes)));
  }

  if (Object.prototype.hasOwnProperty.call(source, 'duration')) {
    patch.focusMinutes = Math.max(0, Math.min(1440, toSafeNumber(source.duration)));
  }

  if (Object.prototype.hasOwnProperty.call(source, 'source')) {
    patch.source = String(source.source || '').trim().slice(0, 20);
  }

  if (Object.prototype.hasOwnProperty.call(source, 'category')) {
    patch.category = String(source.category || '').trim().slice(0, 20);
  }

  if (options && options.createdAt) {
    patch.createdAt = options.createdAt;
  }

  patch.updatedAt = Date.now();
  return patch;
}

function serializeGoal(row) {
  const status = normalizeStatus(row && row.status, row && row.completed ? 'done' : 'pending');

  return {
    ...(row || {}),
    status,
    completed: status === 'done' || !!(row && row.completed),
    focusMinutes: toSafeNumber(row && (row.focusMinutes || row.duration))
  };
}

async function getOwnedGoal(id, openid) {
  const result = await db.collection('goal_items')
    .where({
      _id: id,
      _openid: openid
    })
    .limit(1)
    .get();

  return result.data && result.data[0] ? result.data[0] : null;
}

async function listGoals(event) {
  const ensured = await requireUser();
  if (!ensured.success) {
    return ensured;
  }

  const { openid } = ensured;
  const targetDate = normalizeDateString((event && event.date) || Date.now());
  try {
    const result = await db.collection('goal_items')
      .where({
        _openid: openid,
        date: targetDate
      })
      .orderBy('createdAt', 'asc')
      .get();

    return {
      success: true,
      date: targetDate,
      goals: (Array.isArray(result.data) ? result.data : []).map(serializeGoal),
      collectionMissing: false
    };
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return {
        success: true,
        date: targetDate,
        goals: [],
        collectionMissing: true,
        message: '请先创建 goal_items 集合。'
      };
    }

    throw error;
  }
}

async function createGoal(event) {
  const ensured = await requireUser();
  if (!ensured.success) {
    return ensured;
  }

  const title = String((event && event.title) || '').trim().slice(0, 40);
  const date = normalizeDateString((event && event.date) || Date.now());
  const now = Date.now();
  const patch = normalizeGoalPatch(event, { createdAt: now });

  if (!title) {
    return {
      success: false,
      error: 'EMPTY_GOAL_TITLE',
      message: '请输入目标内容'
    };
  }

  const check = await checkContent(title);
  if (!check.safe) {
    return {
      success: false,
      error: check.error,
      message: check.message
    };
  }

  let addResult;

  try {
    addResult = await db.collection('goal_items').add({
      data: {
        _openid: ensured.openid,
        ...patch,
        title,
        date,
        status: patch.status || 'pending',
        completed: !!patch.completed,
        createdAt: now,
        updatedAt: now
      }
    });
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return buildMissingCollectionResponse('goal_items');
    }

    throw error;
  }

  return {
    success: true,
    goal: {
      _id: addResult._id,
      ...patch,
      title,
      date,
      status: patch.status || 'pending',
      completed: !!patch.completed,
      createdAt: now,
      updatedAt: now
    }
  };
}

async function updateGoalStatus(event) {
  const ensured = await requireUser();
  if (!ensured.success) {
    return ensured;
  }

  const id = String((event && event.id) || '').trim();
  const status = normalizeStatus(event && event.status);

  if (!id) {
    return {
      success: false,
      error: 'EMPTY_GOAL_ID',
      message: '缺少目标 ID'
    };
  }

  try {
    const existing = await getOwnedGoal(id, ensured.openid);
    if (!existing) {
      return {
        success: false,
        error: 'GOAL_NOT_FOUND',
        message: '目标不存在'
      };
    }

    await db.collection('goal_items').doc(id).update({
      data: {
        status,
        completed: status === 'done',
        updatedAt: Date.now()
      }
    });
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return buildMissingCollectionResponse('goal_items');
    }

    throw error;
  }

  return {
    success: true,
    id,
    status,
    completed: status === 'done'
  };
}

async function updateGoal(event) {
  const ensured = await requireUser();
  if (!ensured.success) {
    return ensured;
  }

  const id = String((event && event.id) || '').trim();
  if (!id) {
    return {
      success: false,
      error: 'EMPTY_GOAL_ID',
      message: '缺少目标 ID'
    };
  }

  const patch = normalizeGoalPatch(event);
  if (Object.prototype.hasOwnProperty.call(patch, 'title')) {
    if (!patch.title) {
      return {
        success: false,
        error: 'EMPTY_GOAL_TITLE',
        message: '请输入目标内容'
      };
    }

    const check = await checkContent(patch.title);
    if (!check.safe) {
      return {
        success: false,
        error: check.error,
        message: check.message
      };
    }
  }

  try {
    const existing = await getOwnedGoal(id, ensured.openid);
    if (!existing) {
      return {
        success: false,
        error: 'GOAL_NOT_FOUND',
        message: '目标不存在'
      };
    }

    await db.collection('goal_items').doc(id).update({
      data: patch
    });

    return {
      success: true,
      goal: serializeGoal({
        ...existing,
        ...patch,
        _id: id
      })
    };
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return buildMissingCollectionResponse('goal_items');
    }

    throw error;
  }
}

async function toggleGoal(event) {
  const ensured = await requireUser();
  if (!ensured.success) {
    return ensured;
  }

  const id = String((event && event.id) || '').trim();
  if (!id) {
    return {
      success: false,
      error: 'EMPTY_GOAL_ID',
      message: '缺少目标 ID'
    };
  }

  try {
    const existing = await getOwnedGoal(id, ensured.openid);
    if (!existing) {
      return {
        success: false,
        error: 'GOAL_NOT_FOUND',
        message: '目标不存在'
      };
    }

    const previous = serializeGoal(existing);
    const nextCompleted = Object.prototype.hasOwnProperty.call(event || {}, 'completed')
      ? !!event.completed
      : !previous.completed;
    const status = nextCompleted ? 'done' : 'pending';
    const updatedAt = Date.now();

    await db.collection('goal_items').doc(id).update({
      data: {
        completed: nextCompleted,
        status,
        completedAt: nextCompleted ? updatedAt : null,
        updatedAt
      }
    });

    let finalStats = null;
    if (nextCompleted && !previous.completed) {
      const currentStats = buildLevelStats(ensured.user.stats || {});
      const awarded = await awardUserStats(ensured.user, {
        experience: currentStats.experience + 4
      });
      finalStats = awarded.stats;
    }

    return {
      success: true,
      id,
      status,
      completed: nextCompleted,
      stats: finalStats
    };
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return buildMissingCollectionResponse('goal_items');
    }

    throw error;
  }
}

module.exports = {
  createGoal,
  listGoals,
  toggleGoal,
  updateGoal,
  updateGoalStatus
};
