/**
 * Cloudflare Pages Function: /api/parse
 * Uses Cloudflare Workers AI model: @cf/google/gemma-4-26b-a4b-it
 * Parses natural language schedule text (including forwarded messages & chat records)
 * into structured event data with shared subject-resolution logic from parser.js.
 */

import {
  cleanEventTitle,
  preprocessForwardedText,
  getCalendarAISystemPrompt,
  extractJsonFromAiResponse,
  extractExplicitScheduleDate,
  parseScheduleText,
  reconcileEventTitle
} from '../../parser.js';

const MODEL_ID = '@cf/google/gemma-4-26b-a4b-it';

export const sanitizeTitle = cleanEventTitle;

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
    const rawText = (body.text || '').trim();
    if (!rawText) {
      return new Response(
        JSON.stringify({ error: 'Missing schedule text' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const clientTime = body.clientTime || new Date().toISOString();
    const timezone = body.timezone || 'Asia/Shanghai';
    const now = new Date(clientTime);
    const pad = (n) => String(n).padStart(2, '0');

    // Structural pre-processing of forwarded headers, chat timestamps, speakers, and org entities
    const prep = preprocessForwardedText(rawText);
    const aiUserContent = (prep.aiInputText || rawText).replace(/(\d{1,2})\s*[:：]\s*(\d{2})/g, '$1:$2');
    const systemPrompt = getCalendarAISystemPrompt(now, timezone);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: aiUserContent }
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

    let parsedJson = null;
    try {
      parsedJson = extractJsonFromAiResponse(aiResultText);
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

    // Post-process & reconcile parsedJson with forwarded subject context and clean schedule date
    if (parsedJson && typeof parsedJson === 'object') {
      const localParsed = parseScheduleText(rawText, now);
      const candidateTitle = typeof parsedJson.title === 'string' ? parsedJson.title : '';
      parsedJson.title = reconcileEventTitle(candidateTitle, localParsed ? localParsed.title : '', rawText);

      if ((!parsedJson.location || !String(parsedJson.location).trim() || parsedJson.location === '办公室' || parsedJson.location === '我办公室') &&
          localParsed && localParsed.location) {
        parsedJson.location = localParsed.location;
      }

      if ((!parsedJson.url || !String(parsedJson.url).trim()) && localParsed && localParsed.url) {
        parsedJson.url = localParsed.url;
      }

      if (!parsedJson.description) {
        parsedJson.description = rawText;
      }

      // Cross-check date against explicit date in CLEANED schedule body (ignoring chat header send timestamps!)
      if (parsedJson.startTime && typeof parsedJson.startTime === 'string' && !parsedJson.isModification) {
        const dateCheckSource = prep.latestScheduleTurnText || prep.cleanText || rawText;
        const expDate = extractExplicitScheduleDate(dateCheckSource, now);
        if (expDate) {
          const expDateStr = `${expDate.year}-${pad(expDate.monthIndex + 1)}-${pad(expDate.day)}`;
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
