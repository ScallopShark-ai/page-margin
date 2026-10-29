import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_PDF_BYTES = 80 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const USER_AGENT =
  'Haila/1.1 (local paper reader; PDF import) Node.js';

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function isPrivateIpv6(address) {
  const value = address.toLowerCase();
  if (value === '::' || value === '::1') return true;
  if (value.startsWith('fc') || value.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(value)) return true;
  if (value.startsWith('ff')) return true;
  if (value.startsWith('2001:db8')) return true;
  if (value.startsWith('::ffff:')) {
    return isPrivateIpv4(value.slice(value.lastIndexOf(':') + 1));
  }
  return false;
}

function isPrivateAddress(address) {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
}

function validateUrlShape(raw) {
  let url;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    throw httpError('PDF 链接格式不正确');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw httpError('只支持 http 或 https PDF 链接');
  }
  if (url.username || url.password) {
    throw httpError('暂不支持带用户名密码的 PDF 链接');
  }
  if (!url.hostname) throw httpError('PDF 链接缺少域名');
  return url;
}

async function assertPublicUrl(raw) {
  const url = validateUrlShape(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw httpError('出于安全原因，不能从本机或内网地址导入 PDF');
  }

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw httpError('出于安全原因，不能从本机或内网地址导入 PDF');
    }
    return url;
  }

  let records;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw httpError('无法解析这个 PDF 链接的域名', 502);
  }
  if (!records.length) throw httpError('无法解析这个 PDF 链接的域名', 502);
  if (records.some((record) => isPrivateAddress(record.address))) {
    throw httpError('出于安全原因，不能从本机或内网地址导入 PDF');
  }
  return url;
}

function safeFilename(value) {
  return String(value ?? '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function filenameFromResponse(response, url) {
  const header = response.headers.get('content-disposition') || '';
  const encoded = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      const name = safeFilename(decodeURIComponent(encoded));
      if (name) return name;
    } catch {
      // Ignore malformed filename* values.
    }
  }
  const plain = header.match(/filename\s*=\s*["']?([^;"']+)/i)?.[1];
  if (plain) {
    const name = safeFilename(plain);
    if (name) return name;
  }
  const pathname = decodeURIComponent(url.pathname || '');
  const base = safeFilename(pathname.split('/').filter(Boolean).pop() || '');
  if (base) return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
  return 'document.pdf';
}

async function readBodyWithLimit(response) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_PDF_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw httpError('PDF 文件超过 80 MB，无法导入', 413);
  }
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_PDF_BYTES) {
      throw httpError('PDF 文件超过 80 MB，无法导入', 413);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PDF_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw httpError('PDF 文件超过 80 MB，无法导入', 413);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function looksLikePdf(buffer) {
  return buffer.subarray(0, 1024).includes(Buffer.from('%PDF'));
}

export async function fetchPdfFromUrl(rawUrl, { signal } = {}) {
  let url = validateUrlShape(rawUrl);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    url = await assertPublicUrl(url);
    let response;
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.4',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'manual',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
          : AbortSignal.timeout(60000),
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (error?.name === 'TimeoutError') {
        throw httpError('PDF 下载超时，请稍后重试', 504);
      }
      throw httpError(
        `无法下载这个 PDF：${error instanceof Error ? error.message : '网络错误'}`,
        502,
      );
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw httpError('PDF 链接返回了无效跳转', 502);
      if (redirectCount === MAX_REDIRECTS) {
        throw httpError('PDF 链接跳转次数过多', 502);
      }
      await response.body?.cancel().catch(() => undefined);
      try {
        url = new URL(location, url);
      } catch {
        throw httpError('PDF 链接跳转地址无效', 502);
      }
      continue;
    }

    if (!response.ok) {
      const status =
        response.status === 404
          ? 404
          : response.status === 403
            ? 403
            : 502;
      throw httpError(`PDF 下载失败（HTTP ${response.status}）`, status);
    }

    const buffer = await readBodyWithLimit(response);
    if (!looksLikePdf(buffer)) {
      throw httpError('这个链接返回的不是有效 PDF 文件', 415);
    }
    return {
      buffer,
      filename: filenameFromResponse(response, url),
      finalUrl: url.toString(),
      contentType: response.headers.get('content-type') || 'application/pdf',
    };
  }

  throw httpError('PDF 下载失败', 502);
}
