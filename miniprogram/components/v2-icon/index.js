const ICON_MAP = {
  leaf: { type: 'success_no_circle', color: '#82a888' },
  sun: { type: 'success', color: '#f2d785' },
  wind: { type: 'info', color: '#9aa7a0' },
  chart: { type: 'waiting', color: '#82a888' },
  badge: { type: 'success', color: '#f2d785' },
  focus: { type: 'waiting', color: '#82a888' },
  diary: { type: 'info', color: '#8c8c8c' },
  settings: { type: 'info', color: '#b8b8b8' },
  check: { type: 'success', color: '#82a888' },
  home: { type: 'success_no_circle', color: '#82a888' },
  calendar: { type: 'waiting', color: '#82a888' },
  profile: { type: 'info', color: '#82a888' }
};

Component({
  properties: {
    name: {
      type: String,
      value: 'info'
    },
    size: {
      type: Number,
      value: 22
    }
  },

  data: {
    iconType: 'info',
    iconColor: '#82a888'
  },

  observers: {
    'name': function onNameChange(name) {
      this.applyIcon(name);
    }
  },

  lifetimes: {
    attached() {
      this.applyIcon(this.data.name);
    }
  },

  methods: {
    applyIcon(name) {
      const config = ICON_MAP[name] || { type: name || 'info', color: '#82a888' };
      this.setData({
        iconType: config.type,
        iconColor: config.color
      });
    }
  }
});
