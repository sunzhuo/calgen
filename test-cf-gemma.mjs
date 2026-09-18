import { onRequestPost } from './functions/api/parse.js';
import { parseScheduleWithGemma, parseScheduleTextAsync, GEMMA_MODEL_ID } from './parser.js';

console.log('Testing Cloudflare Pages Function with @cf/google/gemma-4-26b-a4b-it...');

// Mock env.AI with Gemma 4 model response
const mockGemmaAi = {
  run: async (model, options) => {
    console.log(`[Mock env.AI] called model: ${model}`);
    if (model !== GEMMA_MODEL_ID) {
      throw new Error(`Unexpected model: ${model}`);
    }

    const userMessage = options.messages.find(m => m.role === 'user').content;
    console.log(`[Mock env.AI] prompt input: "${userMessage}"`);

    // Simulate Gemma 4 26B structured output
    return {
      response: JSON.stringify({
        title: "团队周会及规划讨论",
        startTime: "2026-09-21T14:30:00",
        endTime: "2026-09-21T16:00:00",
        allDay: false,
        location: "5楼会议室",
        description: userMessage,
        url: "https://meeting.tencent.com/dm/123456789"
      })
    };
  }
};

// 1. Test onRequestPost handler directly
const mockRequest = new Request('https://calgen.pages.dev/api/parse', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    text: "下周一下午2点半 腾讯会议：123-456-789 在5楼会议室开团队周会及规划讨论 预计1.5小时",
    clientTime: "2026-09-18T10:00:00.000Z",
    timezone: "Asia/Shanghai"
  })
});

const response = await onRequestPost({
  request: mockRequest,
  env: { AI: mockGemmaAi }
});

console.log('Response status:', response.status);
const resJson = await response.json();
console.log('Parsed API Result:', JSON.stringify(resJson, null, 2));

if (resJson.success && resJson.model === GEMMA_MODEL_ID && resJson.data.title === "团队周会及规划讨论") {
  console.log('✅ Functions API test passed!');
} else {
  console.error('❌ Functions API test failed!');
  process.exit(1);
}
