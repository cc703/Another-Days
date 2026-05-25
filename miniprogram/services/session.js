const STORAGE_KEY = 'version2:user_session';
const SIGNED_OUT_KEY = 'version2:user_signed_out';

function getStoredUser() {
  try {
    return wx.getStorageSync(STORAGE_KEY) || null;
  } catch (error) {
    return null;
  }
}

function setStoredUser(user) {
  try {
    if (!user) {
      return;
    }
    wx.setStorageSync(STORAGE_KEY, user);
  } catch (error) {
    return;
  }
}

function clearStoredUser() {
  try {
    wx.removeStorageSync(STORAGE_KEY);
  } catch (error) {
    return;
  }
}

function isUserSignedOut() {
  try {
    return Boolean(wx.getStorageSync(SIGNED_OUT_KEY));
  } catch (error) {
    return false;
  }
}

function markUserSignedOut() {
  try {
    wx.setStorageSync(SIGNED_OUT_KEY, 1);
  } catch (error) {
    return;
  }
}

function clearSignedOutMark() {
  try {
    wx.removeStorageSync(SIGNED_OUT_KEY);
  } catch (error) {
    return;
  }
}

function isPlaceholderNickName(nickName) {
  const safeNickName = String(nickName || '').trim();

  return !safeNickName
    || safeNickName === '备考残像'
    || safeNickName === '微信用户'
    || /^用户[\da-zA-Z]{6}$/.test(safeNickName);
}

function buildProfileSummary(user) {
  const profile = user || {};
  const rawNickName = String(profile.nickName || '').trim();
  const avatarUrl = String(profile.avatarUrl || '').trim();
  const hasNickNameAuth = !isPlaceholderNickName(rawNickName);
  const hasAvatarAuth = Boolean(avatarUrl);

  return {
    nickName: hasNickNameAuth ? rawNickName : '备考残像',
    rawNickName,
    avatarUrl,
    hasAvatarAuth,
    hasNickNameAuth,
    missingAvatar: !hasAvatarAuth,
    missingNickName: !hasNickNameAuth,
    statusText: hasAvatarAuth && hasNickNameAuth
      ? '微信头像和昵称都已同步。'
      : hasAvatarAuth
        ? '头像已同步，点一下名字补昵称。'
        : hasNickNameAuth
          ? '昵称已同步，还差微信头像。'
          : '点击头像选微信头像，点击名字填微信昵称。'
  };
}

module.exports = {
  clearStoredUser,
  clearSignedOutMark,
  getStoredUser,
  isUserSignedOut,
  markUserSignedOut,
  buildProfileSummary,
  setStoredUser
};
