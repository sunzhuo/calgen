import { parseScheduleText } from './parser.js';

const tests = [
  '我有两个博士计划下周二上午八点半预答辩，你有时间吧？',
  '我有两个博士计划下周二上午八点半在科技楼302预答辩，你有时间吧？',
  '张老师，我们打算明天下午3点在315会议室开项目周会，方便吗？',
  '下周三上午10点腾讯会议：123-456-789 开团队周会 预计1.5小时',
  '下周二上午八点半预答辩，地点：学院楼A301',
  '下周二上午八点半预答辩，地点在主楼402，你有空吗？',
  '各位老师下午好，我是本次答辩的秘书安帅斌，博士开题及中期时间：10月28日（后天）下午1：30，地点：管理楼A507，共9名同学参加，顺序见截图，请各位老师预留时间，辛苦[咖啡]'
];

for (const t of tests) {
  console.log('INPUT:', t);
  const res = parseScheduleText(t);
  console.log('OUTPUT:', JSON.stringify({ title: res.title, location: res.location, url: res.url }));
  console.log('---');
}

