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

// Test 3: Direct CalendarProvider Insertion flow via NativeCalendarPlugin with User Confirmation
let capturedDirectParams = null;
globalThis.Capacitor = {
  isNativePlatform: () => true,
  Plugins: {
    NativeCalendar: {
      createAndOpenEvent: async (params) => {
        capturedDirectParams = params;
        return { success: true, eventId: 10086, calendarId: 1, method: 'native_direct' };
      }
    },
    CapacitorCalendar: {
      createEventWithPrompt: async () => ({ result: 'fallback' })
    }
  }
};

async function testNativeDirectCalendarFlow() {
  const testEvent = {
    id: 'direct-test-event',
    title: '博士论文预答辩',
    startTime: '2026-09-26T10:00:00',
    endTime: '2026-09-26T11:30:00',
    location: '科技楼302',
    url: 'https://meeting.tencent.com/dm/789012',
    description: '孙卓博士预答辩汇报'
  };

  const res = await openCalendarEvent(testEvent);
  console.log('openCalendarEvent NativeCalendar direct result:', res);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.method, 'native_direct');
  assert.strictEqual(res.eventId, 10086);
  assert.ok(capturedDirectParams, 'capturedDirectParams should be populated');

  // Verify parameters passed to ContentResolver insertion
  assert.strictEqual(capturedDirectParams.title, '博士论文预答辩');
  assert.strictEqual(capturedDirectParams.location, '科技楼302');
  assert.strictEqual(typeof capturedDirectParams.startTime, 'number');
  assert.strictEqual(typeof capturedDirectParams.endTime, 'number');
  assert.strictEqual(capturedDirectParams.alarmMinutes, 15);
  assert.strictEqual(capturedDirectParams.openMode, 'view');
  assert.ok(capturedDirectParams.description.startsWith('地点：科技楼302'));
  console.log('✔ NativeCalendar direct insert flow with confirmation passed!');
}

await testNativeDirectCalendarFlow();

// Test 4: User cancels confirmation dialog in NativeCalendar
globalThis.Capacitor.Plugins.NativeCalendar = {
  createAndOpenEvent: async () => {
    return { success: false, cancelled: true };
  }
};

async function testNativeUserCancelFlow() {
  const cancelTestEvent = {
    id: 'cancel-test-event',
    title: '不确定的会议',
    startTime: '2026-09-28T10:00:00',
    endTime: '2026-09-28T11:00:00',
    location: '待定',
    description: '可能取消'
  };

  const res = await openCalendarEvent(cancelTestEvent);
  console.log('openCalendarEvent user cancelled result:', res);
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.cancelled, true);
  console.log('✔ User cancellation handled cleanly without fallback or insertion!');
}

await testNativeUserCancelFlow();

// Test 5: Fallback flow to createEventWithPrompt when NativeCalendar errors/unimplemented
let capturedPromptParams = null;
globalThis.Capacitor.Plugins.NativeCalendar = {
  createAndOpenEvent: async () => {
    throw new Error('NativeCalendar unavailable');
  }
};
globalThis.Capacitor.Plugins.CapacitorCalendar = {
  requestWriteOnlyCalendarAccess: async () => ({ result: 'granted' }),
  createEventWithPrompt: async (params) => {
    capturedPromptParams = params;
    return { result: 'created' };
  }
};

async function testFallbackPromptFlow() {
  const fallbackEvent = {
    id: 'fallback-event',
    title: '临时项目紧急会',
    startTime: '2026-09-27T14:00:00',
    endTime: '2026-09-27T15:00:00',
    location: '行政楼501',
    description: '讨论紧急Bug'
  };

  const res = await openCalendarEvent(fallbackEvent);
  console.log('openCalendarEvent fallback prompt result:', res);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.method, 'capacitor_prompt');
  assert.ok(capturedPromptParams);
  assert.strictEqual(capturedPromptParams.eventLocation, '行政楼501');
  assert.strictEqual(capturedPromptParams.location, '行政楼501');
  assert.ok(capturedPromptParams.description.startsWith('地点：行政楼501'));
  console.log('✔ Fallback to createEventWithPrompt flow passed!');
}

await testFallbackPromptFlow();

// Test 6: User clicks "修改信息" (editRequested flow)
globalThis.Capacitor.Plugins.NativeCalendar = {
  createAndOpenEvent: async (params) => {
    return { success: false, editRequested: true };
  }
};

async function testNativeEditRequestedFlow() {
  const eventToEdit = {
    id: 'edit-test-event',
    title: '周一例会',
    startTime: '2026-09-28T09:00:00',
    endTime: '2026-09-28T10:00:00',
    location: '会议室',
    description: '讨论周目标'
  };

  const res = await openCalendarEvent(eventToEdit);
  console.log('openCalendarEvent editRequested result:', res);
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.editRequested, true);
  console.log('✔ Native editRequested handled cleanly without fallback or insertion!');
}

await testNativeEditRequestedFlow();

// Test 7: Save and directly insert edited event (with skipConfirm: true)
capturedDirectParams = null;
globalThis.Capacitor.Plugins.NativeCalendar = {
  createAndOpenEvent: async (params) => {
    capturedDirectParams = params;
    return { success: true, eventId: 8888 };
  }
};

async function testModifiedEventDirectInsertFlow() {
  const modifiedEvent = {
    id: 'modified-event',
    title: '修改后的项目架构研讨会',
    startTime: '2026-09-28T14:30:00',
    endTime: '2026-09-28T16:30:00',
    allDay: false,
    location: '科技园区B座801国际会议厅',
    description: '讨论新架构落地细节',
    alarmMinutes: 30
  };

  const res = await openCalendarEvent(modifiedEvent, { skipConfirm: true });
  console.log('openCalendarEvent modified direct insert result:', res);
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.method, 'native_direct');
  assert.strictEqual(res.eventId, 8888);
  assert.ok(capturedDirectParams);
  assert.strictEqual(capturedDirectParams.title, '修改后的项目架构研讨会');
  assert.strictEqual(capturedDirectParams.location, '科技园区B座801国际会议厅');
  assert.strictEqual(capturedDirectParams.alarmMinutes, 30);
  assert.strictEqual(capturedDirectParams.skipConfirm, true);
  console.log('✔ Modified event direct insertion with skipConfirm passed!');
}

await testModifiedEventDirectInsertFlow();

console.log('\nAll verification tests completed successfully!');
