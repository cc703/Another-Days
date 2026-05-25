const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function getOpenId() {
  const wxContext = cloud.getWXContext();
  return wxContext.OPENID || '';
}

async function getUserByOpenId(openid) {
  const result = await db.collection('users')
    .where({ _openid: openid })
    .limit(1)
    .get();

  return result.data && result.data[0] ? result.data[0] : null;
}

async function requireUser() {
  const openid = getOpenId();

  if (!openid) {
    return {
      success: false,
      error: 'OPENID_NOT_FOUND',
      message: '无法获取用户身份'
    };
  }

  const user = await getUserByOpenId(openid);

  if (!user) {
    return {
      success: false,
      error: 'USER_NOT_FOUND',
      message: '用户不存在'
    };
  }

  return {
    success: true,
    openid,
    user
  };
}

async function checkContent(content) {
  const safeContent = String(content || '').trim();

  if (!safeContent) {
    return { safe: true };
  }

  try {
    const result = await cloud.openapi.security.msgSecCheck({
      content: safeContent
    });

    if (result.errCode === 87014) {
      return {
        safe: false,
        error: 'SENSITIVE_CONTENT',
        message: '内容包含敏感信息'
      };
    }

    return { safe: true };
  } catch (error) {
    if (error.errCode === 87014) {
      return {
        safe: false,
        error: 'SENSITIVE_CONTENT',
        message: '内容包含敏感信息'
      };
    }

    console.warn('[version2/api] 内容安全检查异常:', error);
    return { safe: true };
  }
}

module.exports = {
  checkContent,
  db,
  requireUser
};
