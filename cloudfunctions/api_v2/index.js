const ROUTE_HANDLERS = {
  'user/stats': () => require('./user').getUserStats(),
  'user/settings': () => require('./user').getSettings(),
  'settings/get': () => require('./user').getSettings(),
  'settings/save': (event) => require('./user').updateSettings(event),
  'user/updateSettings': (event) => require('./user').updateSettings(event),
  'user/feedback': (event) => require('./user').submitFeedback(event),
  'feedback/submit': (event) => require('./user').submitFeedback(event),
  'habit/dashboard': (event) => require('./habit').getHabitDashboard(event),
  'habit/checkIn': (event) => require('./habit').checkIn(event),
  'goal/list': (event) => require('./goal').listGoals(event),
  'goal/create': (event) => require('./goal').createGoal(event),
  'goal/update': (event) => require('./goal').updateGoal(event),
  'goal/toggle': (event) => require('./goal').toggleGoal(event),
  'goal/updateStatus': (event) => require('./goal').updateGoalStatus(event),
  'task/list': (event) => require('./goal').listGoals(event),
  'task/create': (event) => require('./goal').createGoal(event),
  'task/update': (event) => require('./goal').updateGoal(event),
  'task/toggle': (event) => require('./goal').toggleGoal(event),
  'today/tasks': (event) => require('./goal').listGoals(event),
  'focus/stats': (event) => require('./focus').getFocusStats(event),
  'focus/log': (event) => require('./focus').logFocus(event),
  'hole/list': (event) => require('./hole').listMoodTraces(event),
  'hole/log': (event) => require('./hole').logMoodTrace(event),
  'status/get': (event) => require('./status').getDailyStatus(event),
  'status/save': (event) => require('./status').saveDailyStatus(event),
  'user/dailyStatus': (event) => require('./status').getDailyStatus(event),
  'user/saveDailyStatus': (event) => require('./status').saveDailyStatus(event),
  'diary/list': (event) => require('./diary').listDiaries(event),
  'diary/save': (event) => require('./diary').saveDiary(event),
  'calendar/detail': (event) => require('./calendar').getCalendarDetail(event),
  'calendar/dayDetail': (event) => require('./calendar').getCalendarDetail(event),
  'notification/flush': (event) => require('./notification').flushNotificationOutbox(event),
  'reminder/flush': (event) => require('./notification').flushReminderOutbox(event)
};

exports.main = async (event) => {
  if (event && event.Type === 'Timer') {
    const feedbackResult = await require('./notification').flushNotificationOutbox(event);

    return {
      success: true,
      notification: feedbackResult,
      reminder: {
        success: true,
        skipped: true,
        message: '学习提醒功能已暂时搁置。'
      }
    };
  }

  const route = String((event && event.$url) || `${event.module || ''}/${event.action || ''}`)
    .replace(/^\/+/, '')
    .trim();
  const handler = ROUTE_HANDLERS[route];

  try {
    if (!handler) {
      return {
        success: false,
        error: 'UNKNOWN_ROUTE',
        message: `未知接口: ${route || 'empty'}`
      };
    }

    return await handler(event);
  } catch (error) {
    console.error('[version2/api] 请求失败:', route, error);
    return {
      success: false,
      error: 'API_FAILED',
      message: error && error.message ? error.message : '服务暂时不可用'
    };
  }
};
