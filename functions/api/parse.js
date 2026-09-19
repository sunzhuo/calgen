/**
 * Cloudflare Pages Function: /api/parse
 * Uses Cloudflare Workers AI model: @cf/google/gemma-4-26b-a4b-it
 * Parses natural language schedule text into structured event data
 */

const MODEL_ID = '@cf/google/gemma-4-26b-a4b-it';

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CF-Account-ID, X-CF-API-Token',
    },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8',
  };

  try {
    const body = await request.json().catch(() => ({}));
    const text = (body.text || '').trim();
    if (!text) {
      return new Response(
        JSON.stringify({ error: 'Missing schedule text' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const clientTime = body.clientTime || new Date().toISOString();
    const timezone = body.timezone || 'Asia/Shanghai';
    const now = new Date(clientTime);

    // Format current reference time for the model
    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = now.getFullYear();
    const mm = pad(now.getMonth() + 1);
    const dd = pad(now.getDate());
    const hh = pad(now.getHours());
    const min = pad(now.getMinutes());
    const weekdays = ['周日(Sunday)', '周一(Monday)', '周二(Tuesday)', '周三(Wednesday)', '周四(Thursday)', '周五(Friday)', '周六(Saturday)'];
    const currentWeekday = weekdays[now.getDay()];

    const systemPrompt = `You are an expert calendar assistant specialized in parsing schedule text into structured JSON.
Current Reference Time: ${yyyy}-${mm}-${dd} ${hh}:${min} (${currentWeekday}), Timezone: ${timezone}.

Extract the schedule event from the user's text and respond ONLY with a valid JSON object matching this schema:
{
  "title": "string (strictly concise core event subject, e.g. 赵帅奇博士预答辩, 项目周会, 财务审计沟通会)",
  "startTime": "string (ISO 8601 local date-time format YYYY-MM-DDTHH:mm:ss for the updated/new schedule)",
  "endTime": "string (ISO 8601 local date-time format YYYY-MM-DDTHH:mm:ss for the updated/new schedule)",
  "allDay": boolean,
  "location": "string (physical location or room, or empty string)",
  "description": "string (original raw notes or details)",
  "url": "string (meeting link or URL if mentioned, e.g. Tencent Meeting link https://meeting.tencent.com/dm/xxx, Zoom link, or empty string)",
  "isModification": boolean,
  "keepExistingLocation": boolean,
  "targetCriteria": {
    "titleKeywords": ["string"],
    "originalDate": "string (YYYY-MM-DD if identifiable, or empty string)",
    "originalTimeOfDay": "string (morning | afternoon | evening | empty string)"
  }
}

Rules:
1. Title Rules:
   - The title MUST be extremely concise, clean, and directly identify the event/meeting subject (e.g. "赵帅奇博士预答辩", "预答辩", "团队周会", "2026年Q3需求评审").
   - STRICTLY strip all conversational greetings and salutations (e.g. "各位老师下午好", "大家好", "各位同事好", "各位领导好", "Hi all", "Dear team").
   - STRICTLY strip announcement/notice boilerplate phrasing (e.g. "...安排如下", "...日程如下", "...通知如下", "...的通知", "关于召开...", "请各位老师预留时间参加", etc.).
   - STRICTLY strip modification/reschedule connectors and reasons from title (e.g. "由于有老师...有课", "因此...时间改为...", "改为", "调整为"). The title must only be the core event name (e.g. "预答辩").
   - Do NOT include dates, times, locations, emojis (like [握手]), or polite closing words in the title.
2. Relative dates (e.g. 今天, 明天, 后天, 下周五, 本周三, 3天后, tomorrow) must be calculated strictly relative to Current Reference Time (${yyyy}-${mm}-${dd}).
3. Modification / Reschedule Rules:
   - If the user's text expresses an intent to change, update, or reschedule an existing or previously scheduled event (e.g. contains "改为", "改到", "调整为", "推迟", "提前", "原定...改...", "由于...有课，预答辩时间改为..."):
     * Set "isModification": true.
     * Populate "targetCriteria":
       - "titleKeywords": [core event name being modified, e.g. "预答辩"]
       - "originalDate": ISO YYYY-MM-DD date of the original event before change (e.g. if original was "下周四下午", calculate that Thursday's YYYY-MM-DD).
       - "originalTimeOfDay": "afternoon" if original was 下午, "morning" if 上午, "evening" if 晚上.
     * If text indicates the location remains the same (e.g. "地点不变", "原地点", "地点同上", "原会议室"), set "keepExistingLocation": true.
     * Compute "startTime" and "endTime" strictly for the NEW rescheduled time (e.g. "上午9:30" on that same day).
   - If the text is a regular new event (not a modification/reschedule), set "isModification": false, "keepExistingLocation": false, and "targetCriteria": null.
4. If end time is not explicitly specified:
   - If duration is mentioned (e.g. 持续2小时, 30分钟), add duration to startTime.
   - If no duration is mentioned and it's not allDay, default endTime to 1 hour after startTime.
   - If allDay is true, startTime and endTime should have the same date with 00:00:00.
5. Tencent meeting number like 123-456-789 should be converted to https://meeting.tencent.com/dm/123456789 in the "url" field.
6. Output MUST be strictly valid JSON without any markdown code fence blocks or extra explanation.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text }
    ];

    let aiResultText = '';

    // 1. Try Cloudflare Pages native Workers AI binding: env.AI
    if (env && env.AI && typeof env.AI.run === 'function') {
      try {
        const response = await env.AI.run(MODEL_ID, {
          messages,
          temperature: 0.1,
          max_tokens: 1024,
        });

        if (typeof response === 'string') {
          aiResultText = response;
        } else if (response && response.response) {
          aiResultText = response.response;
        } else if (response && response.choices && response.choices[0] && response.choices[0].message) {
          aiResultText = response.choices[0].message.content;
        } else {
          aiResultText = JSON.stringify(response);
        }
      } catch (aiErr) {
        console.warn('env.AI execution failed, falling back to REST API if configured:', aiErr);
      }
    }

    // 2. If env.AI wasn't available or failed, try Cloudflare REST API with credentials
    if (!aiResultText) {
      const accountId = request.headers.get('X-CF-Account-ID') || (env && env.CLOUDFLARE_ACCOUNT_ID);
      const apiToken = request.headers.get('X-CF-API-Token') || (env && env.CLOUDFLARE_API_TOKEN);

      if (accountId && apiToken) {
        const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL_ID}`;
        const cfRes = await fetch(cfUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages,
            temperature: 0.1,
            max_tokens: 1024,
          }),
        });

        if (cfRes.ok) {
          const cfData = await cfRes.json();
          if (cfData && cfData.result && cfData.result.response) {
            aiResultText = cfData.result.response;
          } else if (cfData && cfData.result && cfData.result.choices) {
            aiResultText = cfData.result.choices[0].message.content;
          }
        } else {
          const errText = await cfRes.text();
          console.error('Cloudflare REST API failed:', errText);
        }
      }
    }

    if (!aiResultText) {
      return new Response(
        JSON.stringify({
          success: false,
          model: MODEL_ID,
          message: 'Workers AI binding (env.AI) or Cloudflare API Token not available. Client will use local rule-based parser.',
        }),
        { status: 503, headers: corsHeaders }
      );
    }

    // Parse the JSON output from Gemma
    let parsedJson = null;
    try {
      // Strip markdown code fences ```json ... ``` if present
      const cleaned = aiResultText
        .replace(/```(?:json)?/gi, '')
        .replace(/```/g, '')
        .trim();

      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedJson = JSON.parse(jsonMatch[0]);
      } else {
        parsedJson = JSON.parse(cleaned);
      }
    } catch (parseErr) {
      console.error('Failed to parse Gemma output as JSON:', aiResultText, parseErr);
      return new Response(
        JSON.stringify({
          success: false,
          model: MODEL_ID,
          raw: aiResultText,
          message: 'Model output could not be parsed as JSON',
        }),
        { status: 422, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        model: MODEL_ID,
        data: parsedJson,
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    console.error('API /api/parse unhandled error:', err);
    return new Response(
      JSON.stringify({ error: err.message || 'Internal Server Error' }),
      { status: 500, headers: corsHeaders }
    );
  }
}
