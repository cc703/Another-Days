const TAB_KEYS = ['home', 'focus', 'diary', 'calendar', 'profile'];

function syncTabBar(page, key) {
  if (!page || !page.getTabBar) {
    return;
  }

  if (TAB_KEYS.indexOf(key) === -1) {
    return;
  }

  const tabBar = page.getTabBar();
  if (tabBar && typeof tabBar.setActive === 'function') {
    tabBar.setActive(key);
  }
}

module.exports = {
  syncTabBar,
  TAB_KEYS
};
