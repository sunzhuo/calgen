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

  // 3. Strip recipient vocatives at the beginning (e.g. "孙卓，", "张老师：", "@所有人 ", "@李工: ")
  t = t.replace(/^(?:[A-Za-z\u4e00-\u9fa5]{2,5}|@\S+)[，,：:\s]+(?=(?:我|咱|请|有|下周|明天|后天|今天|关于|原定|现|麻烦|想|由于|因|各位))/i, '');

  // 4. Strip notification / announcement prefixes
  // e.g., 关于召开..., 关于举办..., 会议通知:, 通知:, 日程安排:
  t = t.replace(/^(?:关于(?:举办|召开|组织|开展)?|通知[：:]|紧急通知[：:]|会议通知[：:]|日程安排[：:]|日程[：:])/g, '');

  // 5. Strip first-person and conversational intent prefixes
  // e.g., "我有两个博士计划预答辩" -> "两个博士计划预答辩", "我们打算开项目周会" -> "开项目周会"
  t = t.replace(/^(?:我(?:们)?|咱(?:们)?)(?:[这里边儿]+)?(?:[有想打算计划准备要需]|希望|拟|预备|准备)+[\s,，]*/i, '');
  t = t.replace(/^(?:请问|麻烦问下|想问下|想请问|不知道你?|请问下)[\s,，]*/i, '');

  // 6. Strip intermediate intent verbs before core schedule verbs/nouns
  // e.g., "两个博士计划预答辩" -> "两个博士预答辩"
  t = t.replace(/(?:\s*(?:计划|准备|打算|拟|预备)\s*)(?=(?:预答辩|答辩|开会|讨论|评审|评审会|研讨|汇报|开题|开题报告|结题|复试|面试|聚餐|碰头|交流|上线|发布))/i, '');

  // 7. Strip leading action verbs like "开", "参加", "举行", "举办" if followed by event noun
  // e.g. "开团队周会" -> "团队周会", "举行答辩" -> "答辩"
  t = t.replace(/^(?:开|举行|举办|参加|召开)\s*(?=[A-Za-z0-9\u4e00-\u9fa5]{2,}(?:周会|例会|会议|答辩|预答辩|评审|研讨|讨论|汇报|宣讲|典礼|仪式|发布会))/i, '');

  // 8. Strip announcement boilerplate suffixes: ...安排如下, ...日程如下, ...通知如下, 如下, 的通知, 的安排
  t = t.replace(/(?:的?(?:工作|日程|会议)?安排如下[：:]*|安排如下[：:]*|日程如下[：:]*|通知如下[：:]*|如下[：:]*|的通知|的安排)$/g, '');

  // 9. Strip polite calls to action and closing conversational question tags
  // e.g., 请各位老师预留时间参加, 请准时出席, 谢谢, 收到请回复
  t = t.replace(/请(?:各位|大家)?.+?(?:参加|出席|预留时间).*$/g, '');
  t = t.replace(/(?:谢谢|致谢|收到请回复).*$/g, '');
  // Question tags / availability checks: 你有时间吧？, 方便吗？, 能来吗？, 可以吗？
  t = t.replace(/(?:[，,、\s]*(?:你?有(?:时间|空)(?:吗|吧|不|呀|呢)?|方便(?:吗|吧|不|呀|呢)?|你方便(?:吗|吧|不|呀|呢)?|你?能(?:来|参加)(?:吗|吧|不)?|能来(?:吗|吧|不)?|能参加(?:吗|吧|不)?|可以吗|可以吧|行不行|好不好|好吗|成吗|吗|吧|么)[\?？!！]*)+$/i, '');

  // 10. Strip residual location remnants: e.g. "，地点，", "地点："
  t = t.replace(/^[，,、\s]*地点[：:\s,，]*/i, '');
  t = t.replace(/[，,、\s]*地点[：:\s,，]*$/i, '');

  // 11. Clean leading/trailing punctuation, quotes, and whitespace
  t = t.replace(/^[\s,，.。;；:：!！\-—~～\(\)（）"“'‘\[\]【】]+|[\s,，.。;；:：!！\-—~～\(\)（）"”'’\[\]【】\?？]+$/g, '').trim();

  return t || '日程安排';
}

/**
 * /**
 * Parse date from natural language text
 * @param {string} str
 * @param {Date} [now]
 * @returns {{ date: Date, text: string } | null}
 */
export function parseDateFromText(str, now = new Date()) {
  if (!str) return null;
  const trimmed = str.trim();

  // 1. Check relative dates: 今天, 明天, 后天, 大后天, 昨天, 今日, 明日, 昨日
  const relDateMatch = trimmed.match(/(大后天|后天|明天|明日|今天|今日|昨天|昨日)/);
  if (relDateMatch) {
    const matchedDate = new Date(now);
    const word = relDateMatch[1];
    if (word === '大后天') matchedDate.setDate(matchedDate.getDate() + 3);
    else if (word === '后天') matchedDate.setDate(matchedDate.getDate() + 2);
    else if (word === '明天' || word === '明日') matchedDate.setDate(matchedDate.getDate() + 1);
    else if (word === '昨天' || word === '昨日') matchedDate.setDate(matchedDate.getDate() - 1);
    return { date: matchedDate, text: word };
  }

  // 2. Check English relative dates: tomorrow, today, yesterday, day after tomorrow
  const enRelMatch = trimmed.match(/\b(day after tomorrow|tomorrow|today|yesterday)\b/i);
  if (enRelMatch) {
    const matchedDate = new Date(now);
    const word = enRelMatch[1].toLowerCase();
    if (word === 'tomorrow') matchedDate.setDate(matchedDate.getDate() + 1);
    else if (word === 'day after tomorrow') matchedDate.setDate(matchedDate.getDate() + 2);
    else if (word === 'yesterday') matchedDate.setDate(matchedDate.getDate() - 1);
    return { date: matchedDate, text: enRelMatch[1] };
  }

  // 3. Check weekday in Chinese
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
      return {
        date: getWeekdayDate(now, targetDay, weekOffset, explicitThisWeek),
        text: weekMatch[0]
      };
    }
  }

  // 4. Check absolute date: YYYY年MM月DD日, YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
  const ymdMatch = trimmed.match(/(\d{4})[\.\/\-年](\d{1,2})[\.\/\-月](\d{1,2})[日号]?/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    return {
      date: new Date(year, month, day),
      text: ymdMatch[0]
    };
  }

  // 5. Check MM月DD日 / MM-DD / MM/DD
  const mdMatch = trimmed.match(/(\d{1,2})月(\d{1,2})[日号]?/) ||
    trimmed.match(/(?:^|[^\d])(\d{1,2})[\/\-](\d{1,2})(?!\d)/);
  if (mdMatch) {
    const month = parseInt(mdMatch[1], 10) - 1;
    const day = parseInt(mdMatch[2], 10);
    let year = now.getFullYear();
    if (month < now.getMonth() - 2) {
      year += 1;
    }
    return {
      date: new Date(year, month, day),
      text: mdMatch[0]
    };
  }

  // 6. Check relative days: "X天后", "X天以后"
  const daysLaterMatch = trimmed.match(/(\d+|[一二两三四五六七八九十]+)天[之以]?后/);
  if (daysLaterMatch) {
    const d = parseChineseNumber(daysLaterMatch[1]) || parseInt(daysLaterMatch[1], 10) || 1;
    const matchedDate = new Date(now);
    matchedDate.setDate(matchedDate.getDate() + d);
    return {
      date: matchedDate,
      text: daysLaterMatch[0]
    };
  }

  return null;
}

/**
 * Parse time information from text
 * @param {string} str
 * @param {Date} targetDate
 * @returns {{ startDate: Date, endDate: Date, allDay: boolean, startHours: number, startMinutes: number }}
 */
export function parseTimeFromText(str, targetDate) {
  const trimmed = str.trim();
  let startHours = null;
  let startMinutes = null;
  let endHours = null;
  let endMinutes = null;
  let durationMinutes = null;
  let allDay = false;

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

  // Check period modifier: 早上/上午/中午/下午/晚上/夜里/半夜/凌晨/pm/am
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

  const startDate = new Date(targetDate);
  startDate.setHours(startHours, startMinutes, 0, 0);

  let endDate;
  if (endHours !== null && endMinutes !== null) {
    endDate = new Date(targetDate);
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

  return {
    startDate,
    endDate,
    allDay,
    startHours,
    startMinutes
  };
}

/**
 * Detect modification/reschedule intent in schedule text
 * @param {string} text
 * @param {Date} [referenceDate]
 * @returns {Object|null}
 */
export function detectModificationIntent(text, referenceDate = new Date()) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();

  const MODIFY_KEYWORD_REGEX = /(?:改为|改到|改在|改期为?|调整为|推迟[到至]|提前[到至]|时间变更为?|变更为?|更正为?|reschedule(?:d)?\s+to|moved\s+to)/i;
  const match = trimmed.match(MODIFY_KEYWORD_REGEX);
  if (!match) return null;

  const beforeRaw = trimmed.slice(0, match.index).trim();
  const afterRaw = trimmed.slice(match.index + match[0].length).trim();

  const keepExistingLocation = /(?:地点不变|地点同上|原地点|保持原地点|原会议室|同原地点|原位置|location unchanged)/i.test(trimmed);
  const keepExistingUrl = /(?:会议号不变|链接不变|线上地址不变|原链接)/i.test(trimmed);

  // Extract original date from beforeRaw
  const origDateRes = parseDateFromText(beforeRaw, referenceDate);
  const originalDateObj = origDateRes ? origDateRes.date : null;
  const originalDateText = origDateRes ? origDateRes.text : '';

  // Extract original time of day from beforeRaw
  let originalTimeOfDay = '';
  if (/下午|傍晚|晚上|夜里|半夜|\bpm\b/i.test(beforeRaw)) {
    originalTimeOfDay = 'afternoon';
  } else if (/早上|清晨|早晨|上午|凌晨|\bam\b/i.test(beforeRaw)) {
    originalTimeOfDay = 'morning';
  } else if (/中午/.test(beforeRaw)) {
    originalTimeOfDay = 'noon';
  }

  // Extract subject / title keywords from beforeRaw
  let subject = beforeRaw;
  subject = subject.replace(/^(?:各位(?:老师|领导|同事|同学|朋友|专家|会员|同仁|代表|家长|评审|评委)?(?:下午好|上午好|中午好|晚上好|好)?|[大各]家(?:下午好|上午好|中午好|晚上好|好)?|亲爱的.+?[好！!，,\s]|(?:Good\s+(?:morning|afternoon|evening)|Hi|Hello|Dear)\s+[^,，!！]+[,，!！]?)+[\s,，:：\-]*/i, '');
  subject = subject.replace(/^(?:由于|因为)[\s\S]+?(?:(?:因此|所以|故|现)[\s,，]*|[，,]\s*(?:因此|所以|故|现)?[\s,，]*)/, '');
  subject = subject.replace(/^(?:因此|所以|故|现)[\s,，]*/, '');
  subject = subject.replace(/(?:原定|原计划|原本)/g, '');
  subject = subject.replace(/(?:(?:下下周|下下个星期|下下星期|下周末|下周|下个星期|下星期|下礼拜|这周末|本周末|本周|这周|这个星期|这礼拜)\s*[一二三四五六日天末12345670]?|(?:周|星期|礼拜)[一二三四五六日天末12345670])/gi, '');
  subject = subject.replace(/(?:大后天|后天|明天|明日|今天|今日|昨天|昨日)/g, '');
  subject = subject.replace(/\b(day after tomorrow|tomorrow|today|yesterday)\b/gi, '');
  subject = subject.replace(/\d{4}[\.\/\-年]\d{1,2}[\.\/\-月]\d{1,2}[日号]?/g, '');
  subject = subject.replace(/\d{1,2}月\d{1,2}[日号]?/g, '');
  subject = subject.replace(/(?:早上|清晨|早晨|上午|中午|下午|傍晚|晚上|夜里|半夜|凌晨)/g, '');
  subject = subject.replace(/(\d{1,2})[:：](\d{2})/g, '');
  subject = subject.replace(/(?:\d{1,2}|[一二两三四五六七八九十]+)\s*点(?:(?:\d{1,2}|半|一刻|三刻)分?)?/g, '');
  subject = subject.replace(/(?:时间|日程|安排|会议)$/, '');
  subject = subject.replace(/^[的\s,，.。;；:：!！\-—~～\(\)（）]+|[的\s,，.。;；:：!！\-—~～\(\)（）]+$/g, '').trim();

  if (!subject || subject === '日程安排') {
    const explicitTitleMatch = trimmed.match(/(?:主题|日程|事项|事件|标题|会议名称)[：:\s]+([^\n,，;；]+)/i);
    if (explicitTitleMatch) {
      subject = explicitTitleMatch[1].trim();
    }
  }

  const cleanSubject = cleanEventTitle(subject || '日程安排');

  // Determine new event date: check afterRaw first, if none, inherit original date
  const afterDateRes = parseDateFromText(afterRaw, referenceDate);
  let effectiveDate = null;
  if (afterDateRes && afterDateRes.date) {
    effectiveDate = afterDateRes.date;
  } else if (originalDateObj) {
    effectiveDate = new Date(originalDateObj);
  } else {
    effectiveDate = new Date(referenceDate);
  }

  // Parse new time strictly from afterRaw
  const timeRes = parseTimeFromText(afterRaw, effectiveDate);

  const targetCriteria = {
    titleKeywords: cleanSubject && cleanSubject !== '日程安排' ? [cleanSubject] : [],
    originalDate: originalDateObj ? originalDateObj.toISOString().slice(0, 10) : '',
    originalDateText: originalDateText || '',
    originalTimeOfDay
  };

  return {
    isModification: true,
    targetCriteria,
    keepExistingLocation,
    keepExistingUrl,
    title: cleanSubject,
    startDate: timeRes.startDate,
    endDate: timeRes.endDate,
    allDay: timeRes.allDay
  };
}

/**
 * Match target criteria against existing schedules list
 * @param {Object} targetCriteria
 * @param {Array} schedules
 * @param {Date} [referenceDate]
 * @returns {Object|null}
 */
export function findMatchingSchedule(targetCriteria, schedules = [], referenceDate = new Date()) {
  if (!targetCriteria || !Array.isArray(schedules) || schedules.length === 0) {
    return null;
  }

  const keywords = (targetCriteria.titleKeywords || [])
    .map(k => String(k || '').trim().toLowerCase())
    .filter(k => k && k.length >= 2);

  let bestMatch = null;
  let highestScore = 0;

  for (const item of schedules) {
    if (!item) continue;
    let score = 0;
    const itemTitle = (item.title || '').trim().toLowerCase();
    const itemDesc = (item.description || '').trim().toLowerCase();

    // 1. Title keyword matching
    for (const kw of keywords) {
      if (itemTitle === kw) {
        score += 70;
      } else if (itemTitle.includes(kw) || kw.includes(itemTitle)) {
        score += 55;
      } else if (itemDesc.includes(kw)) {
        score += 25;
      }
    }

    // 2. Date matching
    if (targetCriteria.originalDate && item.startTime) {
      const targetDate = new Date(targetCriteria.originalDate);
      const itemStartDate = new Date(item.startTime);
      if (!isNaN(targetDate.getTime()) && !isNaN(itemStartDate.getTime())) {
        const isSameDay =
          targetDate.getFullYear() === itemStartDate.getFullYear() &&
          targetDate.getMonth() === itemStartDate.getMonth() &&
          targetDate.getDate() === itemStartDate.getDate();

        if (isSameDay) {
          score += 40;
        } else if (targetDate.getDay() === itemStartDate.getDay()) {
          score += 20;
        }
      }
    }

    // 3. Time of day matching
    if (targetCriteria.originalTimeOfDay && item.startTime) {
      const itemStartDate = new Date(item.startTime);
      if (!isNaN(itemStartDate.getTime())) {
        const hours = itemStartDate.getHours();
        const tod = targetCriteria.originalTimeOfDay;
        if (tod === 'afternoon' && hours >= 12 && hours < 18) {
          score += 25;
        } else if (tod === 'morning' && hours >= 6 && hours < 12) {
          score += 25;
        } else if (tod === 'evening' && hours >= 18) {
          score += 25;
        } else if (tod === 'afternoon' && hours >= 12) {
          score += 15;
        }
      }
    }

    if (score > highestScore) {
      highestScore = score;
      bestMatch = item;
    }
  }

  if (highestScore >= 45) {
    return bestMatch;
  }

  return null;
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

  // Extract explicit URL (meeting link or website)
  let url = '';
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

  // Location extraction
  let location = '';

  // 1. Explicit location label: 地点：..., 地点在..., 位置在..., 会议室：...
  const explicitLocMatch = trimmed.match(/(?:(?:开会|活动|面试|答辩|预答辩|培训|会商|集合)?地点|位置|地址|会议室|场所)(?:[：:\s]+|(?:[在为设于]+[\s：:]*))([^\n,，;；]+)/i);
  if (explicitLocMatch) {
    let cand = explicitLocMatch[1].trim();
    cand = cand.replace(/[，,、\s]*(?:你有时间|你有空|方便|你能来|可以吗|行不行|预答辩|答辩|开会).*$/i, '').trim();
    if (cand && !/^(今天|明天|后天|昨天|周|星期|上午|下午|晚上|\d+)/.test(cand)) {
      location = cand;
    }
  }

  // 2. English "at <location>"
  if (!location) {
    const enAtMatches = [...trimmed.matchAll(/\bat\s+([a-zA-Z0-9][a-zA-Z0-9\s]{1,25}?)(?=\s+with|\s+on|\s+for|\s+at|$|[,\.])/gi)];
    for (const m of enAtMatches) {
      const candidate = m[1].trim();
      if (!/^(?:the|a|an|\d+(?::\d+)?\s*(?:am|pm)?)$/i.test(candidate)) {
        location = candidate;
        break;
      }
    }
  }

  // 3. Inline "在 <location> [动词/事件/标点]"
  if (!location) {
    const inlineLocMatch = trimmed.match(/在\s*([a-zA-Z0-9\u4e00-\u9fa5\-_—\(\)（）#]{2,25}?)(?=\s*(?:[，,。！!\n]|$|开(?:会|例会|周会|项目|讨论|评审|宣讲|庭)?|举行|集合|碰头|见面|聚餐|举办|进行|线上|等|答辩|预答辩|上课|研讨|评审|讨论|汇报|培训|面试|会商|组织|签到|签合同|有\d+个|有[一二两三四五六七八九十]+个|计划|打算|准备))/i);
    if (inlineLocMatch) {
      const candidate = inlineLocMatch[1].trim();
      if (!/^(今天|明天|后天|昨天|周|星期|上午|下午|晚上|\d+)/.test(candidate)) {
        location = candidate;
      }
    }
  }

  // 4. Physical venue keywords: e.g. 科技楼302, 主楼报告厅, 315会议室
  if (!location) {
    const venueMatch = trimmed.match(/(?:在\s*)?([A-Za-z0-9#\-_]{1,10}?(?:会议室|报告厅|研讨室|研讨厅|办公室|教室|实验室|大厦|大楼|学院楼|教学楼|综合楼|科技楼|主楼|南楼|北楼|东楼|西楼|\d+层|\d+楼|\d{3,4}室|[A-Z]\d{2,4}|操场|体育馆|食堂)|[一-龥]{2,8}(?:会议室|报告厅|研讨室|研讨厅|办公室|教室|实验室|大厦|大楼|学院楼|教学楼|综合楼|科技楼|主楼|南楼|北楼|东楼|西楼|操场|体育馆|食堂)(?:\s*\d{3,4}室?)?)/);
    if (venueMatch) {
      let candidate = venueMatch[1].trim();
      candidate = candidate.replace(/^(?:在|地点在|地点为)\s*/, '');
      if (!/^(今天|明天|后天|昨天|周|星期|上午|下午|晚上)/.test(candidate)) {
        location = candidate;
      }
    }
  }

  // 5. Online meeting location fallback: Tencent Meeting or Zoom
  if (!location) {
    if (tencentMatch) {
      const code = tencentMatch[1].trim();
      location = `腾讯会议 ${code}`;
    } else if (zoomMatch) {
      const code = zoomMatch[1].trim();
      location = `Zoom ${code}`;
    } else if (/腾讯会议/i.test(trimmed)) {
      location = '腾讯会议';
    } else if (/Zoom/i.test(trimmed)) {
      location = 'Zoom';
    }
  }

  // 1. Check modification / reschedule intent first
  const modIntent = detectModificationIntent(trimmed, now);
  if (modIntent) {
    return {
      id: `event-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      title: modIntent.title || '日程安排',
      startTime: modIntent.startDate.toISOString(),
      endTime: modIntent.endDate.toISOString(),
      allDay: modIntent.allDay,
      location: location || '',
      description: trimmed,
      url: url || '',
      alarmMinutes: 15,
      createdAt: new Date().toISOString(),
      parserType: 'local',
      isModification: true,
      keepExistingLocation: modIntent.keepExistingLocation,
      keepExistingUrl: modIntent.keepExistingUrl,
      targetCriteria: modIntent.targetCriteria
    };
  }

  // 2. Standard parsing for new events
  let explicitTitle = '';
  const explicitTitleMatch = trimmed.match(/(?:主题|日程|事项|事件|标题|会议名称)[：:\s]+([^\n,，;；]+)/i);
  if (explicitTitleMatch) {
    explicitTitle = explicitTitleMatch[1].trim();
  }

  const dateRes = parseDateFromText(trimmed, now);
  const matchedDate = dateRes && dateRes.date ? dateRes.date : new Date(now);
  const timeRes = parseTimeFromText(trimmed, matchedDate);

  // Title Extraction
  let title = explicitTitle ? cleanEventTitle(explicitTitle) : '';
  if (!title) {
    let cleaned = trimmed;
    cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, '');
    cleaned = cleaned.replace(/腾讯会议[：:\s]*\d{3}[-\s]?\d{3}[-\s]?\d{3,4}/gi, '');
    cleaned = cleaned.replace(/Zoom[：:\s]*\d{3}[-\s]?\d{3}[-\s]?\d{3,4}/gi, '');
    cleaned = cleaned.replace(/(?:(?:开会|活动|面试|答辩|预答辩|培训|会商|集合)?地点|位置|地址|会议室|场所)(?:[：:\s]+|(?:[在为设于]+[\s：:]*))[^\n,，;；]+/gi, '');

    if (location) {
      const escapedLoc = location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      cleaned = cleaned.replace(new RegExp(`\\bat\\s+${escapedLoc}\\b`, 'i'), '');
      cleaned = cleaned.replace(new RegExp(`(?:(?:开会|活动|面试|答辩|预答辩|培训|会商|集合)?地点|位置|地址|会议室|场所)?(?:[在为设于]+[\\s：:]*)?${escapedLoc}`, 'gi'), '');
    }

    cleaned = cleaned.replace(/(大后天|后天|明天|明日|今天|今日|昨天|昨日)/g, '');
    cleaned = cleaned.replace(/\b(day after tomorrow|tomorrow|today|yesterday)\b/gi, '');
    cleaned = cleaned.replace(/(?:(?:下下周|下下个星期|下下星期|下周末|下周|下个星期|下星期|下礼拜|这周末|本周末|本周|这周|这个星期|这礼拜)\s*[一二三四五六日天末12345670]?|(?:周|星期|礼拜)[一二三四五六日天末12345670])/gi, '');
    cleaned = cleaned.replace(/(\d+|[一二两三四五六七八九十]+)天[之以]?后/g, '');
    cleaned = cleaned.replace(/\d{4}[\.\/\-年]\d{1,2}[\.\/\-月]\d{1,2}[日号]?/g, '');
    cleaned = cleaned.replace(/\d{1,2}月\d{1,2}[日号]?/g, '');
    cleaned = cleaned.replace(/(\d{1,2})[:：](\d{2})\s*(?:-|~|至|到)\s*(\d{1,2})[:：](\d{2})/g, '');
    cleaned = cleaned.replace(/(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?\s*(?:am|pm)?/gi, '');
    cleaned = cleaned.replace(/(?:上午|下午|晚上|中午|凌晨)?\s*(?:\d{1,2}|[一二两三四五六七八九十]+)\s*点(?:(?:\d{1,2}|半|一刻|三刻)分?)?/g, '');
    cleaned = cleaned.replace(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, '');
    cleaned = cleaned.replace(/(?:早上|清晨|早晨|上午|中午|下午|傍晚|晚上|夜里|半夜|凌晨)/g, '');
    cleaned = cleaned.replace(/(?:持续|时长|大概|预计)?(?:\d+(?:\.\d+)?|[一二两三四五半]+)\s*(?:个)?(?:小时|分钟|hr|hrs|min|mins)/gi, '');
    cleaned = cleaned.replace(/(?:全天|整天|\ball[\s\-]day\b)/gi, '');
    cleaned = cleaned.replace(/(?:提醒我|备忘|安排|请参加|请大家|准时|参加)/g, '');
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
    startTime: timeRes.startDate.toISOString(),
    endTime: timeRes.endDate.toISOString(),
    allDay: timeRes.allDay,
    location: location || '',
    description: trimmed,
    url: url || '',
    alarmMinutes: 15,
    createdAt: new Date().toISOString(),
    parserType: 'local',
    isModification: false,
    keepExistingLocation: false,
    targetCriteria: null
  };
}

export const GEMMA_MODEL_ID = '@cf/google/gemma-4-26b-a4b-it';
export const DEFAULT_REMOTE_API = 'https://calgen.pages.dev/api/parse';

/**
 * Check if code is running inside Capacitor native platform
 */
export function isRunningInNativeApp() {
  if (typeof window !== 'undefined' && window.Capacitor) {
    if (typeof window.Capacitor.isNativePlatform === 'function') {
      return window.Capacitor.isNativePlatform();
    }
  }
  if (typeof globalThis !== 'undefined' && globalThis.Capacitor) {
    if (typeof globalThis.Capacitor.isNativePlatform === 'function') {
      return globalThis.Capacitor.isNativePlatform();
    }
  }
  return false;
}

/**
 * Get effective API endpoint for Gemma 4 AI parsing
 * Automatically uses remote production endpoint when running in Capacitor APK or local origins
 */
export function getEffectiveApiEndpoint(customEndpoint = '') {
  if (customEndpoint && customEndpoint.trim()) {
    return customEndpoint.trim();
  }
  if (typeof window !== 'undefined') {
    if (isRunningInNativeApp() ||
        window.location.protocol === 'capacitor:' ||
        window.location.protocol === 'file:' ||
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1') {
      return DEFAULT_REMOTE_API;
    }
  }
  return '/api/parse';
}

/**
 * Parse schedule using Cloudflare Workers AI model @cf/google/gemma-4-26b-a4b-it
 * @param {string} text
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function parseScheduleWithGemma(text, options = {}) {
  const effectiveEndpoint = getEffectiveApiEndpoint(options.apiEndpoint);
  const {
    apiEndpoint = effectiveEndpoint,
    accountId = '',
    apiToken = '',
    referenceDate = new Date(),
    signal = null,
    timeoutMs = 12000
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
    parserType: 'gemma-4-26b-a4b-it',
    isModification: !!d.isModification,
    keepExistingLocation: !!d.keepExistingLocation,
    targetCriteria: d.targetCriteria || null
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
