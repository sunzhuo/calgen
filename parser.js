/**
 * Schedule Natural Language Parser
 * Parses Chinese and English date/time/location/title texts,
 * with specialized structural resolution for forwarded messages, multi-turn chat logs,
 * speaker deixis ("我"/"咱们"), organizational self-introductions, and head-preserving title compression.
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

  let diff = targetDay - currentDay;

  if (weekOffset > 0) {
    diff = diff + (weekOffset * 7);
  } else if (!explicitThisWeek) {
    if (diff <= 0) {
      diff += 7;
    }
  }

  date.setDate(date.getDate() + diff);
  return date;
}

const METADATA_LABEL_REGEX = /^(?:时间|会议时间|活动时间|开始时间|结束时间|签到时间|集合时间|截止时间|日期|会议日期|地点|会议地点|活动地点|开会地点|位置|地址|会议室|场所|主题|会议主题|日程|事项|事件|标题|会议名称|内容|会议内容|主要内容|交流核心|议程|会议议程|备注|附言|补充|说明|链接|会议链接|入会链接|点击链接入会|点击链接直接加入会议|手机一键拨号入会|会议密码|复制该信息|腾讯会议|Zoom|飞书会议|钉钉会议|通知|紧急通知|重要通知|会议通知|温馨提示|提醒|发件人|收件人|抄送|发送时间|From|To|Cc|Sent|Date|Subject)$/i;

const GROUP_VOCATIVE_REGEX = /^(?:各位.*|大家|老师们|同学们|同事们|领导们|朋友们|家长们|所有人|全体.*|@.*|尊敬的.*|亲爱的.*)$/i;

const SELF_SPEAKER_REGEX = /^(?:我|本人|俺|自己|Me|I)$/i;

const META_FORWARD_NOTE_REGEX = /^(?:(?:请|麻烦|帮我|帮忙)?(?:记一下|记录一下|加一下|添加(?:到)?|存一下|生成|建个?|安排一下|弄一下)?(?:这个|本|该|这条)?(?:日程|日历|会议|提醒|备忘|事项)?|(?:转给你(?:看下|看看)?|转发(?:给你)?|收到(?:[，,\s]*谢谢)?|好的(?:[^，,。]{0,4}收到)?|明白|ok|OK|嗯嗯|好滴|好的呢|一定准时到|准时参加|准时到|记得(?:去|参加)|别忘了|如题|RT|FYI))[！!。.~～👍👌\s]*$/i;

const ACK_TURN_REGEX = /^(?:好的[\u4e00-\u9fa5A-Za-z0-9]{0,6}[，,\s]*(?:收到|明白|谢谢|没问题)?|收到[，,\s]*(?:谢谢[\u4e00-\u9fa5]{0,4})?|明白[，,\s]*(?:谢谢)?|没问题|好的没问题|ok|OK|好滴|嗯嗯|谢谢[\u4e00-\u9fa5]{0,4}|辛苦[\u4e00-\u9fa5]{0,4}|准时参加|一定准时到)[！!。.~～\[\]\u4e00-\u9fa5]{0,6}$/i;

const PLACEHOLDER_MEETING_TOPIC_REGEX = /(?:预定的会议|预约的会议|的快速会议|发起的(?:视频|线上|语音)?会议|的(?:腾讯|飞书|钉钉|视频|线上|Zoom)会议|^(?:腾讯|飞书|钉钉|Zoom|视频|线上|临时|快速)?会议$)$/i;

const BARE_GENERIC_TITLE_REGEX = /^(?:日程安排|日程|安排|重要日程|会议日程|会议|开会|线上会议|视频会议|语音会议|腾讯会议|飞书会议|钉钉会议|Zoom会议|讨论|讨论一下|聊一下|聊聊|碰一下|碰头|沟通|沟通一下|面谈|谈一下|汇报|汇报一下|汇报进度|过一下|对齐|对齐一下|一面|二面|三面|终面|初面|面试|视频面试|线上面试|复试|笔试|复诊|就诊|看病|看牙|体检|聚餐|吃饭|请吃饭|请客|签字|找我签字|盖章|来办公室|来我办公室|去办公室|到办公室|见一面|见面|拜访|聊天记录|合并转发|转发|转发消息|收到|好的|同学你好|老师你好|您好|你好)$/i;

/**
 * Check if a meeting topic is a system-generated default placeholder (e.g. "张华预定的会议")
 */
export function isPlaceholderMeetingTopic(topic = '') {
  const t = String(topic || '').trim();
  if (!t) return true;
  return PLACEHOLDER_MEETING_TOPIC_REGEX.test(t);
}

/**
 * Check if an extracted title is missing a meaningful subject, broken, or overly generic
 */
export function isWeakEventTitle(title = '') {
  const t = String(title || '').trim();
  if (!t || t.length < 2) return true;
  if (BARE_GENERIC_TITLE_REGEX.test(t)) return true;
  if (/^(?:我是|本人是|这里是|俺是|提取文件|===)/.test(t)) return true;
  if (/(?:的|时间|地点|关于|召开|举办|举行|预定的?|聊天记录)$/.test(t)) return true;
  if (isPlaceholderMeetingTopic(t)) return true;
  return false;
}

/**
 * Extract organization / institution / counterparty entity from self-introduction or leading bracket tag
 * Distinguishes messenger-only roles ("我是本次答辩的秘书安帅斌") from subject-bearing entities ("我是字节跳动HR李敏", "这里是协和医院口腔科")
 */
export function extractEntityFromText(text = '') {
  if (!text || typeof text !== 'string') {
    return { orgSubject: '', eventTypeHint: '', inviter: '' };
  }
  const trimmed = text.trim();
  let orgSubject = '';
  let eventTypeHint = '';
  let inviter = '';

  // 1. Inviter from meeting invite template: "张华 邀请您参加腾讯会议/飞书会议/Zoom..."
  const inviteMatch = trimmed.match(/(?:^|\n)\s*([\u4e00-\u9fa5A-Za-z0-9_·]{2,12})\s*邀请您参加(?:腾讯会议|飞书会议|钉钉会议|视频会议|线上会议|Zoom)/i);
  if (inviteMatch) {
    inviter = inviteMatch[1].trim();
  }

  // 2. Leading bracketed organization tag: 【协和医院】 / 【招商银行】 / 【字节跳动】
  const bracketMatch = trimmed.match(/^\s*【([^】]{2,14})】/);
  if (bracketMatch) {
    const tag = bracketMatch[1].trim();
    const isGenericTag = /^(?:通知|紧急通知|重要通知|会议通知|温馨提示|提醒|日程|日程安排|转发|合并转发|聊天记录|腾讯会议|飞书会议|钉钉|公告|公示|教务处|科研处|研究生院|学生处|人事处|财务处|行政部|办公室)$/.test(tag);
    if (!isGenericTag) {
      orgSubject = tag;
    }
  }

  // 3. Self-introduction clause: "我是..." / "这里是..."
  const selfIntroClauseMatch = trimmed.match(/(?:^|[，,。；;！!\s\n])(我是|本人是|这里是|俺是)\s*([^\n，,。；;！!？?]{2,24})/);
  if (selfIntroClauseMatch) {
    const introVerb = selfIntroClauseMatch[1];
    const introBody = selfIntroClauseMatch[2].trim();

    // Case A: Messenger-only self-intro referencing an event type ("我是本次答辩的秘书安帅斌")
    const eventRefMatch = introBody.match(/^(?:本次|这次|本场|此次|该)([^\s，,。；;的]{2,10}?)(?:的)?(?:秘书|负责人|联系人|主持人|组织者|助教|老师|同学|工作人员)/);
    if (eventRefMatch) {
      eventTypeHint = eventRefMatch[1].trim();
    } else if (introVerb === '这里是') {
      // Case B: "这里是协和医院口腔科"
      let placeOrg = introBody
        .replace(/(?:的)?(?:客服|前台|导诊台?|工作人员|秘书|助手|通知|提醒).*$/, '')
        .trim();
      const isInternalGeneric = /^(?:行政部|人事部|财务部|办公室|教务处|科研处|研究生院|秘书处|会务组)$/.test(placeOrg);
      if (placeOrg.length >= 2 && placeOrg.length <= 12 && !isInternalGeneric) {
        orgSubject = placeOrg;
      }
    } else {
      // Case C: "我是字节跳动HR李敏" / "我是华为云张工" / "我是招商银行客户经理陈晨"
      let candidateOrg = introBody
        .replace(/(?:的)?(?:HR|hr|人事|招聘(?:组|专员|经理|负责人)?|校招(?:组|负责人)?|猎头|客户经理|理财经理|产品经理|项目经理|技术总监|研发总监|部门经理|团队负责人|主治医师|副主任医师|主任医师|医生|大夫|护士|顾问|专员|秘书|负责人|联系人|主持人|组织者|助教|助理|工作人员).*$/i, '')
        .replace(/(?:的)?[张王李赵刘陈杨黄周吴徐孙胡朱高林何郭马罗梁宋郑谢韩唐冯于董萧程曹袁邓许傅沈曾彭吕苏卢蒋蔡贾丁魏薛叶阎余潘杜戴夏钟汪田任姜范方石姚谭廖邹熊金陆郝孔白崔康毛邱秦江史顾侯邵孟龙万段漕钱汤尹黎易常武乔贺赖龚文][\u4e00-\u9fa5]{0,2}(?:工|总|哥|姐|老师|教授|经理|主任|院长|处长|所长|博士|师兄|师姐|同学)?$/, '')
        .replace(/的$/, '')
        .trim();

      const isNonOrg = /^(?:本次|这次|本场|此次|负责|通知|联系|组织|主持|行政部|人事部|办公室|教务处|科研处)/.test(candidateOrg);
      if (candidateOrg.length >= 2 && candidateOrg.length <= 10 && !isNonOrg && !orgSubject) {
        orgSubject = candidateOrg;
      }
    }
  }

  return { orgSubject, eventTypeHint, inviter };
}

/**
 * Structural pre-analyzer for forwarded messages, multi-turn chat records, quoted blocks, and ZIP extracts.
 * Strips wrapper noise and chat send timestamps while preserving speaker attribution, deictic context, and clean text.
 * @param {string} rawText
 * @returns {{
 *   isForwarded: boolean,
 *   cleanText: string,
 *   latestScheduleTurnText: string,
 *   aiInputText: string,
 *   primarySpeaker: string,
 *   speakers: string[],
 *   orgSubject: string,
 *   eventTypeHint: string,
 *   inviter: string,
 *   forwarderNote: string,
 *   turns: Array<{ speaker: string, text: string, isAck: boolean }>,
 *   hasFirstPersonDeixis: boolean
 * }}
 */
export function preprocessForwardedText(rawText = '') {
  if (!rawText || typeof rawText !== 'string') {
    return {
      isForwarded: false,
      cleanText: '',
      latestScheduleTurnText: '',
      aiInputText: '',
      primarySpeaker: '',
      speakers: [],
      orgSubject: '',
      eventTypeHint: '',
      inviter: '',
      forwarderNote: '',
      turns: [],
      hasFirstPersonDeixis: false
    };
  }

  let working = rawText.replace(/\r\n/g, '\n').trim();
  let isForwarded = false;
  let forwarderNote = '';
  const speakersSet = new Set();

  // 1. Strip Android ZIP extraction headers ("=== 提取文件: xxx.txt ===")
  if (/^===\s*提取文件\s*[:：].*?===/m.test(working)) {
    isForwarded = true;
    working = working.replace(/^===\s*提取文件\s*[:：].*?===\s*$/gm, '').trim();
  }

  // 2. Handle WeChat/IM quoted block + dashed divider:
  // e.g. 「刘主任：周四下午2点...」\n - - - - - - - \n 帮我记一下
  const quoteDividerMatch = working.match(/^([\s\S]+?)\n\s*(?:-\s*){4,}-?\s*\n([\s\S]+)$/);
  if (quoteDividerMatch) {
    isForwarded = true;
    let quotedPart = quoteDividerMatch[1].trim();
    const notePart = quoteDividerMatch[2].trim();
    quotedPart = quotedPart.replace(/^[「『“"]([\s\S]+)[」』”"]$/, '$1').trim();

    if (META_FORWARD_NOTE_REGEX.test(notePart)) {
      working = quotedPart;
    } else {
      forwarderNote = notePart;
      working = `${quotedPart}\n附言：${notePart}`;
    }
  } else if (/^[「『][\s\S]+[」』]$/.test(working)) {
    isForwarded = true;
    working = working.replace(/^[「『]([\s\S]+)[」』]$/, '$1').trim();
  }

  // 3. Process line-by-line for merged chat headers, email forward headers, and chat speaker+timestamp headers
  const rawLines = working.split('\n');
  const turns = [];
  let currentSpeaker = '';
  let currentBuffer = [];

  const flushTurn = () => {
    const joined = currentBuffer.join('\n').trim();
    if (joined) {
      const isAck = ACK_TURN_REGEX.test(joined);
      turns.push({ speaker: currentSpeaker, text: joined, isAck });
      if (currentSpeaker && !SELF_SPEAKER_REGEX.test(currentSpeaker)) {
        speakersSet.add(currentSpeaker);
      }
    }
    currentBuffer = [];
  };

  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i].trim();
    if (!line) continue;

    // 3a. Merged chat history banner: -----XXX的聊天记录----- or ---------- Forwarded message ---------
    if (/^[-—=]{2,}\s*(?:.*?(?:聊天记录|Forwarded\s+message|转发的?(?:消息|邮件|内容)?))\s*[-—=]{0,}\s*$/i.test(line) ||
        /^(?:\[聊天记录\]|【聊天记录】|\[合并转发\]|【合并转发】)$/.test(line)) {
      isForwarded = true;
      continue;
    }

    // 3b. Email / OA forward metadata lines
    const emailFromMatch = line.match(/^(?:发件人|From)\s*[:：]\s*(.+)$/i);
    if (emailFromMatch) {
      isForwarded = true;
      const senderClean = emailFromMatch[1].replace(/<[^>]+>/g, '').replace(/["']/g, '').trim();
      if (senderClean && senderClean.length <= 16 && !SELF_SPEAKER_REGEX.test(senderClean)) {
        speakersSet.add(senderClean);
        currentSpeaker = senderClean;
      }
      continue;
    }
    if (/^(?:发送时间|发送日期|收件人|抄送|Sent|To|Cc)\s*[:：]\s*.+$/i.test(line)) {
      isForwarded = true;
      continue;
    }
    const emailSubjMatch = line.match(/^(?:主题|Subject)\s*[:：]\s*(.+)$/i);
    if (emailSubjMatch) {
      const cleanedSubj = emailSubjMatch[1].replace(/^(?:(?:转发|回复|Fw|Fwd|Re)\s*[:：]\s*)+/gi, '').trim();
      line = `主题：${cleanedSubj}`;
    }

    // 3c. Explicit inline forward prefix: [转发] 李处长：... / 转发自 教务处刘老师：...
    const explicitFwdMatch = line.match(/^(?:\[转发\]|【转发】|转发自|转自|来自)\s*([\u4e00-\u9fa5A-Za-z0-9_·]{2,14}?)\s*[：:]\s*(.*)$/);
    if (explicitFwdMatch) {
      flushTurn();
      isForwarded = true;
      const spk = explicitFwdMatch[1].trim();
      if (!METADATA_LABEL_REGEX.test(spk) && !GROUP_VOCATIVE_REGEX.test(spk)) {
        currentSpeaker = spk;
        if (!SELF_SPEAKER_REGEX.test(spk)) speakersSet.add(spk);
      }
      if (explicitFwdMatch[2] && explicitFwdMatch[2].trim()) {
        currentBuffer.push(explicitFwdMatch[2].trim());
      }
      continue;
    }
    if (/^(?:\[转发\]|【转发】|转发\s*[：:])\s*/i.test(line)) {
      isForwarded = true;
      line = line.replace(/^(?:\[转发\]|【转发】|转发\s*[：:])\s*/i, '').trim();
      if (!line) continue;
    }

    // 3d. Chat message header with send timestamp:
    // e.g. "王教授 2026/11/18 10:15", "张院长 10:25", "赵老师 14:20:05", "陈经理 昨天 09:12"
    const chatHeaderMatch = line.match(
      /^([\u4e00-\u9fa5A-Za-z0-9_（()）·\-]{1,16}?)\s+(?:(?:\d{4}[\/\-年]\d{1,2}[\/\-月]\d{1,2}[日号]?|\d{1,2}[\/\-月]\d{1,2}[日号]?|今天|昨天|前天|星期[一二三四五六日天]|周[一二三四五六日天])\s+)?(\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:AM|PM|am|pm))?)$/
    );
    if (chatHeaderMatch) {
      const candidateName = chatHeaderMatch[1].trim();
      if (!/^(?:https?|ftp|mailto|tel|zoommtg|calgen|file)$/i.test(candidateName) &&
          !METADATA_LABEL_REGEX.test(candidateName) && !/(?:时间|日期|时段|期限)$/.test(candidateName)) {
        flushTurn();
        isForwarded = true;
        currentSpeaker = candidateName;
        if (!SELF_SPEAKER_REGEX.test(candidateName)) {
          speakersSet.add(candidateName);
        }
        continue; // Strip send timestamp line!
      }
    }

    // 3e. Standalone speaker line ending with colon: "王建国教授：" followed by body on next line
    const standaloneSpeakerMatch = line.match(/^([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9_·]{1,12})\s*[：:]$/);
    if (standaloneSpeakerMatch && i + 1 < rawLines.length) {
      const candidateName = standaloneSpeakerMatch[1].trim();
      const nextLine = (rawLines[i + 1] || '').trim();
      const isGreetingToRecipient = /^(?:您好|你好|早上好|上午好|中午好|下午好|晚上好|好[！!，,\s])/.test(nextLine);
      if (!METADATA_LABEL_REGEX.test(candidateName) && !GROUP_VOCATIVE_REGEX.test(candidateName) && !/(?:点击|链接|入会|扫码|复制|打开|查看|拨号|密码)/.test(candidateName) && !isGreetingToRecipient) {
        flushTurn();
        isForwarded = true;
        currentSpeaker = candidateName;
        if (!SELF_SPEAKER_REGEX.test(candidateName)) {
          speakersSet.add(candidateName);
        }
        continue;
      }
    }

    // 3f. Single-line "Speaker：Message" (e.g. "刘主任：周四下午2点在二号楼会议室开安全检查协调会")
    const inlineSpeakerMatch = line.match(/^([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9_·]{1,10})\s*[：:]\s*(?!\/\/)(.+)$/);
    if (inlineSpeakerMatch) {
      const candidateName = inlineSpeakerMatch[1].trim();
      const restMsg = inlineSpeakerMatch[2].trim();
      const isGreetingToRecipient = /^(?:您好|你好|早上好|上午好|中午好|下午好|晚上好|好[！!，,\s])/.test(restMsg);
      const isDirectQuestionToRecipient = /^(?:我们|咱们|我(?:这边|这里)?(?:打算|计划|想|准备))/.test(restMsg) &&
        /(?:方便吗|有空吗|有时间吗|有时间吧|可以吗|行吗)[？?！!]*$/.test(restMsg);

      if (!METADATA_LABEL_REGEX.test(candidateName) &&
          !GROUP_VOCATIVE_REGEX.test(candidateName) &&
          !/(?:点击|链接|入会|扫码|复制|打开|查看|拨号|密码)/.test(candidateName) &&
          !isGreetingToRecipient &&
          !isDirectQuestionToRecipient) {
        flushTurn();
        isForwarded = true;
        currentSpeaker = candidateName;
        if (!SELF_SPEAKER_REGEX.test(candidateName)) {
          speakersSet.add(candidateName);
        }
        currentBuffer.push(restMsg);
        continue;
      }
    }

    currentBuffer.push(line);
  }
  flushTurn();

  const speakers = [...speakersSet];
  const primarySpeaker = speakers.length > 0 ? speakers[0] : '';

  const nonAckTurns = turns.filter(t => !t.isAck);
  const effectiveTurns = nonAckTurns.length > 0 ? nonAckTurns : turns;
  const cleanText = effectiveTurns.map(t => t.text).join('\n').trim() || working;

  // Find latest turn that contains concrete time/date confirmation in multi-turn dialogues
  let latestScheduleTurnText = cleanText;
  if (effectiveTurns.length > 1) {
    for (let idx = effectiveTurns.length - 1; idx >= 0; idx--) {
      const tText = effectiveTurns[idx].text;
      if (/(?:\d{1,2}\s*[:：点]\s*\d{0,2}|上午|下午|晚上|中午|明天|后天|周[一二三四五六日天]|星期[一二三四五六日天]|\d{1,2}月\d{1,2}[日号]?)/.test(tText)) {
        latestScheduleTurnText = tText;
        break;
      }
    }
  }

  const { orgSubject, eventTypeHint, inviter } = extractEntityFromText(cleanText);
  const cleanWithoutInviteTemplate = cleanText.replace(/邀请您参加(?:腾讯会议|飞书会议|钉钉会议|视频会议|线上会议|Zoom)/gi, "");
  const hasFirstPersonDeixis = /(?:来我|到我|去我|找我|跟我|和我|发我|给我|请大家|咱们|我们线上|我们过|我们讨论|我们碰)/.test(cleanWithoutInviteTemplate);

  // Build structured AI user input that preserves speaker identity without raw send-timestamp confusion
  let aiInputText = cleanText;
  if (effectiveTurns.some(t => t.speaker)) {
    aiInputText = effectiveTurns
      .map(t => (t.speaker ? `[发言人: ${t.speaker}] ${t.text}` : t.text))
      .join('\n');
  }
  const hintParts = [];
  if (primarySpeaker) hintParts.push(`消息发送方/对话人=${primarySpeaker}`);
  if (orgSubject) hintParts.push(`关联机构/企业主体=${orgSubject}`);
  if (inviter && inviter !== primarySpeaker) hintParts.push(`会议发起人=${inviter}`);
  if (forwarderNote) hintParts.push(`转发补充说明=${forwarderNote}`);
  if (hintParts.length > 0) {
    aiInputText += `\n[转发上下文提示: ${hintParts.join('；')}]`;
  }

  return {
    isForwarded: isForwarded || Boolean(orgSubject) || Boolean(inviter),
    cleanText,
    latestScheduleTurnText,
    aiInputText,
    primarySpeaker,
    speakers,
    orgSubject,
    eventTypeHint,
    inviter,
    forwarderNote,
    turns: effectiveTurns,
    hasFirstPersonDeixis
  };
}

/**
 * Compress a cleaned Chinese event title to <= maxLen characters WITHOUT chopping off the right-hand core event head-noun.
 * @param {string} title
 * @param {number} [maxLen=12]
 * @returns {string}
 */
export function compressTitleToLimit(title, maxLen = 12) {
  if (!title || typeof title !== 'string') return '';
  let t = title.trim();
  const effectiveMax = /^[\x20-\x7E]+$/.test(t) ? Math.max(maxLen * 2, 24) : maxLen;
  if (t.length <= effectiveMax) return t;

  // Step 1: Strip low-signal year / quarter / session / seasonal modifiers
  t = t.replace(/20\d{2}\s*(?:年度?|学年|届)/g, '');
  if (t.length <= maxLen) return t;

  t = t.replace(/第[一二三四五六七八九十百\d]+(?:季度|届|期|次|批|轮)/g, '');
  t = t.replace(/(?:春|夏|秋|冬)季(?:学期)?/g, '');
  t = t.replace(/(?:上|下)半年/g, '');
  if (t.length <= maxLen) return t;

  // Step 2: Compact verbose academic / institutional phrases
  const compactRules = [
    [/科学与技术学院/g, '学院'],
    [/工程与科学学院/g, '学院'],
    [/信息与通信工程/g, '信通'],
    [/(硕士|博士)研究生/g, '$1'],
    [/学位论文/g, '论文'],
    [/毕业论文/g, '论文'],
    [/前沿技术/g, '前沿'],
    [/关键技术/g, '技术'],
    [/重点项目/g, '项目'],
    [/项目进度/g, '进度'],
    [/进行|开展|举行|举办|召开/g, ''],
    [/一下/g, '']
  ];
  for (const [pattern, replacement] of compactRules) {
    if (t.length <= maxLen) break;
    t = t.replace(pattern, replacement);
  }
  if (t.length <= maxLen) return t;

  // Step 3: Head-noun preserving compression (keep core right-hand event noun intact!)
  const headMatch = t.match(
    /(预答辩|开题答辩|中期答辩|毕业答辩|论文答辩|答辩|研讨会|评审会|沟通会|协调会|发布会|宣讲会|报告会|座谈会|推进会|通气会|启动会|复盘会|例会|周会|组会|早会|晨会|夕会|会议|讲座|论坛|沙龙|培训|一面|二面|三面|终面|初面|面试|复试|笔试|机试|复诊|就诊|门诊|体检|聚餐|团建|典礼|仪式|检查|督导|调研|走访|考察|汇报|讨论|面谈|签字)$/
  );
  if (headMatch) {
    const head = headMatch[1];
    const prefixBudget = maxLen - head.length;
    if (prefixBudget >= 2) {
      let prefix = t.slice(0, t.length - head.length);
      prefix = prefix.slice(0, prefixBudget).replace(/[的与和及跟找向在去到]+$/, '');
      if (prefix.length >= 2) {
        return `${prefix}${head}`;
      }
    }
  }

  return t.substring(0, maxLen).replace(/[的与和及跟找向在去到]+$/, '').trim();
}

/**
 * Extract glued event title appearing directly before "时间：" or "地点："
 * e.g., "博士开题及中期时间：10月28日..." -> "博士开题及中期答辩" or "博士开题及中期"
 * @param {string} text
 * @returns {string}
 */
export function extractGluedEventTitle(text) {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim();

  // Rule A: match specific event name glued to (具体|开始|结束|会议|活动)?(时间|地点)[:：]
  const gluedMatch = trimmed.match(
    /(?:^|[，。；！？、\s\n\r])([^\s，。；！？、：:\n\r]{2,20}?)(?:具体|开始|结束|会议|活动)?(?:时间|地点)\s*[:：]/
  );
  if (!gluedMatch) return '';

  let candidate = gluedMatch[1].trim();

  // Filter out pure generic words
  const genericWords = /^(?:会议|活动|开始|结束|具体|通知|集合|开会|培训|日程|安排|召开|举行|举办|交流|座谈|调研|时间|地点|签到|面试|答辩)$/;
  if (genericWords.test(candidate)) return '';

  // Filter out pure greetings / vocatives if any glued
  candidate = candidate.replace(/^(?:各位[^\s，,：:]{0,6}|大家好|老师们|同学们|所有人)/, '').trim();
  if (candidate.length < 2) return '';

  // Rule B: check if there is a self-introduction clause with an event type word
  // e.g. "我是本次答辩的秘书安帅斌" -> eventType = "答辩"
  const selfIntroMatch = trimmed.match(
    /(?:^|[，。；！？、\s\n\r])(?:我是|本人是|这里是|俺是)(?:本次|这次|本场)?([^\s，。；！？、：:\n\r]{2,10}?)(?:的)?(?:秘书|负责人|联系人|主持人|组织者|助教|老师|同学|工作人员)/
  );
  const eventType = selfIntroMatch ? selfIntroMatch[1].trim() : '';

  // Rule C: semantic merge
  if (eventType && !candidate.endsWith(eventType)) {
    if ((candidate + eventType).length <= 12) {
      return `${candidate}${eventType}`;
    }
  }

  return compressTitleToLimit(candidate, 12);
}

/**
 * Enrich or repair an extracted title with the true event subject from forwarded context
 * (organization/company/hospital from self-intro or tag, speaker from forwarded chat + deixis,
 * multi-turn topic, forwarder note, or meeting invite metadata).
 * @param {string} currentTitle
 * @param {string} [fullText]
 * @returns {string}
 */
export function enrichTitleWithForwardedSubject(currentTitle, fullText = '') {
  const t = (currentTitle || '').trim();
  if (!fullText || typeof fullText !== 'string') return t;

  const prep = preprocessForwardedText(fullText);
  const { primarySpeaker, orgSubject, inviter, forwarderNote, cleanText, turns, hasFirstPersonDeixis } = prep;

  // 1. If forwarder explicitly wrote a substantive note (e.g. "向王总汇报智慧园区项目进度") and current title is weak/generic
  if (forwarderNote && (isWeakEventTitle(t) || t.length <= 4)) {
    const cleanedNote = stripClauseToCoreAction(forwarderNote);
    if (cleanedNote && !isWeakEventTitle(cleanedNote)) {
      return compressTitleToLimit(cleanedNote, 12);
    }
  }

  // 2. Handle Tencent/Feishu/Zoom placeholder topic ("张华预定的会议" / "张华预定")
  if (isPlaceholderMeetingTopic(t) || /^(?:[\u4e00-\u9fa5A-Za-z]{2,6})预定$/.test(t)) {
    // Check 附言/议题 or earlier forwarded turns for real subject
    const noteTopicMatch = cleanText.match(/(?:附言|备注|议题|说明|内容)\s*[:：]\s*([^\n。；;]+)/);
    if (noteTopicMatch) {
      const noteAction = stripClauseToCoreAction(noteTopicMatch[1]);
      if (noteAction && !isWeakEventTitle(noteAction)) {
        return compressTitleToLimit(noteAction, 12);
      }
    }
    for (const turn of turns) {
      if (!/邀请您参加|会议主题/.test(turn.text)) {
        const turnAction = stripClauseToCoreAction(turn.text);
        if (turnAction && !isWeakEventTitle(turnAction)) {
          const spk = turn.speaker && !SELF_SPEAKER_REGEX.test(turn.speaker) ? turn.speaker : primarySpeaker;
          return bindSpeakerAndAction(spk, turnAction, hasFirstPersonDeixis);
        }
      }
    }
    const host = inviter || primarySpeaker || (t.match(/^([\u4e00-\u9fa5A-Za-z]{2,8})预定/) || [])[1] || '';
    if (host) {
      const platform = /腾讯会议/.test(fullText) ? '腾讯会议' : (/飞书/.test(fullText) ? '飞书会议' : '线上会议');
      return compressTitleToLimit(`${host}的${platform}`, 12);
    }
  }

  // 3. Multi-turn chat recovery: if current title is weak/empty, scan all substantive turns for the real topic
  let workingTitle = t;
  if ((turns.length > 1 && isWeakEventTitle(workingTitle)) || !workingTitle || workingTitle === '日程安排') {
    for (const turn of turns) {
      const candidate = stripClauseToCoreAction(turn.text);
      if (candidate && !isWeakEventTitle(candidate)) {
        workingTitle = candidate;
        break;
      }
    }
  }

  // 4. Organization / Institution subject binding:
  // e.g. orgSubject="字节跳动", workingTitle="后端研发一面" -> "字节跳动后端研发一面"
  // e.g. orgSubject="协和医院口腔科", workingTitle="复诊" -> "协和医院口腔科复诊"
  if (orgSubject) {
    const orgCore = orgSubject.slice(0, 2);
    const alreadyHasOrg = workingTitle && (workingTitle.includes(orgSubject) || (orgCore.length >= 2 && workingTitle.includes(orgCore)));
    if (!alreadyHasOrg) {
      if (!workingTitle || workingTitle === '日程安排' || /^(?:同学你好|老师你好|您好|你好)$/.test(workingTitle)) {
        const recoveredAction = extractActionFromBody(cleanText);
        if (recoveredAction) {
          return compressTitleToLimit(`${orgSubject}${recoveredAction}`, 12);
        }
      }
      const needsOrgSubject = isWeakEventTitle(workingTitle) ||
        /(?:一面|二面|三面|终面|初面|面试|复试|笔试|机试|宣讲|双选|复诊|就诊|门诊|看牙|洗牙|体检|面谈|理财|开户|签约|拜访|对齐|沟通|交流|演示|培训)$/.test(workingTitle);
      if (needsOrgSubject && workingTitle && workingTitle !== '日程安排') {
        return compressTitleToLimit(`${orgSubject}${workingTitle}`, 12);
      }
    }
  }

  // 5. Forwarded Speaker + Deictic / Subjectless Action binding:
  // e.g. primarySpeaker="王建国教授" + "来我办公室讨论一下开题报告" -> "与王建国教授讨论开题报告"
  // e.g. primarySpeaker="李总" + "今晚6点半在望湘园请大家吃饭" -> "李总请吃饭"
  if (primarySpeaker) {
    const spkCore = primarySpeaker.replace(/(?:教授|老师|院长|处长|主任|经理|总监|馆长|科长|博士|总|工|哥|姐)$/, '') || primarySpeaker;
    const alreadyHasSpeaker = workingTitle && (
      workingTitle.includes(primarySpeaker) ||
      (spkCore.length >= 2 && workingTitle.includes(spkCore))
    );

    if (!alreadyHasSpeaker) {
      // Check if workingTitle is equal to just the speaker name or broken
      let actionPart = (!workingTitle || workingTitle === '日程安排' || workingTitle === primarySpeaker)
        ? extractActionFromBody(cleanText)
        : workingTitle;

      // Determine whether this forwarded message is an interpersonal/deictic event vs a self-contained formal named event
      const isFormalStandaloneEvent = actionPart &&
        actionPart.length >= 5 &&
        /(?:预答辩|开题|中期|毕业答辩|课题组组会|组会|例会|周会|研讨会|评审会|协调会|发布会|宣讲会|报告会|座谈会|督导检查|安全检查|学术讲座|论坛|典礼|仪式)$/.test(actionPart) &&
        !hasFirstPersonDeixis;

      if (!isFormalStandaloneEvent && actionPart) {
        if (hasFirstPersonDeixis || isWeakEventTitle(actionPart) || /^(?:讨论|沟通|商讨|碰|过|聊|谈|汇报|核对|对齐|修改|签字|吃饭|聚餐|请吃饭)/.test(actionPart)) {
          return bindSpeakerAndAction(primarySpeaker, actionPart, hasFirstPersonDeixis, cleanText);
        }
      } else if (!actionPart) {
        return compressTitleToLimit(`与${primarySpeaker}日程`, 12);
      }
    } else if (workingTitle === primarySpeaker) {
      // Title only captured speaker name without the action!
      const actionPart = extractActionFromBody(cleanText);
      if (actionPart) {
        return bindSpeakerAndAction(primarySpeaker, actionPart, hasFirstPersonDeixis, cleanText);
      }
    }
  }

  return workingTitle;
}

/**
 * Clean a raw sentence/clause down to its core verb-object / noun-phrase event action
 */
function stripClauseToCoreAction(clause = '') {
  if (!clause) return '';
  let s = clause.trim();
  s = s.replace(/\[[\u4e00-\u9fa5a-zA-Z0-9_\-]+\]/g, '');
  s = s.replace(/https?:\/\/[^\s]+/g, '');
  s = s.replace(/#?(?:腾讯会议|Zoom)[：:\s]*\d{3}[-\s]?\d{3}[-\s]?\d{3,4}/gi, '');
  // Strip greetings & self-intro clauses
  s = s.replace(/^\s*【[^】]{1,14}】\s*(?:(?:同学|老师|先生|女士|各位[^，,]{0,6})?(?:您好|你好|下午好|上午好|早上好|晚上好))?[，,！!\s]*/i, '');
  const parts = s.split(/[，,。；;！!？?\n]+/).map(p => p.trim()).filter(Boolean);
  const filtered = parts.filter(p => {
    if (/^(?:【[^】]+】)?(?:同学|老师|先生|女士|各位|大家)?(?:你好|您好|早上好|上午好|中午好|下午好|晚上好|好)$/.test(p)) return false;
    if (/^(?:我是|本人是|这里是|俺是)/.test(p)) return false;
    if (/^(?:好|好的|那|那就|行|没问题)$/.test(p)) return false;
    if (/有(?:空|时间)吗[？?]*$/.test(p) && p.length <= 12) return false;
    if (/^(?:请|麻烦)?(?:各位|大家|相关)?.*?(?:准时|预留时间|把PPT|准备好|收到|回复|谢谢|辛苦)/.test(p) && !/(?:复诊|面试|一面|答辩|开会|讨论)/.test(p)) return false;
    return true;
  });

  let joined = filtered.join('，');
  // Strip time/date expressions
  joined = joined.replace(/\d{4}[\.\/\-年]\d{1,2}[\.\/\-月]\d{1,2}[日号]?/g, '');
  joined = joined.replace(/\d{1,2}月\d{1,2}[日号]?/g, '');
  joined = joined.replace(/(?:大后天|后天|明天|明日|今天|今日|昨天|昨日|今晚|明晚)/g, '');
  joined = joined.replace(/(?:(?:下下周|下周|本周|这周)\s*[一二三四五六日天末]?|(?:周|星期|礼拜)[一二三四五六日天末])/g, '');
  joined = joined.replace(/(?:早上|清晨|早晨|上午|中午|下午|傍晚|晚上|夜里|凌晨)?\s*\d{1,2}\s*[:：]\s*\d{2}(?:分)?(?:\s*[-~至到]\s*\d{1,2}\s*[:：]\s*\d{2}(?:分)?)?/g, '');
  joined = joined.replace(/(?:早上|清晨|早晨|上午|中午|下午|傍晚|晚上|夜里|凌晨)?\s*(?:\d{1,2}|[一二两三四五六七八九十]+)\s*点(?:(?:\d{1,2}|半|一刻|三刻)分?)?/g, '');
  joined = joined.replace(/(?:早上|清晨|早晨|上午|中午|下午|傍晚|晚上|夜里|凌晨)/g, '');
  // Strip location phrases
  joined = joined.replace(/(?:地点|位置|地址|会议室|场所)\s*(?:[：:]|在|为|设于)?\s*[^\n,，。.;；]+/g, '');
  joined = joined.replace(/(?:来|到|去|在)\s*(?:我(?:的)?办公室|[A-Za-z0-9\u4e00-\u9fa5]{2,14}?(?:会议室|报告厅|办公室|教室|实验室|管理楼|科技楼|行政楼|主楼|门诊楼|二号楼|一号楼|科研处|教务处|学工办|望湘园|广场|大厦|中心)(?:[A-Za-z0-9\u4e00-\u9fa5]{0,6}?(?:室|楼|层|厅|会议室))?)/g, '');
  // Strip conversational lead-ins
  joined = joined.replace(/^(?:好|好的|那|那就)?(?:定在|暂定|约在|约你|约您|想约你们?|提醒您|提醒你|通知您|请您|请你|顺便|咱们|我们|我)?(?:线上|线下|一起)?(?:进行|开展|参加)?/g, '');
  joined = joined.replace(/一下/g, '');
  joined = joined.replace(/[，,。;；:：!！?？"“”'‘’「」『』、~～\-—·\(\)（）\[\]【】]/g, '').trim();
  return joined;
}

/**
 * Extract the best core action phrase from cleaned message body
 */
function extractActionFromBody(cleanText = '') {
  if (!cleanText) return '';
  if (/请(?:大家|咱们|你们|各位)?吃饭/.test(cleanText)) return '请吃饭';
  const lines = cleanText.split(/[\n。；;！!]+/).map(s => s.trim()).filter(Boolean);
  for (const line of lines) {
    if (/邀请您参加|会议主题|点击链接入会|#腾讯会议/.test(line)) continue;
    const act = stripClauseToCoreAction(line);
    if (act && act.length >= 2 && !/^(?:A座|B座|C座|\d+)/.test(act)) {
      return act;
    }
  }
  return '';
}

/**
 * Naturally combine speaker name and action into a concise <=12-char Chinese calendar title
 */
function bindSpeakerAndAction(speaker, action, hasDeixis = false, rawContext = '') {
  if (!speaker) return compressTitleToLimit(action, 12);
  let act = (action || '').trim();
  act = act.replace(/^(?:来我办公室|到我办公室|去我办公室|找我|跟我|和我|与我|咱们|我们)/, '').replace(/一下/g, '').trim();

  if (!act || act === '日程安排') {
    return compressTitleToLimit(`与${speaker}面谈`, 12);
  }
  if (act === '请吃饭' || /请.*吃饭/.test(act)) {
    return compressTitleToLimit(`${speaker}请吃饭`, 12);
  }
  if (/^(?:聚餐|吃饭)$/.test(act)) {
    return compressTitleToLimit(`与${speaker}聚餐`, 12);
  }
  if (/^(?:签字|盖章|报销|交材料|拿材料|取材料)/.test(act) || /(?:找我|到.*找我)/.test(rawContext)) {
    if (/^(?:签字|盖章)/.test(act)) {
      return compressTitleToLimit(`找${speaker}${act}`, 12);
    }
  }
  if (/^(?:聊|聊聊|谈谈|见面|见一面)$/.test(act)) {
    return compressTitleToLimit(`与${speaker}面谈`, 12);
  }
  if (/^(?:开会|会议|线上会议|视频会议)$/.test(act)) {
    return compressTitleToLimit(`与${speaker}${act}`, 12);
  }

  const candidateWithYu = `与${speaker}${act}`;
  if (candidateWithYu.length <= 12) {
    return candidateWithYu;
  }

  // Try shortening speaker title if needed (e.g. "王建国教授" -> "王建国" or "王教授")
  const titleMatch = speaker.match(/^([\u4e00-\u9fa5])[\u4e00-\u9fa5]{1,2}(教授|老师|院长|处长|主任|经理|总监|馆长|博士|总)$/);
  if (titleMatch) {
    const shortSpeaker = `${titleMatch[1]}${titleMatch[2]}`;
    if (`与${shortSpeaker}${act}`.length <= 12) {
      return `与${shortSpeaker}${act}`;
    }
  }

  return compressTitleToLimit(candidateWithYu, 12);
}

/**
 * Sanitize and clean event title to keep it concise, clear, and focused on the core subject.
 * Strips salutations, polite greetings, boilerplate announcement prefixes/suffixes, emojis,
 * self-introduction phrases, forwarded wrappers, and dangling particles, while preserving
 * core event subjects and right-hand event head-nouns.
 * @param {string} rawTitle
 * @param {string} [fullText]
 * @returns {string}
 */
export function cleanEventTitle(rawTitle, fullText = '') {
  if (!rawTitle || typeof rawTitle !== 'string') return '日程安排';
  let t = rawTitle.trim();

  // 0. Strip ZIP extract banners, chat log banners, and quote dividers
  t = t.replace(/^===\s*提取文件\s*[:：].*?===\s*/gm, '').trim();
  t = t.replace(/^[-—=]{2,}\s*.*?(?:聊天记录|Forwarded\s+message).*?[-—=]{0,}\s*/gim, '').trim();
  t = t.replace(/^(?:\[聊天记录\]|【聊天记录】|\[合并转发\]|【合并转发】|\[转发\]|【转发】)\s*/gi, '').trim();
  t = t.replace(/^[「『“"]([\s\S]+?)[」』”"]$/, '$1').trim();

  // 1. Strip bracket emojis (e.g. [握手], [OK], [强], [玫瑰], [咖啡], [微笑])
  t = t.replace(/\[[\u4e00-\u9fa5a-zA-Z0-9_\-]+\]/g, '').trim();

  // 1.2 Handle leading 【Tag】: strip generic admin notice tags (【通知】, 【教务处】关于...) while keeping org subjects if needed
  t = t.replace(/^【(?:通知|紧急通知|重要通知|会议通知|温馨提示|提醒|日程|公告|公示|转发|聊天记录)】\s*/, '');
  // Strip "[机构/学院] + 关于(召开|举办|举行|开展|组织|做好)..." official document header!
  t = t.replace(
    /^(?:【[^】]{1,12}】\s*)?(?:[\u4e00-\u9fa5]{2,16}?(?:学院|大学|学校|教务处|科研处|研究生院|学生处|人事处|财务处|办公室|委员会|中心|部门|协会|学会|局|厅|部))?\s*关于(?:进一步)?(?:召开|举办|举行|开展|组织|进行|做好|启动)?\s*/,
    ''
  );

  // 1.5 Strip meeting agenda/content details from the tail
  t = t.replace(/(?:交流核心|主要内容|会议内容|研讨内容|会议议程|主要议程|议程包括|交流要点)[：:\s\S]*$/i, '');

  // 2. Self-introduction extraction:
  // Distinguish messenger-only ("我是本次答辩的秘书安帅斌" -> "答辩") vs org subject ("我是字节跳动HR李敏" -> handled by subject enricher)
  const selfIntroMatch = t.match(
    /^(?:我是|本人是|这里是|俺是)(?:本次|这次|本场)?(.+?)(?:的)?(?:秘书|负责人|联系人|主持人|组织者|助教|老师|同学|工作人员)(?:[\u4e00-\u9fa5]{0,6})?$/
  );
  if (selfIntroMatch && selfIntroMatch[1] && selfIntroMatch[1].trim()) {
    t = selfIntroMatch[1].trim();
  }

  // 2.1 Strip standalone vocatives at the start in a loop (e.g. "@所有人 各位领导：", "各位负责人，")
  const vocativeLoopPattern = /^(?:各位(?:负责人|老师|领导|同事|同学|朋友|专家|会员|同仁|代表|家长|评审|评委|学长|学姐|新生|教授|大家)?|老师们|领导们|同事们|同学们|大家|所有人|@所有人)\s*[，,：:\s]+/i;
  let prevVoc;
  do {
    prevVoc = t;
    t = t.replace(vocativeLoopPattern, '').trim();
  } while (t !== prevVoc);

  // 2.5 Strip salutations and greetings from the start
  t = t.replace(/^(?:(?:各位(?:老师|领导|同事|同学|朋友|专家|会员|同仁|代表|家长|评审|评委|学长|学姐|新生|教授|负责人)?|大家|老师们|领导们|同事们|同学们|同学|老师)?(?:下午好|上午好|早上好|中午好|晚上好|好|您好|你好)|亲爱的.+?[好！!，,\s]|(?:Good\s+(?:morning|afternoon|evening)|Hi|Hello|Dear)\s+[^,，!！]+[,，!！]?)+[\s,，:：\-]*/i, '');

  // 3. Strip recipient vocatives with COMMA at the beginning (e.g. "张老师，我们打算...")
  // Note: Colon-separated forwarded speakers ("王教授：...") are intentionally handled via preprocessForwardedText / enrichTitleWithForwardedSubject!
  t = t.replace(/^(?:[A-Za-z\u4e00-\u9fa5]{2,5}|@\S+)[，,\s]+(?=(?:我|咱|请|有|下周|明天|后天|今天|关于|原定|现|麻烦|想|由于|因|各位))/i, '');

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

  // 4. Strip notification / announcement / note prefixes in a loop
  const prefixPattern = /^(?:各位[^\s，,：:]{0,6}(?:上午好|下午好|晚上好|大家好|好)|(?:上午|下午|晚上)?好|我是|本人是|这里是|俺是|关于(?:举办|召开|举行|组织|开展)?|通知您|通知你|提醒您|提醒你|邀请您|邀请你|通知|紧急通知|会议通知|日程安排|日程|安排|提醒|温馨提示|转发自|转自|转发|附言|备注|补充说明|补充|说明|议题|本次|这次|本场)[\s，,：:]*|^(?:时间|地点|主题|事项|会议内容|附言|备注|说明|议题)\s*[:：]\s*/i;
  let prev;
  do {
    prev = t;
    t = t.replace(prefixPattern, '').trim();
  } while (t !== prev);

  // Re-check official notice "关于召开..." if exposed after stripping prefixes
  t = t.replace(/^(?:[\u4e00-\u9fa5]{2,14}?(?:学院|大学|处|部|院|中心))?关于(?:召开|举办|举行|开展|组织)?/, '').trim();

  // 5. Strip first-person, invite-verb, and conversational intent prefixes
  t = t.replace(/^(?:我(?:们)?|咱(?:们)?)(?:[这里边儿]+)?(?:[有想打算计划准备要需]|希望|拟|预备|准备)+[\s,，]*/i, '');
  t = t.replace(/^(?:想?约你们?|约你|约您|邀请你|邀请您|提醒你|提醒您|通知你|通知您)(?:一起|线上|线下)?(?:进行|参加|开展)?[\s,，]*/i, '');
  t = t.replace(/^(?:请问|麻烦问下|想问下|想请问|不知道你?|请问下)[\s,，]*/i, '');

  // 6. Strip intermediate intent verbs before core schedule verbs/nouns
  t = t.replace(/(?:\s*(?:计划|准备|打算|拟|预备)\s*)(?=(?:预答辩|答辩|开会|讨论|评审|评审会|研讨|汇报|开题|开题报告|结题|复试|面试|聚餐|碰头|交流|上线|发布))/i, '');

  // 6.5 Strip leading date/time words from title
  t = t.replace(/^(?:大后天|后天|明天|明日|今天|今日|昨天|昨日|今晚|明晚|下下周[一二三四五六日天]?|下周[一二三四五六日天]?|本周[一二三四五六日天]?|这周[一二三四五六日天]?|周[一二三四五六日天]|星期[一二三四五六日天])[\s,，]*/i, '');
  t = t.replace(/^(?:早上|清晨|早晨|上午|中午|下午|傍晚|晚上|夜里|半夜|凌晨)[\s,，]*/i, '');

  // 7. Strip leading action verbs like "开", "参加", "举行", "举办" if followed by event noun
  t = t.replace(/^(?:开|举行|举办|参加|召开|进行|开展)\s*(?=[A-Za-z0-9\u4e00-\u9fa5]{2,}(?:周会|组会|例会|会议|协调会|研讨会|评审会|沟通会|答辩|预答辩|评审|研讨|讨论|汇报|宣讲|典礼|仪式|发布会|检查|督导|面试|一面|二面|终面))/i, '');

  // 8. Strip announcement boilerplate suffixes: ...安排如下, ...日程如下, ...通知如下, 如下, 的通知, 的安排
  t = t.replace(/(?:的?(?:工作|日程|会议)?安排如下[：:]*|安排如下[：:]*|日程如下[：:]*|通知如下[：:]*|如下[：:]*|的通知|的公告|的函|的安排|的温馨提示)$/g, '');

  // 9. Strip polite calls to action and closing conversational question tags
  t = t.replace(/请(?:各位|大家|相关)?.+?(?:参加|出席|预留时间|准时到场).*$/g, '');
  t = t.replace(/(?:谢谢|致谢|收到请回复).*$/g, '');
  t = t.replace(/(?:[，,、\s]*(?:你?有(?:时间|空)(?:吗|吧|不|呀|呢)?|方便(?:吗|吧|不|呀|呢)?|你方便(?:吗|吧|不|呀|呢)?|你?能(?:来|参加)(?:吗|吧|不)?|能来(?:吗|吧|不)?|能参加(?:吗|吧|不)?|可以吗|可以吧|行不行|好不好|好吗|成吗|吗|吧|么)[\?？!！]*)+$/i, '');

  // 9.5 Strip trailing notifier roles (MANDATORY role noun!), time/location remnants, or dangling particles in a loop
  // FIXED: Role noun is now strictly required so normal "的+事件名词" titles (e.g. "张三的毕业答辩", "美的秋招面试", "李教授的学术讲座") are NEVER mutilated!
  const suffixPattern = /(?:的?(?:秘书|负责人|联系人|主持人|组织者|助教|工作人员)[\u4e00-\u9fa5]{0,4}|(?:具体|开始|会议|活动)?(?:时间|地点)|[的了呢吧啊呀及和与在：:，,。；;])+$/i;
  do {
    prev = t;
    t = t.replace(suffixPattern, '').trim();
  } while (t !== prev);

  // 10. Strip residual location remnants: e.g. "，地点，", "地点："
  t = t.replace(/^[，,、\s]*地点[：:\s,，]*/i, '');
  t = t.replace(/[，,、\s]*地点[：:\s,，]*$/i, '');

  // 10.5 Strip deictic movement verb before medical/interview nouns (e.g. 来复诊 -> 复诊)
  t = t.replace(/^(?:来|去|到)(?=(?:复诊|就诊|门诊|体检|面试|一面|二面|终面|复试|笔试|报到|签到))/, '');
  t = t.replace(/([过聊谈碰看审改])一下/g, '$1');

  // 11. Clean ALL punctuation marks from title (pure noun phrase, no punctuation, including 「」『』《》=)
  t = t.replace(/[，,。;；:：!！?？"“”'‘’「」『』《》〈〉、~～\-—·\(\)（）\[\]【】=]/g, '').trim();

  // 11.5 Fallback salvage from fullText when title is too short (<= 2 chars), broken, or missing forwarded subject
  if (fullText && typeof fullText === 'string') {
    if (t.length <= 2) {
      const glued = extractGluedEventTitle(fullText);
      if (glued) {
        t = glued;
      } else {
        const gluedMatch = fullText.match(
          /(?:^|[，。；！？、\s\n\r])([^\s，。；！？、：:\n\r]{2,18}?)(?:时间|地点)\s*[:：]/
        );
        if (gluedMatch) {
          const candidate = gluedMatch[1]
            .replace(/^(?:会议|活动|开始|结束|具体|通知|集合|开会|培训|日程|安排)$/, '')
            .trim();
          if (candidate) {
            t = (t && !candidate.endsWith(t) && (candidate + t).length <= 12) ? `${candidate}${t}` : candidate;
          }
        }
      }
    }

    // Subject enrichment for forwarded messages, organizations, multi-turn chats, and placeholder topics
    t = enrichTitleWithForwardedSubject(t, fullText);
  }

  // Re-clean any punctuation introduced during enrichment, collapse spaces (removing spaces next to CJK), and compress to <= 12 chars
  t = t.replace(/[，,。;；:：!！?？"“”'‘’「」『』《》〈〉、~～\-—·\(\)（）\[\]【】=]/g, ' ');
  t = t.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5A-Za-z0-9])/g, '$1$2');
  t = t.replace(/([A-Za-z0-9])\s+([\u4e00-\u9fa5])/g, '$1$2');
  t = t.replace(/\s+/g, ' ').trim();
  t = compressTitleToLimit(t, 12);

  return t || '日程安排';
}

export const sanitizeTitle = cleanEventTitle;

/**
 * Reconcile AI-generated title with local subject-aware title
 * @param {string} aiTitle
 * @param {string} localTitle
 * @param {string} [rawText]
 * @returns {string}
 */
export function reconcileEventTitle(aiTitle, localTitle, rawText = '') {
  const cleanedAi = aiTitle ? cleanEventTitle(aiTitle, rawText) : '';
  const cleanedLocal = localTitle ? cleanEventTitle(localTitle, rawText) : '';

  if (isWeakEventTitle(cleanedAi) && cleanedLocal && !isWeakEventTitle(cleanedLocal)) {
    return cleanedLocal;
  }
  return cleanedAi || cleanedLocal || '日程安排';
}

/**
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

  // 3. Check relative dates: 今天, 明天, 后天, 大后天, 昨天, 今日, 明日, 昨日, 今晚, 明晚
  const relDateMatch = trimmed.match(/(大后天|后天|明天|明日|明晚|今天|今日|今晚|昨天|昨日)/);
  if (relDateMatch) {
    const matchedDate = new Date(now);
    const word = relDateMatch[1];
    if (word === '大后天') matchedDate.setDate(matchedDate.getDate() + 3);
    else if (word === '后天') matchedDate.setDate(matchedDate.getDate() + 2);
    else if (word === '明天' || word === '明日' || word === '明晚') matchedDate.setDate(matchedDate.getDate() + 1);
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

  // Strip GMT/UTC offset annotations like "(GMT+08:00)" so "+08:00" is never mistaken for start time 08:00!
  const timeSource = trimmed.replace(/\(\s*(?:GMT|UTC)[+\-]\d{1,2}:?\d{0,2}\s*\)/gi, '');

  // Check for duration: 持续2小时, 开会半小时, 45分钟, 1.5小时
  const durMatch = timeSource.match(/(?:持续|时长|大概|预计)?(\d+(?:\.\d+)?|[一二两三四五半]+)\s*(?:个)?(小时|分钟|hr|hrs|min|mins)/i);
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

  // Check period modifier: 早上/上午/中午/下午/晚上/今晚/明晚/夜里/半夜/凌晨/pm/am
  let isPM = false;
  let isAM = false;
  if (/下午|傍晚|晚上|今晚|明晚|夜里|半夜|\bpm\b/i.test(timeSource)) {
    isPM = true;
  } else if (/中午/.test(timeSource)) {
    isPM = true;
  } else if (/早上|清晨|早晨|上午|凌晨|\bam\b/i.test(timeSource)) {
    isAM = true;
  }

  // Check time ranges like "14:00-16:30" or "8:30分-10:00" or "下午2点到4点半" or "9:00 ~ 11:30"
  const rangeMatch = timeSource.match(/(\d{1,2})[:：](\d{2})(?:分)?\s*(?:-|~|至|到)\s*(\d{1,2})[:：](\d{2})(?:分)?/) ||
    timeSource.match(/(?:(?:上午|下午|晚上|中午|凌晨)?\s*(\d{1,2}|[一二两三四五六七八九十]+)\s*点(?:(\d{1,2}|半|一刻|三刻)分?)?)\s*(?:-|~|至|到)\s*(?:(?:上午|下午|晚上|中午|凌晨)?\s*(\d{1,2}|[一二两三四五六七八九十]+)\s*点(?:(\d{1,2}|半|一刻|三刻)分?)?)/);

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
    const timeMatch = timeSource.match(/(?:^|[^\d])(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?(?:分)?(?:\s*(am|pm))?/i);
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
    const pointMatch = timeSource.match(/(\d{1,2}|[一二两三四五六七八九十]+)\s*点(?:(\d{1,2}|半|一刻|三刻)分?)?/);
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
    const enMatch = timeSource.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
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
    if (/全天|整天|\ball[\s\-]day\b|放假|休假|纪念日|生日/.test(timeSource) || !timeSource.match(/\d|点|分/)) {
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
  const prep = preprocessForwardedText(text);
  const trimmed = prep.cleanText || text.trim();

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

  const cleanSubject = cleanEventTitle(subject || '日程安排', text);

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

    for (const kw of keywords) {
      if (itemTitle === kw) {
        score += 70;
      } else if (itemTitle.includes(kw) || kw.includes(itemTitle)) {
        score += 55;
      } else if (itemDesc.includes(kw)) {
        score += 25;
      }
    }

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
 * @param {string} text - User input schedule text (including forwarded texts / chat logs)
 * @param {Date} [referenceDate] - Base date for relative calculations
 * @returns {Object|null} Parsed event object
 */
export function parseScheduleText(text, referenceDate = new Date()) {
  if (!text || typeof text !== 'string') return null;
  const rawTrimmed = text.trim();
  if (!rawTrimmed) return null;

  const now = new Date(referenceDate);
  const prep = preprocessForwardedText(rawTrimmed);
  const trimmed = prep.cleanText || rawTrimmed;
  const scheduleTimeSource = prep.latestScheduleTurnText || trimmed;

  // Extract explicit URL (meeting link or website)
  let url = '';
  const urlMatch = trimmed.match(/(https?:\/\/[^\s]+)/i);
  if (urlMatch) {
    url = urlMatch[1];
  }

  // Extract Tencent Meeting / Zoom meeting numbers
  const tencentMatch = trimmed.match(/#?腾讯会议[：:\s]*(\d{3}[-\s]?\d{3}[-\s]?\d{3,4})/i);
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

  // 0. Deictic speaker office ("来我办公室" -> "王建国教授办公室")
  if (/(?:来|到|去|在)我(?:的)?办公室/.test(trimmed)) {
    location = prep.primarySpeaker ? `${prep.primarySpeaker}办公室` : '办公室';
  }

  // 1a. Explicit location label WITH colon or preposition ("地点：...", "地点在...", "会议室：302")
  if (!location) {
    const explicitLocMatch = trimmed.match(
      /(?:(?:开会|活动|面试|答辩|预答辩|培训|会商|集合|会议|复诊|就诊)?(?:地点|位置|地址|场所)|会议室)\s*(?:[：:]|(?:设)?在|定在|设于|位于|为)\s*([^\n,，。.;；！!？?」』]+)/i
    ) || trimmed.match(
      /(?:^|[，,。；;\s\n])(?:开会|活动|面试|答辩|预答辩|培训|会议)?地点(?!(?:不变|同上|待定))([^\s\n,，。.;；：:！!？?」』]+)/i
    );
    if (explicitLocMatch) {
      let cand = explicitLocMatch[1].trim();
      cand = cand.replace(/[，,、\s]*(?:你有时间|你有空|方便|你能来|可以吗|行不行|预答辩|答辩|开会|交流核心|主要内容|会议内容).*$/i, '').trim();
      cand = cand.replace(/[，,。.;；:：!！「」『』]+$/, '').trim();
      if (cand && !/^(今天|明天|后天|昨天|周|星期|上午|下午|晚上|\d+(?:点|:\d{2}))/.test(cand)) {
        location = cand;
      }
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

  // 3. Inline "在/到/来/去 <location> [动词/事件/标点]"
  if (!location) {
    const inlineLocMatch = trimmed.match(
      /(?:在|到|来|去)\s*([a-zA-Z0-9\u4e00-\u9fa5\-_—\(\)（）#]{2,25}?)(?=\s*(?:[，,。！!；;\n]|$|开(?:会|例会|周会|组会|项目|讨论|评审|宣讲|庭|安全|协调)?|举行|集合|碰头|碰一下|见面|聚餐|请大家吃饭|请吃饭|吃饭|举办|进行|线上|等|答辩|预答辩|上课|研讨|评审|讨论|谈一下|聊一下|汇报|培训|面试|复诊|就诊|找我|签字|会商|组织|签到|签合同|有\d+个|有[一二两三四五六七八九十]+个|计划|打算|准备))/i
    );
    if (inlineLocMatch) {
      let candidate = inlineLocMatch[1].trim();
      candidate = candidate.replace(/^(?:上午|下午|晚上|中午|\d{1,2}点(?:半|\d{1,2}分?)?)\s*/, '');
      if (candidate && !/^(今天|明天|后天|昨天|周|星期|上午|下午|晚上|我|咱们|我们|\d+)/.test(candidate)) {
        location = candidate;
      }
    }
  }

  // 4. Generic building + room/floor pattern: e.g. 管理楼A515, A座502会议室, 门诊楼3楼, 科技楼302
  if (!location) {
    const buildingRoomMatch = trimmed.match(
      /(?:[在到来去]\s*)?([A-Za-z]\s*座\s*\d{2,4}\s*(?:会议室|室)?|[\u4e00-\u9fa5A-Za-z]{2,12}(?:楼|馆|中心|大厦|校区|学院|院系)\s*(?:[A-Za-z]?\d{2,4}(?:会议室|室)?|\d{1,2}[楼层](?:[A-Za-z]?\d{2,4}室?)?))/i
    );
    if (buildingRoomMatch) {
      let candidate = buildingRoomMatch[1].trim();
      candidate = candidate.replace(/^(?:在|到|来|去|地点在|地点为)\s*/, '');
      if (!/^(今天|明天|后天|昨天|周|星期|上午|下午|晚上|\d+点)/.test(candidate)) {
        location = candidate;
      }
    }
  }

  // 5. Physical venue keywords: e.g. 主楼报告厅, 315会议室, 二号楼会议室 (excluding verb/pronoun prefixes like "点来我")
  if (!location) {
    const venueMatch = trimmed.match(
      /(?:[在到来去]\s*)?([A-Za-z0-9#\-_]{1,10}?(?:会议室|报告厅|研讨室|研讨厅|教室|实验室|\d+层|\d+楼|\d{3,4}室|[A-Z]\d{2,4})|(?![点来去到在回找跟和与我你他她它咱上下午晚早今明后昨])[\u4e00-\u9fa5]{2,8}(?:会议室|报告厅|研讨室|研讨厅|教室|实验室|大厦|大楼|学院楼|教学楼|综合楼|科技楼|行政楼|管理楼|主楼|南楼|北楼|东楼|西楼|操场|体育馆|食堂)(?:\s*\d{3,4}室?)?)/
    );
    if (venueMatch) {
      let candidate = venueMatch[1].trim();
      candidate = candidate.replace(/^(?:在|到|来|去|地点在|地点为)\s*/, '');
      if (!/^(今天|明天|后天|昨天|周|星期|上午|下午|晚上)/.test(candidate)) {
        location = candidate;
      }
    }
  }

  // 6. Online meeting location fallback: Tencent Meeting or Zoom
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
  const modIntent = detectModificationIntent(rawTrimmed, now);
  if (modIntent) {
    return {
      id: `event-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      title: modIntent.title || '日程安排',
      startTime: modIntent.startDate.toISOString(),
      endTime: modIntent.endDate.toISOString(),
      allDay: modIntent.allDay,
      location: location || '',
      description: rawTrimmed,
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
  const explicitTitleMatch = trimmed.match(/(?:会议主题|主题|日程|事项|事件|标题|会议名称)[：:\s]+([^\n,，;；]+)/i);
  if (explicitTitleMatch) {
    const rawExplicit = explicitTitleMatch[1].trim();
    // Do not lock onto placeholder topics like "张华预定的会议" if better context exists
    if (!isPlaceholderMeetingTopic(rawExplicit)) {
      explicitTitle = rawExplicit;
    }
  }
  if (!explicitTitle) {
    const gluedTitle = extractGluedEventTitle(trimmed);
    if (gluedTitle) {
      explicitTitle = gluedTitle;
    }
  }

  // Date: check latestScheduleTurnText first, fallback to full cleaned text if date was mentioned in an earlier turn
  const dateRes = parseDateFromText(scheduleTimeSource, now) || parseDateFromText(trimmed, now);
  const matchedDate = dateRes && dateRes.date ? dateRes.date : new Date(now);
  const timeRes = parseTimeFromText(scheduleTimeSource, matchedDate);

  // Title Extraction
  let title = explicitTitle ? cleanEventTitle(explicitTitle, rawTrimmed) : '';
  if (!title || isWeakEventTitle(title)) {
    let cleaned = trimmed;
    // Strip leading bracketed tag + pure greeting clause (e.g. "【协和医院】您好，")
    cleaned = cleaned.replace(/^\s*【[^】]{1,14}】\s*(?:(?:同学|老师|先生|女士|各位[^，,]{0,6})?(?:您好|你好|下午好|上午好|早上好|晚上好))[，,！!\s]*/i, '');
    // Strip direct recipient vocatives before comma-splitting (e.g. "张老师，我们打算...")
    cleaned = cleaned.replace(/^(?:[A-Za-z\u4e00-\u9fa5]{2,5}|@\S+)[，,\s]+(?=(?:我|咱|请|有|下周|明天|后天|今天|关于|原定|现|麻烦|想|由于|因|各位|在|开))/i, '');
    // Strip standalone "附言："/"备注：" label prefix so its content is evaluated cleanly
    cleaned = cleaned.replace(/(?:^|\n)\s*(?:附言|备注|说明|补充)\s*[:：]\s*/g, '\n');
    cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, '');
    cleaned = cleaned.replace(/#?腾讯会议[：:\s]*\d{3}[-\s]?\d{3}[-\s]?\d{3,4}/gi, '');
    cleaned = cleaned.replace(/Zoom[：:\s]*\d{3}[-\s]?\d{3}[-\s]?\d{3,4}/gi, '');
    cleaned = cleaned.replace(/^.*邀请您参加(?:腾讯会议|飞书会议|钉钉会议|视频会议|Zoom).*$/gim, '');
    cleaned = cleaned.replace(/^点击链接入会.*$/gim, '');
    cleaned = cleaned.replace(/\(\s*(?:GMT|UTC)[+\-]\d{1,2}:?\d{0,2}\s*\)[^\n]*/gi, '');
    cleaned = cleaned.replace(/(?:(?:开会|活动|面试|答辩|预答辩|培训|会商|集合|会议)?(?:地点|位置|地址|场所)|会议室)\s*(?:[：:]|在|为|设于)\s*[^\n,，。.;；]+/gi, '');
    cleaned = cleaned.replace(/(?:^|[，,。；;\s])地点(?!(?:不变|同上))[^\n,，。.;；]+/gi, '');
    cleaned = cleaned.replace(/(?:开会|会议|活动|日程)?时间\s*(?:定在|在|为|设在|设于)?[：:\s]*/gi, '');
    cleaned = cleaned.replace(/(?:来|到|去|在)我(?:的)?办公室/g, '');

    if (location) {
      const escapedLoc = location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      cleaned = cleaned.replace(new RegExp(`\\bat\\s+${escapedLoc}\\b`, 'i'), '');
      cleaned = cleaned.replace(new RegExp(`(?:(?:开会|活动|面试|答辩|预答辩|培训|会商|集合)?地点|位置|地址|会议室|场所)?(?:[在到来去为设于]+[\\s：:]*)?${escapedLoc}`, 'gi'), '');
    }

    cleaned = cleaned.replace(/(大后天|后天|明天|明日|明晚|今天|今日|今晚|昨天|昨日)/g, '');
    cleaned = cleaned.replace(/\b(day after tomorrow|tomorrow|today|yesterday)\b/gi, '');
    cleaned = cleaned.replace(/(?:(?:下下周|下下个星期|下下星期|下周末|下周|下个星期|下星期|下礼拜|这周末|本周末|本周|这周|这个星期|这礼拜)\s*[一二三四五六日天末12345670]?|(?:周|星期|礼拜)[一二三四五六日天末12345670])/gi, '');
    cleaned = cleaned.replace(/(\d+|[一二两三四五六七八九十]+)天[之以]?后/g, '');
    cleaned = cleaned.replace(/\d{4}[\.\/\-年]\d{1,2}[\.\/\-月]\d{1,2}[日号]?/g, '');
    cleaned = cleaned.replace(/\d{1,2}月\d{1,2}[日号]?/g, '');
    cleaned = cleaned.replace(/(\d{1,2})[:：](\d{2})(?:分)?\s*(?:-|~|至|到)\s*(\d{1,2})[:：](\d{2})(?:分)?/g, '');
    cleaned = cleaned.replace(/(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?(?:分)?\s*(?:am|pm)?/gi, '');
    cleaned = cleaned.replace(/(?:上午|下午|晚上|中午|凌晨)?\s*(?:\d{1,2}|[一二两三四五六七八九十]+)\s*点(?:(?:\d{1,2}|半|一刻|三刻)分?)?(?:后)?/g, '');
    cleaned = cleaned.replace(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, '');
    cleaned = cleaned.replace(/(?:早上|清晨|早晨|上午|中午|下午|傍晚|晚上|夜里|半夜|凌晨)/g, '');
    cleaned = cleaned.replace(/(?:持续|时长|大概|预计)?(?:\d+(?:\.\d+)?|[一二两三四五半]+)\s*(?:个)?(?:小时|分钟|hr|hrs|min|mins)/gi, '');
    cleaned = cleaned.replace(/(?:全天|整天|\ball[\s\-]day\b)/gi, '');
    cleaned = cleaned.replace(/(?:提醒我|备忘|请参加|请大家|请相关老师|准时到场|准时到|准时|把PPT准备好|顺序见截图)/g, '');
    cleaned = cleaned.replace(/(?:交流核心|主要内容|会议内容|研讨内容|会议议程|主要议程|议程包括|交流要点)[：:\s\S]*$/gi, '');
    cleaned = cleaned.replace(/^[\s,，.。;；:：!！\-—~～]+/g, '').replace(/[\s,，.。;；:：!！\-—~～]+$/g, '');

    const rawClauses = cleaned.split(/[\r\n，,。；;！!？?]+/).map(s => s.trim()).filter(Boolean);
    const filteredClauses = rawClauses
      .filter(s => {
        if (/^(?:我是|本人是|这里是|俺是)/.test(s)) return false;
        if (/(?:的)?(?:秘书|负责人|联系人|主持人|组织者|助教|工作人员)$/.test(s)) return false;
        if (/^(?:会议主题|主题)\s*[:：]/.test(s) && isPlaceholderMeetingTopic(s.replace(/^(?:会议主题|主题)\s*[:：]\s*/, ''))) return false;
        if (/^(?:好|好的|那|那就|那就定在|定在|都可以|后都可以|有空吗|有时间吗|方便吗|同学你好|老师你好|您好|你好)$/.test(s)) return false;
        if (/^【[^】]+】(?:您好|你好)?$/.test(s)) return false;
        return true;
      })
      .map(s => cleanEventTitle(s, ''))
      .filter(s => s && s !== '日程安排');

    const strongCandidates = filteredClauses.filter(s => !isWeakEventTitle(s));
    title = strongCandidates.length > 0 ? strongCandidates[0] : (filteredClauses[0] || '');
  }

  title = cleanEventTitle(title || '日程安排', rawTrimmed);

  return {
    id: `event-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    title: title || '日程安排',
    startTime: timeRes.startDate.toISOString(),
    endTime: timeRes.endDate.toISOString(),
    allDay: timeRes.allDay,
    location: location || '',
    description: rawTrimmed,
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
 * Generate calendar parsing system prompt with current reference date and forwarded-subject rules
 */
export function getCalendarAISystemPrompt(referenceDate = new Date(), timezoneOverride = '') {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = referenceDate.getFullYear();
  const mm = pad(referenceDate.getMonth() + 1);
  const dd = pad(referenceDate.getDate());
  const hh = pad(referenceDate.getHours());
  const min = pad(referenceDate.getMinutes());
  const weekdays = ['周日(Sunday)', '周一(Monday)', '周二(Tuesday)', '周三(Wednesday)', '周四(Thursday)', '周五(Friday)', '周六(Saturday)'];
  const currentWeekday = weekdays[referenceDate.getDay()];
  const timezone = timezoneOverride || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';

  return `You are an expert calendar assistant specialized in parsing schedule text (including forwarded WeChat/IM messages, multi-turn chat records, and official notices) into structured JSON.
Current Reference Time: ${yyyy}-${mm}-${dd} ${hh}:${min} (${currentWeekday}), Timezone: ${timezone}.

Extract the schedule event from the user's text and respond ONLY with a valid JSON object matching this schema:
{
  "title": "string (strictly concise core event noun phrase with clear event subject, <= 12 characters, no punctuation, e.g. 赵帅奇博士预答辩, 字节跳动后端一面, 与王教授讨论开题, 协和医院口腔科复诊)",
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
1. Title & Event Subject Rules (标题与转发文本事件主体规则):
   - 长度严格限制在 12 个字以内（<= 12 characters），绝对不带任何标点符号或表情符号。
   - 核心原则：【明确事件主体 + 核心动作/事项】，严禁输出丢失主体的空洞泛化词（如严禁仅输出 "开会"、"会议"、"线上会议"、"腾讯会议"、"面试"、"一面"、"复诊"、"讨论"、"汇报"、"聚餐"、"签字"、"聊天记录"、"转发消息"、"XX预定的会议"）。
   - 【转发消息发言人与人称指代还原（关键！）】：
     * 当输入来自转发消息或带有 [发言人: XXX] / XXX： / [转发上下文提示] 时，正文中第一人称“我/我办公室/找我/咱们”指代该发言人（而非日历主人）！
     * 若正文是人际邀约、面谈、汇报、讨论、聚餐、签字（如 [发言人: 王建国教授] 明天下午3点来我办公室讨论一下开题报告），必须将发言人作为主体融入标题（如 "与王教授讨论开题" 或 "王建国教授开题讨论"，location 提取为 "王建国教授办公室"）。
     * 若正文自身已包含完整明确的专有会议/活动名称（如 "课题组组会"、"安全检查协调会"、"赵帅奇博士预答辩"），直接采用该专有事项名，无需冗余拼接发信人。
   - 【自我介绍的二分法处理（保留机构主体 vs 剔除教务代发人）】：
     * 承载事件主体的企业/机构/医院/银行自我介绍（如 "我是字节跳动HR李敏，约你明天下午3点后端研发一面"、"这里是协和医院口腔科，提醒您明天上午复诊"、"我是华为云张工，周四对齐接口"）：**必须提取并保留企业/机构名作为标题主体**，生成 "字节跳动后端一面"、"协和医院口腔科复诊"、"华为云对齐接口"！
     * 纯会议/答辩通知代发人自我介绍（如 "我是本次答辩的秘书安帅斌，博士开题及中期时间：..."）：剔除秘书/助教个人身份，提取真正事项 "博士开题及中期答辩"，严禁输出 "我是本次答辩的"。
   - 【多轮聊天记录、引用转发与默认会议主题】：
     * 多轮对话（如首轮陈经理提出 "过一下Q4预算方案"，末轮敲定 "明天下午3点半，A座502会议室"）：跨轮次综合提取【核心议题+关键对象】（如 "与陈经理过Q4预算"），时间地点以最终敲定轮次为准，忽略 "好的收到"、"帮我记一下" 等附言套话。
     * 腾讯会议/飞书邀请若 会议主题 为默认占位词（如 "张华预定的会议"），优先采用附言或上下文真实议题（如 "双十一复盘会议"）；若无其他议题则规范为 "张华的腾讯会议"。
   - 【长通知标题“保尾去冗”压缩】：
     * 彻底剔除开头问候语（“各位老师下午好”、“@所有人”）、公文套话（“【教务处】关于召开...的通知”、“...安排如下”）及冗余年份季度词（“2026年度第三季度”），**务必保留右侧核心事件中心词**（如提取 "人工智能前沿研讨会"、"计算机学院硕士预答辩"，绝不能机械截断前12字变成 "计算机科学与技术学院关于"！）。
   - 对于“X带队到Y做一线调研/座谈/走访”句式，精炼为“X来调研”或“X座谈”（如“图书馆馆长来调研”）。
   - 彻底剔除主观意图与句末疑问（“我有两个博士计划...你有时间吧？” -> “两个博士预答辩”；“张老师，我们打算...开项目周会，方便吗？” -> “项目周会”）。

2. Date Parsing & Cross-Verification Rules (日期解析与双重核对规则):
   - 注意区分【消息发送时间戳】与【日程事件时间】：聊天记录头部的日期时间仅代表发消息时刻，绝不能当作日程时间！
   - 具体日期优先（Explicit Date Priority）：日程正文中如果出现具体明确的月日（如“9月24日”、“2026-09-24”、“10月28日”），必须以该明确日期为绝对基准！
   - 双重核对（Cross-Verification）：当同时出现具体日期与星期/相对词时（如“9月24日（下周四）”、“10月28日（后天）”），具体日期是决定性的事件日期，括号内仅为辅助标注，绝不能再加 7 天！
   - 仅当正文完全没有具体月日时，才基于 Current Reference Time 计算相对日期。

3. Location Rules:
   - 提取具体物理地点或会议室（如“管理楼A515”、“管理楼A515会议室”、“科技楼302”、“A座502会议室”）。
   - 转发消息中发言人说“来我办公室”时，结合发言人身份提取为“XXX办公室”（如“王建国教授办公室”）。
   - 地点中严禁包含动词或事件名称；线上会议无实体地点时填写“腾讯会议 123-456-789”或“Zoom 123-456-789”。

4. Modification / Reschedule Rules:
   - 若表达对已有日程的改期/调整（如“改为”、“推迟到”、“原定...改...”），设 "isModification": true，填充 "targetCriteria" 与 "keepExistingLocation"；常规新日程设 "isModification": false, "targetCriteria": null。

5. Time, Duration & Meeting URL Rules:
   - 格式为 YYYY-MM-DDTHH:mm:ss；准确解析范围（如“8:30分-10:00”为 08:30 至 10:00）；未指定结束时间默认 1 小时。
   - 腾讯会议号自动转换为 https://meeting.tencent.com/dm/123456789 填入 url 字段。

6. Few-Shot Examples (少样本示例):
   - Input: "各位负责人，图书馆馆长带队到交通学院做一线调研，时间定在9月21日上午8:30分-10:00；地点管理楼A515。交流核心包括：一、图书馆老师简单介绍现有资源和服务。"
     -> "title": "图书馆馆长来调研", "startTime": "${yyyy}-09-21T08:30:00", "endTime": "${yyyy}-09-21T10:00:00", "location": "管理楼A515"
   - Input: "各位老师下午好，赵帅奇博士预答辩安排如下：\n时间：9月24日（下周四）下午2:30\n地点：管理楼A515会议室\n请各位老师预留时间参加，谢谢[握手]"
     -> "title": "赵帅奇博士预答辩", "startTime": "${yyyy}-09-24T14:30:00", "endTime": "${yyyy}-09-24T15:30:00", "location": "管理楼A515会议室"
   - Input: "各位老师下午好，我是本次答辩的秘书安帅斌，博士开题及中期时间：10月28日（后天）下午1：30，地点：管理楼A507，共9名同学参加"
     -> "title": "博士开题及中期答辩", "startTime": "${yyyy}-10-28T13:30:00", "endTime": "${yyyy}-10-28T14:30:00", "location": "管理楼A507"
   - Input: "[发言人: 王建国教授] 明天下午3点来我办公室讨论一下开题报告\n[转发上下文提示: 消息发送方/对话人=王建国教授]"
     -> "title": "与王教授讨论开题", "location": "王建国教授办公室"
   - Input: "同学你好，我是字节跳动HR李敏，约你明天下午3点进行后端研发一面，腾讯会议：456-789-123\n[转发上下文提示: 关联机构/企业主体=字节跳动]"
     -> "title": "字节跳动后端研发一面", "location": "腾讯会议 456-789-123", "url": "https://meeting.tencent.com/dm/456789123"
   - Input: "[发言人: 陈经理] 明天下午有空吗？想约你们过一下Q4预算方案\n[发言人: 我] 下午3点后都可以\n[发言人: 陈经理] 好，那就定在明天下午3点半，A座502会议室\n[转发上下文提示: 消息发送方/对话人=陈经理]"
     -> "title": "与陈经理过Q4预算", "location": "A座502会议室"
   - Input: "【教务处】关于召开2026年度第三季度人工智能前沿技术研讨会的通知，时间：11月20日下午2:00，地点：主楼报告厅"
     -> "title": "人工智能前沿技术研讨会", "startTime": "${yyyy}-11-20T14:00:00", "endTime": "${yyyy}-11-20T15:00:00", "location": "主楼报告厅"
   - Input: "各位老师好，由于有老师下周四下午有课，因此预答辩时间改为上午9：30，地点不变，辛苦各位老师"
     -> "title": "预答辩", "isModification": true, "keepExistingLocation": true, "targetCriteria": { "titleKeywords": ["预答辩"], "originalTimeOfDay": "afternoon" }

7. Output MUST be strictly valid JSON without any markdown code fence blocks or extra explanation.`;
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
 * Extract explicit calendar date from cleaned schedule body (excluding chat message send timestamps!)
 * @param {string} scheduleBody
 * @param {Date} referenceDate
 * @returns {{ year: number, monthIndex: number, day: number } | null}
 */
export function extractExplicitScheduleDate(scheduleBody, referenceDate = new Date()) {
  if (!scheduleBody || typeof scheduleBody !== 'string') return null;
  let expYear = null, expMonth = null, expDay = null;
  const m1 = scheduleBody.match(/(?:(\d{4})[\.\/\-年])?(\d{1,2})月(\d{1,2})[日号]?/);
  if (m1) {
    expYear = m1[1] ? parseInt(m1[1], 10) : referenceDate.getFullYear();
    expMonth = parseInt(m1[2], 10) - 1;
    expDay = parseInt(m1[3], 10);
  } else {
    const m2 = scheduleBody.match(/(?:^|[^\d])(\d{4})[\.\/\-](\d{1,2})[\.\/\-](\d{1,2})(?!\d)/);
    if (m2) {
      expYear = parseInt(m2[1], 10);
      expMonth = parseInt(m2[2], 10) - 1;
      expDay = parseInt(m2[3], 10);
    } else {
      const m3 = scheduleBody.match(/(?:^|[^\d:])(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])(?!\d|:)/);
      if (m3) {
        expYear = referenceDate.getFullYear();
        expMonth = parseInt(m3[1], 10) - 1;
        expDay = parseInt(m3[2], 10);
      }
    }
  }

  if (expMonth !== null && expDay !== null && expMonth >= 0 && expMonth <= 11 && expDay >= 1 && expDay <= 31) {
    return { year: expYear || referenceDate.getFullYear(), monthIndex: expMonth, day: expDay };
  }
  return null;
}

/**
 * Build standard calendar event object from parsed AI JSON, with forwarded-subject reconciliation
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

  const rawText = typeof text === 'string' ? text : '';
  const prep = preprocessForwardedText(rawText);
  const dateCheckSource = prep.latestScheduleTurnText || prep.cleanText || rawText;

  // Double-check date with explicit date in CLEANED schedule body (never chat header send timestamps!)
  if (dateCheckSource && !d.isModification) {
    const expDate = extractExplicitScheduleDate(dateCheckSource, referenceDate);
    if (expDate) {
      if (startDate.getMonth() !== expDate.monthIndex || startDate.getDate() !== expDate.day) {
        const duration = endDate.getTime() - startDate.getTime();
        startDate.setFullYear(expDate.year, expDate.monthIndex, expDate.day);
        endDate = new Date(startDate.getTime() + (duration > 0 ? duration : 3600000));
      }
    }
  }

  // Deterministic hybrid reconciliation using local subject-aware parser
  let finalLocation = d.location || '';
  let finalUrl = d.url || '';
  let finalTitle = d.title || '';

  if (rawText) {
    const localParsed = parseScheduleText(rawText, referenceDate);
    if (localParsed) {
      // 0. Reconcile & enrich title if AI returned weak, subject-deficient, or broken title
      finalTitle = reconcileEventTitle(finalTitle, localParsed.title, rawText);

      // 1. Supplement or upgrade deictic location (e.g. "办公室" -> "王建国教授办公室")
      if ((!finalLocation || !finalLocation.trim() || finalLocation === '办公室' || finalLocation === '我办公室') && localParsed.location) {
        finalLocation = localParsed.location;
      }

      // 2. Correct endTime if AI defaulted to 1 hour while local parser found an explicit range
      if (!d.allDay && localParsed.startTime && localParsed.endTime) {
        const localStart = new Date(localParsed.startTime);
        const localEnd = new Date(localParsed.endTime);
        const localDuration = localEnd.getTime() - localStart.getTime();
        const aiDuration = endDate.getTime() - startDate.getTime();

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
    title: cleanEventTitle(finalTitle || '日程安排', rawText),
    startTime: startDate.toISOString(),
    endTime: endDate.toISOString(),
    allDay: !!d.allDay,
    location: finalLocation || '',
    description: d.description || rawText.trim(),
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

  const prep = preprocessForwardedText(trimmedText);
  const aiPromptInput = (prep.aiInputText || trimmedText).replace(/(\d{1,2})\s*[:：]\s*(\d{2})/g, '$1:$2');

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
          { role: 'user', content: aiPromptInput }
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
