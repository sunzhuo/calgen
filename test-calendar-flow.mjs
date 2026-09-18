import { getSafeICSFilename, buildICS, openCalendarEvent } from './ics.js';
import assert from 'assert';

console.log('=== Running Calendar Flow and Filename Tests ===');

// Test 1: getSafeICSFilename
const filenameCases = [
  { input: '明天下午3点在会议室开会', expected: '明天下午3点在会议室开会.ics' },
  { input: '周五/周六: 讨论 "需求" & <方案> | 测试?', expected: '周五_周六_ 讨论 _需求_ & _方案_ _ 测试_.ics' },
  { input: '换行\r\n测试\t文本', expected: '换行_测试_文本.ics' },
  { input: '', expected: '日程.ics' },
  { input: null, expected: '日程.ics' },
  { input: undefined, expected: '日程.ics' },
  { input: '   空格会议   ', expected: '空格会议.ics' },
  { input: 'already.ics', expected: 'already.ics' },
];

for (const tc of filenameCases) {
  const result = getSafeICSFilename(tc.input);
  console.log(`Input: [${tc.input}] -> Output: [${result}]`);
  assert.strictEqual(result, tc.expected, `Mismatch for ${tc.input}`);
}
console.log('✔ All getSafeICSFilename tests passed!');

// Test 2: Mock browser DOM to test openCalendarEvent
let triggeredDownloadFilename = null;
let triggeredBlobContent = null;
let revokedUrl = null;

globalThis.Blob = class MockBlob {
  constructor(parts, options) {
    this.parts = parts;
    this.options = options;
    triggeredBlobContent = parts.join('');
  }
};

globalThis.URL = {
  createObjectURL: (blob) => 'blob:mock-url-123',
  revokeObjectURL: (url) => { revokedUrl = url; }
};

globalThis.document = {
  createElement: (tag) => {
    if (tag === 'a') {
      return {
        href: '',
        setAttribute: (attr, val) => {
          if (attr === 'download') {
            triggeredDownloadFilename = val;
          }
        },
        click: () => {
          console.log(`[Browser Mock] <a> clicked, downloading file: ${triggeredDownloadFilename}`);
        }
      };
    }
    return {};
  },
  body: {
    appendChild: (el) => {},
    removeChild: (el) => {}
  }
};

const mockEvent = {
  id: 'test-event-1',
  title: '周五下午3点需求评审/研讨会',
  startTime: '2026-09-25T15:00:00',
  endTime: '2026-09-25T16:00:00',
  location: '5楼大会议室',
  url: 'https://meeting.tencent.com/dm/123456',
  description: '周五下午3点需求评审/研讨会'
};

async function testWebDownloadFlow() {
  const res = await openCalendarEvent(mockEvent);
  console.log('openCalendarEvent result:', res);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.method, 'web');
  assert.strictEqual(res.filename, '周五下午3点需求评审_研讨会.ics');
  assert.strictEqual(triggeredDownloadFilename, '周五下午3点需求评审_研讨会.ics');
  assert.ok(triggeredBlobContent.includes('BEGIN:VCALENDAR'));
  assert.ok(triggeredBlobContent.includes('SUMMARY:周五下午3点需求评审/研讨会'));
  assert.ok(triggeredBlobContent.includes('LOCATION:5楼大会议室'));
  console.log('✔ openCalendarEvent Web download flow passed!');
}

await testWebDownloadFlow();

console.log('\nAll verification tests completed successfully!');

