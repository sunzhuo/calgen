import assert from 'assert';
import {
  preprocessForwardedText,
  cleanEventTitle,
  parseScheduleText,
  buildEventFromAiData,
  parseScheduleWithAI,
  getCalendarAISystemPrompt
} from './parser.js';
import { onRequestPost, sanitizeTitle } from './functions/api/parse.js';

console.log('=== Running Forwarded Text Event Subject & Title Precision Tests ===\n');

const refDate = new Date('2026-11-18T12:00:00+08:00'); // Wednesday, Nov 18, 2026

// 1. Regression test for "的 + <=4字事件词" preservation
console.log('--- Suite 1: Preserve Valid "的 + Event Noun" Titles ---');
const deTitleCases = [
  ['张三的毕业答辩', '张三的毕业答辩'],
  ['美的秋招面试', '美的秋招面试'],
  ['李教授的学术讲座', '李教授的学术讲座'],
  ['王总的项目汇报', '王总的项目汇报'],
];
for (const [input, expected] of deTitleCases) {
  assert.strictEqual(cleanEventTitle(input), expected);
  assert.strictEqual(sanitizeTitle(input), expected);
}
console.log('✔ Suite 1 passed: Valid "的 + Event Noun" titles preserved intact!\n');

// 2. Forwarded WeChat / IM / Notice / Invite / ZIP Scenarios
console.log('--- Suite 2: 14 Real-World Forwarded Text Subject & Schedule Extraction ---');
const forwardedScenarios = [
  {
    name: '微信单条转发：发言人 + 第一人称“来我办公室”指代还原',
    input: '王建国教授：\n明天下午3点来我办公室讨论一下开题报告',
    expectedTitle: '与王建国教授讨论开题报告',
    expectedLocation: '王建国教授办公室',
    expectedMonth: 11,
    expectedDay: 19,
    expectedHour: 15,
    expectedMinute: 0
  },
  {
    name: '微信复制转发：带发言发送时间戳 + “咱们碰一下”',
    input: '张院长 10:25\n周五上午9点半咱们碰一下学科评估材料，在行政楼302',
    expectedTitle: '与张院长碰学科评估材料',
    expectedLocation: '行政楼302',
    expectedMonth: 11,
    expectedDay: 20,
    expectedHour: 9,
    expectedMinute: 30
  },
  {
    name: '显式[转发]前缀 + 找领导谈项目',
    input: '[转发] 李处长：明天上午10点来科研处谈一下重点项目申报',
    expectedTitle: '与李处长谈重点项目申报',
    expectedLocation: '科研处',
    expectedMonth: 11,
    expectedDay: 19,
    expectedHour: 10,
    expectedMinute: 0
  },
  {
    name: '微信合并转发聊天记录：剥离聊天头与发消息日期及收到回复，保留专有会议名',
    input: '-----王教授和李明的聊天记录-----\n王教授 2026/11/18 10:15\n下周二下午两点半在管理楼402开课题组组会，把PPT准备好\n\n李明 2026/11/18 10:16\n好的王老师，收到！',
    expectedTitle: '课题组组会',
    expectedLocation: '管理楼402',
    expectedMonth: 11,
    expectedDay: 24,
    expectedHour: 14,
    expectedMinute: 30
  },
  {
    name: '多轮协商聊天记录：跨轮次聚合首轮议题主体 + 末轮敲定时间地点',
    input: '陈经理 09:12\n明天下午有空吗？想约你们过一下Q4预算方案\n我 09:13\n下午3点后都可以\n陈经理 09:14\n好，那就定在明天下午3点半，A座502会议室',
    expectedTitle: '与陈经理过Q4预算方案',
    expectedLocation: 'A座502会议室',
    expectedMonth: 11,
    expectedDay: 19,
    expectedHour: 15,
    expectedMinute: 30
  },
  {
    name: '微信引用转发 + 纯事务性记日程附言（忽略附言套话）',
    input: '「刘主任：周四下午2点在二号楼会议室开安全检查协调会」\n- - - - - - - - - - - - - - -\n帮我记一下这个日程',
    expectedTitle: '安全检查协调会',
    expectedLocation: '二号楼会议室',
    expectedMonth: 11,
    expectedDay: 19,
    expectedHour: 14,
    expectedMinute: 0
  },
  {
    name: '微信引用转发 + 补充主体的有效附言（采纳附言补全泛化标题）',
    input: '「王总：下周三上午10点汇报进度」\n- - - - - - - - - - - - - - -\n向王总汇报智慧园区项目进度',
    expectedTitle: '向王总汇报智慧园区进度',
    expectedLocation: '',
    expectedMonth: 11,
    expectedDay: 25,
    expectedHour: 10,
    expectedMinute: 0
  },
  {
    name: '招聘HR转发：从自我介绍提取企业主体“字节跳动”合入面试标题',
    input: '同学你好，我是字节跳动HR李敏，约你明天下午3点进行后端研发一面，腾讯会议：456-789-123',
    expectedTitle: '字节跳动后端研发一面',
    expectedLocation: '腾讯会议 456-789-123',
    expectedMonth: 11,
    expectedDay: 19,
    expectedHour: 15,
    expectedMinute: 0
  },
  {
    name: '医院提醒转发：从“这里是...”提取机构科室主体“协和医院口腔科”',
    input: '【协和医院】您好，这里是协和医院口腔科，提醒您11月20日上午9:30来门诊楼3楼复诊。',
    expectedTitle: '协和医院口腔科复诊',
    expectedLocation: '门诊楼3楼',
    expectedMonth: 11,
    expectedDay: 20,
    expectedHour: 9,
    expectedMinute: 30
  },
  {
    name: '高校长公文转发：剥离“【教务处】关于召开2026年度第三季度...的通知”，保尾保留“研讨会”',
    input: '【教务处】关于召开2026年度第三季度人工智能前沿技术研讨会的通知，时间：11月20日下午2:00，地点：主楼报告厅',
    expectedTitle: '人工智能前沿技术研讨会',
    expectedLocation: '主楼报告厅',
    expectedMonth: 11,
    expectedDay: 20,
    expectedHour: 14,
    expectedMinute: 0
  },
  {
    name: '腾讯会议转发（明确议题）：忽略“点击链接入会”与GMT时区干扰',
    input: '王明 邀请您参加腾讯会议\n会议主题：智能网联汽车课题组周会\n会议时间：2026/11/20 14:00-15:30 (GMT+08:00) 中国标准时间 - 北京\n点击链接入会：\nhttps://meeting.tencent.com/dm/AbCdEf123\n#腾讯会议：123-456-789',
    expectedTitle: '智能网联汽车课题组周会',
    expectedLocation: '腾讯会议 123-456-789',
    expectedMonth: 11,
    expectedDay: 20,
    expectedHour: 14,
    expectedMinute: 0
  },
  {
    name: '腾讯会议转发（默认“XX预定的会议”占位主题 + 附言真实议题）',
    input: '张华 邀请您参加腾讯会议\n会议主题：张华预定的会议\n会议时间：2026/11/20 15:00-16:00\n#腾讯会议：987-654-321\n附言：过一下双十一复盘数据',
    expectedTitle: '过双十一复盘数据',
    expectedLocation: '腾讯会议 987-654-321',
    expectedMonth: 11,
    expectedDay: 20,
    expectedHour: 15,
    expectedMinute: 0
  },
  {
    name: '腾讯会议转发（仅默认“XX预定的会议”无附言 -> 规范化为“张华的腾讯会议”）',
    input: '张华 邀请您参加腾讯会议\n会议主题：张华预定的会议\n会议时间：2026/11/20 15:00-16:00\n#腾讯会议：987-654-321',
    expectedTitle: '张华的腾讯会议',
    expectedLocation: '腾讯会议 987-654-321',
    expectedMonth: 11,
    expectedDay: 20,
    expectedHour: 15,
    expectedMinute: 0
  },
  {
    name: 'Android微信ZIP解压文本：剥离“=== 提取文件 ===”与秒级发言时间戳，绑定发言人主体',
    input: '=== 提取文件: message.txt ===\n赵老师 14:20:05\n下周三上午9点我们线上过一下毕业论文初稿，腾讯会议：345-678-901',
    expectedTitle: '与赵老师线上过论文初稿',
    expectedLocation: '腾讯会议 345-678-901',
    expectedMonth: 11,
    expectedDay: 25,
    expectedHour: 9,
    expectedMinute: 0
  }
];

for (const sc of forwardedScenarios) {
  const res = parseScheduleText(sc.input, refDate);
  assert.ok(res, `Failed to parse scenario: ${sc.name}`);
  assert.strictEqual(res.title, sc.expectedTitle, `[${sc.name}] title mismatch: got "${res.title}"`);
  assert.ok(res.title.length <= 12, `[${sc.name}] title exceeds 12 chars: "${res.title}"`);
  assert.ok(!/[，,。;；:：!！?？"“”'‘’「」『』、~～\-—·\(\)（）\[\]【】=]/.test(res.title), `[${sc.name}] punctuation found in "${res.title}"`);
  assert.strictEqual(res.location, sc.expectedLocation, `[${sc.name}] location mismatch`);

  const d = new Date(res.startTime);
  assert.strictEqual(d.getMonth() + 1, sc.expectedMonth, `[${sc.name}] month mismatch`);
  assert.strictEqual(d.getDate(), sc.expectedDay, `[${sc.name}] day mismatch`);
  assert.strictEqual(d.getHours(), sc.expectedHour, `[${sc.name}] hour mismatch`);
  assert.strictEqual(d.getMinutes(), sc.expectedMinute, `[${sc.name}] minute mismatch`);
  console.log(`✔ ${sc.name} -> "${res.title}"`);
}
console.log('');

// 3. Test AI Pipeline (/api/parse Cloudflare Pages Function + buildEventFromAiData) when LLM outputs weak/subjectless titles
console.log('--- Suite 3: End-to-End /api/parse & AI Post-Processing Subject Recovery ---');

let capturedAiMessages = null;
const mockWeakEnvAi = {
  run: async (model, payload) => {
    capturedAiMessages = payload.messages;
    const userContent = payload.messages.find(m => m.role === 'user').content;
    if (userContent.includes('字节跳动')) {
      // Simulate AI dropping the company name and returning only "后端研发一面"
      return {
        response: JSON.stringify({
          title: '后端研发一面',
          startTime: '2026-11-19T15:00:00',
          endTime: '2026-11-19T16:00:00',
          allDay: false,
          location: '腾讯会议 456-789-123',
          url: 'https://meeting.tencent.com/dm/456789123'
        })
      };
    }
    if (userContent.includes('王建国教授')) {
      // Simulate AI returning generic "讨论开题报告" and vague "办公室"
      return {
        response: JSON.stringify({
          title: '讨论开题报告',
          startTime: '2026-11-19T15:00:00',
          endTime: '2026-11-19T16:00:00',
          allDay: false,
          location: '办公室',
          url: ''
        })
      };
    }
    // Simulate AI on merged chat log with send timestamp 2026/11/18 10:15
    return {
      response: JSON.stringify({
        title: '聊天记录',
        startTime: '2026-11-24T14:30:00',
        endTime: '2026-11-24T15:30:00',
        allDay: false,
        location: '管理楼402',
        url: ''
      })
    };
  }
};

// 3a. HR Interview via /api/parse
{
  const hrText = '同学你好，我是字节跳动HR李敏，约你明天下午3点进行后端研发一面，腾讯会议：456-789-123';
  const req = new Request('https://calgen.pages.dev/api/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: hrText, clientTime: refDate.toISOString(), timezone: 'Asia/Shanghai' })
  });
  const resp = await onRequestPost({ request: req, env: { AI: mockWeakEnvAi } });
  const json = await resp.json();

  assert.strictEqual(json.success, true);
  assert.ok(capturedAiMessages[1].content.includes('关联机构/企业主体=字节跳动'), 'AI user input must include extracted org hint');
  assert.strictEqual(json.data.title, '字节跳动后端研发一面', 'Weak AI title "后端研发一面" must be enriched with "字节跳动"');
  console.log('✔ /api/parse enriched HR self-intro AI title ->', json.data.title);
}

// 3b. Speaker + first-person office via /api/parse
{
  const profText = '王建国教授：\n明天下午3点来我办公室讨论一下开题报告';
  const req = new Request('https://calgen.pages.dev/api/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: profText, clientTime: refDate.toISOString(), timezone: 'Asia/Shanghai' })
  });
  const resp = await onRequestPost({ request: req, env: { AI: mockWeakEnvAi } });
  const json = await resp.json();

  assert.strictEqual(json.success, true);
  assert.ok(capturedAiMessages[1].content.includes('[发言人: 王建国教授]'), 'AI user input must annotate speaker');
  assert.strictEqual(json.data.title, '与王建国教授讨论开题报告', 'Weak AI title "讨论开题报告" must bind speaker subject');
  assert.strictEqual(json.data.location, '王建国教授办公室', 'Vague location "办公室" must upgrade to "王建国教授办公室"');
  console.log('✔ /api/parse enriched speaker deixis title & location ->', json.data.title, '|', json.data.location);
}

// 3c. Merged chat log via /api/parse: ensure chat send date 2026/11/18 does NOT overwrite AI event date 2026-11-24!
{
  const chatLogText = '-----王教授和李明的聊天记录-----\n王教授 2026/11/18 10:15\n下周二下午两点半在管理楼402开课题组组会，把PPT准备好\n\n李明 2026/11/18 10:16\n好的王老师，收到！';
  const req = new Request('https://calgen.pages.dev/api/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: chatLogText, clientTime: refDate.toISOString(), timezone: 'Asia/Shanghai' })
  });
  const resp = await onRequestPost({ request: req, env: { AI: mockWeakEnvAi } });
  const json = await resp.json();

  assert.strictEqual(json.success, true);
  assert.ok(!capturedAiMessages[1].content.includes('2026/11/18 10:15'), 'Chat send timestamp must be stripped from AI prompt input');
  assert.strictEqual(json.data.title, '课题组组会', 'Hallucinated "聊天记录" title must be repaired to "课题组组会"');
  assert.ok(json.data.startTime.startsWith('2026-11-24'), `Event date must remain 2026-11-24, got ${json.data.startTime}`);

  // Also check client-side buildEventFromAiData date cross-check doesn't corrupt 2026-11-24 with 2026/11/18
  const clientEvent = buildEventFromAiData(json.data, chatLogText, refDate);
  assert.strictEqual(clientEvent.title, '课题组组会');
  assert.strictEqual(new Date(clientEvent.startTime).getDate(), 24);
  console.log('✔ /api/parse & buildEventFromAiData repaired "聊天记录" and protected event date 2026-11-24 from chat header timestamp!');
}

// 4. Test Custom OpenAI-compatible API flow via parseScheduleWithAI
console.log('\n--- Suite 4: Custom OpenAI-Compatible API Flow (parseScheduleWithAI) ---');
const origFetch = globalThis.fetch;
try {
  let sentBody = null;
  globalThis.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: '张华预定的会议',
                startTime: '2026-11-20T15:00:00',
                endTime: '2026-11-20T16:00:00',
                allDay: false,
                location: '腾讯会议 987-654-321',
                url: ''
              })
            }
          }
        ]
      })
    };
  };

  const inviteWithNote = '张华 邀请您参加腾讯会议\n会议主题：张华预定的会议\n会议时间：2026/11/20 15:00-16:00\n#腾讯会议：987-654-321\n附言：过一下双十一复盘数据';
  const aiEvent = await parseScheduleWithAI(inviteWithNote, {
    apiUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-4o-mini',
    referenceDate: refDate
  });

  assert.ok(sentBody.messages[0].content.includes('转发消息发言人与人称指代还原'));
  assert.ok(sentBody.messages[1].content.includes('会议发起人=张华'));
  assert.strictEqual(aiEvent.title, '过双十一复盘数据', 'Placeholder AI title "张华预定的会议" must be replaced by real note subject');
  assert.strictEqual(aiEvent.url, 'https://meeting.tencent.com/dm/987654321');
  console.log('✔ Custom OpenAI API flow verified ->', aiEvent.title);
} finally {
  globalThis.fetch = origFetch;
}

console.log('\n🎉 ALL FORWARDED TEXT SUBJECT & TITLE PRECISION TESTS PASSED! 🎉');
