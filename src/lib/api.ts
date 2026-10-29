import type {
  ArcherResult,
  ChatMessage,
  ModelConfig,
  PaperMeta,
  PageText,
  ServerConfig,
  StreamMeta,
} from '../types';

async function errorFromResponse(response: Response): Promise<Error & { code?: string }> {
  let message = `请求失败（HTTP ${response.status}）`;
  let code: string | undefined;
  try {
    const data = (await response.json()) as { error?: string; code?: string };
    if (data?.error) message = data.error;
    if (data?.code) code = data.code;
  } catch {
    try {
      const text = await response.text();
      if (text.trim()) message = text.slice(0, 300);
    } catch {
      // ignore
    }
  }
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

export async function resolveArxiv(input: string, signal?: AbortSignal): Promise<ArcherResult> {
  const response = await fetch(`/api/arxiv/resolve?input=${encodeURIComponent(input)}`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw await errorFromResponse(response);
  return (await response.json()) as ArcherResult;
}

export async function fetchPdfBlob(url: string): Promise<Blob> {
  const response = await fetch(url, { headers: { Accept: 'application/pdf' } });
  if (!response.ok) throw new Error(`PDF 下载失败（HTTP ${response.status}）`);
  return response.blob();
}

export async function fetchServerConfig(): Promise<ServerConfig> {
  const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw await errorFromResponse(response);
  return (await response.json()) as ServerConfig;
}

export interface ChatStreamEvent {
  type: 'meta' | 'delta' | 'done' | 'error' | 'aborted';
  text?: string;
  message?: string;
  status?: number;
  meta?: StreamMeta;
  usage?: unknown;
}

export interface ChatRequest {
  paper: PaperMeta;
  pages: PageText[];
  messages: Pick<ChatMessage, 'role' | 'content'>[];
  config: ModelConfig;
  focusPage: number | null;
  signal?: AbortSignal;
  onEvent: (event: ChatStreamEvent) => void;
}

export async function streamPaperChat({
  paper,
  pages,
  messages,
  config,
  focusPage,
  signal,
  onEvent,
}: ChatRequest): Promise<void> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      paper: {
        ...paper,
        pages: pages.filter((page) => page.text.trim().length > 0),
      },
      messages,
      focusPage,
      config: {
        provider: config.provider,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
      },
    }),
  });

  if (!response.ok) throw await errorFromResponse(response);
  if (!response.body) throw new Error('浏览器无法读取响应流');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleBlock = (block: string) => {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''));
    if (dataLines.length === 0) return;
    const raw = dataLines.join('\n');
    if (!raw.trim()) return;
    let event: ChatStreamEvent;
    try {
      event = JSON.parse(raw) as ChatStreamEvent;
    } catch {
      return;
    }
    onEvent(event);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (block.trim()) handleBlock(block);
        boundary = buffer.indexOf('\n\n');
      }
    }
    if (buffer.trim()) handleBlock(buffer);
  } finally {
    reader.releaseLock();
  }
}

export interface TranslationStreamEvent {
  type: 'meta' | 'delta' | 'done' | 'error';
  text?: string;
  message?: string;
  targetLanguage?: 'zh' | 'en';
  model?: string;
}

export async function streamTranslation({
  text,
  context,
  paperTitle,
  config,
  signal,
  onEvent,
}: {
  text: string;
  context: string;
  paperTitle: string;
  config: ModelConfig;
  signal?: AbortSignal;
  onEvent: (event: TranslationStreamEvent) => void;
}): Promise<void> {
  const response = await fetch('/api/translate', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      text,
      context,
      paperTitle,
      config: {
        provider: config.provider,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
      },
    }),
  });
  if (!response.ok) throw await errorFromResponse(response);
  if (!response.body) throw new Error('浏览器无法读取翻译响应流');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleBlock = (block: string) => {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''));
    if (dataLines.length === 0) return;
    const raw = dataLines.join('\n');
    if (!raw.trim()) return;
    try {
      onEvent(JSON.parse(raw) as TranslationStreamEvent);
    } catch {
      // Ignore malformed keep-alive payloads.
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (block.trim()) handleBlock(block);
        boundary = buffer.indexOf('\n\n');
      }
    }
    if (buffer.trim()) handleBlock(buffer);
  } finally {
    reader.releaseLock();
  }
}
