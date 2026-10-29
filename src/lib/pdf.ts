import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ArcherResult, PageText, PaperMeta } from '../types';

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const DOC_OPTIONS = {
  cMapUrl: '/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/',
  wasmUrl: '/pdfjs/wasm/',
  iccUrl: '/pdfjs/iccs/',
  enableXfa: true,
};

export type PdfProgress = (progress: { loaded: number; total: number }) => void;

export async function loadPdfFromUrl(
  url: string,
  onProgress?: PdfProgress,
): Promise<PDFDocumentProxy> {
  const task = pdfjsLib.getDocument({
    url,
    ...DOC_OPTIONS,
  });
  if (onProgress) {
    task.onProgress = (progress: { loaded: number; total: number }) => {
      onProgress({ loaded: progress.loaded, total: progress.total });
    };
  }
  return task.promise;
}

export async function loadPdfFromFile(file: File | Blob): Promise<PDFDocumentProxy> {
  const buffer = await file.arrayBuffer();
  const task = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    ...DOC_OPTIONS,
  });
  return task.promise;
}

export async function renderThumbnail(
  doc: PDFDocumentProxy,
  targetWidth = 360,
): Promise<string | undefined> {
  let page: PDFPageProxy | null = null;
  try {
    page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1, targetWidth / Math.max(1, base.width));
    const viewport = page.getViewport({ scale });
    const renderCanvas = document.createElement('canvas');
    renderCanvas.width = Math.max(1, Math.floor(viewport.width));
    renderCanvas.height = Math.max(1, Math.floor(viewport.height));
    await page.render({ canvas: renderCanvas, viewport }).promise;

    const output = document.createElement('canvas');
    output.width = renderCanvas.width;
    output.height = renderCanvas.height;
    const context = output.getContext('2d');
    if (!context) return undefined;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, output.width, output.height);
    context.drawImage(renderCanvas, 0, 0);
    return output.toDataURL('image/jpeg', 0.74);
  } catch {
    return undefined;
  } finally {
    page?.cleanup();
  }
}

function itemsToText(items: unknown[]): string {
  let text = '';
  let lastY: number | null = null;
  let lastXEnd: number | null = null;

  for (const raw of items) {
    const item = raw as PdfTextItem;
    if (typeof item.str !== 'string') continue;
    const transform = item.transform;
    if (!transform || transform.length < 6) {
      text += item.str;
      continue;
    }
    const x = transform[4];
    const y = transform[5];
    const height = Math.abs(item.height || transform[3] || 10);
    const gapThreshold = Math.max(1.4, height * 0.22);

    if (text && lastY !== null && Math.abs(y - lastY) > height * 0.55) {
      text += '\n';
    } else if (text && lastXEnd !== null && x - lastXEnd > gapThreshold && !text.endsWith(' ')) {
      text += ' ';
    }

    text += item.str;
    lastY = y;
    lastXEnd = x + (Number.isFinite(item.width) ? item.width : 0);
    if (item.hasEOL) {
      text += '\n';
      lastY = null;
      lastXEnd = null;
    }
  }

  return text
    .replace(/\u00ad/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export async function extractPageText(
  doc: PDFDocumentProxy,
  onProgress?: (page: number, total: number) => void,
): Promise<{ pages: PageText[]; chars: number }> {
  const pages: PageText[] = [];
  let chars = 0;
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    let page: PDFPageProxy | null = null;
    try {
      page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = itemsToText(content.items);
      pages.push({ page: pageNumber, text });
      chars += text.length;
    } catch {
      pages.push({ page: pageNumber, text: '' });
    } finally {
      page?.cleanup();
    }
    onProgress?.(pageNumber, doc.numPages);
    // Give React a chance to paint progress while large PDFs are parsed.
    if (pageNumber % 2 === 0 || pageNumber === doc.numPages) {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  }
  return { pages, chars };
}

function titleLooksGeneric(value: string): boolean {
  return (
    /^(untitled|microsoft word|document|title|paper|pdf)$/i.test(value) ||
    /^Microsoft Word - /i.test(value) ||
    /^(?:arxiv[:\s-]*)?\d{4}\.\d{4,5}(?:v\d+)?$/i.test(value) ||
    /^[\d.\-_\s]+$/.test(value)
  );
}

/**
 * PDF metadata is often empty or holds a filename. As a fallback, find a
 * title-shaped line near the top of page one (before the abstract/authors).
 */
export function inferTitleFromPageText(text: string): string {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 32);

  let best = '';
  let bestScore = -Infinity;
  const banned =
    /@|https?:|doi:|arxiv:|proceedings|conference|permission|reproduce|copyright|preprint|under review|university|institute|department|laboratory|abstract|keywords|contents|provided proper|attribution/i;

  lines.forEach((line, index) => {
    if (line.length < 8 || line.length > 180) return;
    if (banned.test(line)) return;
    if (/^(abstract|introduction|contents|摘要|引言|目录)$/i.test(line)) return;

    const words = line.split(/\s+/);
    const letters = (line.match(/[A-Za-z\u3400-\u9fff]/g) ?? []).length;
    if (letters < 6) return;
    if (words.length > 24) return;

    const cjkCount = (line.match(/[\u3400-\u9fff]/g) ?? []).length;
    const capitalized = words.filter((word) => /^[A-Z0-9]/.test(word)).length;
    const punctuation = (line.match(/[,.，。;；:：]/g) ?? []).length;
    const digitRatio = (line.match(/\d/g) ?? []).length / Math.max(1, line.length);

    let score = 0;
    score += Math.min(4, capitalized / Math.max(1, words.length)) * 4;
    score += line.length >= 18 && line.length <= 110 ? 2 : 0;
    score -= punctuation * (cjkCount > 2 ? 0.35 : 0.8);
    score -= digitRatio * 8;
    score -= index * 0.18;
    if (cjkCount > 2) score += 1.5;
    if (/^[A-Z]/.test(line)) score += 1.2;

    if (score > bestScore) {
      bestScore = score;
      best = line;
    }
  });

  if (bestScore < 2.2) return '';
  return best.replace(/\s*[*†‡]+$/g, '').trim();
}

export async function readPdfMetadata(
  doc: PDFDocumentProxy,
  file?: File,
): Promise<{ title: string; authors: string[] }> {
  try {
    const metadata = await doc.getMetadata();
    const info = metadata.info as Record<string, unknown>;
    const rawTitle = typeof info.Title === 'string' ? info.Title.trim() : '';
    const titleIsUseful =
      rawTitle.length > 3 && !titleLooksGeneric(rawTitle);
    const rawAuthor = typeof info.Author === 'string' ? info.Author.trim() : '';
    const authors = rawAuthor
      ? rawAuthor
          .split(/\s*(?:;|,|\band\b)\s*/i)
          .map((a) => a.trim())
          .filter((a) => a.length > 1)
          .slice(0, 12)
      : [];
    const fallback = file?.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim() ?? '';
    return {
      title: titleIsUseful ? rawTitle : fallback || '未命名论文',
      authors,
    };
  } catch {
    return {
      title: file?.name.replace(/\.pdf$/i, '') || '未命名论文',
      authors: [],
    };
  }
}

export function arxivToMeta(meta: ArcherResult, pageCount: number, chars: number): PaperMeta {
  return {
    source: 'arxiv',
    title: meta.title,
    authors: meta.authors,
    abstract: meta.abstract,
    published: meta.published,
    year: meta.year || meta.published.slice(0, 4),
    category: meta.category,
    arxivId: meta.arxivId,
    absUrl: meta.absUrl,
    pdfUrl: meta.pdfUrl,
    pages: pageCount,
    chars,
  };
}

export function localToMeta(
  file: File,
  pdfMeta: { title: string; authors: string[] },
  pageCount: number,
  chars: number,
): PaperMeta {
  return {
    source: 'local',
    title: pdfMeta.title,
    authors: pdfMeta.authors,
    abstract: '',
    published: '',
    year: '',
    category: '本地 PDF',
    fileName: file.name,
    pages: pageCount,
    chars,
  };
}

export function shortAuthors(authors: string[], max = 3): string {
  if (authors.length === 0) return '作者未知';
  if (authors.length <= max) return authors.join('、');
  return `${authors.slice(0, max).join('、')} 等`;
}
