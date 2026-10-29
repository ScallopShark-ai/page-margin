import type { PaperMeta, PaperSession } from '../types';
import { fetchPdfBlob, fetchRemotePdf, resolveArxiv } from './api';
import {
  arxivToMeta,
  extractPageText,
  inferTitleFromPageText,
  loadPdfFromFile,
  localToMeta,
  readPdfMetadata,
  renderThumbnail,
} from './pdf';
import { savePaper } from './library';
import {
  arxivPaperId,
  fileNameFromUrl,
  hostFromUrl,
  isArxivReference,
  isWebPdfUrl,
  localPaperId,
  webPaperId,
} from './paperId';

export type BatchImportItem =
  | { kind: 'link'; value: string }
  | { kind: 'file'; file: File };

export interface BatchImportProgress {
  stage: string;
  detail?: string;
  percent: number;
}

export interface BatchImportResult {
  id: string;
  title: string;
  source: PaperMeta['source'];
  warning?: string;
}

export type BatchProgressHandler = (progress: BatchImportProgress) => void;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Import cancelled', 'AbortError');
  }
}

function numberId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function displayFileTitle(name: string): string {
  return name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim() || name;
}

async function storeSession(
  session: PaperSession,
  pdfBlob: Blob,
  onProgress: BatchProgressHandler,
  signal?: AbortSignal,
): Promise<BatchImportResult> {
  throwIfAborted(signal);
  onProgress({ stage: '生成封面', percent: 94 });
  const thumbnail = await renderThumbnail(session.doc).catch(() => undefined);
  throwIfAborted(signal);
  onProgress({ stage: '保存到文库', percent: 97 });
  const result = await savePaper({
    id: session.key,
    meta: session.meta,
    pages: session.pages,
    pdfBlob,
    thumbnail,
  });
  if (signal?.aborted) {
    throw new DOMException('Import cancelled', 'AbortError');
  }
  return {
    id: result.paper.id,
    title: result.paper.title,
    source: result.paper.source,
    warning: result.blobSaved
      ? undefined
      : '浏览器空间不足，已保存论文信息和文本，但未保存 PDF 原件。',
  };
}

async function importArxiv(
  input: string,
  onProgress: BatchProgressHandler,
  signal?: AbortSignal,
): Promise<BatchImportResult> {
  onProgress({ stage: '读取 arXiv 信息', percent: 5 });
  const meta = await resolveArxiv(input, signal);
  throwIfAborted(signal);

  onProgress({ stage: '下载论文 PDF', detail: meta.title, percent: 14 });
  const blob = await fetchPdfBlob(meta.pdfUrl, signal);
  throwIfAborted(signal);

  onProgress({ stage: '打开 PDF', detail: meta.title, percent: 24 });
  const doc = await loadPdfFromFile(blob);
  let session: PaperSession | null = null;
  try {
    throwIfAborted(signal);
    const pdfMeta = await readPdfMetadata(doc);
    onProgress({
      stage: '提取论文全文',
      detail: `共 ${doc.numPages} 页`,
      percent: 32,
    });
    const extraction = await extractPageText(doc, (page, total) => {
      onProgress({
        stage: '提取论文全文',
        detail: `第 ${page} / ${total} 页`,
        percent: 32 + Math.round((page / total) * 58),
      });
    });
    throwIfAborted(signal);

    const mergedMeta = arxivToMeta(meta, doc.numPages, extraction.chars);
    if (mergedMeta.authors.length === 0) mergedMeta.authors = pdfMeta.authors;
    if (meta.metadataUnavailable || /^arXiv\s/i.test(mergedMeta.title)) {
      const inferredTitle = inferTitleFromPageText(extraction.pages[0]?.text ?? '');
      mergedMeta.title =
        inferredTitle ||
        (pdfMeta.title !== '未命名论文' ? pdfMeta.title : '') ||
        mergedMeta.title;
    }
    const paperId = arxivPaperId(mergedMeta);
    session = {
      key: paperId,
      meta: mergedMeta,
      pages: extraction.pages,
      doc,
      pdfHref: '',
      extractedChars: extraction.chars,
    };
    const result = await storeSession(session, blob, onProgress, signal);
    onProgress({ stage: '完成', percent: 100 });
    return result;
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

async function importWebPdf(
  url: string,
  onProgress: BatchProgressHandler,
  signal?: AbortSignal,
): Promise<BatchImportResult> {
  if (!isWebPdfUrl(url)) {
    throw new Error('请输入有效的 http 或 https PDF 链接');
  }
  const normalizedUrl = new URL(url);
  normalizedUrl.hash = '';
  const fileName = fileNameFromUrl(normalizedUrl.toString());
  onProgress({ stage: '下载网页 PDF', detail: normalizedUrl.hostname, percent: 8 });

  const blob = await fetchRemotePdf(normalizedUrl.toString(), signal);
  throwIfAborted(signal);
  onProgress({ stage: '打开 PDF', detail: fileName, percent: 24 });
  const doc = await loadPdfFromFile(blob);
  let session: PaperSession | null = null;
  try {
    throwIfAborted(signal);
    const pdfMeta = await readPdfMetadata(doc);
    onProgress({
      stage: '提取论文全文',
      detail: `共 ${doc.numPages} 页`,
      percent: 32,
    });
    const extraction = await extractPageText(doc, (page, total) => {
      onProgress({
        stage: '提取论文全文',
        detail: `第 ${page} / ${total} 页`,
        percent: 32 + Math.round((page / total) * 58),
      });
    });
    throwIfAborted(signal);

    const inferredTitle = inferTitleFromPageText(extraction.pages[0]?.text ?? '');
    const fallbackTitle = displayFileTitle(fileName);
    const title =
      inferredTitle ||
      (pdfMeta.title !== '未命名论文' ? pdfMeta.title : '') ||
      fallbackTitle ||
      hostFromUrl(normalizedUrl.toString());
    const webId = webPaperId(normalizedUrl.toString());
    const meta: PaperMeta = {
      source: 'web',
      title,
      authors: pdfMeta.authors,
      abstract: '',
      published: '',
      year: '',
      category: hostFromUrl(normalizedUrl.toString()),
      sourceUrl: normalizedUrl.toString(),
      fileName,
      pages: doc.numPages,
      chars: extraction.chars,
    };
    session = {
      key: webId,
      meta,
      pages: extraction.pages,
      doc,
      pdfHref: '',
      extractedChars: extraction.chars,
    };
    const result = await storeSession(session, blob, onProgress, signal);
    onProgress({ stage: '完成', percent: 100 });
    return result;
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

async function importLocalFile(
  file: File,
  onProgress: BatchProgressHandler,
  signal?: AbortSignal,
): Promise<BatchImportResult> {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('不是 PDF 文件');
  }
  if (file.size > 80 * 1024 * 1024) {
    throw new Error('PDF 文件超过 80 MB');
  }

  onProgress({ stage: '读取本地 PDF', detail: file.name, percent: 8 });
  const doc = await loadPdfFromFile(file);
  let session: PaperSession | null = null;
  try {
    throwIfAborted(signal);
    const pdfMeta = await readPdfMetadata(doc, file);
    onProgress({
      stage: '提取论文全文',
      detail: `共 ${doc.numPages} 页`,
      percent: 28,
    });
    const extraction = await extractPageText(doc, (page, total) => {
      onProgress({
        stage: '提取论文全文',
        detail: `第 ${page} / ${total} 页`,
        percent: 28 + Math.round((page / total) * 62),
      });
    });
    throwIfAborted(signal);

    const inferredTitle = inferTitleFromPageText(extraction.pages[0]?.text ?? '');
    const paperId = localPaperId(file);
    const meta = localToMeta(
      file,
      { ...pdfMeta, title: inferredTitle || pdfMeta.title },
      doc.numPages,
      extraction.chars,
    );
    session = {
      key: paperId,
      meta,
      pages: extraction.pages,
      doc,
      localFile: file,
      pdfHref: '',
      extractedChars: extraction.chars,
    };
    const result = await storeSession(session, file, onProgress, signal);
    onProgress({ stage: '完成', percent: 100 });
    return result;
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

export async function importBatchItem(
  item: BatchImportItem,
  onProgress: BatchProgressHandler,
  signal?: AbortSignal,
): Promise<BatchImportResult> {
  if (item.kind === 'file') {
    return importLocalFile(item.file, onProgress, signal);
  }

  const value = item.value.trim();
  if (!value) throw new Error('链接为空');
  if (isArxivReference(value)) {
    return importArxiv(value, onProgress, signal);
  }
  return importWebPdf(value, onProgress, signal);
}

export function batchItemLabel(item: BatchImportItem): string {
  return item.kind === 'file' ? item.file.name : item.value;
}

export function newBatchTaskId(): string {
  return numberId();
}
