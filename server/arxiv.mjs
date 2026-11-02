import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(here, '..', '.cache', 'arxiv');
const META_TTL_MS = 1000 * 60 * 60 * 6;
const metaCache = new Map();
const inFlightPdf = new Map();

const USER_AGENT =
  'Haila/1.1 (local paper reader; https://arxiv.org/help/api) Node.js';

const MODERN_ID = /^\d{4}\.\d{4,5}(?:v\d+)?$/i;
const LEGACY_ID = /^[a-z][a-z\-]*(?:\.[a-z]{2})?\/\d{7}(?:v\d+)?$/i;

function cleanArxivId(value) {
  let id = String(value ?? '').trim();
  id = id.replace(/^arxiv:\s*/i, '');
  id = id.replace(/[?#].*$/, '');
  // Strip URL punctuation before testing the .pdf suffix, so copies such as
  // "2401.12345v1.pdf/" and "2401.12345v1/" work too.
  id = id.replace(/\/+$/, '');
  id = id.replace(/\.pdf$/i, '');
  id = id.replace(/\/+$/, '');
  try {
    id = decodeURIComponent(id);
  } catch {
    // Keep the original if the URL had a malformed escape sequence.
  }
  return id.trim();
}

function stripWrappingCharacters(value) {
  return value
    .trim()
    .replace(/^[\s"'“”‘’<>()【】]+/, '')
    .replace(/[\s"'“”‘’<>()【】]+$/, '');
}

export function normalizeArxivInput(input) {
  let raw = stripWrappingCharacters(String(input ?? ''));
  if (!raw) return null;

  // Users often copy a link out of a citation or Markdown. Pull out the first
  // complete arXiv URL before trying to parse the input as a bare identifier.
  const embeddedUrl = raw.match(
    /https?:\/\/(?:[a-z0-9-]+\.)*arxiv\.org\/(?:abs|pdf|format)\/[^\s<>"'）)】]+/i,
  );
  if (embeddedUrl) raw = embeddedUrl[0];
  if (/^(?:[a-z0-9-]+\.)*arxiv\.org\/(?:abs|pdf|format)\//i.test(raw)) {
    raw = `https://${raw}`;
  }
  if (/^\/\/(?:[a-z0-9-]+\.)*arxiv\.org\//i.test(raw)) {
    raw = `https:${raw}`;
  }

  let candidate = raw;
  let kind = 'id';
  if (/^https?:\/\//i.test(raw)) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    const host = url.hostname.toLowerCase();
    if (host !== 'arxiv.org' && !host.endsWith('.arxiv.org')) return null;
    const match = url.pathname.match(/^\/(abs|pdf|format)\/(.+)$/i);
    if (!match) return null;
    kind = match[1].toLowerCase();
    try {
      candidate = decodeURIComponent(match[2]);
    } catch {
      candidate = match[2];
    }
  } else if (/arxiv\.org/i.test(raw)) {
    return null;
  }

  // Handle "1706.03762v7.pdf" and URL-encoded legacy ids such as "hep-th/9901001".
  candidate = cleanArxivId(candidate).replace(/[.,;!?，。；！？]+$/, '');
  if (candidate.includes('/')) {
    if (!LEGACY_ID.test(candidate)) return null;
  } else if (!MODERN_ID.test(candidate)) {
    return null;
  }

  const versionMatch = candidate.match(/(v\d+)$/i);
  const version = versionMatch ? versionMatch[1].toLowerCase() : '';
  const baseId = versionMatch ? candidate.slice(0, -version.length) : candidate;
  return {
    id: `${baseId}${version}`,
    baseId,
    version,
    kind,
  };
}

function decodeXmlEntities(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function xmlTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? decodeXmlEntities(match[1]).replace(/\s+/g, ' ').trim() : '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RETRYABLE_STATUSES = new Set([403, 408, 425, 429, 500, 502, 503, 504]);
const ARXIV_API_INTERVAL_MS = 3000;
const ARXIV_WEB_INTERVAL_MS = 1200;

// arXiv explicitly asks automated clients to space out API requests. A single
// FIFO gate also prevents a batch import from firing several metadata/PDF
// requests at once and immediately getting rate-limited.
let arxivQueue = Promise.resolve();
let lastArxivRequestAt = 0;

function arxivIntervalMs(url) {
  return /\/api\/query/i.test(url) ? ARXIV_API_INTERVAL_MS : ARXIV_WEB_INTERVAL_MS;
}

function jitter(max = 450) {
  return Math.floor(Math.random() * max);
}

function retryAfterMs(headers) {
  const raw = headers?.get?.('retry-after');
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(60_000, Math.max(1000, seconds * 1000));
  }
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return 0;
  return Math.min(60_000, Math.max(1000, at - Date.now()));
}

function backoffMs(attempt, base = 1600, max = 15_000) {
  return Math.min(max, base * 2 ** attempt) + jitter();
}

async function scheduledArxivFetch(url, init) {
  let release;
  const previous = arxivQueue;
  arxivQueue = new Promise((resolve) => {
    release = resolve;
  });
  await previous.catch(() => undefined);
  try {
    const wait = Math.max(
      0,
      lastArxivRequestAt + arxivIntervalMs(url) - Date.now(),
    );
    if (wait > 0) await sleep(wait);
    lastArxivRequestAt = Date.now();
    return await fetch(url, init);
  } finally {
    release();
  }
}

async function fetchWithRetry(
  url,
  init,
  { attempts = 4, timeoutMs = 16_000, label = 'arXiv' } = {},
) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response;
    try {
      response = await scheduledArxivFetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
      await sleep(backoffMs(attempt));
      continue;
    }

    if (response.ok) return response;

    const retryable = RETRYABLE_STATUSES.has(response.status);
    if (!retryable || attempt === attempts - 1) {
      const error = new Error(`${label} 暂时不可用（HTTP ${response.status}）`);
      error.status = response.status;
      error.retryAfterMs = retryAfterMs(response.headers);
      error.attempts = attempt + 1;
      throw error;
    }

    const wait = retryAfterMs(response.headers) || backoffMs(attempt);
    await response.body?.cancel().catch(() => undefined);
    await sleep(wait);
  }

  const detail = lastError instanceof Error ? lastError.message : '网络连接失败';
  const error = new Error(`${label} 连接失败：${detail}`);
  error.status = 502;
  error.attempts = attempts;
  error.cause = lastError;
  throw error;
}

async function fetchText(url, timeoutMs = 16_000) {
  const response = await fetchWithRetry(
    url,
    {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/atom+xml, application/xml, text/xml, text/html;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    },
    { attempts: 4, timeoutMs, label: 'arXiv' },
  );
  return response.text();
}

function parseAtom(xml, info) {
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/i)?.[1];
  if (!entry) throw new Error('arXiv did not return a paper entry');
  const rawTitle = xmlTag(entry, 'title');
  if (/Error/i.test(rawTitle) && !rawTitle.includes(' ')) {
    throw new Error(`arXiv metadata error: ${rawTitle}`);
  }

  const authors = [];
  for (const match of entry.matchAll(/<author>([\s\S]*?)<\/author>/gi)) {
    const name = xmlTag(match[1], 'name');
    if (name && !authors.includes(name)) authors.push(name);
  }

  const primary =
    entry.match(/<arxiv:primary_category[^>]*term=["']([^"']+)["']/i)?.[1] ??
    entry.match(/<category[^>]*term=["']([^"']+)["']/i)?.[1] ??
    '';

  const published =
    xmlTag(entry, 'published') || xmlTag(entry, 'updated') || '';
  return {
    source: 'arxiv',
    arxivId: info.id,
    title: rawTitle || `arXiv ${info.baseId}`,
    authors,
    abstract: xmlTag(entry, 'summary'),
    published,
    year: published ? published.slice(0, 4) : '',
    category: primary,
    absUrl: `https://arxiv.org/abs/${info.id}`,
    pdfUrl: `/api/arxiv/pdf?id=${encodeURIComponent(info.id)}`,
    chars: 0,
    pages: 0,
  };
}

function stripHtml(value) {
  return decodeXmlEntities(
    String(value ?? '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMetaTags(html) {
  const tags = new Map();
  const authors = [];
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const attr = (name) => {
      const value = tag.match(
        new RegExp(`${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'),
      )?.[2];
      return value ? decodeXmlEntities(value).trim() : '';
    };
    const key = (attr('name') || attr('property')).toLowerCase();
    const content = attr('content');
    if (!key || !content) continue;
    if (key === 'citation_author') {
      if (!authors.includes(content)) authors.push(content);
    } else if (!tags.has(key)) {
      tags.set(key, content);
    }
  }
  return { tags, authors };
}

function parseAbsHtml(html, info) {
  const { tags, authors } = parseMetaTags(html);
  const title = tags.get('citation_title') || '';
  if (!title) throw new Error('arXiv abs page did not contain metadata');

  let abstract = tags.get('citation_abstract') || tags.get('description') || '';
  if (!abstract) {
    const block =
      html.match(
        /<blockquote[^>]*class=["'][^"']*abstract[^"']*["'][^>]*>([\s\S]*?)<\/blockquote>/i,
      )?.[1] ?? '';
    abstract = stripHtml(block).replace(/^abstract:\s*/i, '');
  }

  const category =
    html.match(
      /<span[^>]*class=["'][^"']*primary-subject[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    )?.[1] ??
    html.match(
      /<td[^>]*class=["'][^"']*subjects[^"']*["'][^>]*>([\s\S]*?)<\/td>/i,
    )?.[1] ??
    '';
  const date = tags.get('citation_date') || tags.get('citation_online_date') || '';
  const published = date
    ? date.replace(/^(\d{4})\/(\d{2})\/(\d{2})$/, '$1-$2-$3')
    : '';

  return {
    source: 'arxiv',
    arxivId: info.id,
    title,
    authors,
    abstract,
    published,
    year: published.slice(0, 4),
    category: stripHtml(category).split(/[;,]/)[0].trim(),
    absUrl: `https://arxiv.org/abs/${info.id}`,
    pdfUrl: `/api/arxiv/pdf?id=${encodeURIComponent(info.id)}`,
    chars: 0,
    pages: 0,
  };
}

function fallbackMeta(info) {
  return {
    source: 'arxiv',
    arxivId: info.id,
    title: `arXiv ${info.baseId}`,
    authors: [],
    abstract: '',
    published: '',
    year: '',
    category: '',
    absUrl: `https://arxiv.org/abs/${info.id}`,
    pdfUrl: `/api/arxiv/pdf?id=${encodeURIComponent(info.id)}`,
    chars: 0,
    pages: 0,
    metadataUnavailable: true,
    warning:
      'arXiv 元数据服务暂时不可用，已直接尝试载入 PDF；论文标题和作者将从 PDF 中补全。',
  };
}

export async function resolveArxiv(input) {
  const info = normalizeArxivInput(input);
  if (!info) {
    const error = new Error(
      '没有识别出有效的 arXiv 链接或论文编号。支持 /abs/ 与 /pdf/ 链接。',
    );
    error.status = 400;
    throw error;
  }

  const cached = metaCache.get(info.baseId);
  if (cached && Date.now() - cached.at < META_TTL_MS) {
    return {
      ...cached.meta,
      arxivId: info.id,
      pdfUrl: `/api/arxiv/pdf?id=${encodeURIComponent(info.id)}`,
    };
  }

  const absUrls = [
    `https://arxiv.org/abs/${info.id}`,
    `https://export.arxiv.org/abs/${info.id}`,
  ];
  const metadataDeadline = Date.now() + 60_000;
  let lastError;

  async function tryAbsPages() {
    for (const url of absUrls) {
      if (Date.now() >= metadataDeadline) break;
      try {
        const html = await fetchText(url);
        const meta = parseAbsHtml(html, info);
        metaCache.set(info.baseId, { at: Date.now(), meta });
        return meta;
      } catch (error) {
        lastError = error;
      }
    }
    return null;
  }

  // A pasted /abs/ link should try the page the user gave us before spending
  // an API quota slot. The API remains the fallback because it is structured
  // and usually more reliable when the HTML page is protected.
  if (info.kind === 'abs' || info.kind === 'format') {
    const fromAbs = await tryAbsPages();
    if (fromAbs) return fromAbs;
  }

  const query = encodeURIComponent(info.baseId);
  const atomEndpoints = [
    `https://export.arxiv.org/api/query?id_list=${query}&max_results=1`,
    `https://arxiv.org/api/query?id_list=${query}&max_results=1`,
  ];
  for (const endpoint of atomEndpoints) {
    if (Date.now() >= metadataDeadline) break;
    try {
      const xml = await fetchText(endpoint);
      const meta = parseAtom(xml, info);
      metaCache.set(info.baseId, { at: Date.now(), meta });
      return meta;
    } catch (error) {
      lastError = error;
    }
  }

  if (info.kind !== 'abs' && info.kind !== 'format') {
    const fromAbs = await tryAbsPages();
    if (fromAbs) return fromAbs;
  }

  // Keep an expired metadata entry as a last resort. This is much better than
  // discarding the title/abstract just because arXiv is temporarily limiting us.
  if (cached) {
    return {
      ...cached.meta,
      arxivId: info.id,
      pdfUrl: `/api/arxiv/pdf?id=${encodeURIComponent(info.id)}`,
      metadataStale: true,
      warning:
        'arXiv 元数据服务暂时不可用，正在使用上次缓存的论文信息；PDF 下载会自动重试。',
    };
  }

  console.warn(
    `[arxiv] metadata unavailable for ${info.id}; attempting PDF download:`,
    lastError instanceof Error ? lastError.message : lastError,
  );
  return fallbackMeta(info);
}

function cacheFilename(info) {
  return `${info.id.replace(/[^a-z0-9.\-_]+/gi, '_')}.pdf`;
}

function looksLikePdf(bytes) {
  const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 1024));
  return head.includes(Buffer.from('%PDF'));
}

function pdfUrlCandidates(info) {
  const encodedId = encodeURIComponent(info.id).replace(/%2F/gi, '/');
  const encodedBase = encodeURIComponent(info.baseId).replace(/%2F/gi, '/');
  const urls = [`https://arxiv.org/pdf/${encodedId}`];
  if (info.version) urls.push(`https://arxiv.org/pdf/${encodedBase}`);
  urls.push(`https://export.arxiv.org/pdf/${encodedId}`);
  if (info.version) urls.push(`https://export.arxiv.org/pdf/${encodedBase}`);
  return [...new Set(urls)];
}

async function downloadPdf(info) {
  await mkdir(CACHE_DIR, { recursive: true });
  const finalPath = path.join(CACHE_DIR, cacheFilename(info));
  try {
    const cached = await readFile(finalPath);
    if (cached.length > 1000 && looksLikePdf(cached)) return finalPath;
  } catch {
    // not cached yet
  }

  let lastError;
  const deadline = Date.now() + 120_000;
  for (const url of pdfUrlCandidates(info)) {
    if (Date.now() >= deadline) break;
    try {
      const response = await fetchWithRetry(
        url,
        {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/pdf,application/octet-stream;q=0.8,*/*;q=0.5',
            Referer: `https://arxiv.org/abs/${info.baseId}`,
          },
          redirect: 'follow',
        },
        { attempts: 2, timeoutMs: 50_000, label: 'arXiv PDF' },
      );
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 1000) throw new Error('arXiv returned an empty PDF');
      if (!looksLikePdf(buffer)) {
        throw new Error('arXiv returned a non-PDF response');
      }

      const tempPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tempPath, buffer);
      await rename(tempPath, finalPath);
      return finalPath;
    } catch (error) {
      lastError = error;
    }
  }

  const limited =
    lastError?.status === 429 ||
    lastError?.status === 403 ||
    /HTTP 429|HTTP 403/i.test(String(lastError?.message ?? ''));
  const error = new Error(
    limited
      ? 'arXiv 当前限制了访问频率；已自动退避重试仍未成功。请等待 1–5 分钟后重试，或先手动下载 PDF 拖入。'
      : 'arXiv PDF 下载失败：网络或 PDF 地址暂时不可达；已自动重试。请稍后重试，或先下载 PDF 拖入。',
  );
  error.status = 502;
  error.code = limited ? 'ARXIV_RATE_LIMITED' : 'ARXIV_UNAVAILABLE';
  error.cause = lastError;
  throw error;
}

export async function getArxivPdf(input) {
  const info = normalizeArxivInput(input);
  if (!info) {
    const error = new Error('无效的 arXiv 编号');
    error.status = 400;
    throw error;
  }

  if (inFlightPdf.has(info.id)) return inFlightPdf.get(info.id);
  const task = downloadPdf(info).finally(() => {
    inFlightPdf.delete(info.id);
  });
  inFlightPdf.set(info.id, task);
  return task;
}

export async function purgeArxivPdf(input) {
  const info = normalizeArxivInput(input);
  if (!info) return false;
  inFlightPdf.delete(info.id);
  metaCache.delete(info.baseId);
  await rm(path.join(CACHE_DIR, cacheFilename(info)), { force: true });
  return true;
}

export async function readCachedPdf(info) {
  try {
    return await readFile(path.join(CACHE_DIR, cacheFilename(info)));
  } catch {
    return null;
  }
}

export const arxivCacheDir = CACHE_DIR;
