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
  "title": "string (strictly concise core event noun phrase, <= 12 characters, no punctuation, e.g. 赵帅奇博士预答辩, 两个博士预答辩, 项目周会, 财务审计沟通会)",
  "startTime": "string (ISO 8601 local date-time format YYYY-MM-DDTHH:mm:ss for the updated/new schedule)",
  "endTime": "string (ISO 8601 local date-time format YYYY-MM-DDTHH:mm:ss for the updated/new schedule)",
  "allDay": boolean,
  "location": "string (physical location/room, or online meeting info like 腾讯会议 123-456-789, or empty string)",
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
1. Title Rules (标题规则):
   - 长度严格限制在 12 个字以内（<= 12 characters）。
   - 尽量使用名词或名词短语（如 "赵帅奇博士预答辩", "两个博士预答辩", "项目周会", "团队周会", "财务审计沟通会", "图书馆馆长来调研"）。
   - 绝对不带任何标点符号（禁止包含逗号、句号、冒号、感叹号、顿号、问号、引号、括号等任何标点）。
   - 彻底剔除开头的打招呼与问候语及通知对象称呼（如“各位负责人，”、“各位老师下午好，”、“大家下午好，”、“各位领导好，”、“老师们好，”、“下午好，”、“@所有人”等，绝不能作为标题的一部分！）。
   - 彻底剔除事务性与通知套话（如“...安排如下”、“...日程如下”、“...通知如下”、“...的通知”、“关于召开...”等）。例如输入“各位老师下午好，赵帅奇博士预答辩安排如下：”，标题必须提取为“赵帅奇博士预答辩”，绝对不要输出“各位老师下午好，赵帅奇博士预答辩”。
   - 对于“X带队到Y做一线调研/座谈/走访”这类句式，标题应精炼规范提取为“X来调研”或“X调研/座谈”（如“图书馆馆长来调研”），绝不要保留“带队到Y做一线”等冗余叙述。
   - 彻底剔除主观意图动词与句末疑问（如“我有...”、“我们计划...”、“打算...”、“你有时间吧？”、“方便吗？”、“收到请回复”、“谢谢[握手]”等）。若包含参与人数量，合入名词短语（如“我有两个博士计划预答辩” -> “两个博士预答辩”）。
   - 彻底剔除改期原因与连词（如“由于有老师...有课”、“因此时间改为”），标题仅保留核心事件名词。
   - 标题中不得包含日期、时间、地点、议程细节（如“交流核心包括...”）或表情符号。

2. Date Parsing & Cross-Verification Rules (日期解析与双重核对规则):
   - 具体日期优先（Explicit Date Priority）：文本中如果出现具体明确的月日（如“9月24日”、“2026-09-24”、“9/24”、“10月5号”等），必须以该明确日期为绝对基准！年份根据 Current Reference Time (${yyyy}) 推算。
   - 双重核对（Cross-Verification）：当文本中同时出现具体日期与星期/相对周表达时（例如“9月24日（下周四）”、“9月24日 周四”、“10月15日(本周四)”）：
     * 必须双重核对具体日期与星期！
     * 具体日期“9月24日”是明确且决定性的事件日期，“下周四”仅为自然语言中的星期补充标注，绝非再加 7 天！
     * 绝不能只解析“下周四”而错误推算出“10月1日”！该日程日期必须严格解析为 9月24日（${yyyy}-09-24）。
   - 仅相对日期时的计算：仅当文本中完全没有具体月日（仅有“下周四”、“明天下午”、“后天”等）时，才严格基于 Current Reference Time 进行相对计算（中文周一为一周起始，下周四指下个周一至周日周期内的周四）。

3. Location Rules:
   - 提取具体物理地点或会议室（如“管理楼A515”、“管理楼A515会议室”、“科技楼302”、“315会议室”）。
   - “地点管理楼A515”与“地点：管理楼A515”含义完全相同，即使没有冒号或空格也必须准确提取地点为“管理楼A515”。
   - 地点中严禁包含动词或事件名称（如“在管理楼A515预答辩” -> location 应为“管理楼A515”，不能包含“预答辩”）。
   - 若为线上会议（腾讯会议/Zoom）且无实体地点，填写“腾讯会议 123-456-789”或“Zoom 123-456-789”。

4. Modification / Reschedule Rules:
   - 若文本表达对已有日程的修改、改期、推迟、提前（如“改为”、“改到”、“调整为”、“推迟”、“原定...改...”）：
     * "isModification": true.
     * "targetCriteria":
       - "titleKeywords": [被修改的核心事件名，如 "赵帅奇博士预答辩", "预答辩"]
       - "originalDate": 修改前的原日期（YYYY-MM-DD）
       - "originalTimeOfDay": "afternoon" / "morning" / "evening"
     * 若提示地点不变（如“地点不变”、“原地点”），"keepExistingLocation": true.
     * "startTime" 与 "endTime" 严格计算为修改后的新时间。
   - 若为常规新日程，"isModification": false, "keepExistingLocation": false, "targetCriteria": null.

5. Time & Duration Rules:
   - 格式为 ISO 8601 本地时间 YYYY-MM-DDTHH:mm:ss。
   - “8:30分-10:00”中的“分”属于分钟单位，准确解析为开始时间 08:30:00，结束时间 10:00:00，严禁退化为默认 1 小时。
   - 未指定结束时间时：若提到时长（如预计1.5小时），则加上时长；若未提时长且非全天，默认结束时间为开始时间后1小时；全天日程开始与结束日期相同且时间为 00:00:00。

6. Meeting URL:
   - 腾讯会议号（如 123-456-789）自动转换为 https://meeting.tencent.com/dm/123456789 填入 url 字段。

7. Few-Shot Examples (少样本示例):
   - Input: "各位负责人，图书馆馆长带队到交通学院做一线调研，时间定在9月21日上午8:30分-10:00；地点管理楼A515。交流核心包括：一、图书馆老师简单介绍现有资源和服务。"
     -> "title": "图书馆馆长来调研", "startTime": "${yyyy}-09-21T08:30:00", "endTime": "${yyyy}-09-21T10:00:00", "location": "管理楼A515", "url": "", "allDay": false
     (解析要点：剔除“各位负责人”称呼；提取规范事件标题“图书馆馆长来调研”；准确提取无冒号地点“管理楼A515”；“8:30分-10:00”准确解析为08:30至10:00而非默认1小时)
   - Input: "各位老师下午好，赵帅奇博士预答辩安排如下：\n时间：9月24日（下周四）下午2:30\n地点：管理楼A515会议室\n请各位老师预留时间参加，谢谢[握手]"
     -> "title": "赵帅奇博士预答辩", "startTime": "${yyyy}-09-24T14:30:00", "endTime": "${yyyy}-09-24T15:30:00", "location": "管理楼A515会议室", "url": "", "allDay": false
     (解析要点：标题严格在12字以内且无标点；剔除“各位老师下午好”；双重核对9月24日与下周四，准确解析为09-24而非10-01)
   - Input: "孙卓，我有两个博士计划下周二上午八点半预答辩，你有时间吧？"
     -> "title": "两个博士预答辩", "location": ""
   - Input: "孙卓，我有两个博士计划下周二上午八点半在科技楼302预答辩，你有时间吧？"
     -> "title": "两个博士预答辩", "location": "科技楼302"
   - Input: "张老师，我们打算明天下午3点在315会议室开项目周会，方便吗？"
     -> "title": "项目周会", "location": "315会议室"
   - Input: "下周三上午10点腾讯会议：123-456-789 开团队周会 预计1.5小时"
     -> "title": "团队周会", "location": "腾讯会议 123-456-789", "url": "https://meeting.tencent.com/dm/123456789"
   - Input: "各位老师好，由于有老师下周四下午有课，因此预答辩时间改为上午9：30，地点不变，辛苦各位老师"
     -> "title": "预答辩", "isModification": true, "keepExistingLocation": true, "targetCriteria": { "titleKeywords": ["预答辩"], "originalTimeOfDay": "afternoon" }

8. Output MUST be strictly valid JSON without any markdown code fence blocks or extra explanation.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text }
    ];

    let aiResultText = '';

    // 1. If custom OpenAI-compatible API is provided, forward the request
    const customApiUrl = (body.customApiUrl || '').trim();
    const customApiKey = (body.customApiKey || '').trim();
    const customModel = (body.customModel || '').trim() || 'gpt-4o-mini';

    if (customApiUrl) {
      try {
        const customHeaders = {
          'Content-Type': 'application/json',
        };
        if (customApiKey) {
          customHeaders['Authorization'] = `Bearer ${customApiKey}`;
        }
        const customRes = await fetch(customApiUrl, {
          method: 'POST',
          headers: customHeaders,
          body: JSON.stringify({
            model: customModel,
            messages,
            temperature: 0.1,
          }),
        });

        if (customRes.ok) {
          const customData = await customRes.json();
          if (customData.choices && customData.choices[0] && customData.choices[0].message) {
            aiResultText = customData.choices[0].message.content;
          }
        } else {
          const errText = await customRes.text();
          console.error('Custom API proxy request failed:', errText);
        }
      } catch (proxyErr) {
        console.error('Proxying custom API failed:', proxyErr);
      }
    }

    // 2. Try native AI binding: env.AI
    if (!aiResultText && env && env.AI && typeof env.AI.run === 'function') {
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

    // 3. Try REST API with credentials if env.AI not available
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
          console.error('REST API failed:', errText);
        }
      }
    }

    if (!aiResultText) {
      return new Response(
        JSON.stringify({
          success: false,
          model: customModel || MODEL_ID,
          message: 'AI service not available. Client will use local rule-based parser.',
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

    // Sanitize parsedJson to guarantee <= 12 chars title, no punctuation, greetings stripped, and date cross-checked
    if (parsedJson && typeof parsedJson === 'object') {
      if (parsedJson.title && typeof parsedJson.title === 'string') {
        let t = parsedJson.title.trim();
        // 1. Strip emojis
        t = t.replace(/\[[\u4e00-\u9fa5a-zA-Z0-9_\-]+\]/g, '');

        // 1.5 Strip agenda/content details
        t = t.replace(/(?:交流核心|主要内容|会议内容|研讨内容|会议议程|主要议程|议程包括|交流要点)[：:\s\S]*$/i, '');

        // 2. Strip standalone vocatives
        t = t.replace(
          /^(?:各位(?:负责人|老师|领导|同事|同学|朋友|专家|会员|同仁|代表|家长|评审|评委|学长|学姐|新生|教授|大家)|老师们|领导们|同事们|同学们|大家|所有人|@所有人)\s*[，,：:\s]\s*/i,
          ''
        );

        // 2.5 Strip greetings and salutations
        t = t.replace(/^(?:(?:各位(?:老师|领导|同事|同学|朋友|专家|会员|同仁|代表|家长|评审|评委|学长|学姐|新生|教授|负责人)?|大家|老师们|领导们|同事们|同学们)?(?:下午好|上午好|早上好|中午好|晚上好|好|您好|你好)|亲爱的.+?[好！!，,\s]|(?:Good\s+(?:morning|afternoon|evening)|Hi|Hello|Dear)\s+[^,，!！]+[,，!！]?)+[\s,，:：\-]*/i, '');

        // 3. Strip recipient vocatives
        t = t.replace(/^(?:[A-Za-z\u4e00-\u9fa5]{2,5}|@\S+)[，,：:\s]+(?=(?:我|咱|请|有|下周|明天|后天|今天|关于|原定|现|麻烦|想|由于|因|各位))/i, '');

        // 3.5 Semantic pattern normalization:
        // e.g. "图书馆馆长带队到交通学院做一线调研" -> "图书馆馆长来调研"
        const surveyMatch = t.match(
          /(?:^|[，,。；;\s])([\u4e00-\u9fa5A-Za-z0-9]{2,10}?)(?:带队)?(?:到|来|赴|深入)[^，,。；;\n]{0,15}?(?:做|开展|进行|组织)?(?:一线|专题|专项|深入)?[^，,。；;\n]{0,6}(调研|走访|考察|交流|座谈|研讨|巡查|指导|督导|检查)/
        );
        if (surveyMatch) {
          const subject = surveyMatch[1];
          const action = surveyMatch[2];
          t = (action === '调研' || action === '走访' || action === '考察' || action === '指导')
            ? `${subject}来${action}`
            : `${subject}${action}`;
        }

        // 4. Strip announcement boilerplate prefixes/suffixes
        t = t.replace(/^(?:关于(?:举办|召开|组织|开展)?|通知[：:]|紧急通知[：:]|会议通知[：:]|日程安排[：:]|日程[：:]|安排[：:])/g, '');
        t = t.replace(/(?:的?(?:工作|日程|会议)?安排如下[：:]*|安排如下[：:]*|日程如下[：:]*|通知如下[：:]*|如下[：:]*|的通知|的安排)$/g, '');
        // 5. Strip closing polite queries
        t = t.replace(/请(?:各位|大家)?.+?(?:参加|出席|预留时间).*$/g, '');
        t = t.replace(/(?:谢谢|致谢|收到请回复).*$/g, '');
        // 5.5 Strip leading relative date/time words and action verbs
        t = t.replace(/^(?:大后天|后天|明天|明日|今天|今日|昨天|昨日|下下周[一二三四五六日天]?|下周[一二三四五六日天]?|本周[一二三四五六日天]?|这周[一二三四五六日天]?|周[一二三四五六日天]|星期[一二三四五六日天])[\s,，]*/i, '');
        t = t.replace(/^(?:早上|清晨|早晨|上午|中午|下午|傍晚|晚上|夜里|半夜|凌晨)[\s,，]*/i, '');
        t = t.replace(/^(?:开|举行|举办|参加|召开)\s*(?=[A-Za-z0-9\u4e00-\u9fa5]{2,}(?:周会|例会|会议|答辩|预答辩|评审|研讨|讨论|汇报|宣讲|典礼|仪式|发布会))/i, '');
        // 6. Strip all punctuation marks
        t = t.replace(/[，,。;；:：!！?？"“”'‘’、~～\-—·\(\)（）\[\]【】]/g, '').trim();
        // 7. Strictly limit to 12 characters
        if (t.length > 12) {
          t = t.substring(0, 12).trim();
        }
        parsedJson.title = t || '日程安排';
      }

      // Cross-check date with explicit date in text if present (e.g. 9月24日 vs 下周四 -> 10月1日)
      if (parsedJson.startTime && typeof parsedJson.startTime === 'string') {
        let expYear = null, expMonth = null, expDay = null;
        const m1 = text.match(/(?:(\d{4})[\.\/\-年])?(\d{1,2})月(\d{1,2})[日号]?/);
        if (m1) {
          expYear = m1[1] ? parseInt(m1[1], 10) : now.getFullYear();
          expMonth = parseInt(m1[2], 10);
          expDay = parseInt(m1[3], 10);
        } else {
          const m2 = text.match(/(?:^|[^\d])(\d{4})[\.\/\-](\d{1,2})[\.\/\-](\d{1,2})(?!\d)/);
          if (m2) {
            expYear = parseInt(m2[1], 10);
            expMonth = parseInt(m2[2], 10);
            expDay = parseInt(m2[3], 10);
          } else {
            const m3 = text.match(/(?:^|[^\d:])(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])(?!\d|:)/);
            if (m3) {
              expYear = now.getFullYear();
              expMonth = parseInt(m3[1], 10);
              expDay = parseInt(m3[2], 10);
            }
          }
        }

        if (expMonth !== null && expDay !== null && expMonth >= 1 && expMonth <= 12 && expDay >= 1 && expDay <= 31) {
          const expDateStr = `${expYear}-${pad(expMonth)}-${pad(expDay)}`;

          const currentStartMatch = parsedJson.startTime.match(/^(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}:\d{2})/);
          if (currentStartMatch && currentStartMatch[1] !== expDateStr) {
            parsedJson.startTime = `${expDateStr}${currentStartMatch[2]}`;
            if (parsedJson.endTime && typeof parsedJson.endTime === 'string') {
              const currentEndMatch = parsedJson.endTime.match(/^(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}:\d{2})/);
              if (currentEndMatch) {
                parsedJson.endTime = `${expDateStr}${currentEndMatch[2]}`;
              }
            }
          }
        }
      }
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
