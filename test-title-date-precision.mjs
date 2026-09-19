import { parseScheduleText, cleanEventTitle, buildEventFromAiData, getCalendarAISystemPrompt } from './parser.js';
import assert from 'assert';

console.log('=== Running Title and Date Precision Tests ===\n');

// 1. Test User's Exact Case via Local Parser
console.log('--- Test 1: User Exact Case Local Parsing ---');
const userExampleText = `各位老师下午好，赵帅奇博士预答辩安排如下：
时间：9月24日（下周四）下午2:30
地点：管理楼A515会议室
请各位老师预留时间参加，谢谢[握手]`;

// Reference date: Sunday, Sep 20, 2026 (which previously triggered the Oct 1 jump due to 下周四)
const refDate = new Date('2026-09-20T10:00:00+08:00');
const parsed = parseScheduleText(userExampleText, refDate);

console.log('Parsed title:', parsed.title);
console.log('Parsed location:', parsed.location);
console.log('Parsed startTime:', parsed.startTime);

// Assertions on Title
assert.strictEqual(parsed.title, '赵帅奇博士预答辩', 'Title must be strictly 赵帅奇博士预答辩 without greeting or boilerplate');
assert.ok(parsed.title.length <= 12, `Title length (${parsed.title.length}) must be <= 12`);
assert.ok(!/[，,。;；:：!！?？"“”'‘’、~～\-—·\(\)（）\[\]【】]/.test(parsed.title), 'Title must not contain punctuation');

// Assertions on Date & Time
const startDate = new Date(parsed.startTime);
// In Shanghai time (UTC+8): 14:30 on 2026-09-24
assert.strictEqual(startDate.getUTCFullYear(), 2026);
assert.strictEqual(startDate.getUTCMonth(), 8, 'Month should be September (0-indexed 8)');
assert.strictEqual(startDate.getUTCDate(), 24, 'Date MUST be September 24th, NOT October 1st');
assert.strictEqual(parsed.location, '管理楼A515会议室', 'Location should be 管理楼A515会议室');
console.log('✔ Test 1 passed: Exact user case parsed accurately without jump to 10月1日!\n');

// 2. Test cleanEventTitle specifically
console.log('--- Test 2: cleanEventTitle Punctuation, Greetings, and Length Limit ---');
const titleCases = [
  {
    raw: '各位老师下午好，赵帅奇博士预答辩安排如下：',
    expected: '赵帅奇博士预答辩'
  },
  {
    raw: '各位老师下午好，赵帅奇博士预答辩',
    expected: '赵帅奇博士预答辩'
  },
  {
    raw: '大家下午好，今天开团队周会：',
    expected: '团队周会'
  },
  {
    raw: '各位领导好，预答辩讨论：',
    expected: '预答辩讨论'
  },
  {
    raw: '关于召开2026年度第三季度人工智能前沿技术研讨会的通知',
    // Must be <= 12 characters and no punctuation
    check: (t) => t.length <= 12 && !/[，,。;；:：!！?？]/.test(t)
  }
];

for (const tc of titleCases) {
  const cleaned = cleanEventTitle(tc.raw);
  console.log(`Input: "${tc.raw}" -> Output: "${cleaned}"`);
  assert.ok(cleaned.length <= 12, `Length of "${cleaned}" must be <= 12`);
  assert.ok(!/[，,。;；:：!！?？"“”'‘’、~～·]/.test(cleaned), `Must have no punctuation: "${cleaned}"`);
  if (tc.expected) {
    assert.strictEqual(cleaned, tc.expected);
  }
  if (tc.check) {
    assert.ok(tc.check(cleaned));
  }
}
console.log('✔ Test 2 passed: cleanEventTitle enforces <= 12 chars, pure noun, no punctuation!\n');

// 3. Test buildEventFromAiData Safety Net
console.log('--- Test 3: buildEventFromAiData Safety Net on AI Mismatches ---');
// Simulate an imperfect LLM that hallucinated 10月1日 and kept greetings in title
const rawAiOutput = {
  title: '各位老师下午好，赵帅奇博士预答辩',
  startTime: '2026-10-01T14:30:00',
  endTime: '2026-10-01T15:30:00',
  allDay: false,
  location: '管理楼A515会议室'
};

const builtEvent = buildEventFromAiData(rawAiOutput, userExampleText, refDate);
console.log('Safety net cleaned title:', builtEvent.title);
console.log('Safety net corrected startTime:', builtEvent.startTime);

assert.strictEqual(builtEvent.title, '赵帅奇博士预答辩', 'AI title must be cleaned to 赵帅奇博士预答辩');
const safetyDate = new Date(builtEvent.startTime);
assert.strictEqual(safetyDate.getMonth(), 8, 'Month should be aligned to September');
assert.strictEqual(safetyDate.getDate(), 24, 'Date should be aligned to 24th based on text');
console.log('✔ Test 3 passed: buildEventFromAiData successfully corrected hallucinated date & title!\n');

// 4. Test AI Prompt Contents
console.log('--- Test 4: AI System Prompt Validation ---');
const prompt = getCalendarAISystemPrompt(refDate);
assert.ok(prompt.includes('12 个字以内'), 'Prompt must specify 12 个字以内 limit');
assert.ok(prompt.includes('标点符号'), 'Prompt must forbid punctuation marks');
assert.ok(prompt.includes('双重核对'), 'Prompt must instruct cross-verification');
assert.ok(prompt.includes('9月24日'), 'Prompt must contain 9月24日 few-shot/example');
assert.ok(prompt.includes('赵帅奇博士预答辩'), 'Prompt must contain 赵帅奇博士预答辩 example');
console.log('✔ Test 4 passed: System prompt verified!\n');

console.log('🎉 ALL TITLE & DATE PRECISION TESTS PASSED SUCCESSFULLY! 🎉');

