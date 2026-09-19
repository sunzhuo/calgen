/**
 * Schedule Natural Language Parser
 * Parses Chinese and English date/time/location/title texts
 */

const CHINESE_NUMS = {
  '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  '十一': 11, '十二': 12
};

function parseChineseNumber(str) {
  if (!str) return null;
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  if (CHINESE_NUMS[str] !== undefined) return CHINESE_NUMS[str];
  if (str.startsWith('十')) {
    const unit = str.substring(1);
    return 10 + (CHINESE_NUMS[unit] || 0);
  }
  return null;
}

const WEEKDAY_MAP = {
  '一': 1, '1': 1, 'mon': 1, 'monday': 1,
  '二': 2, '2': 2, 'tue': 2, 'tuesday': 2,
  '三': 3, '3': 3, 'wed': 3, 'wednesday': 3,
  '四': 4, '4': 4, 'thu': 4, 'thursday': 4,
  '五': 5, '5': 5, 'fri': 5, 'friday': 5,
  '六': 6, '6': 6, 'sat': 6, 'saturday': 6,
  '日': 0, '天': 0, '0': 0, '7': 0, 'sun': 0, 'sunday': 0,
  '末': 6 // 周末 default to Saturday
};

/**
 * Get target date for a weekday
 * @param {Date} baseDate
 * @param {number} targetDay - 0 (Sun) to 6 (Sat)
 * @param {number} weekOffset - 0 (this week or next upcoming), 1 (next week), 2 (week after next)
 * @param {boolean} explicitThisWeek - whether user explicitly said "本周/这周"
 */
function getWeekdayDate(baseDate, targetDay, weekOffset = 0, explicitThisWeek = false) {
  const date = new Date(baseDate);
  const currentDay = date.getDay(); // 0 is Sunday, 1 is Monday ... 6 is Saturday
  
  // Calculate day difference
  let diff = targetDay - currentDay;
  
  if (weekOffset > 0) {
    // e.g. "下周" means next week: move forward by (7 * weekOffset) plus difference
    diff = diff + (weekOffset * 7);
  } else if (!explicitThisWeek) {
    // If user says "周五" without "这周", and today is past or on that day, default to next occurrence
    if (diff <= 0) {
      diff += 7;
    }
  }
  
  date.setDate(date.getDate() + diff);
  return date;
}

/**
 * Sanitize and clean event title to keep it concise, clear, and focused on the core subject.
 * Strips salutations, polite greetings, boilerplate announcement prefixes/suffixes, and emojis.
 * @param {string} rawTitle
 * @returns {string}
 */
export function cleanEventTitle(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return '日程安排';
  let t = rawTitle.trim();

  // 1. Strip bracket emojis (e.g. [握手], [OK], [强], [玫瑰], [微笑])
  t = t.replace(/\[[\u4e00-\u9fa5a-zA-Z0-9_\-]+\]/g, '');

  // 2. Strip salutations and greetings from the start
  // e.g., 各位老师下午好, 各位领导好, 老师们好, 大家好, 亲爱的同事们, Hi all, Good morning, etc.
  t = t.replace(/^(?:各位(?:老师|领导|同事|同学|朋友|专家|会员|同仁|代表|家长|评审|评委)?(?:下午好|上午好|中午好|晚上好|好)?|[大各]家(?:下午好|上午好|中午好|晚上好|好)?|亲爱的.+?[好！!，,\s]|(?:Good\s+(?:morning|afternoon|evening)|Hi|Hello|Dear)\s+[^,，!！]+[,，!！]?)+[\s,，:：\-]*/i, '');

  // 3. Strip notification / announcement prefixes
  // e.g., 关于召开..., 关于举办..., 会议通知:, 通知:, 日程安排:
  t = t.replace(/^(?:关于(?:举办|召开|组织|开展)?|通知[：:]|紧急通知[：:]|会议通知[：:]|日程安排[：:]|日程[：:])/g, '');

  // 4. Strip announcement boilerplate suffixes: ...安排如下, ...日程如下, ...通知如下, 如下, 的通知, 的安排
  // Note: Carefully keep the core subject intact (e.g. 预答辩, 答辩, 总结会)
  t = t.replace(/(?:的?(?:工作|日程|会议)?安排如下[：:]*|安排如下[：:]*|日程如下[：:]*|通知如下[：:]*|如下[：:]*|的通知|的安排)$/g, '');

  // 5. Strip polite calls to action: 请各位老师预留时间参加, 请准时出席, 谢谢
  t = t.replace(/请(?:各位|大家)?.+?(?:参加|出席|预留时间).*$/g, '');
  t = t.replace(/(?:谢谢|致谢|收到请回复).*$/g, '');

  // 6. Clean leading/trailing punctuation and whitespace
  t = t.replace(/^[\s,，.。;；:：!！\-—~～\(\)（）]+|[\s,，.。;；:：!！\-—~～\(\)（）]+$/g, '').trim();

  return t || '日程安排';
}

/**
 * Main parser function
 * @param {string} text - User input schedule text
 * @param {Date} [referenceDate] - Base date for relative calculations
 * @returns {Object|null} Parsed event object
 */
export function parseScheduleText(text, referenceDate = new Date()) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const now = new Date(referenceDate);
  let matchedDate = null;
  let allDay = false;
  let startHours = null;
  let startMinutes = null;
  let endHours = null;
  let endMinutes = null;
  let durationMinutes = null;
  let location = '';
  let url = '';
  let explicitTitle = '';

  // Extract explicit URL (meeting link or website)
  const urlMatch = trimmed.match(/(https?:\/\/[^\s]+)/i);
  if (urlMatch) {
    url = urlMatch[1];
  }

  // Extract Tencent Meeting / Zoom meeting numbers
  const tencentMatch = trimmed.match(/腾讯会议[：:\s]*(\d{3}[-\s]?\d{3}[-\s]?\d{3,4})/i);
  if (tencentMatch) {
    const meetingCode = tencentMatch[1].replace(/[-\s]/g, '');
    const meetingUrl = `https://meeting.tencent.com/dm/${meetingCode}`;
    if (!url) url = meetingUrl;
  }
  const zoomMatch = trimmed.match(/Zoom[：:\s]*(\d{3}[-\s]?\d{3}[-\s]?\d{3,4})/i);
  if (zoomMatch) {
    const meetingCode = zoomMatch[1].replace(/[-\s]/g, '');
    if (!url) url = `zoommtg://zoom.us/join?confno=${meetingCode}`;
  }

  // Check explicit title / location lines or fields
  const explicitTitleMatch = trimmed.match(/(?:主题|日程|事项|事件|标题|会议名称)[：:\s]+([^\n,，;；]+)/i);
  if (explicitTitleMatch) {
    explicitTitle = explicitTitleMatch[1].trim();
  }

  const explicitLocMatch = trimmed.match(/(?:地点|位置|地址|会议室|场所)[：:\s]+([^\n,，;；]+)/i);
  if (explicitLocMatch) {
    location = explicitLocMatch[1].trim();
  }

  // If no explicit location, find inline location patterns
  if (!location) {
    // English: match "at [Location]" that is not a time
    const enAtMatches = [...trimmed.matchAll(/\bat\s+([a-zA-Z0-9][a-zA-Z0-9\s]{1,25}?)(?=\s+with|\s+on|\s+for|\s+at|$|[,\.])/gi)];
    for (const m of enAtMatches) {
      const candidate = m[1].trim();
      if (!/^(?:the|a|an|\d+(?::\d+)?\s*(?:am|pm)?)$/i.test(candidate)) {
        location = candidate;
        break;
      }
    }
  }

  if (!location) {
    // Chinese: "在 [会议室|万达广场|...] (开会|举行|聚餐|...)" or "在 [地点]"
    const inlineLocMatch = trimmed.match(/在\s*([a-zA-Z0-9\u4e00-\u9fa5\-_—\(\)（）#]{2,20}?)(?=\s*(?:开会|举行|集合|碰头|见面|聚餐|举办|进行|线上|等|[，,。！!\n]|$))/i);
    if (inlineLocMatch) {
      const candidate = inlineLocMatch[1].trim();
      // Ensure candidate doesn't look like a time or relative date
      if (!/^(今天|明天|后天|昨天|周|星期|上午|下午|晚上|\d+)/.test(candidate)) {
        location = candidate;
      }
    }
  }

  // 1. DATE PARSING
  // Check relative dates: 今天, 明天, 后天, 大后天, 昨天, 今日, 明日, 昨日
  const relDateMatch = trimmed.match(/(大后天|后天|明天|明日|今天|今日|昨天|昨日)/);
  if (relDateMatch) {
    matchedDate = new Date(now);
    const word = relDateMatch[1];
    if (word === '大后天') matchedDate.setDate(matchedDate.getDate() + 3);
    else if (word === '后天') matchedDate.setDate(matchedDate.getDate() + 2);
    else if (word === '明天' || word === '明日') matchedDate.setDate(matchedDate.getDate() + 1);
    else if (word === '昨天' || word === '昨日') matchedDate.setDate(matchedDate.getDate() - 1);
    // 今天: offset 0
  }

  // Check English relative dates: tomorrow, today, yesterday, day after tomorrow
  if (!matchedDate) {
    const enRelMatch = trimmed.match(/\b(day after tomorrow|tomorrow|today|yesterday)\b/i);
    if (enRelMatch) {
      matchedDate = new Date(now);
      const word = enRelMatch[1].toLowerCase();
      if (word === 'tomorrow') matchedDate.setDate(matchedDate.getDate() + 1);
      else if (word === 'day after tomorrow') matchedDate.setDate(matchedDate.getDate() + 2);
      else if (word === 'yesterday') matchedDate.setDate(matchedDate.getDate() - 1);
    }
  }

  // Check weekday in Chinese:
  // (下下周|下周|下个星期|下星期|下礼拜|本周|这周|这个星期|这礼拜|周|星期|礼拜) + [一二三四五六日天末12345670]
  if (!matchedDate) {
    const weekRegex = /(?:(下下周|下下个星期|下下星期|下周末|下周|下个星期|下星期|下礼拜|这周末|本周末|本周|这周|这个星期|这礼拜)\s*([一二三四五六日天末12345670])?|(?:周|星期|礼拜)\s*([一二三四五六日天末12345670]))/i;
    const weekMatch = trimmed.match(weekRegex);

    if (weekMatch) {
      const prefix = weekMatch[1] || '';
      let dayChar = weekMatch[2] || weekMatch[3];
      let weekOffset = 0;
      let explicitThisWeek = false;

      if (prefix.includes('下下')) {
        weekOffset = 2;
      } else if (prefix.includes('下')) {
        weekOffset = 1;
      } else if (prefix.includes('本') || prefix.includes('这')) {
        explicitThisWeek = true;
      }

      if (prefix.includes('周末')) {
        dayChar = '六';
      }

      if (dayChar) {
        const targetDay = WEEKDAY_MAP[dayChar] !== undefined ? WEEKDAY_MAP[dayChar] : 1;
        matchedDate = getWeekdayDate(now, targetDay, weekOffset, explicitThisWeek);
      }
    }
  }

  // Check absolute date: YYYY年MM月DD日, YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
  if (!matchedDate) {
    const ymdMatch = trimmed.match(/(\d{4})[\.\/\-年](\d{1,2})[\.\/\-月](\d{1,2})[日号]?/);
    if (ymdMatch) {
      const year = parseInt(ymdMatch[1], 10);
      const month = parseInt(ymdMatch[2], 10) - 1;
      const day = parseInt(ymdMatch[3], 10);
      matchedDate = new Date(year, month, day);
    }
  }

  // Check MM月DD日 / MM-DD / MM/DD
  if (!matchedDate) {
    const mdMatch = trimmed.match(/(\d{1,2})月(\d{1,2})[日号]?/) ||
      trimmed.match(/(?:^|[^\d])(\d{1,2})[\/\-](\d{1,2})(?!\d)/);
    if (mdMatch) {
      const month = parseInt(mdMatch[1], 10) - 1;
      const day = parseInt(mdMatch[2], 10);
      let year = now.getFullYear();
      if (month < now.getMonth() - 2) {
        year += 1;
      }
      matchedDate = new Date(year, month, day);
    }
  }

  // Check relative days: "X天后", "X天以后"
  if (!matchedDate) {
    const daysLaterMatch = trimmed.match(/(\d+|[一二两三四五六七八九十]+)天[之以]?后/);
    if (daysLaterMatch) {
      const d = parseChineseNumber(daysLaterMatch[1]) || parseInt(daysLaterMatch[1], 10) || 1;
      matchedDate = new Date(now);
      matchedDate.setDate(matchedDate.getDate() + d);
    }
  }

  // Default to today if no date found
  if (!matchedDate) {
    matchedDate = new Date(now);
  }

  // 2. TIME PARSING
  // Check for duration: 持续2小时, 开会半小时, 45分钟, 1.5小时
  const durMatch = trimmed.match(/(?:持续|时长|大概|预计)?(\d+(?:\.\d+)?|[一二两三四五半]+)\s*(?:个)?(小时|分钟|hr|hrs|min|mins)/i);
  if (durMatch) {
    const unit = durMatch[2].toLowerCase();
    const numStr = durMatch[1];
    let val = 1;
    if (numStr === '半') {
      val = 0.5;
    } else {
      const parsed = parseChineseNumber(numStr);
      val = parsed !== null ? parsed : parseFloat(numStr) || 1;
    }
    if (unit.startsWith('小') || unit.startsWith('hr')) {
      durationMinutes = Math.round(val * 60);
    } else {
      durationMinutes = Math.round(val);
    }
  }

  // Check period modifier: 早上/上午/中午/下午/晚上/夜里/凌晨/pm/am
  let isPM = false;
  let isAM = false;
  if (/下午|傍晚|晚上|夜里|半夜|\bpm\b/i.test(trimmed)) {
    isPM = true;
  } else if (/中午/.test(trimmed)) {
    isPM = true;
  } else if (/早上|清晨|早晨|上午|凌晨|\bam\b/i.test(trimmed)) {
    isAM = true;
  }

  // Check time ranges like "14:00-16:30" or "下午2点到4点半" or "9:00 ~ 11:30"
  const rangeMatch = trimmed.match(/(\d{1,2})[:：](\d{2})\s*(?:-|~|至|到)\s*(\d{1,2})[:：](\d{2})/) ||
    trimmed.match(/(?:(?:上午|下午|晚上|中午|凌晨)?\s*(\d{1,2}|[一二两三四五六七八九十]+)\s*点(?:(\d{1,2}|半|一刻|三刻)分?)?)\s*(?:-|~|至|到)\s*(?:(?:上午|下午|晚上|中午|凌晨)?\s*(\d{1,2}|[一二两三四五六七八九十]+)\s*点(?:(\d{1,2}|半|一刻|三刻)分?)?)/);

  if (rangeMatch) {
    if (rangeMatch[0].includes(':') || rangeMatch[0].includes('：')) {
      startHours = parseInt(rangeMatch[1], 10);
      startMinutes = parseInt(rangeMatch[2], 10);
      endHours = parseInt(rangeMatch[3], 10);
      endMinutes = parseInt(rangeMatch[4], 10);
      if (isPM && startHours < 12) startHours += 12;
      if (isPM && endHours < 12) endHours += 12;
    } else {
      const shRaw = parseChineseNumber(rangeMatch[1]) || parseInt(rangeMatch[1], 10);
      let sm = 0;
      if (rangeMatch[2] === '半') sm = 30;
      else if (rangeMatch[2] === '一刻') sm = 15;
      else if (rangeMatch[2] === '三刻') sm = 45;
      else if (rangeMatch[2]) sm = parseInt(rangeMatch[2], 10);

      const ehRaw = parseChineseNumber(rangeMatch[3]) || parseInt(rangeMatch[3], 10);
      let em = 0;
      if (rangeMatch[4] === '半') em = 30;
      else if (rangeMatch[4] === '一刻') em = 15;
      else if (rangeMatch[4] === '三刻') em = 45;
      else if (rangeMatch[4]) em = parseInt(rangeMatch[4], 10);

      startHours = shRaw;
      startMinutes = sm;
      endHours = ehRaw;
      endMinutes = em;

      if (isPM) {
        if (startHours < 12) startHours += 12;
        if (endHours < 12) endHours += 12;
      }
    }
  }

  // Single time match: "14:30" or "下午3点半" or "10点" or "3pm"
  if (startHours === null) {
    const timeMatch = trimmed.match(/(?:^|[^\d])(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?(?:\s*(am|pm))?/i);
    if (timeMatch) {
      startHours = parseInt(timeMatch[1], 10);
      startMinutes = parseInt(timeMatch[2], 10);
      const ampm = timeMatch[4] ? timeMatch[4].toLowerCase() : null;
      if (ampm === 'pm' && startHours < 12) startHours += 12;
      if (ampm === 'am' && startHours === 12) startHours = 0;
      if (!ampm && isPM && startHours < 12) startHours += 12;
    }
  }

  if (startHours === null) {
    const pointMatch = trimmed.match(/(\d{1,2}|[一二两三四五六七八九十]+)\s*点(?:(\d{1,2}|半|一刻|三刻)分?)?/);
    if (pointMatch) {
      startHours = parseChineseNumber(pointMatch[1]) || parseInt(pointMatch[1], 10);
      if (pointMatch[2] === '半') startMinutes = 30;
      else if (pointMatch[2] === '一刻') startMinutes = 15;
      else if (pointMatch[2] === '三刻') startMinutes = 45;
      else if (pointMatch[2]) startMinutes = parseInt(pointMatch[2], 10);
      else startMinutes = 0;

      if (isPM && startHours < 12) {
        startHours += 12;
      } else if (isAM && startHours === 12) {
        startHours = 0;
      }
    }
  }

  if (startHours === null) {
    const enMatch = trimmed.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    if (enMatch) {
      startHours = parseInt(enMatch[1], 10);
      startMinutes = enMatch[2] ? parseInt(enMatch[2], 10) : 0;
      const ampm = enMatch[3].toLowerCase();
      if (ampm === 'pm' && startHours < 12) startHours += 12;
      if (ampm === 'am' && startHours === 12) startHours = 0;
    }
  }

  // All-day check or default
  if (startHours === null) {
    if (/全天|整天|\ball[\s\-]day\b|放假|休假|纪念日|生日/.test(trimmed) || !trimmed.match(/\d|点|分/)) {
      allDay = true;
      startHours = 9;
      startMinutes = 0;
    } else {
      startHours = 9;
      startMinutes = 0;
    }
  } else {
    if (startMinutes === null) startMinutes = 0;
  }

  const startDate = new Date(matchedDate);
  startDate.setHours(startHours, startMinutes, 0, 0);

  let endDate;
  if (endHours !== null && endMinutes !== null) {
    endDate = new Date(matchedDate);
    endDate.setHours(endHours, endMinutes, 0, 0);
    if (endDate.getTime() <= startDate.getTime()) {
      endDate.setDate(endDate.getDate() + 1);
    }
  } else if (durationMinutes) {
    endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);
  } else if (allDay) {
    endDate = new Date(startDate.getTime());
  } else {
    endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
  }

  // 3. TITLE EXTRACTION
  let title = explicitTitle ? cleanEventTitle(explicitTitle) : '';
  if (!title) {
    let cleaned = trimmed;

    // Remove URLs
    cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, '');
    cleaned = cleaned.replace(/腾讯会议[：:\s]*\d{3}[-\s]?\d{3}[-\s]?\d{3,4}/gi, '');
    cleaned = cleaned.replace(/Zoom[：:\s]*\d{3}[-\s]?\d{3}[-\s]?\d{3,4}/gi, '');

    // Remove explicit location fields
    cleaned = cleaned.replace(/(?:地点|位置|地址|会议室|场所)[：:\s]+[^\n,，;；]+/gi, '');

    // Remove English "at [Location]" if location was extracted
    if (location) {
      const escapedLoc = location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      cleaned = cleaned.replace(new RegExp(`\\bat\\s+${escapedLoc}\\b`, 'i'), '');
      cleaned = cleaned.replace(new RegExp(`在\\s*${escapedLoc}`, 'gi'), '');
    }

    // Remove relative dates (Chinese and English)
    cleaned = cleaned.replace(/(大后天|后天|明天|明日|今天|今日|昨天|昨日)/g, '');
    cleaned = cleaned.replace(/\b(day after tomorrow|tomorrow|today|yesterday)\b/gi, '');
    cleaned = cleaned.replace(/(?:(?:下下周|下下个星期|下下星期|下周末|下周|下个星期|下星期|下礼拜|这周末|本周末|本周|这周|这个星期|这礼拜)\s*[一二三四五六日天末12345670]?|(?:周|星期|礼拜)[一二三四五六日天末12345670])/gi, '');
    cleaned = cleaned.replace(/(\d+|[一二两三四五六七八九十]+)天[之以]?后/g, '');

    // Remove absolute dates
    cleaned = cleaned.replace(/\d{4}[\.\/\-年]\d{1,2}[\.\/\-月]\d{1,2}[日号]?/g, '');
    cleaned = cleaned.replace(/\d{1,2}月\d{1,2}[日号]?/g, '');

    // Remove time expressions
    cleaned = cleaned.replace(/(\d{1,2})[:：](\d{2})\s*(?:-|~|至|到)\s*(\d{1,2})[:：](\d{2})/g, '');
    cleaned = cleaned.replace(/(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?\s*(?:am|pm)?/gi, '');
    cleaned = cleaned.replace(/(?:上午|下午|晚上|中午|凌晨)?\s*(?:\d{1,2}|[一二两三四五六七八九十]+)\s*点(?:(?:\d{1,2}|半|一刻|三刻)分?)?/g, '');
    cleaned = cleaned.replace(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, '');
    cleaned = cleaned.replace(/(?:早上|清晨|早晨|上午|中午|下午|傍晚|晚上|夜里|半夜|凌晨)/g, '');
    cleaned = cleaned.replace(/(?:持续|时长|大概|预计)?(?:\d+(?:\.\d+)?|[一二两三四五半]+)\s*(?:个)?(?:小时|分钟|hr|hrs|min|mins)/gi, '');
    cleaned = cleaned.replace(/(?:全天|整天|\ball[\s\-]day\b)/gi, '');

    // Remove filler keywords
    cleaned = cleaned.replace(/(?:提醒我|备忘|安排|请参加|请大家|准时|参加)/g, '');

    // Clean leading/trailing punctuation and whitespace
    cleaned = cleaned.replace(/^[\s,，.。;；:：!！\-—~～]+/g, '').replace(/[\s,，.。;；:：!！\-—~～]+$/g, '');

    const candidateLines = cleaned.split(/\r?\n/)
      .map(s => cleanEventTitle(s))
      .filter(s => s && s !== '日程安排');
    title = candidateLines.length > 0 ? candidateLines[0] : '';
    if (!title || title.length < 2) {
      title = '日程安排';
    }
  }

  title = cleanEventTitle(title);

  if (title.length > 60) {
    title = title.substring(0, 60).trim() + '...';
  }

  return {
    id: `event-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    title: title || '日程安排',
    startTime: startDate.toISOString(),
    endTime: endDate.toISOString(),
    allDay,
    location: location || '',
    description: trimmed,
    url: url || '',
    alarmMinutes: 15,
    createdAt: new Date().toISOString(),
    parserType: 'local'
  };
}

export const GEMMA_MODEL_ID = '@cf/google/gemma-4-26b-a4b-it';

/**
 * Parse schedule using Cloudflare Workers AI model @cf/google/gemma-4-26b-a4b-it
 * @param {string} text
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function parseScheduleWithGemma(text, options = {}) {
  const {
    apiEndpoint = '/api/parse',
    accountId = '',
    apiToken = '',
    referenceDate = new Date(),
    signal = null,
    timeoutMs = 8000
  } = options;

  const headers = {
    'Content-Type': 'application/json',
  };
  if (accountId) headers['X-CF-Account-ID'] = accountId;
  if (apiToken) headers['X-CF-API-Token'] = apiToken;

  const body = {
    text: text.trim(),
    clientTime: referenceDate.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
  };

  // Setup timeout controller
  const timeoutController = new AbortController();
  const timerId = setTimeout(() => {
    timeoutController.abort(new Error('AI parse request timed out'));
  }, timeoutMs);

  let effectiveSignal = timeoutController.signal;
  if (signal) {
    if (typeof AbortSignal.any === 'function') {
      effectiveSignal = AbortSignal.any([signal, timeoutController.signal]);
    } else {
      signal.addEventListener('abort', () => timeoutController.abort(signal.reason), { once: true });
    }
  }

  let res;
  try {
    res = await fetch(apiEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: effectiveSignal
    });
  } finally {
    clearTimeout(timerId);
  }

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || `API error ${res.status}`);
  }

  const json = await res.json();
  if (!json.success || !json.data) {
    throw new Error(json.message || 'AI failed to parse schedule');
  }

  const d = json.data;

  let startDate = d.startTime ? new Date(d.startTime) : new Date(referenceDate);
  if (isNaN(startDate.getTime())) {
    startDate = new Date(referenceDate);
  }

  let endDate;
  if (d.endTime) {
    endDate = new Date(d.endTime);
    if (isNaN(endDate.getTime())) {
      endDate = new Date(startDate.getTime() + (d.allDay ? 0 : 3600000));
    }
  } else {
    endDate = new Date(startDate.getTime() + (d.allDay ? 0 : 3600000));
  }

  return {
    id: `event-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    title: cleanEventTitle(d.title || '日程安排'),
    startTime: startDate.toISOString(),
    endTime: endDate.toISOString(),
    allDay: !!d.allDay,
    location: d.location || '',
    description: d.description || text.trim(),
    url: d.url || '',
    alarmMinutes: 15,
    createdAt: new Date().toISOString(),
    parserType: 'gemma-4-26b-a4b-it'
  };
}

/**
 * Unified schedule parser: attempts Gemma 4 26B AI parsing first,
 * with immediate transparent fallback to rule-based parser.
 * @param {string} text
 * @param {Object} [options]
 * @returns {Promise<Object|null>}
 */
export async function parseScheduleTextAsync(text, options = {}) {
  if (!text || !text.trim()) return null;

  // If useAi is explicitly disabled, directly use local parser
  if (options.useAi === false) {
    return parseScheduleText(text, options.referenceDate);
  }

  try {
    const aiEvent = await parseScheduleWithGemma(text, options);
    return aiEvent;
  } catch (err) {
    console.info('Gemma AI parsing unavailable or failed, fallback to local parser:', err.message);
    return parseScheduleText(text, options.referenceDate);
  }
}

/**
 * Check if an event is outdated (ended before now)
 * @param {Object} event
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isEventOutdated(event, now = new Date()) {
  if (!event || !event.endTime) return false;
  const end = new Date(event.endTime);
  return end.getTime() < now.getTime();
}
