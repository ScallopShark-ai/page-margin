const DEFAULTS = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
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

function openAiResponsesEndpoint(baseUrl) {
  let base = normalizeBase(baseUrl).replace(/\/chat\/completions$/i, '');
  if (!base) throw new Error('缺少 API Base URL');
  if (/\/responses$/i.test(base)) return base;
  if (!/\/v\d+$/i.test(base)) base = `${base}/v1`;
  return `${base}/responses`;
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

// ---------------------------------------------------------------------------
// 采样温度兼容层
//
// 旧模型（gpt-4o、deepseek-chat、claude 等）接受 0.3，输出更稳定；
// 新一代推理模型（GPT-5 / o 系列等）只允许服务端默认值 1，传 0.3 会被
// 400 直接拒绝，整次请求不生成任何内容。
//
// 处理顺序：
//   1. 按模型名选初始策略，命中已知的固定采样模型就直接发 1；
//   2. 若猜错（自建网关、新发布的模型），收到 400 且错误信息明确指向
//      temperature 时自动降级重试：0.3 → 1 → 完全不传该字段；
//   3. 把最终生效的策略缓存在进程内，同一模型后续请求不再先失败一次。
// ---------------------------------------------------------------------------

const DEFAULT_TEMPERATURE = 0.3;
const FIXED_TEMPERATURE = 1;

const TEMPERATURE_POLICIES = {
  custom: DEFAULT_TEMPERATURE,
  default: FIXED_TEMPERATURE,
  omit: undefined,
};

// 只接受默认采样温度的模型：GPT-5 / GPT-6、o 系列推理模型，以及 DeepSeek 推理模型。
const FIXED_TEMPERATURE_MODEL =
  /^(?:gpt-?(?:5|6)|o[1-9]|codex|deepseek-(?:reasoner|r[1-9]))(?:$|[-._/:])/i;

const temperaturePolicyCache = new Map();
const MAX_TEMPERATURE_CACHE = 100;

function temperatureCacheKey(provider, baseUrl, model) {
  return `${provider}|${normalizeBase(baseUrl)}|${model.toLowerCase()}`;
}

// 有些网关把模型名写成 `openai/gpt-5`、`models/gpt-5`，判断时只看最后一段。
function temperatureModelName(model) {
  const raw = String(model ?? '').trim();
  const slash = raw.lastIndexOf('/');
  return (slash === -1 ? raw : raw.slice(slash + 1)).toLowerCase();
}

function initialTemperaturePolicy(provider, model) {
  if (provider === 'anthropic') return 'custom';
  return FIXED_TEMPERATURE_MODEL.test(temperatureModelName(model))
    ? 'default'
    : 'custom';
}

// 降级顺序：先用初始策略，再退到默认值 1，最后连字段都不发。
function temperatureAttempts(policy) {
  if (policy === 'omit') return ['omit'];
  if (policy === 'default') return ['default', 'omit'];
  return ['custom', 'default', 'omit'];
}

function isTemperatureRejection(status, bodyText) {
  if (status !== 400 && status !== 422) return false;
  const text = String(bodyText ?? '').toLowerCase();
  if (!text.includes('temperature')) return false;
  return (
    text.includes('unsupported') ||
    text.includes('not support') ||
    text.includes('does not support') ||
    text.includes('only the default') ||
    text.includes('unrecognized') ||
    text.includes('unknown parameter') ||
    text.includes('invalid')
  );
}

function formatImageMessages(provider, messages) {
  return messages.map((message) => {
    if (!Array.isArray(message.images) || message.images.length === 0) {
      return { role: message.role, content: message.content };
    }
    const imageLinks = message.images
      .filter((image) => image?.url)
      .map(
        (image, index) =>
          `${index + 1}. ${image.name || '图片'}：${image.url}`,
      );
    const textWithLinks = `${message.content || '请分析这些图片。'}${
      imageLinks.length > 0
        ? `\n\n用户已把图片存入站点，可直接在 Markdown 笔记/报告中引用：\n${imageLinks.join('\n')}`
        : ''
    }`;
    if (provider === 'anthropic') {
      const parts = [{ type: 'text', text: textWithLinks }];
      for (const image of message.images) {
        const match = String(image.dataUrl ?? '').match(
          /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i,
        );
        if (!match) continue;
        parts.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: match[1],
            data: match[2].replace(/\s+/g, ''),
          },
        });
      }
      return { role: message.role, content: parts };
    }

    const parts = [
      {
        type: 'text',
        text: textWithLinks,
      },
      ...message.images.map((image) => ({
        type: 'image_url',
        image_url: { url: image.dataUrl },
      })),
    ];
    return { role: message.role, content: parts };
  });
}

function buildCompletionBody({ provider, model, system, messages, policy }) {
  const temperature = TEMPERATURE_POLICIES[policy];
  const providerMessages = formatImageMessages(provider, messages);
  const body =
    provider === 'anthropic'
      ? {
          model,
          max_tokens: 4096,
          system,
          messages: providerMessages,
          stream: true,
        }
      : {
          model,
          stream: true,
          messages: [
            { role: 'system', content: system },
            ...providerMessages,
          ],
        };
  if (temperature !== undefined) body.temperature = temperature;
  return body;
}

function toResponsesMessages(messages) {
  return messages.map((message) => {
    if (!Array.isArray(message.images) || message.images.length === 0) {
      return { role: message.role, content: message.content };
    }
    const content = [
      {
        type: 'input_text',
        text: message.content || '请分析这些图片。',
      },
      ...message.images.map((image) => ({
        type: 'input_image',
        image_url: image.dataUrl,
      })),
    ];
    return { role: message.role, content };
  });
}

function buildWebSearchBody({ model, system, messages }) {
  return {
    model,
    instructions: system,
    input: toResponsesMessages(messages),
    tools: [{ type: 'web_search' }],
    tool_choice: 'auto',
    stream: true,
    store: false,
  };
}

function rememberTemperaturePolicy(key, policy) {
  if (
    temperaturePolicyCache.size >= MAX_TEMPERATURE_CACHE &&
    !temperaturePolicyCache.has(key)
  ) {
    const oldest = temperaturePolicyCache.keys().next().value;
    if (oldest !== undefined) temperaturePolicyCache.delete(oldest);
  }
  temperaturePolicyCache.set(key, policy);
}

const RETRYABLE_MODEL_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function retryWaitMs(attempt) {
  return Math.min(8_000, 900 * 2 ** attempt) + Math.floor(Math.random() * 350);
}

function retryAfterMs(headers) {
  const raw = headers?.get?.('retry-after');
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(30_000, Math.max(1000, seconds * 1000));
  }
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return 0;
  return Math.min(30_000, Math.max(1000, at - Date.now()));
}

async function requestCompletion({
  provider,
  apiKey,
  baseUrl,
  model,
  system,
  messages,
  signal,
  webSearch = false,
}) {
  const defaults = providerDefaults(provider);
  const effectiveBase = baseUrl?.trim() || defaults.baseUrl;
  const effectiveModel = model?.trim() || defaults.model;
  if (!effectiveBase) throw new Error('请填写 API Base URL');
  if (!effectiveModel) throw new Error('请填写模型名称');
  if (webSearch && provider !== 'openai') {
    const error = new Error('联网搜索目前仅支持 OpenAI 模型');
    error.status = 400;
    throw error;
  }

  let url;
  let headers;
  if (provider === 'anthropic') {
    url = anthropicEndpoint(effectiveBase);
    headers = {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
  } else {
    url = webSearch
      ? openAiResponsesEndpoint(effectiveBase)
      : openAiEndpoint(effectiveBase);
    headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
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

  const cacheKey = temperatureCacheKey(provider, effectiveBase, effectiveModel);
  const policy =
    temperaturePolicyCache.get(cacheKey) ??
    initialTemperaturePolicy(provider, effectiveModel);
  const attempts = webSearch ? ['web-search'] : temperatureAttempts(policy);

  try {
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index];
      const body = webSearch
        ? buildWebSearchBody({
            model: effectiveModel,
            system,
            messages,
          })
        : buildCompletionBody({
            provider,
            model: effectiveModel,
            system,
            messages,
            policy: attempt,
          });

      let response = null;
      let networkError = null;
      for (let retry = 0; retry < 3; retry += 1) {
        try {
          response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } catch (error) {
          networkError = error;
          if (controller.signal.aborted) throw error;
          if (retry === 2) throw error;
          console.warn(
            `[providers] ${effectiveModel} 连接失败，第 ${retry + 1} 次重试：${error?.message ?? error}`,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, retryWaitMs(retry)),
          );
          continue;
        }

        if (response.ok) break;
        if (
          !RETRYABLE_MODEL_STATUSES.has(response.status) ||
          retry === 2
        ) {
          break;
        }
        await response.text().catch(() => '');
        const wait =
          retryAfterMs(response.headers) || retryWaitMs(retry);
        console.warn(
          `[providers] ${effectiveModel} 返回 HTTP ${response.status}，${Math.round(wait / 1000)} 秒后重试`,
        );
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      if (!response) {
        throw networkError ?? new Error('无法连接模型服务');
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        if (
          !webSearch &&
          index < attempts.length - 1 &&
          isTemperatureRejection(response.status, errorBody)
        ) {
          if (attempt === 'custom') {
            console.warn(
              `[providers] ${effectiveModel} 不接受 temperature=${DEFAULT_TEMPERATURE}，改用默认值 1 重试`,
            );
          }
          continue;
        }
        const error = new Error(friendlyUpstreamMessage(response.status, errorBody));
        error.status = 502;
        error.upstreamStatus = response.status;
        throw error;
      }

      if (!webSearch) rememberTemperaturePolicy(cacheKey, attempt);
      if (!response.body) {
        throw new Error('模型服务未返回内容流');
      }
      return { response, effectiveModel, cleanup, abortedError };
    }
    const error = new Error('模型服务拒绝了采样温度参数');
    error.status = 502;
    throw error;
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

function citationFromAnnotation(annotation) {
  if (!annotation || annotation.type !== 'url_citation') return null;
  const url = String(annotation.url ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  return {
    url,
    title: String(annotation.title ?? url).trim() || url,
  };
}

async function streamOpenAiResponses({ response, onDelta }) {
  let usage = null;
  let finishReason = '';
  const citations = [];
  const seen = new Set();
  const addCitation = (annotation) => {
    const citation = citationFromAnnotation(annotation);
    if (!citation || seen.has(citation.url)) return;
    seen.add(citation.url);
    citations.push(citation);
  };

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
    if (payload?.type === 'error' || payload?.type === 'response.failed') {
      throw new Error(
        payload.error?.message ||
          payload.response?.error?.message ||
          'OpenAI 联网搜索失败',
      );
    }
    if (payload?.type === 'response.output_text.delta') {
      if (typeof payload.delta === 'string' && payload.delta) {
        onDelta(payload.delta);
      }
      continue;
    }
    if (payload?.type === 'response.output_text.annotation.added') {
      addCitation(payload.annotation);
      continue;
    }
    if (payload?.type === 'response.completed') {
      const completed = payload.response;
      usage = completed?.usage || usage;
      finishReason = completed?.status || 'completed';
      for (const item of completed?.output || []) {
        for (const part of item.content || []) {
          for (const annotation of part.annotations || []) {
            addCitation(annotation);
          }
        }
      }
      continue;
    }
    if (payload?.type === 'response.incomplete') {
      finishReason = payload.response?.incomplete_details?.reason || 'incomplete';
    }
  }
  return { usage, finishReason, citations };
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
  webSearch = false,
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
      webSearch,
    });

  try {
    const result =
      webSearch
        ? await streamOpenAiResponses({ response, onDelta })
        : provider === 'anthropic'
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
