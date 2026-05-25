const {
  awardUserStats,
  buildLevelStats,
  buildMissingCollectionResponse,
  checkContent,
  db,
  getMonthMeta,
  isCollectionMissingError,
  normalizeDateString,
  requireUser
} = require('./shared');

async function listDiaries(event) {
  const ensured = await requireUser();
  if (!ensured.success) {
    return ensured;
  }

  const { openid, user } = ensured;
  const targetDate = normalizeDateString((event && event.date) || Date.now());
  const month = getMonthMeta(targetDate);

  try {
    const allDiaries = await db.collection('diary_entries')
      .where({ _openid: openid })
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();

    const diaryList = Array.isArray(allDiaries.data) ? allDiaries.data : [];
    const monthDiaries = diaryList.filter(
      (item) => item.date >= month.firstDate && item.date <= month.lastDate
    );
    const diaryDates = [...new Set(monthDiaries.map((item) => item.date))];
    const dayDiaries = diaryList.filter((item) => item.date === targetDate);

    const stats = buildLevelStats(user.stats || {});

    return {
      success: true,
      date: targetDate,
      diaryDates,
      recentEntries: dayDiaries,
      stats
    };
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return {
        success: true,
        date: targetDate,
        diaryDates: [],
        recentEntries: [],
        stats: buildLevelStats(user.stats || {}),
        collectionMissing: true,
        message: '请先创建 diary_entries 集合。'
      };
    }
    throw error;
  }
}

async function saveDiary(event) {
  const ensured = await requireUser();
  if (!ensured.success) {
    return ensured;
  }

  const { openid, user } = ensured;
  const content = String((event && event.content) || '').trim();
  const mood = String((event && event.mood) || '').trim();
  const tags = Array.isArray(event && event.tags)
    ? event.tags.map((tag) => String(tag || '').trim().replace(/^#/, '').slice(0, 20)).filter(Boolean).slice(0, 12)
    : [];
  const imageIds = Array.isArray(event && event.imageIds)
    ? event.imageIds.map((image) => String(image || '').trim().slice(0, 300)).filter(Boolean).slice(0, 9)
    : [];
  const imagePaths = Array.isArray(event && event.imagePaths)
    ? event.imagePaths.map((image) => String(image || '').trim().slice(0, 300)).filter(Boolean).slice(0, 9)
    : [];
  const rawImages = Array.isArray(event && event.images) ? event.images : [];
  const images = rawImages.map((image, index) => {
    if (typeof image === 'string') {
      return {
        fileID: image.slice(0, 300),
        cloudPath: '',
        tempFilePath: '',
        order: index
      };
    }

    const fileID = String((image && (image.fileID || image.fileId || image.id)) || imageIds[index] || '').trim().slice(0, 300);
    const cloudPath = String((image && image.cloudPath) || imagePaths[index] || '').trim().slice(0, 300);
    const tempFilePath = String((image && (image.tempFilePath || image.path || image.url)) || '').trim().slice(0, 300);
    return {
      fileID,
      cloudPath,
      tempFilePath,
      order: index
    };
  }).filter((image) => image.fileID || image.cloudPath || image.tempFilePath).slice(0, 9);
  const completedItems = Array.isArray(event && event.completedItems)
    ? event.completedItems.slice(0, 30)
    : [];
  const date = normalizeDateString((event && event.date) || Date.now());

  if (!content) {
    return {
      success: false,
      error: 'EMPTY_CONTENT',
      message: '请先写点内容'
    };
  }

  const check = await checkContent([content, mood, ...tags].filter(Boolean).join(' '));
  if (!check.safe) {
    return {
      success: false,
      error: check.error,
      message: check.message
    };
  }

  const safeContent = content.slice(0, 500);
  const createdAt = Date.now();

  try {
    await db.collection('diary_entries').add({
      data: {
        _openid: openid,
        content: safeContent,
        date,
        mood,
        tags,
        images,
        completedItems,
        createdAt
      }
    });
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return buildMissingCollectionResponse('diary_entries');
    }
    throw error;
  }

  const currentStats = buildLevelStats(user.stats || {});
  const { stats: finalStats } = await awardUserStats(user, {
    totalDiaries: currentStats.totalDiaries + 1,
    experience: currentStats.experience + 8
  });

  return {
    success: true,
    diary: {
      content: safeContent,
      date,
      mood,
      tags,
      images,
      completedItems,
      createdAt
    },
    message: '病历已归档',
    stats: finalStats
  };
}

module.exports = {
  listDiaries,
  saveDiary
};
