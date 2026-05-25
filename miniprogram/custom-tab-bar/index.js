Component({
  data: {
    selected: 'home',
    list: [
      { key: 'home', path: '/pages/home/home', text: '首页', icon: 'home' },
      { key: 'focus', path: '/pages/focus/focus', text: '专注', icon: 'focus' },
      { key: 'diary', path: '/pages/diary/diary', text: '记录', action: true },
      { key: 'calendar', path: '/pages/calendar/calendar', text: '日历', icon: 'calendar' },
      { key: 'profile', path: '/pages/profile/profile', text: '我的', icon: 'profile' }
    ]
  },
  methods: {
    setActive(key) {
      this._switching = false;
      this.setData({ selected: key });
    },
    onSwitch(e) {
      const { key, path } = e.currentTarget.dataset;
      if (!key || !path || key === this.data.selected || this._switching) {
        return;
      }

      this._switching = true;
      wx.switchTab({
        url: path,
        fail: () => {
          this._switching = false;
        },
        complete: () => {
          setTimeout(() => {
            this._switching = false;
          }, 260);
        }
      });
    }
  }
});
