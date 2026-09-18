
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
 * Safely get Capacitor from global or window if running inside Capacitor native app
 */
export function getCapacitor() {
  if (typeof window !== 'undefined' && window.Capacitor) {
    return window.Capacitor;
  }
  if (typeof globalThis !== 'undefined' && globalThis.Capacitor) {
    return globalThis.Capacitor;
  }
  return null;
}

/**
 * Check if running inside Capacitor native mobile platform (Android/iOS APK)
 */
export function isNativeApp() {
  const cap = getCapacitor();
  return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
}

/**
 * Safely get CapacitorCalendar plugin instance in native environment
 */
export function getCalendarPlugin() {
  const cap = getCapacitor();
  if (!cap) return null;
  if (cap.Plugins && cap.Plugins.CapacitorCalendar) {
    return cap.Plugins.CapacitorCalendar;
  }
  if (typeof cap.registerPlugin === 'function') {
    return cap.registerPlugin('CapacitorCalendar');
  }
  return null;
}

/**
 * Check if the current environment is Android browser/OS
 */
export function isAndroid() {
  return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent || '');
}

/**
 * Sanitize event title to a valid, clean filename with .ics extension
 * Removes illegal characters: \ / : * ? " < > | \r \n \t
 * @param {string} [title]
 * @returns {string}
 */
export function getSafeICSFilename(title = '') {
  const sanitized = String(title || '')
    .trim()
    .replace(/[\r\n\t\\/:*?"<>|]/g, '_')
    .replace(/_+/g, '_')
    .trim();
  const base = sanitized || '日程';
  return base.endsWith('.ics') ? base : `${base}.ics`;
}

/**
 * Download standard .ics file via Blob in browser
 * @param {string} icsContent
 * @param {string} [filename]
 */
export function downloadICSFile(icsContent, filename = 'schedule.ics') {
  const safeFilename = filename.endsWith('.ics') ? filename : `${filename}.ics`;
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', safeFilename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Trigger calendar open/import for a schedule event
 * - Only in APK (Capacitor native app): directly invokes system calendar via @capgo/capacitor-calendar
 * - In Web browser: ONLY downloads standard .ics file using frontend Blob, with parsed event title as filename
 * @param {Object} event
 */
export async function openCalendarEvent(event) {
  // 1. Native Capacitor environment (APK)
  if (isNativeApp()) {
    const calendarPlugin = getCalendarPlugin();
    if (calendarPlugin) {
      try {
        // Request write permission if not granted
        try {
          if (typeof calendarPlugin.requestWriteOnlyCalendarAccess === 'function') {
            await calendarPlugin.requestWriteOnlyCalendarAccess();
          }
        } catch (permErr) {
          console.warn('Calendar permission prompt:', permErr);
        }

        const startMs = new Date(event.startTime).getTime();
        let endMs = new Date(event.endTime).getTime();
        if (!endMs || isNaN(endMs) || endMs <= startMs) {
          endMs = startMs + (event.allDay ? 86400000 : 3600000);
        }

        // Launch native system calendar event creation UI with prefilled fields
        await calendarPlugin.createEventWithPrompt({
          title: event.title || '日程安排',
          startDate: startMs,
          endDate: endMs,
          isAllDay: Boolean(event.allDay),
          location: event.location || '',
          description: [
            event.description || '',
            event.url ? `链接: ${event.url}` : ''
          ].filter(Boolean).join('\n')
        });
        return { success: true, method: 'capacitor' };
      } catch (err) {
        console.warn('createEventWithPrompt error, attempting fallback to openCalendar:', err);
        try {
          if (typeof calendarPlugin.openCalendar === 'function') {
            await calendarPlugin.openCalendar({
              date: new Date(event.startTime).getTime()
            });
            return { success: true, method: 'capacitor' };
          }
        } catch (openErr) {
          console.error('Capacitor openCalendar failed:', openErr);
        }
      }
    }
  }

  // 2. Web Browser: ONLY generate Blob and trigger .ics file download with parsed event title
  const icsData = buildICS(event);
  const filename = getSafeICSFilename(event.title);
  downloadICSFile(icsData, filename);
  return { success: true, method: 'web', filename };
}

/**
 * Trigger download of ICS file in browser
 * @param {string} icsContent
 * @param {string} [filename]
 */
export function downloadICS(icsContent, filename = 'schedule.ics') {
  downloadICSFile(icsContent, filename);
}

