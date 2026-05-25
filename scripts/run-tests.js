const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function testDateShared() {
  const dateShared = require(path.resolve(__dirname, '../cloudfunctions/api_v2/date-shared.js'));

  assert(dateShared.normalizeDateString('2026-05-13') === '2026-05-13', 'normalizeDateString should preserve valid date');
  assert(dateShared.addDays('2026-05-13', -1) === '2026-05-12', 'addDays should subtract one day');
  const month = dateShared.getMonthMeta('2026-05-13');
  assert(month.firstDate === '2026-05-01', 'getMonthMeta should compute firstDate');
  assert(month.lastDate === '2026-05-31', 'getMonthMeta should compute lastDate');
}

function testStatsShared() {
  const statsShared = require(path.resolve(__dirname, '../cloudfunctions/api_v2/stats-shared.js'));

  const streak = statsShared.buildCheckInStats(['2026-05-10', '2026-05-11', '2026-05-12'], '2026-05-12');
  assert(streak.currentStreak === 3, 'buildCheckInStats should compute current streak');
  assert(streak.longestStreak === 3, 'buildCheckInStats should compute longest streak');

  const level = statsShared.buildLevelStats({
    totalCheckIns: 3,
    experience: 215
  });
  assert(level.level === 3, 'buildLevelStats should compute level from experience');
  assert(level.experienceToNext === 85, 'buildLevelStats should compute experienceToNext');

  const achievement = statsShared.applyAchievementCount({
    totalCheckIns: 3,
    longestStreak: 3,
    totalFocusMinutes: 120,
    totalFocusSessions: 12,
    totalDiaries: 0,
    totalAchievements: 0,
    experience: 220
  }, {
    nickName: '测试用户',
    avatarUrl: 'cloud://avatar'
  });
  assert(achievement.totalAchievements >= 5, 'applyAchievementCount should update earned achievements');
}

function testPageDateUtils() {
  const pageDate = require(path.resolve(__dirname, '../miniprogram/utils/date.js'));

  assert(pageDate.getTodayString().length === 10, 'getTodayString should return yyyy-mm-dd');
  assert(pageDate.addMonths('2026-05-13', -1) === '2026-04-01', 'addMonths should shift month and reset day');
  assert(pageDate.getMonthStart('2026-05-13') === '2026-05-01', 'getMonthStart should return month start');
}

function testPageHelpers() {
  const helpers = require(path.resolve(__dirname, '../miniprogram/utils/page-helpers.js'));
  const page = {
    updates: [],
    setData(patch) {
      this.updates.push(patch);
    }
  };

  const token = helpers.createRequestToken(page, '_requestId');
  assert(helpers.isActiveRequest(page, '_requestId', token), 'request token should match active request');
  helpers.clearRequestToken(page, '_requestId');
  assert(!helpers.isActiveRequest(page, '_requestId', token), 'cleared token should not match active request');

  helpers.applyPageReset(page, () => ({ loading: false, value: 1 }));
  assert(page.updates[0].value === 1, 'applyPageReset should call setData with factory output');

  page._timeouts = [];
  const timeout = helpers.queueManagedTimeout(page, '_timeouts', () => {}, 1000);
  assert(page._timeouts.length === 1, 'queueManagedTimeout should register timer');
  helpers.clearManagedTimeoutQueue(page, '_timeouts');
  assert(page._timeouts.length === 0, 'clearManagedTimeoutQueue should clear timer queue');

  helpers.startManagedInterval(page, '_interval', () => {}, 1000);
  assert(page._interval, 'startManagedInterval should register interval');
  helpers.clearManagedInterval(page, '_interval');
  assert(page._interval === null, 'clearManagedInterval should clear interval');
}

function createNotificationTestDatabase(rows) {
  const updates = [];

  return {
    updates,
    collection(collectionName) {
      assert(collectionName === 'notification_outbox', 'notification worker should use notification_outbox');

      return {
        where(condition) {
          return {
            limit() {
              return {
                async get() {
                  return {
                    data: rows.filter((row) => (
                      Object.keys(condition).every((key) => row[key] === condition[key])
                    ))
                  };
                }
              };
            }
          };
        },
        doc(id) {
          return {
            async update(payload) {
              const row = rows.find((item) => item._id === id);
              assert(row, 'notification worker should update an existing outbox row');
              updates.push({ id, data: payload.data });
              Object.assign(row, payload.data);
            }
          };
        }
      };
    }
  };
}

function createReminderTestDatabase(rows) {
  const updates = [];

  return {
    updates,
    collection(collectionName) {
      assert(collectionName === 'reminder_outbox', 'reminder worker should use reminder_outbox');

      return {
        where(condition) {
          return {
            limit() {
              return {
                async get() {
                  return {
                    data: rows.filter((row) => (
                      Object.keys(condition).every((key) => row[key] === condition[key])
                    ))
                  };
                }
              };
            }
          };
        },
        doc(id) {
          return {
            async update(payload) {
              const row = rows.find((item) => item._id === id);
              assert(row, 'reminder worker should update an existing outbox row');
              updates.push({ id, data: payload.data });
              Object.assign(row, payload.data);
            }
          };
        }
      };
    }
  };
}

async function testNotificationOutboxEmailFlush() {
  const {
    buildFeedbackEmail,
    flushNotificationOutbox
  } = require(path.resolve(__dirname, '../cloudfunctions/api_v2/notification.js'));
  const now = 1770000000000;
  const rows = [
    {
      _id: 'outbox-1',
      _openid: 'user-openid',
      type: 'feedback',
      channel: 'owner_email',
      status: 'pending',
      payload: {
        feedbackId: 'feedback-1',
        content: '希望增加真实邮件提醒',
        contact: 'tester@example.com',
        page: 'profile'
      },
      createdAt: now - 1000,
      updatedAt: now - 1000
    }
  ];
  const database = createNotificationTestDatabase(rows);
  const sentMessages = [];
  const sender = {
    async send(message) {
      sentMessages.push(message);
      return { messageId: 'smtp-message-1' };
    }
  };

  const email = buildFeedbackEmail(rows[0], {
    from: 'from@example.com',
    to: 'owner@example.com',
    subjectPrefix: 'Version2'
  });
  assert(email.subject.includes('feedback-1'), 'feedback email subject should include feedback id');
  assert(email.text.includes('希望增加真实邮件提醒'), 'feedback email should include content');
  assert(email.text.includes('tester@example.com'), 'feedback email should include contact');

  const result = await flushNotificationOutbox({
    $url: 'notification/flush',
    secret: 'test-secret'
  }, {
    database,
    sender,
    now: () => now,
    env: {
      NOTIFY_WORKER_SECRET: 'test-secret',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_USER: 'from@example.com',
      SMTP_PASS: 'smtp-pass',
      FEEDBACK_NOTIFY_TO: 'owner@example.com'
    }
  });

  assert(result.success, 'notification flush should succeed');
  assert(result.processed === 1, 'notification flush should process one row');
  assert(result.sent === 1, 'notification flush should send one email');
  assert(sentMessages.length === 1, 'notification flush should call sender once');
  assert(rows[0].status === 'sent', 'notification row should be marked sent');
  assert(rows[0].providerMessageId === 'smtp-message-1', 'notification row should store provider message id');
  assert(database.updates[0].data.status === 'sending', 'notification flush should mark sending first');
  assert(database.updates[1].data.status === 'sent', 'notification flush should mark sent after delivery');
}

async function testNotificationTimerTriggerBypassesSecret() {
  const { flushNotificationOutbox } = require(path.resolve(__dirname, '../cloudfunctions/api_v2/notification.js'));
  const now = 1770000000000;
  const rows = [
    {
      _id: 'outbox-timer-1',
      _openid: 'user-openid',
      type: 'feedback',
      channel: 'owner_email',
      status: 'pending',
      payload: {
        feedbackId: 'feedback-timer-1',
        content: 'timer trigger test'
      },
      createdAt: now - 1000,
      updatedAt: now - 1000
    }
  ];
  const database = createNotificationTestDatabase(rows);
  const sender = {
    async send() {
      return { messageId: 'smtp-message-timer-1' };
    }
  };

  const result = await flushNotificationOutbox({
    Type: 'Timer',
    TriggerName: 'notificationOutboxTimer'
  }, {
    database,
    sender,
    now: () => now,
    env: {
      NOTIFY_TIMER_TRIGGER_NAME: 'notificationOutboxTimer',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_USER: 'from@example.com',
      SMTP_PASS: 'smtp-pass',
      FEEDBACK_NOTIFY_TO: 'owner@example.com'
    }
  });

  assert(result.success, 'timer-triggered notification flush should succeed without secret');
  assert(result.sent === 1, 'timer-triggered notification flush should send one email');
}

async function testReminderOutboxFlushReschedulesNextRun() {
  const {
    buildChinaReminderSchedule,
    createReminderSender,
    flushReminderOutbox
  } = require(path.resolve(__dirname, '../cloudfunctions/api_v2/notification.js'));
  const now = new Date('2026-05-25T21:31:00+08:00').getTime();
  const sameDaySchedule = buildChinaReminderSchedule('14:05', new Date('2026-05-25T14:01:37+08:00').getTime());
  assert(
    new Date(sameDaySchedule).toISOString() === '2026-05-25T06:05:00.000Z',
    'reminder schedule should treat reminderTime as Beijing time'
  );

  const rows = [
    {
      _id: 'reminder-1',
      _openid: 'user-openid',
      channel: 'study_reminder',
      status: 'pending',
      scheduledAt: now - 1000,
      payload: {
        reminderTime: '21:30',
        title: '学习提醒',
        phrase: '到点了，回来学习。',
        fieldMap: {
          title: 'thing1',
          time: 'date3',
          phrase: 'thing4'
        }
      }
    }
  ];
  const database = createReminderTestDatabase(rows);
  const sentMessages = [];
  const cloudSdk = {
    openapi: {
      subscribeMessage: {
        send(message) {
          sentMessages.push(message);
          return Promise.resolve({ msgid: 'subscribe-msg-1' });
        }
      }
    }
  };
  const sender = createReminderSender({
    templateId: 'tmpl-id',
    page: 'pages/profile/profile',
    lang: 'zh_CN'
  }, cloudSdk);

  const result = await flushReminderOutbox({
    Type: 'Timer',
    TriggerName: 'notificationOutboxTimer'
  }, {
    database,
    sender,
    now: () => now,
    env: {
      NOTIFY_TIMER_TRIGGER_NAME: 'notificationOutboxTimer',
      STUDY_REMINDER_TEMPLATE_ID: 'tmpl-id'
    }
  });

  assert(result.success, 'reminder flush should succeed');
  assert(result.sent === 1, 'reminder flush should send one message');
  assert(rows[0].status === 'pending', 'reminder row should remain pending for next cycle');
  assert(rows[0].provider === 'subscribe_message', 'reminder row should record provider');
  assert(rows[0].scheduledAt > now, 'reminder row should be rescheduled to the future');
  assert(sentMessages[0].data.thing1.value === '学习提醒', 'reminder should map title to thing1');
  assert(sentMessages[0].data.date3.value === '2026-05-25', 'reminder should map date to date3');
  assert(sentMessages[0].data.thing4.value === '到点了，回来学习。', 'reminder should map phrase to thing4');
}

async function testReminderOutboxFlushAcceptsInjectedSender() {
  const { flushReminderOutbox } = require(path.resolve(__dirname, '../cloudfunctions/api_v2/notification.js'));
  const now = new Date('2026-05-25T21:31:00+08:00').getTime();
  const rows = [
    {
      _id: 'reminder-2',
      _openid: 'user-openid',
      channel: 'study_reminder',
      status: 'pending',
      scheduledAt: now - 1000,
      payload: {
        reminderTime: '21:30',
        title: '学习提醒',
        phrase: '到点了，回来学习。'
      }
    }
  ];
  const database = createReminderTestDatabase(rows);
  const sender = {
    async send() {
      return { msgid: 'subscribe-msg-1' };
    }
  };

  const result = await flushReminderOutbox({
    Type: 'Timer',
    TriggerName: 'notificationOutboxTimer'
  }, {
    database,
    sender,
    now: () => now,
    env: {
      NOTIFY_TIMER_TRIGGER_NAME: 'notificationOutboxTimer',
      STUDY_REMINDER_TEMPLATE_ID: 'tmpl-id'
    }
  });

  assert(result.success, 'reminder flush should succeed');
  assert(result.sent === 1, 'reminder flush should send one message');
  assert(rows[0].status === 'pending', 'reminder row should remain pending for next cycle');
  assert(rows[0].provider === 'subscribe_message', 'reminder row should record provider');
  assert(rows[0].scheduledAt > now, 'reminder row should be rescheduled to the future');
}

async function testApiRouteHandlesTimerTrigger() {
  const notification = require(path.resolve(__dirname, '../cloudfunctions/api_v2/notification.js'));
  const originalFlush = notification.flushNotificationOutbox;
  const originalReminderFlush = notification.flushReminderOutbox;
  const apiModulePath = path.resolve(__dirname, '../cloudfunctions/api_v2/index.js');
  const cachedApiModule = require.cache[apiModulePath];

  delete require.cache[apiModulePath];
  notification.flushNotificationOutbox = async (event) => ({
    success: true,
    timer: true,
    triggerName: event.TriggerName || ''
  });
  notification.flushReminderOutbox = async () => ({
    success: false,
    reminder: true
  });

  try {
    const apiModule = require(apiModulePath);
    const result = await apiModule.main({
      Type: 'Timer',
      TriggerName: 'notificationOutboxTimer'
    });
    assert(
      result.success && result.notification && result.notification.timer && result.reminder && result.reminder.skipped,
      'api_v2 should route timer events to notification and skip paused reminder flush'
    );
  } finally {
    notification.flushNotificationOutbox = originalFlush;
    notification.flushReminderOutbox = originalReminderFlush;
    delete require.cache[apiModulePath];
    if (cachedApiModule) {
      require.cache[apiModulePath] = cachedApiModule;
    }
  }
}

function testClientApiShape() {
  const { createApi } = require(path.resolve(__dirname, '../miniprogram/services/api.js'));
  const originalWx = global.wx;
  const calls = [];
  global.wx = {
    cloud: {
      callFunction(payload) {
        calls.push(payload);
        return Promise.resolve({ result: { success: true } });
      }
    }
  };

  try {
    const api = createApi();
    assert(typeof api.task.list === 'function', 'api.task.list should exist');
    assert(typeof api.task.create === 'function', 'api.task.create should exist');
    assert(typeof api.task.toggle === 'function', 'api.task.toggle should exist');
    assert(typeof api.daily.getStatus === 'function', 'api.daily.getStatus should exist');
    assert(typeof api.daily.saveStatus === 'function', 'api.daily.saveStatus should exist');
    assert(typeof api.daily.getDetail === 'function', 'api.daily.getDetail should exist');
    assert(typeof api.user.updateSettings === 'function', 'api.user.updateSettings should exist');
    assert(typeof api.user.submitFeedback === 'function', 'api.user.submitFeedback should exist');
    assert(typeof api.user.getStatsByPeriod === 'function', 'api.user.getStatsByPeriod should exist');
    assert(typeof api.calendar.getDetail === 'function', 'api.calendar.getDetail should exist');
    api.daily.getStatus('2026-05-24');
    api.daily.saveStatus({ mood: 'charged' });
    api.daily.getDetail('2026-05-24');
    api.calendar.getDetail('2026-05-24');
    assert(calls[0].data.$url === 'status/get', 'daily.getStatus should call status/get');
    assert(calls[1].data.$url === 'status/save', 'daily.saveStatus should call status/save');
    assert(calls[2].data.$url === 'calendar/detail', 'daily.getDetail should call calendar/detail');
    assert(calls[3].data.$url === 'calendar/detail', 'calendar.getDetail should call calendar/detail');
  } finally {
    global.wx = originalWx;
  }
}

function testPagePureTransforms() {
  const { parseDate } = require(path.resolve(__dirname, '../miniprogram/utils/date.js'));

  const displayDate = `${parseDate('2026-05-13').getMonth() + 1}月${parseDate('2026-05-13').getDate()}日`;
  assert(displayDate === '5月13日', 'page display date transform should remain stable');
}

async function run() {
  testDateShared();
  testStatsShared();
  testClientApiShape();
  testPageDateUtils();
  testPageHelpers();
  await testNotificationOutboxEmailFlush();
  await testNotificationTimerTriggerBypassesSecret();
  await testReminderOutboxFlushReschedulesNextRun();
  await testReminderOutboxFlushAcceptsInjectedSender();
  await testApiRouteHandlesTimerTrigger();
  testPagePureTransforms();
  process.stdout.write('PASS\n');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
