function formatError(error, fallbackMessage) {
  if (!error) {
    return {
      success: false,
      error: 'UNKNOWN_ERROR',
      message: fallbackMessage || '请求失败'
    };
  }

  const rawMessage = String(error.message || error.errMsg || '');
  const isInvalidEnv =
    rawMessage.indexOf('Env Not Exists') >= 0 ||
    rawMessage.indexOf('INVALID_ENV') >= 0 ||
    rawMessage.indexOf('-501000') >= 0 ||
    rawMessage.indexOf('[100003]') >= 0;

  return {
    success: false,
    error: isInvalidEnv ? 'CLOUD_ENV_UNAVAILABLE' : (error.error || error.code || 'REQUEST_FAILED'),
    message: isInvalidEnv ? '云环境未就绪，请检查微信开发者工具当前云环境。' : (rawMessage || fallbackMessage || '请求失败'),
    rawMessage
  };
}

function createApi() {
  async function callFunction(name, data, fallbackMessage) {
    try {
      const response = await wx.cloud.callFunction({
        name,
        data: data || {}
      });

      if (!response || !response.result) {
        return {
          success: false,
          error: 'EMPTY_RESPONSE',
          message: fallbackMessage || '服务响应为空'
        };
      }

      return response.result;
    } catch (error) {
      return formatError(error, fallbackMessage || '云函数调用失败');
    }
  }

  async function call(route, data) {
    const payload = data || {};
    const parts = String(route || '').split('/');
    const module = parts[0] || '';
    const action = parts[1] || '';

    try {
      const response = await wx.cloud.callFunction({
        name: 'api_v2',
        data: {
          $url: route,
          module,
          action,
          ...payload
        }
      });

      if (!response || !response.result) {
        return {
          success: false,
          error: 'EMPTY_RESPONSE',
          message: '服务响应为空'
        };
      }

      return response.result;
    } catch (error) {
      return formatError(error, '云函数调用失败');
    }
  }

  return {
    call,
    user: {
      login(userInfo) {
        return callFunction('user', {
          action: 'login',
          userInfo: userInfo || {}
        }, '登录失败');
      },
      getProfile() {
        return callFunction('user', {
          action: 'getProfile'
        }, '获取资料失败');
      },
      getStats() {
        return call('user/stats', {});
      },
      getStatsByPeriod(period) {
        return call('user/stats', { period: period || 'week' });
      },
      updateProfile(data) {
        return callFunction('user', {
          action: 'updateProfile',
          ...(data || {})
        }, '更新资料失败');
      },
      updateSettings(settings) {
        return call('user/updateSettings', { settings: settings || {} });
      },
      submitFeedback(data) {
        return call('user/feedback', data || {});
      },
      getSettings() {
        return call('user/settings', {});
      }
    },
    task: {
      list(date) {
        return call('task/list', { date });
      },
      create(data) {
        return call('task/create', data || {});
      },
      update(data) {
        return call('task/update', data || {});
      },
      toggle(data) {
        return call('task/toggle', data || {});
      }
    },
    daily: {
      getStatus(date) {
        return call('status/get', { date });
      },
      saveStatus(data) {
        return call('status/save', data || {});
      },
      getDetail(date) {
        return call('calendar/detail', { date });
      }
    },
    calendar: {
      getDetail(date) {
        return call('calendar/detail', { date });
      }
    },
    reminder: {
      flush(data) {
        return call('reminder/flush', data || {});
      }
    },
    habit: {
      getDashboard(date) {
        return call('habit/dashboard', { date });
      },
      checkIn(date) {
        return call('habit/checkIn', { date });
      }
    },
    focus: {
      getStats(period) {
        return call('focus/stats', { period: period || 'day' });
      },
      logSession(data) {
        return call('focus/log', data || {});
      },
      logTaskSession(data) {
        return call('focus/log', {
          ...(data || {}),
          source: 'task'
        });
      }
    },
    hole: {
      logMood(data) {
        return call('hole/log', data || {});
      },
      listByDate(date) {
        return call('hole/list', { date });
      }
    },
    diary: {
      getList(date) {
        return call('diary/list', { date });
      },
      save(data) {
        return call('diary/save', data || {});
      }
    }
  };
}

module.exports = {
  createApi
};
