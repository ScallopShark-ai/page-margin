import express from 'express';

const MAX_PDF_BYTES = 80 * 1024 * 1024;
const SERVICE_TIMEOUT_MS = 45_000;

function pdf2zhError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    throw pdf2zhError('PDF 翻译服务地址无效');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw pdf2zhError('PDF 翻译服务只支持 http/https 地址');
  }
  if (url.username || url.password) {
    throw pdf2zhError('PDF 翻译服务地址不能包含用户名或密码');
  }
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

function safeFileName(value) {
  const name = String(value ?? '').trim();
  if (
    !name ||
    name.length > 180 ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    !name.toLowerCase().endsWith('.pdf')
  ) {
    throw pdf2zhError('无效的 PDF 文件名');
  }
  return name;
}

function serviceUrl(baseUrl, path) {
  return `${normalizeBaseUrl(baseUrl)}${path}`;
}

async function readPayload(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { status: 'error', message: text.slice(0, 500) };
  }
}

function serviceFailure(payload, status) {
  const message =
    payload && typeof payload === 'object' && typeof payload.message === 'string'
      ? payload.message
      : `PDF 翻译服务返回 HTTP ${status}`;
  return pdf2zhError(message, 502);
}

async function requestService(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    });
  } catch (error) {
    const detail =
      error?.name === 'TimeoutError'
        ? '连接超时'
        : error instanceof Error
          ? error.message
          : '连接失败';
    throw pdf2zhError(
      `无法连接 PDF 翻译服务：${detail}。请确认服务已启动，并检查设置中的地址。`,
      502,
    );
  }
  const payload = await readPayload(response);
  if (!response.ok) throw serviceFailure(payload, response.status);
  return { response, payload };
}

function parseClientLlmConfig(req) {
  const raw = req.get('X-PDF2zh-Config');
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    throw pdf2zhError('PDF 翻译 API 配置无法解析');
  }
  const apiUrl = String(parsed?.apiUrl ?? '').trim().replace(/\/+$/, '');
  const apiKey = String(parsed?.apiKey ?? '').trim();
  const model = String(parsed?.model ?? '').trim();
  if (!apiUrl || !apiKey || !model) {
    throw pdf2zhError('首次使用需要配置 DeepSeek API Key、Base URL 和模型');
  }
  let url;
  try {
    url = new URL(apiUrl);
  } catch {
    throw pdf2zhError('DeepSeek API Base URL 无效');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw pdf2zhError('DeepSeek API Base URL 只支持 http/https');
  }
  return {
    apiKey,
    apiUrl,
    model,
    extraData: {},
  };
}

function findTask(tasks, taskId) {
  if (!Array.isArray(tasks)) return null;
  return (
    tasks.find(
      (task) =>
        task &&
        typeof task === 'object' &&
        (task.taskId === taskId || task.id === taskId),
    ) ?? null
  );
}

export function createPdf2zhRouter() {
  const router = express.Router();

  router.post(
    '/translate',
    express.raw({
      type: ['application/pdf', 'application/octet-stream'],
      limit: MAX_PDF_BYTES,
    }),
    async (req, res, next) => {
      try {
        const baseUrl = normalizeBaseUrl(req.query.base);
        const fileName = safeFileName(req.query.name);
        const engine =
          String(req.query.engine ?? '') === 'pdf2zh' ? 'pdf2zh' : 'pdf2zh_next';
        const service = String(req.query.service ?? '').trim().slice(0, 80);
        const pdf = Buffer.isBuffer(req.body) ? req.body : null;
        if (!pdf || pdf.length === 0) {
          throw pdf2zhError('没有收到 PDF 文件');
        }
        if (pdf.length > MAX_PDF_BYTES) {
          throw pdf2zhError('PDF 文件超过 80 MB');
        }
        if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
          throw pdf2zhError('上传内容不是有效的 PDF');
        }

        const llmApi = parseClientLlmConfig(req);
        const config = {
          fileName,
          fileContent: pdf.toString('base64'),
          engine,
          service,
          ...(llmApi ? { llm_api: llmApi } : {}),
          next_service: service,
          sourceLang: 'en',
          targetLang: 'zh-CN',
          mono: true,
          dual: false,
          mono_cut: false,
          dual_cut: false,
          compare: false,
          crop_compare: false,
          noMono: false,
          noDual: true,
          noWatermark: true,
          threadNum: 4,
          qps: 10,
          asyncJob: true,
        };

        const { payload } = await requestService(
          serviceUrl(baseUrl, '/translate'),
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-PDF2zh-Protocol': 'accepted',
            },
            body: JSON.stringify(config),
          },
        );
        if (payload.status !== 'accepted' && payload.status !== 'success') {
          throw serviceFailure(payload, 200);
        }
        res.json({
          status: payload.status,
          taskId: payload.taskId,
          fileList: Array.isArray(payload.fileList) ? payload.fileList : undefined,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get('/task', async (req, res, next) => {
    try {
      const baseUrl = normalizeBaseUrl(req.query.base);
      const taskId = String(req.query.id ?? '').trim();
      if (!taskId) throw pdf2zhError('缺少翻译任务 ID');

      const [activeResult, historyResult] = await Promise.all([
        requestService(serviceUrl(baseUrl, '/api/tasks')).catch((error) => ({
          error,
        })),
        requestService(serviceUrl(baseUrl, '/api/history')).catch((error) => ({
          error,
        })),
      ]);
      if (activeResult.error && historyResult.error) {
        throw activeResult.error;
      }
      const task =
        findTask(activeResult.payload?.tasks, taskId) ??
        findTask(historyResult.payload?.history, taskId);
      if (!task) {
        res.status(404).json({ status: 'not_found' });
        return;
      }
      res.json({ status: 'ok', task });
    } catch (error) {
      next(error);
    }
  });

  router.get('/file', async (req, res, next) => {
    try {
      const baseUrl = normalizeBaseUrl(req.query.base);
      const fileName = String(req.query.name ?? '').trim();
      if (
        !fileName ||
        fileName === '.' ||
        fileName === '..' ||
        fileName.includes('/') ||
        fileName.includes('\\') ||
        !fileName.toLowerCase().endsWith('.pdf')
      ) {
        throw pdf2zhError('无效的翻译结果文件名');
      }
      const url = serviceUrl(
        baseUrl,
        `/translatedFile/${encodeURIComponent(fileName)}`,
      );
      const response = await fetch(url, {
        signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
      });
      if (!response.ok) {
        const payload = await readPayload(response);
        throw serviceFailure(payload, response.status);
      }
      const blob = Buffer.from(await response.arrayBuffer());
      if (!blob.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        throw pdf2zhError('翻译服务返回的不是有效 PDF', 502);
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(blob);
    } catch (error) {
      next(error);
    }
  });

  router.get('/health', async (req, res, next) => {
    try {
      const baseUrl = normalizeBaseUrl(req.query.base);
      const { response, payload } = await requestService(
        serviceUrl(baseUrl, '/health'),
      );
      res.json({ ok: true, status: response.status, service: payload });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
