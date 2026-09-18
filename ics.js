/**
 * ICS (iCalendar RFC 5545) generator
 */

export function padZero(num, size = 2) {
  return String(num).padStart(size, '0');
}

/**
 * Format a Date object to iCalendar date-time string
 * If allDay is true, returns YYYYMMDD
 * Otherwise returns YYYYMMDDTHHMMSS
 */
export function formatICSDate(date, allDay = false) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = padZero(d.getMonth() + 1);
  const day = padZero(d.getDate());
  
  if (allDay) {
    return `${year}${month}${day}`;
  }
  
  const hours = padZero(d.getHours());
  const minutes = padZero(d.getMinutes());
  const seconds = padZero(d.getSeconds());
  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

/**
 * Format UTC date for DTSTAMP
 */
export function formatUTC(date = new Date()) {
  const d = new Date(date);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Escape text for iCalendar format
 */
export function escapeICSText(str = '') {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Generate unique UID
 */
export function generateUID() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}@calgen.pages.dev`;
}

/**
 * Build ICS content from event object
 * @param {Object} event
 * @param {string} event.id
 * @param {string} event.title
 * @param {Date|string|number} event.startTime
 * @param {Date|string|number} event.endTime
 * @param {boolean} [event.allDay]
 * @param {string} [event.location]
 * @param {string} [event.description]
 * @param {string} [event.url]
 * @param {number} [event.alarmMinutes] - reminder in minutes before start, e.g. 15
 * @returns {string}
 */
export function buildICS(event) {
  const now = new Date();
  const uid = event.id || generateUID();
  const dtstamp = formatUTC(now);
  const allDay = !!event.allDay;
  
  const startDate = new Date(event.startTime);
  const endDate = event.endTime ? new Date(event.endTime) : new Date(startDate.getTime() + 60 * 60 * 1000);
  
  const dtStartProp = allDay 
    ? `DTSTART;VALUE=DATE:${formatICSDate(startDate, true)}`
    : `DTSTART:${formatICSDate(startDate, false)}`;

  // For all-day events, RFC 5545 states DTEND is non-inclusive, so add 1 day if start == end
  let dtEndProp;
  if (allDay) {
    const nextDay = new Date(endDate.getTime());
    if (nextDay.getTime() <= startDate.getTime()) {
      nextDay.setDate(nextDay.getDate() + 1);
    }
    dtEndProp = `DTEND;VALUE=DATE:${formatICSDate(nextDay, true)}`;
  } else {
    dtEndProp = `DTEND:${formatICSDate(endDate, false)}`;
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CalGen//Calendar Generator//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    dtStartProp,
    dtEndProp,
    `SUMMARY:${escapeICSText(event.title || '日程安排')}`,
  ];

  if (event.location && event.location.trim()) {
    lines.push(`LOCATION:${escapeICSText(event.location.trim())}`);
  }

  if (event.description && event.description.trim()) {
    lines.push(`DESCRIPTION:${escapeICSText(event.description.trim())}`);
  }

  if (event.url && event.url.trim()) {
    lines.push(`URL:${escapeICSText(event.url.trim())}`);
  }

  // Add 15 min reminder by default or custom
  const alarmMins = event.alarmMinutes !== undefined ? event.alarmMinutes : 15;
  if (alarmMins >= 0 && !allDay) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeICSText(event.title || '日程提醒')}`,
      `TRIGGER:-PT${alarmMins}M`,
      'END:VALARM'
    );
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.join('\r\n');
}

/**
 * Directly trigger system calendar import via Base64 data URI
 * Avoids Blob and link.download so browsers directly prompt to import into calendar
 * @param {string} icsString
 */
export function openDirectCalendar(icsString) {
  // 1. 转为 base64 的 data URI
  const base64Data = btoa(unescape(encodeURIComponent(icsString)));
  const dataUri = `data:text/calendar;charset=utf8;base64,${base64Data}`;

  // 2. 直接赋值给 window.location 或打开窗口
  // 在 iOS Safari 和部分 Android 浏览器中，系统检测到 text/calendar 会直接唤起日历确认弹窗
  window.location.href = dataUri;
}

/**
 * Trigger download / open of ICS file in browser (compatibility wrapper)
 * @param {string} icsContent
 * @param {string} [filename]
 */
export function downloadICS(icsContent, filename = 'schedule.ics') {
  openDirectCalendar(icsContent);
}
