function clearToast(page) {
  if (page && page.toastTimer) {
    clearTimeout(page.toastTimer);
    page.toastTimer = null;
  }
}

function showChaosToast(page, message, duration) {
  const delay = typeof duration === 'number' ? duration : 2000;

  clearToast(page);
  if (!page || !page.setData) {
    return;
  }

  page.setData({
    toastVisible: true,
    toastMessage: String(message || '')
  });

  page.toastTimer = setTimeout(() => {
    page.setData({
      toastVisible: false,
      toastMessage: ''
    });
    page.toastTimer = null;
  }, delay);
}

module.exports = {
  clearToast,
  showChaosToast
};
