function pad(value) {
  return String(value).padStart(2, '0');
}

function parseDate(dateString) {
  const match = String(dateString || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return new Date();
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatDate(date) {
  const target = date instanceof Date ? date : new Date(date);
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
}

function getTodayString() {
  return formatDate(new Date());
}

function addMonths(dateString, offset) {
  const date = parseDate(dateString);
  date.setDate(1);
  date.setMonth(date.getMonth() + offset);
  return formatDate(date);
}

function getMonthStart(dateString) {
  const date = parseDate(dateString);
  date.setDate(1);
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
    monthLabel: `${year}.${pad(month)}`
  };
}

module.exports = {
  addMonths,
  formatDate,
  getMonthMeta,
  getMonthStart,
  getTodayString,
  parseDate
};
