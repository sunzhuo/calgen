import { parseScheduleText, findMatchingSchedule, detectModificationIntent } from './parser.js';
import assert from 'assert';

console.log('=== Running Schedule Reschedule / Modification Intent Tests ===');

const refDate = new Date('2026-09-18T10:00:00.000Z'); // Friday (2026-09-18)
// Next Thursday is 2026-09-24

// --- Test 1: User Request Example ---
const userText = '各位老师好，由于有老师下周四下午有课，因此预答辩时间改为上午9：30，地点不变，辛苦各位老师';
const parsed1 = parseScheduleText(userText, refDate);

console.log('Parsed result 1:');
console.log('  Title:', parsed1.title);
console.log('  Start:', parsed1.startTime);
console.log('  End:', parsed1.endTime);
console.log('  isModification:', parsed1.isModification);
console.log('  keepExistingLocation:', parsed1.keepExistingLocation);
console.log('  targetCriteria:', parsed1.targetCriteria);

assert.strictEqual(parsed1.isModification, true, 'Should detect modification intent');
assert.strictEqual(parsed1.keepExistingLocation, true, 'Should detect keepExistingLocation');
assert.strictEqual(parsed1.title, '预答辩', 'Clean core title should be 预答辩');
assert.ok(parsed1.targetCriteria.titleKeywords.includes('预答辩'), 'Target titleKeywords should include 预答辩');
assert.strictEqual(parsed1.targetCriteria.originalTimeOfDay, 'afternoon', 'Original time should be afternoon');

// Verify new time is 9:30 AM
const startDate1 = new Date(parsed1.startTime);
assert.strictEqual(startDate1.getHours(), 9, 'New hour must be 9 AM');
assert.strictEqual(startDate1.getMinutes(), 30, 'New minute must be 30');

// Verify date is next Thursday (2026-09-24)
assert.strictEqual(startDate1.getDate(), 24, 'Date should be next Thursday (24th)');
console.log('✔ Test 1 passed: User example parsed accurately!');

// --- Test 2: Matching Existing Schedule in List ---
const existingSchedules = [
  {
    id: 'event-other',
    title: '团队例会',
    startTime: '2026-09-24T01:00:00.000Z',
    endTime: '2026-09-24T02:00:00.000Z',
    location: '201会议室'
  },
  {
    id: 'event-target',
    title: '赵帅奇博士预答辩',
    startTime: '2026-09-24T06:30:00.000Z', // Thursday afternoon 14:30 Beijing time
    endTime: '2026-09-24T08:30:00.000Z',
    location: '学院南楼302',
    url: 'https://meeting.tencent.com/dm/123456789'
  }
];

const matched = findMatchingSchedule(parsed1.targetCriteria, existingSchedules, refDate);
assert.ok(matched, 'Should find a matching schedule in the list');
assert.strictEqual(matched.id, 'event-target', 'Should match the exact target schedule');
assert.strictEqual(matched.title, '赵帅奇博士预答辩');
console.log('✔ Test 2 passed: Successfully matched existing schedule:', matched.title);

// --- Test 3: Simulating In-Place Update & Location Preservation ---
const updatedEvent = {
  ...matched,
  startTime: parsed1.startTime,
  endTime: parsed1.endTime,
  location: parsed1.keepExistingLocation ? matched.location : (parsed1.location || matched.location),
  isModified: true
};

assert.strictEqual(updatedEvent.id, 'event-target', 'Preserved original ID');
assert.strictEqual(updatedEvent.location, '学院南楼302', 'Preserved original location because 地点不变');
assert.strictEqual(new Date(updatedEvent.startTime).getHours(), 9, 'Updated to 9:30 AM');
assert.strictEqual(updatedEvent.isModified, true, 'Flagged as modified');
console.log('✔ Test 3 passed: In-place update and location preservation verified!');

// --- Test 4: Additional Reschedule Formats ---
const textCase2 = '原定周五下午的团队周会推迟到下周一上午10点';
const parsed2 = parseScheduleText(textCase2, refDate);
assert.strictEqual(parsed2.isModification, true);
assert.strictEqual(parsed2.title, '团队周会');
assert.strictEqual(parsed2.targetCriteria.originalTimeOfDay, 'afternoon');
const startDate2 = new Date(parsed2.startTime);
assert.strictEqual(startDate2.getHours(), 10);
// Next Monday from refDate (Friday 2026-09-18) is 2026-09-21
assert.strictEqual(startDate2.getDate(), 21);
console.log('✔ Test 4 passed: "原定周五下午的团队周会推迟到下周一上午10点"');

// --- Test 5: Standard Schedule (Negative Test - Should Not be Modification) ---
const normalText = '明天下午3点在会议室开会';
const parsedNormal = parseScheduleText(normalText, refDate);
assert.strictEqual(parsedNormal.isModification, false);
assert.strictEqual(parsedNormal.targetCriteria, null);
console.log('✔ Test 5 passed: Standard schedule is correctly identified as not a modification');

console.log('\nAll reschedule & modification intent tests passed with 100% success! 🎉');

