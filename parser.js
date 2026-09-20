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

  // 1.5 Strip meeting agenda/content details from the tail
  // e.g., 交流核心包括：..., 主要内容包括..., 会议议程如下...
  t = t.replace(/(?:交流核心|主要内容|会议内容|研讨内容|会议议程|主要议程|议程包括|交流要点)[：:\s\S]*$/i, '');

  // 2. Strip standalone vocatives at the start (such as "各位负责人，", "各位老师：", "@所有人 ")
  // even when there is no "好" after the vocative
  t = t.replace(
    /^(?:各位(?:负责人|老师|领导|同事|同学|朋友|专家|会员|同仁|代表|家长|评审|评委|学长|学姐|新生|教授|大家)|老师们|领导们|同事们|同学们|大家|所有人|@所有人)\s*[，,：:\s]\s*/i,
    ''
  );

  // 2.5 Strip salutations and greetings from the start
  // e.g., 各位老师下午好, 各位领导好, 老师们好, 大家好, 亲爱的同事们, Hi all, Good morning, etc.
  t = t.replace(/^(?:(?:各位(?:老师|领导|同事|同学|朋友|专家|会员|同仁|代表|家长|评审|评委|学长|学姐|新生|教授|负责人)?|大家|老师们|领导们|同事们|同学们)?(?:下午好|上午好|早上好|中午好|晚上好|好|您好|你好)|亲爱的.+?[好！!，,\s]|(?:Good\s+(?:morning|afternoon|evening)|Hi|Hello|Dear)\s+[^,，!！]+[,，!！]?)+[\s,，:：\-]*/i, '');

  // 3. Strip recipient vocatives at the beginning (e.g. "孙卓，", "张老师：", "@所有人 ", "@李工: ")
  t = t.replace(/^(?:[A-Za-z\u4e00-\u9fa5]{2,5}|@\S+)[，,：:\s]+(?=(?:我|咱|请|有|下周|明天|后天|今天|关于|原定|现|麻烦|想|由于|因|各位))/i, '');

  // 3.5 Semantic pattern normalization:
  // e.g. "图书馆馆长带队到交通学院做一线调研" -> "图书馆馆长来调研"
  const surveyMatch = t.match(
    /(?:^|[，,。；;\s])([\u4e00-\u9fa5A-Za-z0-9]{2,10}?)(?:带队)?(?:到|来|赴|深入)[^，,。；;\n]{0,15}?(?:做|开展|进行|组织)?(?:一线|专题|专项|深入)?[^，,。；;\n]{0,6}(调研|走访|考察|交流|座谈|研讨|巡查|指导|督导|检查)/
  );
  if (surveyMatch) {
    const subject = surveyMatch[1];
    const action = surveyMatch[2];
    t = (action === '调研' || action === '走访' || action === '考察' || action === '指导')
      ? `${subject}来${action}`
      : `${subject}${action}`;
  }

  // 4. Strip notification / announcement prefixes
  // e.g., 关于召开..., 关于举办..., 会议通知:, 通知:, 日程安排:
  t = t.replace(/^(?:关于(?:举办|召开|组织|开展)?|通知[：:]|紧急通知[：:]|会议通知[：:]|日程安排[：:]|日程[：:]|安排[：:])/g, '');

  // 5. Strip first-person and conversational intent prefixes
  // e.g., "我有两个博士计划预答辩" -> "两个博士计划预答辩", "我们打算开项目周会" -> "开项目周会"
  t = t.replace(/^(?:我(?:们)?|咱(?:们)?)(?:[这里边儿]+)?(?:[有想打算计划准备要需]|希望|拟|预备|准备)+[\s,，]*/i, '');
  t = t.replace(/^(?:请问|麻烦问下|想问下|想请问|不知道你?|请问下)[\s,，]*/i, '');

  // 6. Strip intermediate intent verbs before core schedule verbs/nouns
  // e.g., "两个博士计划预答辩" -> "两个博士预答辩"
  t = t.replace(/(?:\s*(?:计划|准备|打算|拟|预备)\s*)(?=(?:预答辩|答辩|开会|讨论|评审|评审会|研讨|汇报|开题|开题报告|结题|复试|面试|聚餐|碰头|交流|上线|发布))/i, '');

  // 6.5 Strip leading date/time words from title
  // e.g., "今天开团队周会" -> "开团队周会" -> "团队周会"
  t = t.replace(/^(?:大后天|后天|明天|明日|今天|今日|昨天|昨日|下下周[一二三四五六日天]?|下周[一二三四五六日天]?|本周[一二三四五六日天]?|这周[一二三四五六日天]?|周[一二三四五六日天]|星期[一二三四五六日天])[\s,，]*/i, '');
  t = t.replace(/^(?:早上|清晨|早晨|上午|中午|下午|傍晚|晚上|夜里|半夜|凌晨)[\s,，]*/i, '');

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

  // 11. Clean ALL punctuation marks from title (pure noun phrase, no punctuation)
  t = t.replace(/[，,。;；:：!！?？"“”'‘’、~～\-—·\(\)（）\[\]【】]/g, '').trim();

  // 12. Strictly limit title length to 12 characters
  if (t.length > 12) {
    t = t.substring(0, 12).trim();
  }

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

  // 1. Check absolute date: YYYY年MM月DD日, YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
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

  // 2. Check explicit MM月DD日 / MM-DD / MM/DD (takes precedence over relative weekday like 下周四)
  const mdMatch = trimmed.match(/(\d{1,2})月(\d{1,2})[日号]?/) ||
    trimmed.match(/(?:^|[^\d:])(\d{1,2})[\/\-](\d{1,2})(?!\d|:)/);
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

  // 3. Check relative dates: 今天, 明天, 后天, 大后天, 昨天, 今日, 明日, 昨日
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

  // 4. Check English relative dates: tomorrow, today, yesterday, day after tomorrow
  const enRelMatch = trimmed.match(/\b(day after tomorrow|tomorrow|today|yesterday)\b/i);
  if (enRelMatch) {
    const matchedDate = new Date(now);
    const word = enRelMatch[1].toLowerCase();
    if (word === 'tomorrow') matchedDate.setDate(matchedDate.getDate() + 1);
    else if (word === 'day after tomorrow') matchedDate.setDate(matchedDate.getDate() + 2);
    else if (word === 'yesterday') matchedDate.setDate(matchedDate.getDate() - 1);
    return { date: matchedDate, text: enRelMatch[1] };
  }

  // 5. Check weekday in Chinese (only when no explicit calendar date was found)
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

  // Check time ranges like "14:00-16:30" or "8:30分-10:00" or "下午2点到4点半" or "9:00 ~ 11:30"
  const rangeMatch = trimmed.match(/(\d{1,2})[:：](\d{2})(?:分)?\s*(?:-|~|至|到)\s*(\d{1,2})[:：](\d{2})(?:分)?/) ||
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

  // Single time match: "14:30" or "8:30分" or "下午3点半" or "10点" or "3pm"
  if (startHours === null) {
    const timeMatch = trimmed.match(/(?:^|[^\d])(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?(?:分)?(?:\s*(am|pm))?/i);
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

  // 1. Explicit location label: 地点：..., 地点在..., 地点管理楼A515, 位置在..., 会议室：...
  const explicitLocMatch = trimmed.match(/(?:(?:开会|活动|面试|答辩|预答辩|培训|会商|集合)?地点|位置|地址|会议室|场所)\s*(?:[：:]|在|为|设于)?\s*([^\n,，。.;；]+)/i);
  if (explicitLocMatch) {
    let cand = explicitLocMatch[1].trim();
    cand = cand.replace(/[，,、\s]*(?:你有时间|你有空|方便|你能来|可以吗|行不行|预答辩|答辩|开会|交流核心|主要内容|会议内容).*$/i, '').trim();
    cand = cand.replace(/[，,。.;；:：!！]+$/, '').trim();
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

  // 4. Generic building + room number pattern: e.g. 管理楼A515, 管理楼A515室, 科技楼302
  if (!location) {
    const buildingRoomMatch = trimmed.match(/(?:在\s*)?([\u4e00-\u9fa5A-Za-z]{2,12}(?:楼|馆|中心|大厦|校区|学院|院系)\s*[A-Za-z]?\d{2,4}(?:室)?)/i);
    if (buildingRoomMatch) {
      let candidate = buildingRoomMatch[1].trim();
      candidate = candidate.replace(/^(?:在|地点在|地点为)\s*/, '');
      if (!/^(今天|明天|后天|昨天|周|星期|上午|下午|晚上|\d+)/.test(candidate)) {
        location = candidate;
      }
    }
  }

  // 5. Physical venue keywords: e.g. 科技楼302, 主楼报告厅, 315会议室
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
    cleaned = cleaned.replace(/(?:(?:开会|活动|面试|答辩|预答辩|培训|会商|集合)?地点|位置|地址|会议室|场所)\s*(?:[：:]|在|为|设于)?\s*[^\n,，。.;；]+/gi, '');
    cleaned = cleaned.replace(/(?:开会|会议|活动|日程)?时间\s*(?:定在|在|为|设在|设于)?[：:\s]*/gi, '');

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
    cleaned = cleaned.replace(/(\d{1,2})[:：](\d{2})(?:分)?\s*(?:-|~|至|到)\s*(\d{1,2})[:：](\d{2})(?:分)?/g, '');
    cleaned = cleaned.replace(/(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?(?:分)?\s*(?:am|pm)?/gi, '');
    cleaned = cleaned.replace(/(?:上午|下午|晚上|中午|凌晨)?\s*(?:\d{1,2}|[一二两三四五六七八九十]+)\s*点(?:(?:\d{1,2}|半|一刻|三刻)分?)?/g, '');
    cleaned = cleaned.replace(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, '');
    cleaned = cleaned.replace(/(?:早上|清晨|早晨|上午|中午|下午|傍晚|晚上|夜里|半夜|凌晨)/g, '');
    cleaned = cleaned.replace(/(?:持续|时长|大概|预计)?(?:\d+(?:\.\d+)?|[一二两三四五半]+)\s*(?:个)?(?:小时|分钟|hr|hrs|min|mins)/gi, '');
    cleaned = cleaned.replace(/(?:全天|整天|\ball[\s\-]day\b)/gi, '');
    cleaned = cleaned.replace(/(?:提醒我|备忘|安排|请参加|请大家|准时|参加)/g, '');
    cleaned = cleaned.replace(/(?:交流核心|主要内容|会议内容|研讨内容|会议议程|主要议程|议程包括|交流要点)[：:\s\S]*$/gi, '');
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
 * Get effective default API endpoint for built-in AI parsing
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
 * Generate calendar parsing system prompt with current reference date
 */
export function getCalendarAISystemPrompt(referenceDate = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = referenceDate.getFullYear();
  const mm = pad(referenceDate.getMonth() + 1);
  const dd = pad(referenceDate.getDate());
  const hh = pad(referenceDate.getHours());
  const min = pad(referenceDate.getMinutes());
  const weekdays = ['周日(Sunday)', '周一(Monday)', '周二(Tuesday)', '周三(Wednesday)', '周四(Thursday)', '周五(Friday)', '周六(Saturday)'];
  const currentWeekday = weekdays[referenceDate.getDay()];
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';

  return `You are an expert calendar assistant specialized in parsing schedule text into structured JSON.
Current Reference Time: ${yyyy}-${mm}-${dd} ${hh}:${min} (${currentWeekday}), Timezone: ${timezone}.

Extract the schedule event from the user's text and respond ONLY with a valid JSON object matching this schema:
{
  "title": "string (strictly concise core event noun phrase, <= 12 characters, no punctuation, e.g. 赵帅奇博士预答辩, 两个博士预答辩, 项目周会, 财务审计沟通会)",
  "startTime": "string (ISO 8601 local date-time format YYYY-MM-DDTHH:mm:ss for the updated/new schedule)",
  "endTime": "string (ISO 8601 local date-time format YYYY-MM-DDTHH:mm:ss for the updated/new schedule)",
  "allDay": boolean,
  "location": "string (physical location/room, or online meeting info like 腾讯会议 123-456-789, or empty string)",
  "description": "string (original raw notes or details)",
  "url": "string (meeting link or URL if mentioned, e.g. Tencent Meeting link https://meeting.tencent.com/dm/xxx, Zoom link, or empty string)",
  "isModification": boolean,
  "keepExistingLocation": boolean,
  "targetCriteria": {
    "titleKeywords": ["string"],
    "originalDate": "string (YYYY-MM-DD if identifiable, or empty string)",
    "originalTimeOfDay": "string (morning | afternoon | evening | empty string)"
  }
}

Rules:
1. Title Rules (标题规则):
   - 长度严格限制在 12 个字以内（<= 12 characters）。
   - 尽量使用名词或名词短语（如 "赵帅奇博士预答辩", "两个博士预答辩", "项目周会", "团队周会", "财务审计沟通会", "图书馆馆长来调研"）。
   - 绝对不带任何标点符号（禁止包含逗号、句号、冒号、感叹号、顿号、问号、引号、括号等任何标点）。
   - 彻底剔除开头的打招呼与问候语及通知对象称呼（如“各位负责人，”、“各位老师下午好，”、“大家下午好，”、“各位领导好，”、“老师们好，”、“下午好，”、“@所有人”等，绝不能作为标题的一部分！）。
   - 彻底剔除事务性与通知套话（如“...安排如下”、“...日程如下”、“...通知如下”、“...的通知”、“关于召开...”等）。例如输入“各位老师下午好，赵帅奇博士预答辩安排如下：”，标题必须提取为“赵帅奇博士预答辩”，绝对不要输出“各位老师下午好，赵帅奇博士预答辩”。
   - 对于“X带队到Y做一线调研/座谈/走访”这类句式，标题应精炼规范提取为“X来调研”或“X调研/座谈”（如“图书馆馆长来调研”），绝不要保留“带队到Y做一线”等冗余叙述。
   - 彻底剔除主观意图动词与句末疑问（如“我有...”、“我们计划...”、“打算...”、“你有时间吧？”、“方便吗？”、“收到请回复”、“谢谢[握手]”等）。若包含参与人数量，合入名词短语（如“我有两个博士计划预答辩” -> “两个博士预答辩”）。
   - 彻底剔除改期原因与连词（如“由于有老师...有课”、“因此时间改为”），标题仅保留核心事件名词。
   - 标题中不得包含日期、时间、地点、议程细节（如“交流核心包括...”）或表情符号。

2. Date Parsing & Cross-Verification Rules (日期解析与双重核对规则):
   - 具体日期优先（Explicit Date Priority）：文本中如果出现具体明确的月日（如“9月24日”、“2026-09-24”、“9/24”、“10月5号”等），必须以该明确日期为绝对基准！年份根据 Current Reference Time (${yyyy}) 推算。
   - 双重核对（Cross-Verification）：当文本中同时出现具体日期与星期/相对周表达时（例如“9月24日（下周四）”、“9月24日 周四”、“10月15日(本周四)”）：
     * 必须双重核对具体日期与星期！
     * 具体日期“9月24日”是明确且决定性的事件日期，“下周四”仅为自然语言中的星期补充标注，绝非再加 7 天！
     * 绝不能只解析“下周四”而错误推算出“10月1日”！该日程日期必须严格解析为 9月24日（${yyyy}-09-24）。
   - 仅相对日期时的计算：仅当文本中完全没有具体月日（仅有“下周四”、“明天下午”、“后天”等）时，才严格基于 Current Reference Time 进行相对计算（中文周一为一周起始，下周四指下个周一至周日周期内的周四）。

3. Location Rules:
   - 提取具体物理地点或会议室（如“管理楼A515”、“管理楼A515会议室”、“科技楼302”、“315会议室”）。
   - “地点管理楼A515”与“地点：管理楼A515”含义完全相同，即使没有冒号或空格也必须准确提取地点为“管理楼A515”。
   - 地点中严禁包含动词或事件名称（如“在管理楼A515预答辩” -> location 应为“管理楼A515”，不能包含“预答辩”）。
   - 若为线上会议（腾讯会议/Zoom）且无实体地点，填写“腾讯会议 123-456-789”或“Zoom 123-456-789”。

4. Modification / Reschedule Rules:
   - 若文本表达对已有日程的修改、改期、推迟、提前（如“改为”、“改到”、“调整为”、“推迟”、“原定...改...”）：
     * "isModification": true.
     * "targetCriteria":
       - "titleKeywords": [被修改的核心事件名，如 "赵帅奇博士预答辩", "预答辩"]
       - "originalDate": 修改前的原日期（YYYY-MM-DD）
       - "originalTimeOfDay": "afternoon" / "morning" / "evening"
     * 若提示地点不变（如“地点不变”、“原地点”），"keepExistingLocation": true.
     * "startTime" 与 "endTime" 严格计算为修改后的新时间。
   - 若为常规新日程，"isModification": false, "keepExistingLocation": false, "targetCriteria": null.

5. Time & Duration Rules:
   - 格式为 ISO 8601 本地时间 YYYY-MM-DDTHH:mm:ss。
   - “8:30分-10:00”中的“分”属于分钟单位，准确解析为开始时间 08:30:00，结束时间 10:00:00，严禁退化为默认 1 小时。
   - 未指定结束时间时：若提到时长（如预计1.5小时），则加上时长；若未提时长且非全天，默认结束时间为开始时间后1小时；全天日程开始与结束日期相同且时间为 00:00:00。

6. Meeting URL:
   - 腾讯会议号（如 123-456-789）自动转换为 https://meeting.tencent.com/dm/123456789 填入 url 字段。

7. Few-Shot Examples (少样本示例):
   - Input: "各位负责人，图书馆馆长带队到交通学院做一线调研，时间定在9月21日上午8:30分-10:00；地点管理楼A515。交流核心包括：一、图书馆老师简单介绍现有资源和服务。"
     -> "title": "图书馆馆长来调研", "startTime": "${yyyy}-09-21T08:30:00", "endTime": "${yyyy}-09-21T10:00:00", "location": "管理楼A515", "url": "", "allDay": false
     (解析要点：剔除“各位负责人”称呼；提取规范事件标题“图书馆馆长来调研”；准确提取无冒号地点“管理楼A515”；“8:30分-10:00”准确解析为08:30至10:00而非默认1小时)
   - Input: "各位老师下午好，赵帅奇博士预答辩安排如下：\n时间：9月24日（下周四）下午2:30\n地点：管理楼A515会议室\n请各位老师预留时间参加，谢谢[握手]"
     -> "title": "赵帅奇博士预答辩", "startTime": "${yyyy}-09-24T14:30:00", "endTime": "${yyyy}-09-24T15:30:00", "location": "管理楼A515会议室", "url": "", "allDay": false
     (解析要点：标题严格在12字以内且无标点；剔除“各位老师下午好”；双重核对9月24日与下周四，准确解析为09-24而非10-01)
   - Input: "孙卓，我有两个博士计划下周二上午八点半预答辩，你有时间吧？"
     -> "title": "两个博士预答辩", "location": ""
   - Input: "孙卓，我有两个博士计划下周二上午八点半在科技楼302预答辩，你有时间吧？"
     -> "title": "两个博士预答辩", "location": "科技楼302"
   - Input: "张老师，我们打算明天下午3点在315会议室开项目周会，方便吗？"
     -> "title": "项目周会", "location": "315会议室"
   - Input: "下周三上午10点腾讯会议：123-456-789 开团队周会 预计1.5小时"
     -> "title": "团队周会", "location": "腾讯会议 123-456-789", "url": "https://meeting.tencent.com/dm/123456789"
   - Input: "各位老师好，由于有老师下周四下午有课，因此预答辩时间改为上午9：30，地点不变，辛苦各位老师"
     -> "title": "预答辩", "isModification": true, "keepExistingLocation": true, "targetCriteria": { "titleKeywords": ["预答辩"], "originalTimeOfDay": "afternoon" }

8. Output MUST be strictly valid JSON without any markdown code fence blocks or extra explanation.`;
}

/**
 * Normalize an API endpoint to standard /chat/completions URL
 */
export function normalizeChatCompletionsUrl(inputUrl = '') {
  let url = (inputUrl || '').trim();
  if (!url) return '';
  url = url.replace(/\/+$/, '');

  if (url.endsWith('/chat/completions') || url.endsWith('/api/parse')) {
    return url;
  }
  if (url.endsWith('/v1')) {
    return `${url}/chat/completions`;
  }
  return `${url}/v1/chat/completions`;
}

/**
 * Safely parse JSON from AI model response string
 */
export function extractJsonFromAiResponse(aiResultText) {
  if (!aiResultText || typeof aiResultText !== 'string') {
    throw new Error('AI 返回内容为空');
  }
  const cleaned = aiResultText
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  return JSON.parse(cleaned);
}

/**
 * Build standard calendar event object from parsed AI JSON
 */
export function buildEventFromAiData(d, text, referenceDate = new Date()) {
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

  // Double-check date with explicit date in text if present (e.g. 9月24日 vs 下周四 -> 10月1日)
  if (text && typeof text === 'string') {
    let expYear = null, expMonth = null, expDay = null;
    const m1 = text.match(/(?:(\d{4})[\.\/\-年])?(\d{1,2})月(\d{1,2})[日号]?/);
    if (m1) {
      expYear = m1[1] ? parseInt(m1[1], 10) : referenceDate.getFullYear();
      expMonth = parseInt(m1[2], 10) - 1;
      expDay = parseInt(m1[3], 10);
    } else {
      const m2 = text.match(/(?:^|[^\d])(\d{4})[\.\/\-](\d{1,2})[\.\/\-](\d{1,2})(?!\d)/);
      if (m2) {
        expYear = parseInt(m2[1], 10);
        expMonth = parseInt(m2[2], 10) - 1;
        expDay = parseInt(m2[3], 10);
      } else {
        const m3 = text.match(/(?:^|[^\d:])(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])(?!\d|:)/);
        if (m3) {
          expYear = referenceDate.getFullYear();
          expMonth = parseInt(m3[1], 10) - 1;
          expDay = parseInt(m3[2], 10);
        }
      }
    }

    if (expMonth !== null && expDay !== null && expMonth >= 0 && expMonth <= 11 && expDay >= 1 && expDay <= 31) {
      if (startDate.getMonth() !== expMonth || startDate.getDate() !== expDay) {
        const duration = endDate.getTime() - startDate.getTime();
        startDate.setFullYear(expYear || referenceDate.getFullYear(), expMonth, expDay);
        endDate = new Date(startDate.getTime() + (duration > 0 ? duration : 3600000));
      }
    }
  }

  // Deterministic hybrid reconciliation using local parser
  let finalLocation = d.location || '';
  let finalUrl = d.url || '';

  if (text && typeof text === 'string') {
    const localParsed = parseScheduleText(text, referenceDate);
    if (localParsed) {
      // 1. Supplement location if AI returned empty or whitespace but local parser identified location
      if ((!finalLocation || !finalLocation.trim()) && localParsed.location) {
        finalLocation = localParsed.location;
      }

      // 2. Correct endTime if AI defaulted to 1 hour (e.g. 08:30-09:30) while local parser found an explicit range (e.g. 08:30-10:00)
      if (!d.allDay && localParsed.startTime && localParsed.endTime) {
        const localStart = new Date(localParsed.startTime);
        const localEnd = new Date(localParsed.endTime);
        const localDuration = localEnd.getTime() - localStart.getTime();
        const aiDuration = endDate.getTime() - startDate.getTime();

        // If local parser detected a non-default duration from explicit text range/duration, and AI ended up with 1 hour default
        if (localDuration !== 3600000 && (aiDuration === 3600000 || isNaN(endDate.getTime()))) {
          endDate = new Date(startDate.getTime() + localDuration);
        }
      }

      // 3. Supplement meeting URL if AI missed it
      if ((!finalUrl || !finalUrl.trim()) && localParsed.url) {
        finalUrl = localParsed.url;
      }
    }
  }

  return {
    id: `event-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    title: cleanEventTitle(d.title || '日程安排'),
    startTime: startDate.toISOString(),
    endTime: endDate.toISOString(),
    allDay: !!d.allDay,
    location: finalLocation || '',
    description: d.description || text.trim(),
    url: finalUrl || '',
    alarmMinutes: 15,
    createdAt: new Date().toISOString(),
    parserType: 'ai',
    isModification: !!d.isModification,
    keepExistingLocation: !!d.keepExistingLocation,
    targetCriteria: d.targetCriteria || null
  };
}

/**
 * Test connectivity for a custom OpenAI-compatible API
 */
export async function testAiConnection(options = {}) {
  const { apiUrl = '', apiKey = '', model = '', timeoutMs = 10000 } = options;
  if (!apiUrl || !apiUrl.trim()) {
    throw new Error('请先填写 API 接口地址');
  }

  const endpoint = normalizeChatCompletionsUrl(apiUrl);
  const targetModel = (model || '').trim() || 'gpt-4o-mini';

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey && apiKey.trim()) {
    headers['Authorization'] = `Bearer ${apiKey.trim()}`;
  }

  const testPayload = {
    model: targetModel,
    messages: [
      { role: 'user', content: 'Say OK' }
    ],
    max_tokens: 16,
    temperature: 0.1
  };

  const timeoutController = new AbortController();
  const timerId = setTimeout(() => {
    timeoutController.abort(new Error('请求超时'));
  }, timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(testPayload),
      signal: timeoutController.signal
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 150)}`);
    }

    const data = await res.json();
    if (!data.choices || !data.choices[0]) {
      throw new Error('API 响应未返回标准 choices 字段');
    }

    return { success: true, message: '连接成功' };
  } finally {
    clearTimeout(timerId);
  }
}

/**
 * Parse schedule using AI (supports any custom OpenAI-compatible API or default built-in AI)
 * @param {string} text
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function parseScheduleWithAI(text, options = {}) {
  const {
    apiUrl = '',
    apiKey = '',
    model = '',
    apiEndpoint = '',
    accountId = '',
    apiToken = '',
    referenceDate = new Date(),
    signal = null,
    timeoutMs = 15000
  } = options;

  const trimmedText = (text || '').trim();
  if (!trimmedText) {
    throw new Error('日程文本不能为空');
  }

  const timeoutController = new AbortController();
  const timerId = setTimeout(() => {
    timeoutController.abort(new Error('AI 解析请求超时'));
  }, timeoutMs);

  let effectiveSignal = timeoutController.signal;
  if (signal) {
    if (typeof AbortSignal.any === 'function') {
      effectiveSignal = AbortSignal.any([signal, timeoutController.signal]);
    } else {
      signal.addEventListener('abort', () => timeoutController.abort(signal.reason), { once: true });
    }
  }

  try {
    // 1. If custom API URL is configured, use OpenAI-compatible chat completions
    if (apiUrl && apiUrl.trim()) {
      const endpoint = normalizeChatCompletionsUrl(apiUrl);
      const targetModel = (model || '').trim() || 'gpt-4o-mini';

      const headers = {
        'Content-Type': 'application/json'
      };
      if (apiKey && apiKey.trim()) {
        headers['Authorization'] = `Bearer ${apiKey.trim()}`;
      }

      const body = {
        model: targetModel,
        messages: [
          { role: 'system', content: getCalendarAISystemPrompt(referenceDate) },
          { role: 'user', content: trimmedText }
        ],
        temperature: 0.1
      };

      let res;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: effectiveSignal
        });
      } catch (fetchErr) {
        // Fallback through proxy if browser CORS blocked it and server /api/parse is available
        if (typeof window !== 'undefined' && !isRunningInNativeApp()) {
          try {
            const proxyRes = await fetch('/api/parse', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text: trimmedText,
                clientTime: referenceDate.toISOString(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
                customApiUrl: endpoint,
                customApiKey: apiKey,
                customModel: targetModel
              }),
              signal: effectiveSignal
            });
            if (proxyRes.ok) {
              const proxyJson = await proxyRes.json();
              if (proxyJson.success && proxyJson.data) {
                return buildEventFromAiData(proxyJson.data, trimmedText, referenceDate);
              }
            }
          } catch (proxyErr) {
            // ignore proxy error
          }
        }
        throw fetchErr;
      }

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(`API 错误 (${res.status}): ${errorText.slice(0, 150)}`);
      }

      const json = await res.json();
      const content = json.choices?.[0]?.message?.content || '';
      const parsedData = extractJsonFromAiResponse(content);
      return buildEventFromAiData(parsedData, trimmedText, referenceDate);
    }

    // 2. Otherwise, use built-in default endpoint (/api/parse or DEFAULT_REMOTE_API)
    const effectiveEndpoint = getEffectiveApiEndpoint(apiEndpoint);
    const headers = {
      'Content-Type': 'application/json',
    };
    if (accountId) headers['X-CF-Account-ID'] = accountId;
    if (apiToken) headers['X-CF-API-Token'] = apiToken;

    const body = {
      text: trimmedText,
      clientTime: referenceDate.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
    };

    const res = await fetch(effectiveEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: effectiveSignal
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.message || `API error ${res.status}`);
    }

    const json = await res.json();
    if (!json.success || !json.data) {
      throw new Error(json.message || 'AI failed to parse schedule');
    }

    return buildEventFromAiData(json.data, trimmedText, referenceDate);
  } finally {
    clearTimeout(timerId);
  }
}

export const GEMMA_MODEL_ID = '@cf/google/gemma-4-26b-a4b-it';
export const parseScheduleWithGemma = parseScheduleWithAI;

/**
 * Unified schedule parser: attempts AI parsing first,
 * with immediate transparent fallback to rule-based parser.
 * @param {string} text
 * @param {Object} [options]
 * @returns {Promise<Object|null>}
 */
export async function parseScheduleTextAsync(text, options = {}) {
  if (!text || !text.trim()) return null;

  if (options.useAi === false) {
    return parseScheduleText(text, options.referenceDate);
  }

  try {
    const aiEvent = await parseScheduleWithAI(text, options);
    return aiEvent;
  } catch (err) {
    console.info('AI parsing unavailable or failed, fallback to local parser:', err.message);
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
