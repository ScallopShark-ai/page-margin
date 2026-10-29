const DEFAULTS = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-20250514',
  },
  custom: {
    baseUrl: '',
    model: '',
  },
};

export const PROVIDER_IDS = Object.keys(DEFAULTS);

export function providerDefaults(provider) {
  return DEFAULTS[provider] ?? DEFAULTS.custom;
}

function normalizeBase(value) {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

function joinEndpoint(baseUrl, path, fullPathPattern) {
  const base = normalizeBase(baseUrl);
  if (!base) throw new Error('缺少 API Base URL');
  if (fullPathPattern.test(base)) return base;
  return `${base}/${path.replace(/^\/+/, '')}`;
}

function openAiEndpoint(baseUrl) {
  return joinEndpoint(baseUrl, 'chat/completions', /\/chat\/completions$/i);
}

function anthropicEndpoint(baseUrl) {
  const base = normalizeBase(baseUrl);
  if (/\/v1\/messages$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/messages`;
  return `${base}/v1/messages`;
}

function modelsEndpoint(provider, baseUrl) {
  let base = normalizeBase(baseUrl);
  if (!base) throw new Error('缺少 API Base URL');

  if (provider === 'anthropic') {
    base = base.replace(/\/v1\/messages$/i, '').replace(/\/messages$/i, '');
    if (/\/v1\/models$/i.test(base)) return base;
    if (/\/v1$/i.test(base)) return `${base}/models`;
    return `${base}/v1/models`;
  }

  base = base.replace(/\/chat\/completions$/i, '');
  if (/\/models$/i.test(base)) return base;
  if (provider === 'openai' && !/\/v\d+$/i.test(base)) {
    return `${base}/v1/models`;
  }
  return `${base}/models`;
}

function normalizeModelList(payload) {
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : Array.isArray(payload?.data?.models)
          ? payload.data.models
          : [];
  const seen = new Set();
  const models = [];
  for (const item of raw) {
    const id =
      typeof item === 'string'
        ? item.trim()
        : String(
            item?.id ?? item?.model ?? item?.slug ?? item?.name ?? '',
          ).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name =
      typeof item === 'object'
        ? String(item?.display_name ?? item?.displayName ?? '').trim()
        : '';
    const ownedBy =
      typeof item === 'object'
        ? String(item?.owned_by ?? item?.ownedBy ?? item?.provider ?? '').trim()
        : '';
    models.push({
      id,
      ...(name && name !== id ? { name } : {}),
      ...(ownedBy ? { ownedBy } : {}),
    });
  }
  models.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  return models;
}

function friendlyModelListMessage(status, upstreamBody) {
  let upstream = '';
  try {
    const parsed = JSON.parse(upstreamBody);
    upstream =
      parsed?.error?.message ||
      parsed?.message ||
      parsed?.error ||
      parsed?.detail ||
      '';
    if (typeof upstream !== 'string') upstream = JSON.stringify(upstream);
  } catch {
    upstream = upstreamBody;
  }
  upstream = String(upstream || '')
    .replace(/\s+/g, ' ')
    .slice(0, 420);

  const prefix =
    status === 401 || status === 403
      ? 'API Key 无效，或没有读取模型列表的权限'
      : status === 404
        ? '这个地址没有模型列表接口，请检查 Base URL'
        : status === 429
          ? '读取模型列表过于频繁或额度已用尽'
          : status >= 500
            ? '模型网关暂时不可用'
            : '读取模型列表失败';
  return `${prefix}（HTTP ${status}）${upstream ? `：${upstream}` : ''}`;
}

export async function listProviderModels({
  provider,
  apiKey,
  baseUrl,
  signal,
}) {
  if (!PROVIDER_IDS.includes(provider)) {
    const error = new Error('未知的模型服务商');
    error.status = 400;
    throw error;
  }
  const defaults = providerDefaults(provider);
  const effectiveBase = baseUrl?.trim() || defaults.baseUrl;
  if (!effectiveBase) {
    const error = new Error('请填写 API Base URL');
    error.status = 400;
    throw error;
  }

  let nextUrl = modelsEndpoint(provider, effectiveBase);
  if (provider === 'anthropic') {
    const url = new URL(nextUrl);
    url.searchParams.set('limit', '1000');
    nextUrl = url.toString();
  }

  const headers = {
    accept: 'application/json',
  };
  if (provider === 'anthropic') {
    headers['x-api-key'] = apiKey || '';
    headers['anthropic-version'] = '2023-06-01';
  } else if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const allModels = [];
  const seen = new Set();
  let endpoint = nextUrl;

  for (let page = 0; page < 5 && nextUrl; page += 1) {
    let response;
    try {
      response = await fetch(nextUrl, {
        headers,
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
          : AbortSignal.timeout(20000),
      });
    } catch (caught) {
      if (caught?.name === 'AbortError') throw caught;
      if (caught?.name === 'TimeoutError') {
        const error = new Error('读取模型列表超时，请稍后重试');
        error.status = 504;
        throw error;
      }
      const error = new Error(
        `无法连接模型网关：${caught instanceof Error ? caught.message : '网络错误'}`,
      );
      error.status = 502;
      throw error;
    }

    const bodyText = await response.text().catch(() => '');
    if (!response.ok) {
      const error = new Error(
        friendlyModelListMessage(response.status, bodyText),
      );
      error.status =
        [400, 401, 403, 404, 429].includes(response.status)
          ? response.status
          : 502;
      error.upstreamStatus = response.status;
      throw error;
    }

    let payload;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      const error = new Error('模型列表返回的不是有效 JSON，请检查 Base URL');
      error.status = 502;
      throw error;
    }

    const rows = normalizeModelList(payload);
    for (const model of rows) {
      if (seen.has(model.id)) continue;
      seen.add(model.id);
      allModels.push(model);
    }

    if (provider === 'anthropic' && payload?.has_more && payload?.last_id) {
      const url = new URL(endpoint);
      url.searchParams.set('after_id', String(payload.last_id));
      nextUrl = url.toString();
      continue;
    }
    break;
  }

  allModels.sort((a, b) =>
    a.id.localeCompare(b.id, 'en', { numeric: true }),
  );
  return { models: allModels, endpoint };
}

function friendlyUpstreamMessage(status, upstreamBody) {
  let upstream = '';
  try {
    const parsed = JSON.parse(upstreamBody);
    upstream =
      parsed?.error?.message ||
      parsed?.message ||
      parsed?.error ||
      parsed?.detail ||
      '';
    if (typeof upstream !== 'string') upstream = JSON.stringify(upstream);
  } catch {
    upstream = upstreamBody;
  }
  upstream = String(upstream || '')
    .replace(/\s+/g, ' ')
    .slice(0, 420);

  const prefix =
    status === 401 || status === 403
      ? 'API Key 无效，或当前密钥没有该模型的访问权限'
      : status === 404
        ? '找不到模型接口或模型名称，请检查 Base URL 与模型名'
        : status === 429
          ? '请求过于频繁或额度已用尽，请稍后重试'
          : status >= 500
            ? '模型服务暂时不可用'
            : '模型请求失败';
  return `${prefix}（HTTP ${status}）${upstream ? `：${upstream}` : ''}`;
}

async function requestCompletion({ provider, apiKey, baseUrl, model, system, messages, signal }) {
  const defaults = providerDefaults(provider);
  const effectiveBase = baseUrl?.trim() || defaults.baseUrl;
  const effectiveModel = model?.trim() || defaults.model;
  if (!effectiveBase) throw new Error('请填写 API Base URL');
  if (!effectiveModel) throw new Error('请填写模型名称');

  let url;
  let headers;
  let body;
  if (provider === 'anthropic') {
    url = anthropicEndpoint(effectiveBase);
    headers = {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
    body = {
      model: effectiveModel,
      max_tokens: 4096,
      temperature: 0.3,
      system,
      messages,
      stream: true,
    };
  } else {
    url = openAiEndpoint(effectiveBase);
    headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    };
    body = {
      model: effectiveModel,
      temperature: 0.3,
      stream: true,
      messages: [{ role: 'system', content: system }, ...messages],
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 210000);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  const cleanup = () => {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', onAbort);
  };

  const abortedError = () => {
    if (timedOut) {
      const timeoutError = new Error('模型响应超时，请重试');
      timeoutError.status = 504;
      return timeoutError;
    }
    const aborted = new Error('已停止生成');
    aborted.code = 'CLIENT_ABORT';
    return aborted;
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      const error = new Error(friendlyUpstreamMessage(response.status, errorBody));
      error.status = 502;
      error.upstreamStatus = response.status;
      throw error;
    }
    if (!response.body) {
      throw new Error('模型服务未返回内容流');
    }
    return { response, effectiveModel, cleanup, abortedError };
  } catch (error) {
    cleanup();
    if (error?.name === 'AbortError' || controller.signal.aborted) {
      throw abortedError();
    }
    if (error?.status) throw error;
    throw new Error(
      `无法连接模型服务：${error instanceof Error ? error.message : '网络错误'}`,
    );
  }
}

async function* sseBlocks(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (block.trim()) yield block;
        boundary = buffer.indexOf('\n\n');
      }
    }
    if (buffer.trim()) yield buffer;
  } finally {
    reader.releaseLock();
  }
}

function parseSseData(block) {
  const dataLines = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  return dataLines.join('\n');
}

async function streamOpenAi({ response, onDelta }) {
  let usage = null;
  let finishReason = '';
  for await (const block of sseBlocks(response)) {
    const data = parseSseData(block);
    if (!data) continue;
    if (data === '[DONE]') break;
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      continue;
    }
    if (payload?.error) {
      throw new Error(
        `模型流式响应出错：${payload.error.message || JSON.stringify(payload.error)}`,
      );
    }
    const choice = payload?.choices?.[0];
    if (!choice) continue;
    const content = choice?.delta?.content;
    if (typeof content === 'string' && content) onDelta(content);
    if (choice.finish_reason) finishReason = choice.finish_reason;
    if (payload.usage) usage = payload.usage;
  }
  return { usage, finishReason };
}

async function streamAnthropic({ response, onDelta }) {
  let usage = null;
  let finishReason = '';
  for await (const block of sseBlocks(response)) {
    const data = parseSseData(block);
    if (!data) continue;
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      continue;
    }
    if (payload.type === 'error') {
      throw new Error(
        `模型流式响应出错：${payload.error?.message || JSON.stringify(payload.error)}`,
      );
    }
    if (payload.type === 'message_start') {
      usage = { ...(usage || {}), ...(payload.message?.usage || {}) };
    }
    if (payload.type === 'content_block_delta' && payload.delta?.type === 'text_delta') {
      if (payload.delta.text) onDelta(payload.delta.text);
    }
    if (payload.type === 'message_delta') {
      if (payload.delta?.stop_reason) finishReason = payload.delta.stop_reason;
      if (payload.usage) usage = { ...(usage || {}), ...payload.usage };
    }
  }
  return { usage, finishReason };
}

export async function streamPaperCompletion({
  provider,
  apiKey,
  baseUrl,
  model,
  system,
  messages,
  signal,
  onDelta,
}) {
  if (!apiKey) {
    const error = new Error('尚未配置 API Key');
    error.code = 'NO_API_KEY';
    error.status = 400;
    throw error;
  }
  if (!PROVIDER_IDS.includes(provider)) {
    const error = new Error('未知的模型服务商');
    error.status = 400;
    throw error;
  }

  const { response, effectiveModel, cleanup, abortedError } =
    await requestCompletion({
      provider,
      apiKey,
      baseUrl,
      model,
      system,
      messages,
      signal,
    });

  try {
    const result =
      provider === 'anthropic'
        ? await streamAnthropic({ response, onDelta })
        : await streamOpenAi({ response, onDelta });
    return { ...result, model: effectiveModel, provider };
  } catch (error) {
    if (error?.name === 'AbortError' || signal?.aborted) {
      throw abortedError();
    }
    if (error?.status) throw error;
    throw new Error(
      `读取模型响应时出错：${error instanceof Error ? error.message : '未知错误'}`,
    );
  } finally {
    cleanup();
  }
}
