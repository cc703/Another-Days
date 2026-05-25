const { showChaosToast } = require('./toast.js');

function isLoggedIn() {
  const app = getApp();
  return app.globalData && app.globalData.isLoggedIn;
}

function isUserSignedOut() {
  const app = getApp();
  return typeof app.isUserSignedOut === 'function' && app.isUserSignedOut();
}

/**
 * 检查用户是否已登录。未登录时弹 Modal 提示先登录。
 * @param {Object} page - 当前页面实例
 * @returns {boolean} - 已登录返回 true，未登录返回 false
 */
function requireLogin(page) {
  if (isLoggedIn()) {
    return true;
  }

  if (isUserSignedOut()) {
    wx.showModal({
      title: '请先登录',
      content: '该功能需要先登录再使用，请前往「残像」页点头像或名字完成登录。',
      showCancel: true,
      cancelText: '稍后',
      confirmText: '去登录',
      success: (res) => {
        if (res.confirm) {
          wx.switchTab({
            url: '/pages/profile/profile'
          });
        }
      }
    });
    return false;
  }

  // 未登录但未主动退出（首次使用场景），不弹提示，让页面自行触发登录流程
  return false;
}

module.exports = {
  isLoggedIn,
  isUserSignedOut,
  requireLogin
};
