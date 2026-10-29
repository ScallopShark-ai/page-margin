export type Pdf2zhEngine = 'pdf2zh' | 'pdf2zh_next';

export interface Pdf2zhConfig {
  baseUrl: string;
  engine: Pdf2zhEngine;
  service: string;
}

export interface Pdf2zhTask {
  taskId?: string;
  active?: boolean;
  finished?: boolean;
  progress?: number;
  status?: string;
  message?: string;
  error?: string;
  fileList?: string[];
  [key: string]: unknown;
}

export interface Pdf2zhSubmitResult {
  taskId: string | null;
  fileList: string[];
}

export const PDF2ZH_STORAGE_KEY = 'pagemargin.pdf2zh.v1';

export const DEFAULT_PDF2ZH_CONFIG: Pdf2zhConfig = {
  baseUrl: 'http://127.0.0.1:8890',
  engine: 'pdf2zh_next',
  service: 'siliconflowfree',
};

export function loadPdf2zhConfig(): Pdf2zhConfig {
  try {
    const raw = localStorage.getItem(PDF2ZH_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PDF2ZH_CONFIG };
    const parsed = JSON.parse(raw) as Partial<Pdf2zhConfig>;
    const engine =
      parsed.engine === 'pdf2zh' || parsed.engine === 'pdf2zh_next'
        ? parsed.engine
        : DEFAULT_PDF2ZH_CONFIG.engine;
    return {
      baseUrl:
        typeof parsed.baseUrl === 'string'
          ? parsed.baseUrl.trim()
          : DEFAULT_PDF2ZH_CONFIG.baseUrl,
      engine,
      service:
        typeof parsed.service === 'string' && parsed.service.trim()
          ? parsed.service.trim()
          : DEFAULT_PDF2ZH_CONFIG.service,
    };
  } catch {
    return { ...DEFAULT_PDF2ZH_CONFIG };
  }
}

export function savePdf2zhConfig(config: Pdf2zhConfig): void {
  try {
    localStorage.setItem(PDF2ZH_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // The in-memory setting still works for this tab.
  }
}

export function normalizePdf2zhConfig(config: Pdf2zhConfig): Pdf2zhConfig | null {
  const baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const engine: Pdf2zhEngine =
    config.engine === 'pdf2zh' ? 'pdf2zh' : 'pdf2zh_next';
  return {
    baseUrl,
    engine,
    service:
      config.service.trim() ||
      (engine === 'pdf2zh' ? 'bing' : 'siliconflowfree'),
  };
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string; message?: string };
    return payload.error || payload.message || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export function pickPdf2zhMonoFile(fileList: string[]): string | null {
  if (fileList.length === 0) return null;
  const mono = fileList.find((name) => /mono/i.test(name) && !/dual|compare/i.test(name));
  if (mono) return mono;
  return (
    fileList.find((name) => !/dual|compare|origin/i.test(name)) ??
    fileList[0] ??
    null
  );
}

export async function submitPdf2zh(
  pdf: Blob,
  fileName: string,
  config: Pdf2zhConfig,
  signal?: AbortSignal,
): Promise<Pdf2zhSubmitResult> {
  const params = new URLSearchParams({
    base: config.baseUrl,
    name: fileName,
    engine: config.engine,
    service: config.service,
  });
  const response = await fetch(`/api/pdf2zh/translate?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: pdf,
    signal,
  });
  if (!response.ok) throw new Error(await readError(response));
  const payload = (await response.json()) as {
    taskId?: string;
    fileList?: string[];
  };
  return {
    taskId: payload.taskId ?? null,
    fileList: Array.isArray(payload.fileList) ? payload.fileList : [],
  };
}

export async function fetchPdf2zhTask(
  config: Pdf2zhConfig,
  taskId: string,
  signal?: AbortSignal,
): Promise<Pdf2zhTask | null> {
  const params = new URLSearchParams({
    base: config.baseUrl,
    id: taskId,
  });
  const response = await fetch(`/api/pdf2zh/task?${params.toString()}`, {
    cache: 'no-store',
    signal,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await readError(response));
  const payload = (await response.json()) as { task?: Pdf2zhTask };
  return payload.task ?? null;
}

export async function waitForPdf2zhResult(
  config: Pdf2zhConfig,
  taskId: string,
  options: {
    signal?: AbortSignal;
    onProgress?: (percent: number, message: string) => void;
    timeoutMs?: number;
  } = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;
  let missingSince: number | null = null;

  while (Date.now() < deadline) {
    if (options.signal?.aborted) throw new DOMException('翻译已取消', 'AbortError');
    const task = await fetchPdf2zhTask(config, taskId, options.signal);
    if (!task) {
      missingSince ??= Date.now();
      if (Date.now() - missingSince > 60_000) {
        throw new Error('翻译任务已丢失，请重新发起翻译');
      }
    } else {
      missingSince = null;
      const status = String(task.status ?? '');
      const failed =
        status === '失败' ||
        status === 'failed' ||
        task.active === false &&
          task.finished === true &&
          status !== '完成' &&
          status !== 'success' &&
          !Array.isArray(task.fileList);
      if (failed) {
        throw new Error(String(task.error || task.message || 'PDF 翻译失败'));
      }
      const progress = Number(task.progress);
      if (Number.isFinite(progress)) {
        options.onProgress?.(
          Math.max(1, Math.min(96, Math.round(progress))),
          String(task.message || '正在翻译 PDF…'),
        );
      }
      const files = Array.isArray(task.fileList)
        ? task.fileList.filter((item): item is string => typeof item === 'string')
        : [];
      const done =
        task.finished === true ||
        task.active === false ||
        status === '完成' ||
        status === 'success';
      if (done && files.length > 0) {
        const mono = pickPdf2zhMonoFile(files);
        if (mono) return mono;
        throw new Error('翻译完成，但没有找到中文单语 PDF');
      }
      if (done && files.length === 0) {
        throw new Error(String(task.error || task.message || '翻译完成，但没有生成 PDF'));
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1800));
  }
  throw new Error('PDF 翻译超时，请稍后重试');
}

export async function fetchPdf2zhFile(
  config: Pdf2zhConfig,
  fileName: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const params = new URLSearchParams({
    base: config.baseUrl,
    name: fileName,
  });
  const response = await fetch(`/api/pdf2zh/file?${params.toString()}`, {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(await readError(response));
  const blob = await response.blob();
  if (blob.size < 5 || blob.type.toLowerCase().includes('json')) {
    throw new Error('翻译服务返回的不是有效 PDF');
  }
  return blob;
}
