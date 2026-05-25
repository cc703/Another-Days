const { db } = require('./user-guard');

function isCollectionMissingError(error) {
  const message = String((error && (error.message || error.errMsg)) || '').toLowerCase();
  return message.includes('collection') && (message.includes('not exist') || message.includes('不存在'));
}

function buildMissingCollectionResponse(collectionName) {
  return {
    success: false,
    error: 'COLLECTION_MISSING',
    collection: collectionName,
    message: '请先在云数据库创建 ' + collectionName + ' 集合。'
  };
}

async function findOneByCondition(collectionName, condition) {
  try {
    const result = await db.collection(collectionName)
      .where(condition)
      .limit(1)
      .get();

    return result.data && result.data[0] ? result.data[0] : null;
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return null;
    }

    throw error;
  }
}

async function listAllByOpenId(collectionName, openid, orderField, order) {
  const list = [];
  let hasMore = true;
  let skip = 0;

  try {
    while (hasMore) {
      let query = db.collection(collectionName).where({ _openid: openid });

      if (orderField) {
        query = query.orderBy(orderField, order || 'desc');
      }

      const result = await query.skip(skip).limit(100).get();
      const rows = Array.isArray(result.data) ? result.data : [];
      list.push(...rows);
      skip += rows.length;
      hasMore = rows.length === 100;
    }
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return [];
    }

    throw error;
  }

  return list;
}

async function listRecentByOpenId(collectionName, openid, limit, orderField) {
  try {
    const result = await db.collection(collectionName)
      .where({ _openid: openid })
      .orderBy(orderField || 'createdAt', 'desc')
      .limit(limit || 50)
      .get();

    return Array.isArray(result.data) ? result.data : [];
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return [];
    }

    throw error;
  }
}

async function listByOpenIdAndDate(collectionName, openid, date, limit, orderField) {
  try {
    const result = await db.collection(collectionName)
      .where({ _openid: openid, date })
      .orderBy(orderField || 'createdAt', 'desc')
      .limit(limit || 50)
      .get();

    return {
      rows: Array.isArray(result.data) ? result.data : [],
      collectionMissing: false
    };
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return {
        rows: [],
        collectionMissing: true
      };
    }

    throw error;
  }
}

module.exports = {
  buildMissingCollectionResponse,
  db,
  findOneByCondition,
  isCollectionMissingError,
  listAllByOpenId,
  listByOpenIdAndDate,
  listRecentByOpenId
};
