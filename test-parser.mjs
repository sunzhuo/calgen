import { parseScheduleText, isEventOutdated } from './parser.js';
import { buildICS } from './ics.js';

const testCases = [
  '明天下午3点在会议室开会',
  '9月20日 14:00-15:30 团队周会 地点：3楼大会议室',
  '下周五上午10点牙医预约',
  '后天 18:30 和张三聚餐 在万达广场',
  '2026-10-01 全天 国庆放假',
  '今天晚上8点看电影 持续2小时',
  '周三下午2点半 腾讯会议：123-456-789 讨论需求',
  'Doctor appointment tomorrow at 3pm at Clinic'
];

const refDate = new Date('2026-09-18T10:00:00Z');
console.log('Testing with reference date:', refDate.toISOString());

let passed = 0;
for (const tc of testCases) {
  const result = parseScheduleText(tc, refDate);
  console.log('\n--- Input:', tc);
  console.log('Title:', result.title);
  console.log('Start:', result.startTime);
  console.log('End:', result.endTime);
  console.log('Location:', result.location);
  console.log('URL:', result.url);
  console.log('AllDay:', result.allDay);
  
  const ics = buildICS(result);
  if (!ics.includes('BEGIN:VCALENDAR') || !ics.includes('BEGIN:VEVENT')) {
    console.error('ICS build failed for:', tc);
  } else {
    passed++;
  }
}

console.log(`\nTests completed: ${passed}/${testCases.length} passed.`);
