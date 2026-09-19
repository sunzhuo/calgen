import { parseScheduleText } from './parser.js';

const tests = [
  '孙卓，我有两个博士计划下周二上午八点半预答辩，你有时间吧？',
  '孙卓，我有两个博士计划下周二上午八点半在科技楼302预答辩，你有时间吧？',
  '张老师，我们打算明天下午3点在315会议室开项目周会，方便吗？',
  '下周三上午10点腾讯会议：123-456-789 开团队周会 预计1.5小时',
  '下周二上午八点半预答辩，地点：学院楼A301',
  '下周二上午八点半预答辩，地点在主楼402，你有空吗？'
];

for (const t of tests) {
  console.log('INPUT:', t);
  const res = parseScheduleText(t);
  console.log('OUTPUT:', JSON.stringify({ title: res.title, location: res.location, url: res.url }));
  console.log('---');
}

