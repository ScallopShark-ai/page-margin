import type { ModelConfig, ProviderId } from '../types';

export const STORAGE_KEY = 'pagemargin.model.v1';

export const PROVIDERS: Record<
  ProviderId,
  {
    label: string;
    short: string;
    baseUrl: string;
    model: string;
    hint: string;
    keyPlaceholder: string;
  }
> = {
  deepseek: {
    label: 'DeepSeek',
    short: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    hint: '国内访问稳定，中文论文解读表现好。',
    keyPlaceholder: 'sk-…',
  },
  openai: {
    label: 'OpenAI',
    short: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: '支持 GPT-4o / GPT-4.1 等 Chat Completions 模型。',
    keyPlaceholder: 'sk-…',
  },
  anthropic: {
    label: 'Anthropic',
    short: 'Claude',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-20250514',
    hint: '使用 Anthropic Messages API，适合长上下文精读。',
    keyPlaceholder: 'sk-ant-…',
  },
  custom: {
    label: '自定义 / 本地',
    short: '自定义',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
    hint: '任何 OpenAI 兼容接口，例如 Ollama、vLLM、One API。',
    keyPlaceholder: '本地服务可留空',
  },
};

export const DEFAULT_CONFIG: ModelConfig = {
  provider: 'deepseek',
  apiKey: '',
  baseUrl: PROVIDERS.deepseek.baseUrl,
  model: PROVIDERS.deepseek.model,
  remember: true,
};

export function loadConfig(): ModelConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<ModelConfig>;
    if (!parsed.provider || !(parsed.provider in PROVIDERS)) return DEFAULT_CONFIG;
    return {
      provider: parsed.provider,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : PROVIDERS[parsed.provider].baseUrl,
      model: typeof parsed.model === 'string' ? parsed.model : PROVIDERS[parsed.provider].model,
      remember: parsed.remember !== false,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function hasSavedConfig(): boolean {
  try {
    return Boolean(localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}

export function saveConfig(config: ModelConfig): void {
  const serialized = JSON.stringify({ ...config, remember: config.remember });
  try {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    if (config.remember) localStorage.setItem(STORAGE_KEY, serialized);
    else sessionStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // Browsers can disable storage; the in-memory config still works for this tab.
  }
}

export function isLocalEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function hasUsableModel(
  config: ModelConfig,
  server: { serverConfigured: boolean; provider: ProviderId } | null,
): boolean {
  if (config.apiKey.trim()) return true;
  if (
    config.provider === 'custom' &&
    isLocalEndpoint(config.baseUrl) &&
    Boolean(config.model.trim())
  ) {
    return true;
  }
  return Boolean(server?.serverConfigured && server.provider === config.provider);
}

export function modelLabel(config: ModelConfig, serverConfigured: boolean): string {
  if (config.provider === 'custom') return config.model || '自定义模型';
  if (!config.apiKey && serverConfigured) return `${PROVIDERS[config.provider].short} · 服务器`;
  return config.model || PROVIDERS[config.provider].model;
}
