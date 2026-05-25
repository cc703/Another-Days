const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const EXPERIENCE_PER_LEVEL = 100;

function clampExperience(experience) {
  return Math.max(0, Number(experience) || 0);
}

function buildLevelStats(stats) {
  const safeStats = stats || {};
  const experience = clampExperience(safeStats.experience);
  const progress = experience % EXPERIENCE_PER_LEVEL;

  return {
    ...safeStats,
    experience,
    level: Math.floor(experience / EXPERIENCE_PER_LEVEL) + 1,
    experienceProgress: progress,
    experienceToNext: progress === 0 ? EXPERIENCE_PER_LEVEL : EXPERIENCE_PER_LEVEL - progress
  };
}

async function checkContent(content) {
  if (!content || typeof content !== 'string') {
    return { safe: true };
  }

  try {
    const result = await cloud.openapi.security.msgSecCheck({
      content: content.trim()
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

    console.warn('[version2/user] 内容安全检查异常:', error);
    return { safe: true };
  }
}

async function getUserByOpenId(openid) {
  const result = await db.collection('users')
    .where({ _openid: openid })
    .limit(1)
    .get();

  return result.data && result.data[0] ? result.data[0] : null;
}

function getOpenId() {
  const wxContext = cloud.getWXContext();
  return wxContext.OPENID || '';
}

async function login(event) {
  const openid = getOpenId();

  if (!openid) {
    return {
      success: false,
      error: 'OPENID_NOT_FOUND',
      message: '无法获取用户身份'
    };
  }

  const payload = event || {};
  const userInfo = payload.userInfo || {};
  const now = Date.now();
  const nickName = userInfo.nickName ? String(userInfo.nickName).trim().slice(0, 20) : '';
  const avatarUrl = userInfo.avatarUrl ? String(userInfo.avatarUrl).trim() : '';

  if (nickName) {
    const check = await checkContent(nickName);
    if (!check.safe) {
      return {
        success: false,
        error: check.error,
        message: check.message
      };
    }
  }

  try {
    const usersCol = db.collection('users');
    const existingUser = await getUserByOpenId(openid);

    if (existingUser) {
      const updateData = {
        lastLoginAt: now,
        updatedAt: now
      };

      if (nickName && nickName !== existingUser.nickName) {
        updateData.nickName = nickName;
      }

      if (avatarUrl && avatarUrl !== existingUser.avatarUrl) {
        updateData.avatarUrl = avatarUrl;
      }

      await usersCol.doc(existingUser._id).update({
        data: updateData
      });

      const nextUser = {
        ...existingUser,
        ...updateData,
        stats: buildLevelStats(existingUser.stats || {})
      };

      return {
        success: true,
        openid,
        isNewUser: false,
        user: nextUser,
        profile: nextUser
      };
    }

    const newUser = {
      _openid: openid,
      nickName: nickName || `用户${openid.slice(-6)}`,
      avatarUrl: avatarUrl || '',
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
      settings: {
        dailyReminderEnabled: false,
        reminderTime: '21:30',
        feedbackReplyNotice: true,
        reminderTemplateId: '',
        reminderSubscriptionAcceptedAt: 0
      },
      stats: {
        totalCheckIns: 0,
        currentStreak: 0,
        longestStreak: 0,
        totalFocusMinutes: 0,
        totalDiaries: 0,
        totalAchievements: 0,
        level: 1,
        experience: 0
      }
    };

    const addResult = await usersCol.add({
      data: newUser
    });

    const nextUser = {
      ...newUser,
      _id: addResult._id,
      stats: buildLevelStats(newUser.stats)
    };

    return {
      success: true,
      openid,
      isNewUser: true,
      user: nextUser,
      profile: nextUser
    };
  } catch (error) {
    console.error('[version2/user] 登录失败:', error);
    return {
      success: false,
      error: 'LOGIN_FAILED',
      message: '登录失败，请重试'
    };
  }
}

async function getProfile() {
  const openid = getOpenId();

  if (!openid) {
    return {
      success: false,
      error: 'OPENID_NOT_FOUND',
      message: '无法获取用户身份'
    };
  }

  try {
    const user = await getUserByOpenId(openid);

    if (!user) {
      return {
        success: false,
        error: 'USER_NOT_FOUND',
        message: '用户不存在'
      };
    }

    const nextUser = {
      ...user,
      stats: buildLevelStats(user.stats || {})
    };

    return {
      success: true,
      user: nextUser,
      profile: nextUser
    };
  } catch (error) {
    console.error('[version2/user] 获取资料失败:', error);
    return {
      success: false,
      error: 'QUERY_FAILED',
      message: '获取用户资料失败'
    };
  }
}

async function updateProfile(event) {
  const openid = getOpenId();

  if (!openid) {
    return {
      success: false,
      error: 'OPENID_NOT_FOUND',
      message: '无法获取用户身份'
    };
  }

  const payload = event || {};
  const nickName = payload.nickName ? String(payload.nickName).trim().slice(0, 20) : '';
  const avatarUrl = payload.avatarUrl ? String(payload.avatarUrl).trim() : '';

  if (!nickName && !avatarUrl) {
    return {
      success: false,
      error: 'MISSING_PARAMS',
      message: '请提供昵称或头像'
    };
  }

  if (nickName) {
    const check = await checkContent(nickName);
    if (!check.safe) {
      return {
        success: false,
        error: check.error,
        message: check.message
      };
    }
  }

  try {
    const user = await getUserByOpenId(openid);

    if (!user) {
      return {
        success: false,
        error: 'USER_NOT_FOUND',
        message: '用户不存在'
      };
    }

    const updateData = {
      updatedAt: Date.now()
    };

    if (nickName) {
      updateData.nickName = nickName;
    }

    if (avatarUrl) {
      updateData.avatarUrl = avatarUrl;
    }

    await db.collection('users').doc(user._id).update({
      data: updateData
    });

    const nextUser = {
      ...user,
      ...updateData,
      stats: buildLevelStats(user.stats || {})
    };

    return {
      success: true,
      message: '资料已更新',
      user: nextUser,
      profile: nextUser
    };
  } catch (error) {
    console.error('[version2/user] 更新资料失败:', error);
    return {
      success: false,
      error: 'UPDATE_FAILED',
      message: '更新失败，请重试'
    };
  }
}

exports.main = async (event) => {
  const action = String((event && event.action) || 'login');

  switch (action) {
    case 'login':
      return login(event);
    case 'getProfile':
      return getProfile();
    case 'updateProfile':
      return updateProfile(event);
    default:
      return {
        success: false,
        error: 'UNKNOWN_ACTION',
        message: '未知操作'
      };
  }
};
