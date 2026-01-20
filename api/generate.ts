type Body = {
  model: string;
  systemInstruction: string;
  userPrompt: string;
  enableThinking?: boolean;
  proxyEndpoint?: string;
};

function normalizeModel(input: string) {
  const m = String(input || '').trim();
  if (!m) return m;

  if (m.startsWith('gpt-') || m.startsWith('o1')) return m;
  if (m.startsWith('gpt')) return `gpt-${m.slice('gpt'.length)}`;

  if (/^\d+(?:\.\d+)*$/.test(m)) return `gpt-${m}`;
  if (/^4o(?:-.+)?$/.test(m)) return `gpt-${m}`;
  return m;
}

function getModelFallbacks(model: string) {
  const m = String(model || '').trim();
  const fallbacks: string[] = [];

  if (!m) return fallbacks;

  if (m.startsWith('gpt-4.1')) {
    fallbacks.push('gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini');
  } else if (m.startsWith('gpt-4o')) {
    fallbacks.push('gpt-4o-mini', 'gpt-4o');
  } else if (m.startsWith('gpt-4')) {
    fallbacks.push('gpt-4o-mini', 'gpt-4o');
  } else if (m.startsWith('o1')) {
    fallbacks.push('gpt-4o-mini', 'gpt-4o');
  } else if (m.includes('gemini-2.0-flash')) {
    fallbacks.push('gemini-1.5-flash', 'gemini-1.5-pro');
  } else if (m.includes('gemini')) {
    fallbacks.push('gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp');
  }

  return Array.from(new Set(fallbacks.filter(x => x && x !== m)));
}

const allowedHosts = new Set([
  'api.vectorengine.ai',
  'generativelanguage.googleapis.com',
]);

function getUpstreamBase(endpoint: string) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('Invalid proxyEndpoint');
  }

  if (!allowedHosts.has(url.hostname)) {
    throw new Error('proxyEndpoint host not allowed');
  }

  return endpoint.replace(/\/+$/, '');
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const auth = req.headers.authorization;
  const token = typeof auth === 'string' ? auth : '';
  const rawToken = token.startsWith('Bearer ') ? token.slice('Bearer '.length).trim() : token.trim();

  const body = (req.body || {}) as Body;
  const model = normalizeModel(body.model);
  const systemInstruction = String(body.systemInstruction || '');
  const userPrompt = String(body.userPrompt || '');
  const enableThinking = Boolean(body.enableThinking);
  const proxyEndpoint = String(body.proxyEndpoint || 'https://api.vectorengine.ai').trim();

  if (!model || !systemInstruction || !userPrompt) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  if (!rawToken) {
    res.status(401).json({ error: 'Missing Proxy Token' });
    return;
  }

  try {
    const endpoint = getUpstreamBase(proxyEndpoint || 'https://api.vectorengine.ai');
    const isOpenAI = model.startsWith('gpt') || model.startsWith('o1');

    let urlObj: URL;
    let upstreamBody: any;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (isOpenAI) {
      let baseUrl = endpoint;
      if (baseUrl.endsWith('/v1beta')) {
        baseUrl = baseUrl.replace(/\/v1beta$/, '/v1');
      } else if (!baseUrl.endsWith('/v1')) {
        baseUrl = `${baseUrl}/v1`;
      }
      urlObj = new URL(`${baseUrl}/chat/completions`);

      headers.Authorization = `Bearer ${rawToken}`;
      headers['X-API-Key'] = rawToken;

      const tryModels = [model, ...getModelFallbacks(model)];
      let lastStatus = 500;
      let lastRaw = '';
      let lastContentType = '';
      let lastJson: any = null;

      for (const m of tryModels) {
        upstreamBody = {
          model: m,
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: userPrompt },
          ],
          stream: false,
          temperature: 0.7,
          top_p: 0.95,
        };

        const upstreamRes = await fetch(urlObj.toString(), {
          method: 'POST',
          headers,
          body: JSON.stringify(upstreamBody),
        });

        lastStatus = upstreamRes.status;
        lastContentType = String(upstreamRes.headers.get('content-type') || '');
        lastRaw = await upstreamRes.text();
        lastJson = (() => {
          try {
            return JSON.parse(lastRaw);
          } catch {
            return null;
          }
        })();

        if (upstreamRes.ok) {
          const text = lastJson?.choices?.[0]?.message?.content || '';
          res.status(200).json({ text, usedModel: m });
          return;
        }

        const upstreamMessage =
          lastJson?.error?.message || lastJson?.message || (lastRaw.trim() ? lastRaw.slice(0, 500) : '');
        const looksLikeModelNotFound =
          upstreamRes.status === 404 &&
          (/model/i.test(upstreamMessage || '') || /模型/i.test(upstreamMessage || '')) &&
          /(not found|does not exist|不存在|未找到|未启用|尚未上线|未开放|No available channels)/i.test(upstreamMessage || '');

        if (!looksLikeModelNotFound) break;
      }

      const upstreamMessage =
        lastJson?.error?.message ||
        lastJson?.message ||
        (typeof lastRaw === 'string' && lastRaw.trim() ? lastRaw.slice(0, 500) : '') ||
        'Upstream error';

      res.status(lastStatus).json({
        error: upstreamMessage,
        upstreamStatus: lastStatus,
        upstreamContentType: lastContentType,
        detail: lastJson ?? lastRaw.slice(0, 2000),
        triedModels: [model, ...getModelFallbacks(model)],
      });
      return;
    } else {
      const baseUrl = endpoint.includes('/v1beta') ? endpoint : `${endpoint}/v1beta`;
      urlObj = new URL(`${baseUrl}/models/${model}:generateContent`);
      const supportsThinking = model.includes('thinking');
      upstreamBody = {
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          topP: 0.95,
          ...(enableThinking && supportsThinking
            ? {
                thinkingConfig: {
                  includeThoughts: true,
                  thinkingBudget: 16000,
                },
              }
            : {}),
        },
      };

      if (urlObj.hostname === 'generativelanguage.googleapis.com') {
        headers['x-goog-api-key'] = rawToken;
      } else {
        headers.Authorization = `Bearer ${rawToken}`;
        headers['X-API-Key'] = rawToken;
      }
    }

    const upstreamRes = await fetch(urlObj.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(upstreamBody),
    });

    const contentType = String(upstreamRes.headers.get('content-type') || '');
    const rawText = await upstreamRes.text();
    const json = (() => {
      try {
        return JSON.parse(rawText);
      } catch {
        return null;
      }
    })();

    if (!upstreamRes.ok) {
      const upstreamMessage =
        (json as any)?.error?.message ||
        (json as any)?.message ||
        (typeof rawText === 'string' && rawText.trim() ? rawText.slice(0, 500) : '') ||
        'Upstream error';

      res.status(upstreamRes.status).json({
        error: upstreamMessage,
        upstreamStatus: upstreamRes.status,
        upstreamContentType: contentType,
        detail: json ?? rawText.slice(0, 2000),
        triedModels: [model, ...getModelFallbacks(model)],
      });
      return;
    }

    const text = Array.isArray((json as any)?.candidates?.[0]?.content?.parts)
      ? (json as any).candidates[0].content.parts.map((p: any) => p?.text || '').join('')
      : '';

    res.status(200).json({ text, usedModel: model });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
}
