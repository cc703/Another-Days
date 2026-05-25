const { requireLogin, isUserSignedOut } = require('./auth.js');
const { showChaosToast } = require('./toast.js');

function scheduleDelayedTask(page, timerKey, delay, task) {
  clearDelayedTask(page, timerKey);
  page[timerKey] = setTimeout(() => {
    page[timerKey] = null;
    task();
  }, delay);
}

function clearDelayedTask(page, timerKey) {
  if (page && page[timerKey]) {
    clearTimeout(page[timerKey]);
    page[timerKey] = null;
  }
}

function queueManagedTimeout(page, queueKey, callback, delay) {
  if (!page[queueKey]) {
    page[queueKey] = [];
  }

  const timer = setTimeout(() => {
    page[queueKey] = (page[queueKey] || []).filter((item) => item !== timer);
    callback();
  }, delay);

  page[queueKey].push(timer);
  return timer;
}

function clearManagedTimeoutQueue(page, queueKey) {
  if (!page || !page[queueKey] || !page[queueKey].length) {
    return;
  }

  page[queueKey].forEach((timer) => clearTimeout(timer));
  page[queueKey] = [];
}

function startManagedInterval(page, timerKey, task, delay) {
  clearManagedInterval(page, timerKey);
  page[timerKey] = setInterval(task, delay);
  return page[timerKey];
}

function clearManagedInterval(page, timerKey) {
  if (page && page[timerKey]) {
    clearInterval(page[timerKey]);
    page[timerKey] = null;
  }
}

function createRequestToken(page, fieldName) {
  const token = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  page[fieldName] = token;
  return token;
}

function isActiveRequest(page, fieldName, token) {
  return page && page[fieldName] === token;
}

function clearRequestToken(page, fieldName) {
  if (page) {
    page[fieldName] = '';
  }
}

function withLoginGate(page, options) {
  const config = options || {};

  if (config.mode === 'action') {
    return requireLogin(page);
  }

  if (!isUserSignedOut()) {
    return true;
  }

  if (page && page.setData && config.resetLoadingField) {
    page.setData({ [config.resetLoadingField]: false });
  }

  if (config.message) {
    showChaosToast(page, config.message, config.duration || 2000);
  }

  return false;
}

function applyPageReset(page, dataFactory, extraReset) {
  if (!page || !page.setData) {
    return;
  }

  if (typeof extraReset === 'function') {
    extraReset(page);
  }

  page.setData(dataFactory());
}

module.exports = {
  applyPageReset,
  clearDelayedTask,
  clearManagedInterval,
  clearManagedTimeoutQueue,
  clearRequestToken,
  createRequestToken,
  isActiveRequest,
  queueManagedTimeout,
  scheduleDelayedTask,
  startManagedInterval,
  withLoginGate
};
