function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDate(dateString) {
  const match = String(dateString || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return new Date();
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function normalizeDateString(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return formatDate(value || Date.now());
}

function addDays(dateString, offset) {
  const date = parseDate(dateString);
  date.setDate(date.getDate() + offset);
  return formatDate(date);
}

function getMonthMeta(dateString) {
  const baseDate = parseDate(dateString);
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth() + 1;
  const firstDate = new Date(year, month - 1, 1);
  const lastDate = new Date(year, month, 0);

  return {
    year,
    month,
    daysInMonth: lastDate.getDate(),
    firstWeekday: firstDate.getDay(),
    monthLabel: `${year}.${pad(month)}`,
    firstDate: formatDate(firstDate),
    lastDate: formatDate(lastDate)
  };
}

module.exports = {
  addDays,
  formatDate,
  getMonthMeta,
  normalizeDateString,
  parseDate
};
