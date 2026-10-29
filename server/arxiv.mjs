import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(here, '..', '.cache', 'arxiv');
const META_TTL_MS = 1000 * 60 * 60 * 6;
const metaCache = new Map();
const inFlightPdf = new Map();

const USER_AGENT =
  'PageMargin/1.1 (local paper reader; https://arxiv.org/help/api) Node.js';

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
  if (/^https?:\/\//i.test(raw)) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    const host = url.hostname.toLowerCase();
    if (host !== 'arxiv.org' && !host.endsWith('.arxiv.org')) return null;
    const match = url.pathname.match(/^\/(?:abs|pdf|format)\/(.+)$/i);
    if (!match) return null;
    try {
      candidate = decodeURIComponent(match[1]);
    } catch {
      candidate = match[1];
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

async function fetchText(url, timeoutMs = 16000) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/atom+xml, application/xml, text/xml, text/html;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const error = new Error(`arXiv request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
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

  const query = encodeURIComponent(info.baseId);
  const atomEndpoints = [
    `https://export.arxiv.org/api/query?id_list=${query}&max_results=1`,
    `https://arxiv.org/api/query?id_list=${query}&max_results=1`,
  ];
  let lastError;
  for (const endpoint of atomEndpoints) {
    try {
      const xml = await fetchText(endpoint);
      const meta = parseAtom(xml, info);
      metaCache.set(info.baseId, { at: Date.now(), meta });
      return meta;
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }

  const absUrls = [
    `https://arxiv.org/abs/${info.id}`,
    `https://export.arxiv.org/abs/${info.id}`,
  ];
  for (const url of absUrls) {
    try {
      const html = await fetchText(url);
      const meta = parseAbsHtml(html, info);
      metaCache.set(info.baseId, { at: Date.now(), meta });
      return meta;
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
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
  for (const url of pdfUrlCandidates(info)) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/pdf,application/octet-stream;q=0.8,*/*;q=0.5',
          Referer: `https://arxiv.org/abs/${info.baseId}`,
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(75000),
      });
      if (!response.ok) {
        const error = new Error(`arXiv PDF download failed (${response.status})`);
        error.status = response.status;
        throw error;
      }
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
      await sleep(350);
    }
  }

  const error = new Error(
    'arXiv PDF 下载失败：元数据服务或 PDF 地址暂时不可达，可能触发了访问限制。请稍后重试，或先下载 PDF 拖入。',
  );
  error.status = 502;
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

export async function readCachedPdf(info) {
  try {
    return await readFile(path.join(CACHE_DIR, cacheFilename(info)));
  } catch {
    return null;
  }
}

export const arxivCacheDir = CACHE_DIR;
