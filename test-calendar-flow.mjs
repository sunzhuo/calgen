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

// Test 2: Mock browser DOM to test openCalendarEvent in Web mode
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

// Test 3: Mock Capacitor native environment to test Android Intent parameters & double fallback
let capturedPromptParams = null;
globalThis.Capacitor = {
  isNativePlatform: () => true,
  Plugins: {
    CapacitorCalendar: {
      requestWriteOnlyCalendarAccess: async () => ({ result: 'granted' }),
      createEventWithPrompt: async (params) => {
        capturedPromptParams = params;
        return { result: 'created' };
      }
    }
  }
};

async function testNativeCapacitorFlow() {
  const nativeTestEvent = {
    id: 'test-native-event',
    title: '部门季度总结会',
    startTime: '2026-09-26T10:00:00',
    endTime: '2026-09-26T11:30:00',
    location: '行政楼501会议室',
    url: 'https://meeting.tencent.com/dm/789012',
    description: '讨论下季度重点OKR与产品规划'
  };

  const res = await openCalendarEvent(nativeTestEvent);
  console.log('openCalendarEvent native result:', res);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.method, 'capacitor');
  assert.ok(capturedPromptParams, 'capturedPromptParams should be populated');

  // Verify Issue 1: Standard eventLocation and compatible location keys are all present
  assert.strictEqual(capturedPromptParams.eventLocation, '行政楼501会议室', 'eventLocation key must match location');
  assert.strictEqual(capturedPromptParams.location, '行政楼501会议室', 'location key must match location');
  assert.strictEqual(capturedPromptParams.event_location, '行政楼501会议室', 'event_location key must match location');
  assert.strictEqual(capturedPromptParams.address, '行政楼501会议室', 'address key must match location');
  assert.strictEqual(capturedPromptParams.title, '部门季度总结会');
  assert.strictEqual(typeof capturedPromptParams.startDate, 'number');
  assert.strictEqual(typeof capturedPromptParams.beginTime, 'number');
  assert.strictEqual(typeof capturedPromptParams.endDate, 'number');
  assert.strictEqual(typeof capturedPromptParams.endTime, 'number');

  // Verify Issue 2: Double fallback in description for Chinese custom ROMs (HyperOS / HarmonyOS / vivo / OPPO)
  console.log('Native prompt description:\n' + capturedPromptParams.description);
  assert.ok(capturedPromptParams.description.startsWith('地点：行政楼501会议室'), 'Description must prepend 地点：xxx as double fallback');
  assert.ok(capturedPromptParams.description.includes('讨论下季度重点OKR与产品规划'));
  assert.ok(capturedPromptParams.description.includes('链接：https://meeting.tencent.com/dm/789012'));

  console.log('✔ openCalendarEvent Native Capacitor flow & parameter verification passed!');
}

await testNativeCapacitorFlow();

console.log('\nAll verification tests completed successfully!');
