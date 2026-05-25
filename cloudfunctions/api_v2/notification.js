const OUTBOX_COLLECTION = 'notification_outbox';
const REMINDER_OUTBOX_COLLECTION = 'reminder_outbox';
const OWNER_EMAIL_CHANNEL = 'owner_email';
const DAILY_REMINDER_CHANNEL = 'study_reminder';
const DEFAULT_BATCH_LIMIT = 10;
const MAX_BATCH_LIMIT = 20;
const MAX_RETRY_COUNT = 3;
const MAX_ERROR_LENGTH = 500;
const DEFAULT_TIMER_TRIGGER_NAME = 'notificationOutboxTimer';
const CHINA_TIMEZONE_OFFSET_MS = 8 * 60 * 60 * 1000;

function isCollectionMissingError(error) {
  const message = String((error && (error.message || error.errMsg)) || '').toLowerCase();
  return message.includes('collection') && (message.includes('not exist') || message.includes('不存在'));
}

function buildMissingCollectionResponse(collectionName) {
  return {
    success: false,
    error: 'COLLECTION_MISSING',
    collection: collectionName,
    message: `请先在云数据库创建 ${collectionName} 集合。`
  };
}

function trimEnv(env, name) {
  return String((env && env[name]) || '').trim();
}

function parseBoolean(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function parsePort(value) {
  const port = Number.parseInt(value, 10);
  return Number.isFinite(port) && port > 0 ? port : 465;
}

function parseBatchLimit(value) {
  const limit = Number.parseInt(value, 10);
  if (!Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_BATCH_LIMIT;
  }

  return Math.min(limit, MAX_BATCH_LIMIT);
}

function getEmailConfig(env) {
  const port = parsePort(trimEnv(env, 'SMTP_PORT'));

  return {
    host: trimEnv(env, 'SMTP_HOST'),
    port,
    secure: parseBoolean(trimEnv(env, 'SMTP_SECURE'), port === 465),
    user: trimEnv(env, 'SMTP_USER'),
    pass: trimEnv(env, 'SMTP_PASS'),
    from: trimEnv(env, 'SMTP_FROM') || trimEnv(env, 'SMTP_USER'),
    to: trimEnv(env, 'FEEDBACK_NOTIFY_TO'),
    subjectPrefix: trimEnv(env, 'EMAIL_SUBJECT_PREFIX') || 'Version2'
  };
}

function getReminderConfig(env) {
  return {
    templateId: trimEnv(env, 'STUDY_REMINDER_TEMPLATE_ID'),
    page: trimEnv(env, 'STUDY_REMINDER_PAGE') || 'pages/profile/profile',
    lang: trimEnv(env, 'STUDY_REMINDER_LANG') || 'zh_CN'
  };
}

function validateEmailConfig(config) {
  const missing = [];

  if (!config.host) missing.push('SMTP_HOST');
  if (!config.port) missing.push('SMTP_PORT');
  if (!config.user) missing.push('SMTP_USER');
  if (!config.pass) missing.push('SMTP_PASS');
  if (!config.from) missing.push('SMTP_FROM');
  if (!config.to) missing.push('FEEDBACK_NOTIFY_TO');

  return missing;
}

function validateReminderConfig(config) {
  const missing = [];
  if (!config.templateId) missing.push('STUDY_REMINDER_TEMPLATE_ID');
  return missing;
}

function authorizeWorker(event, env) {
  if (isTimerTriggerEvent(event, env)) {
    return { success: true };
  }

  const expected = trimEnv(env, 'NOTIFY_WORKER_SECRET');
  const actual = String(
    (event && (event.secret || event.workerSecret || event.notifySecret || event.notificationSecret)) || ''
  ).trim();

  if (!expected) {
    return {
      success: false,
      error: 'NOTIFY_SECRET_MISSING',
      message: '请先在云函数环境变量中配置 NOTIFY_WORKER_SECRET。'
    };
  }

  if (actual !== expected) {
    return {
      success: false,
      error: 'UNAUTHORIZED',
      message: '通知发送器鉴权失败。'
    };
  }

  return { success: true };
}

function isTimerTriggerEvent(event, env) {
  if (!event || event.Type !== 'Timer') {
    return false;
  }

  const expectedName = trimEnv(env, 'NOTIFY_TIMER_TRIGGER_NAME') || DEFAULT_TIMER_TRIGGER_NAME;
  const triggerName = String(event.TriggerName || '').trim();

  return !triggerName || triggerName === expectedName;
}

function truncate(value, maxLength) {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function parseReminderClock(reminderTime) {
  const [hoursText, minutesText] = String(reminderTime || '21:30').split(':');
  return {
    hours: Math.max(0, Math.min(23, Number.parseInt(hoursText, 10) || 21)),
    minutes: Math.max(0, Math.min(59, Number.parseInt(minutesText, 10) || 30))
  };
}

function buildChinaReminderSchedule(reminderTime, now) {
  const baseTime = Number(now || Date.now());
  const { hours, minutes } = parseReminderClock(reminderTime);
  const chinaDate = new Date(baseTime + CHINA_TIMEZONE_OFFSET_MS);
  const year = chinaDate.getUTCFullYear();
  const month = chinaDate.getUTCMonth();
  const day = chinaDate.getUTCDate();
  let scheduled = Date.UTC(year, month, day, hours - 8, minutes, 0, 0);

  if (scheduled <= baseTime) {
    scheduled += 24 * 60 * 60 * 1000;
  }

  return scheduled;
}

function formatChinaDate(timestamp) {
  const value = Number(timestamp || Date.now());
  const date = new Date(value + CHINA_TIMEZONE_OFFSET_MS);
  return date.toISOString().slice(0, 10);
}

function getReminderTimeFieldValue(fieldName, payload, record) {
  if (/^date\d+$/i.test(String(fieldName || ''))) {
    return formatChinaDate(record && record.scheduledAt);
  }
  return payload.reminderTime || '21:30';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '未知时间';
  }

  return new Date(timestamp).toISOString();
}

function getFeedbackPayload(record) {
  const payload = record && typeof record.payload === 'object' ? record.payload : {};

  return {
    feedbackId: truncate(payload.feedbackId || record._id || '', 120),
    content: truncate(payload.content || '', 1000),
    contact: truncate(payload.contact || '', 120),
    page: truncate(payload.page || '', 120)
  };
}

function getReminderPayload(record) {
  const payload = record && typeof record.payload === 'object' ? record.payload : {};
  return {
    reminderTime: String(payload.reminderTime || '').trim(),
    title: truncate(payload.title || '学习提醒', 40),
    phrase: truncate(payload.phrase || '到点了，回来学习。', 40),
    page: truncate(payload.page || '', 120),
    fieldMap: payload.fieldMap && typeof payload.fieldMap === 'object' ? payload.fieldMap : {}
  };
}

function getNextReminderSchedule(record, now) {
  const payload = getReminderPayload(record);
  return buildChinaReminderSchedule(payload.reminderTime, now);
}

function buildFeedbackEmail(record, config) {
  const payload = getFeedbackPayload(record || {});
  const feedbackId = payload.feedbackId || 'unknown';
  const createdAt = formatTime(record && record.createdAt);
  const subject = truncate(`${config.subjectPrefix} 新反馈 #${feedbackId}`, 120);
  const rows = [
    ['反馈 ID', feedbackId],
    ['提交时间', createdAt],
    ['用户 OpenID', truncate((record && record._openid) || '', 120) || 'N/A'],
    ['来源页面', payload.page || 'N/A'],
    ['联系方式', payload.contact || 'N/A'],
    ['反馈内容', payload.content || 'N/A']
  ];

  const text = rows.map(([label, value]) => `${label}: ${value}`).join('\n');
  const htmlRows = rows.map(([label, value]) => (
    `<tr><th align="left" style="padding:6px 10px;border:1px solid #ddd;">${escapeHtml(label)}</th>` +
    `<td style="padding:6px 10px;border:1px solid #ddd;white-space:pre-wrap;">${escapeHtml(value)}</td></tr>`
  )).join('');

  return {
    from: config.from,
    to: config.to,
    subject,
    text,
    html: `<p>收到一条新的小程序反馈。</p><table style="border-collapse:collapse;">${htmlRows}</table>`
  };
}

function createSmtpEmailSender(config) {
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });

  return {
    send(message) {
      return transporter.sendMail(message);
    }
  };
}

function createReminderSender(config, cloudSdk) {
  const cloud = cloudSdk || require('wx-server-sdk');
  return {
    async send(record) {
      const payload = getReminderPayload(record);
      const titleField = String(payload.fieldMap.title || 'thing1').trim();
      const timeField = String(payload.fieldMap.time || 'date3').trim();
      const phraseField = String(payload.fieldMap.phrase || 'thing4').trim();
      const data = {};

      data[titleField] = { value: payload.title };
      data[timeField] = { value: getReminderTimeFieldValue(timeField, payload, record) };
      data[phraseField] = { value: payload.phrase };

      return cloud.openapi.subscribeMessage.send({
        touser: record._openid,
        templateId: config.templateId,
        page: payload.page || config.page,
        lang: config.lang,
        data
      });
    }
  };
}

function normalizeError(error) {
  return truncate((error && (error.message || error.errMsg)) || String(error || 'UNKNOWN_ERROR'), MAX_ERROR_LENGTH);
}

function getBackoffMs(retryCount) {
  return Math.min(60 * 60 * 1000, Math.pow(2, Math.max(0, retryCount - 1)) * 60 * 1000);
}

async function listPendingOutbox(database, limit, now) {
  try {
    const result = await database.collection(OUTBOX_COLLECTION)
      .where({
        status: 'pending'
      })
      .limit(limit)
      .get();
    const rows = Array.isArray(result.data) ? result.data : [];
    const matchingRows = rows.filter((row) => (
      (row.channel || OWNER_EMAIL_CHANNEL) === OWNER_EMAIL_CHANNEL &&
      (!row.nextRetryAt || Number(row.nextRetryAt) <= now)
    ));

    return {
      collectionMissing: false,
      scanned: rows.length,
      rows: matchingRows.sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0))
    };
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return {
        collectionMissing: true,
        scanned: 0,
        rows: []
      };
    }

    throw error;
  }
}

async function updateOutbox(database, id, data) {
  await database.collection(OUTBOX_COLLECTION).doc(id).update({ data });
}

async function updateReminderOutbox(database, id, data) {
  await database.collection(REMINDER_OUTBOX_COLLECTION).doc(id).update({ data });
}

async function flushNotificationOutbox(event, options) {
  const env = (options && options.env) || process.env;
  const nowFn = (options && options.now) || Date.now;
  const database = (options && options.database) || require('./shared').db;
  const dryRun = Boolean((event && event.dryRun) || (options && options.dryRun));
  const auth = options && options.skipAuth ? { success: true } : authorizeWorker(event || {}, env);

  if (!auth.success) {
    return auth;
  }

  const config = getEmailConfig(env);
  const missingConfig = validateEmailConfig(config);

  if (!dryRun && missingConfig.length) {
    return {
      success: false,
      error: 'EMAIL_CONFIG_MISSING',
      missing: missingConfig,
      message: `请先配置邮件环境变量：${missingConfig.join(', ')}。`
    };
  }

  const limit = parseBatchLimit(event && event.limit);
  const now = nowFn();
  const pending = await listPendingOutbox(database, limit, now);

  if (pending.collectionMissing) {
    return buildMissingCollectionResponse(OUTBOX_COLLECTION);
  }

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      pending: pending.rows.length,
      scanned: pending.scanned || 0,
      processed: 0,
      sent: 0,
      failed: 0
    };
  }

  let sender;
  try {
    sender = (options && options.sender) || createSmtpEmailSender(config);
  } catch (error) {
    return {
      success: false,
      error: 'EMAIL_SENDER_INIT_FAILED',
      message: normalizeError(error)
    };
  }
  const results = [];
  let sent = 0;
  let failed = 0;
  let retrying = 0;

  for (const record of pending.rows) {
    const id = record._id;
    if (!id) {
      failed += 1;
      results.push({
        id: '',
        status: 'failed',
        error: 'MISSING_OUTBOX_ID'
      });
      continue;
    }

    const startedAt = nowFn();
    await updateOutbox(database, id, {
      status: 'sending',
      processingAt: startedAt,
      updatedAt: startedAt
    });

    try {
      const message = buildFeedbackEmail(record, config);
      const sendResult = await sender.send(message, record);
      const sentAt = nowFn();

      await updateOutbox(database, id, {
        status: 'sent',
        sentAt,
        updatedAt: sentAt,
        provider: 'smtp',
        providerMessageId: String((sendResult && sendResult.messageId) || ''),
        errorMessage: '',
        nextRetryAt: null
      });

      sent += 1;
      results.push({
        id,
        status: 'sent'
      });
    } catch (error) {
      const failedAt = nowFn();
      const retryCount = Number(record.retryCount || 0) + 1;
      const willRetry = retryCount < MAX_RETRY_COUNT;
      const status = willRetry ? 'pending' : 'failed';

      await updateOutbox(database, id, {
        status,
        retryCount,
        lastAttemptAt: failedAt,
        updatedAt: failedAt,
        errorMessage: normalizeError(error),
        nextRetryAt: willRetry ? failedAt + getBackoffMs(retryCount) : null
      });

      if (willRetry) {
        retrying += 1;
      } else {
        failed += 1;
      }

      results.push({
        id,
        status,
        error: normalizeError(error)
      });
    }
  }

  return {
    success: true,
    processed: pending.rows.length,
    sent,
    failed,
    retrying,
    results
  };
}

async function listPendingReminderOutbox(database, now) {
  try {
    const result = await database.collection(REMINDER_OUTBOX_COLLECTION)
      .where({
        status: 'pending'
      })
      .limit(MAX_BATCH_LIMIT)
      .get();
    const rows = Array.isArray(result.data) ? result.data : [];
    return rows.filter((row) => (
      (row.channel || DAILY_REMINDER_CHANNEL) === DAILY_REMINDER_CHANNEL &&
      Number(row.scheduledAt || 0) <= now &&
      (!row.nextRetryAt || Number(row.nextRetryAt) <= now)
    ));
  } catch (error) {
    if (isCollectionMissingError(error)) {
      return null;
    }
    throw error;
  }
}

async function flushReminderOutbox(event, options) {
  const env = (options && options.env) || process.env;
  const nowFn = (options && options.now) || Date.now;
  const database = (options && options.database) || require('./shared').db;
  const dryRun = Boolean((event && event.dryRun) || (options && options.dryRun));
  const auth = options && options.skipAuth ? { success: true } : authorizeWorker(event || {}, env);

  if (!auth.success) {
    return auth;
  }

  const config = getReminderConfig(env);
  const missingConfig = validateReminderConfig(config);
  if (!dryRun && missingConfig.length) {
    return {
      success: false,
      error: 'REMINDER_CONFIG_MISSING',
      missing: missingConfig,
      message: `请先配置提醒环境变量：${missingConfig.join(', ')}。`
    };
  }

  const now = nowFn();
  const rows = await listPendingReminderOutbox(database, now);
  if (rows === null) {
    return buildMissingCollectionResponse(REMINDER_OUTBOX_COLLECTION);
  }

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      pending: rows.length,
      processed: 0,
      sent: 0,
      failed: 0
    };
  }

  const sender = (options && options.sender) || createReminderSender(config);
  let sent = 0;
  let failed = 0;
  let retrying = 0;
  const results = [];

  for (const record of rows) {
    const id = record._id;
    const startedAt = nowFn();
    await updateReminderOutbox(database, id, {
      status: 'sending',
      processingAt: startedAt,
      updatedAt: startedAt
    });

    try {
      const sendResult = await sender.send(record);
      const sentAt = nowFn();
      await updateReminderOutbox(database, id, {
        status: 'pending',
        sentAt,
        updatedAt: sentAt,
        scheduledAt: getNextReminderSchedule(record, sentAt),
        provider: 'subscribe_message',
        providerMessageId: String((sendResult && (sendResult.msgid || sendResult.requestId || '')) || ''),
        errorMessage: '',
        nextRetryAt: null
      });
      sent += 1;
      results.push({ id, status: 'sent' });
    } catch (error) {
      const failedAt = nowFn();
      const retryCount = Number(record.retryCount || 0) + 1;
      const willRetry = retryCount < MAX_RETRY_COUNT;
      await updateReminderOutbox(database, id, {
        status: willRetry ? 'pending' : 'failed',
        retryCount,
        lastAttemptAt: failedAt,
        updatedAt: failedAt,
        errorMessage: normalizeError(error),
        nextRetryAt: willRetry ? failedAt + getBackoffMs(retryCount) : null
      });
      if (willRetry) {
        retrying += 1;
      } else {
        failed += 1;
      }
      results.push({ id, status: willRetry ? 'pending' : 'failed', error: normalizeError(error) });
    }
  }

  return {
    success: true,
    processed: rows.length,
    sent,
    failed,
    retrying,
    results
  };
}

module.exports = {
  buildFeedbackEmail,
  buildChinaReminderSchedule,
  createReminderSender,
  flushNotificationOutbox,
  flushReminderOutbox,
  getReminderTimeFieldValue,
  getEmailConfig,
  getReminderConfig,
  validateEmailConfig,
  validateReminderConfig
};
