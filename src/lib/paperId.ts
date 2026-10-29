import type { PaperMeta } from '../types';

export function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function arxivPaperId(meta: PaperMeta): string {
  const baseId = (meta.arxivId || '').replace(/v\d+$/i, '');
  return `arxiv-${baseId || hashString(meta.title)}`;
}

export function localPaperId(file: File): string {
  return `local-${hashString(`${file.name}|${file.size}|${file.lastModified}`)}`;
}

export function normalizePdfUrl(value: string): string {
  const url = new URL(value.trim());
  url.hash = '';
  return url.toString();
}

export function webPaperId(value: string): string {
  return `web-${hashString(normalizePdfUrl(value))}`;
}

export function isWebPdfUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const ARXIV_HOST = /(^|\.)arxiv\.org$/i;

export function isArxivReference(value: string): boolean {
  const input = value.trim();
  if (!input) return false;

  if (/^https?:\/\//i.test(input)) {
    try {
      const url = new URL(input);
      return ARXIV_HOST.test(url.hostname) && /^\/(abs|pdf|format)\//i.test(url.pathname);
    } catch {
      return false;
    }
  }

  if (/^(?:www\.|export\.)?arxiv\.org\//i.test(input)) {
    return /^\/(abs|pdf|format)\//i.test(input.replace(/^[^/]+\//, '/'));
  }
  if (/^arxiv:/i.test(input)) return true;
  if (/^\d{4}\.\d{4,5}(?:v\d+)?$/i.test(input)) return true;
  if (/^[a-z-]+(?:\.[a-z]{2})?\/\d{7}(?:v\d+)?$/i.test(input)) return true;
  return false;
}

export function fileNameFromUrl(value: string): string {
  try {
    const url = new URL(value);
    const raw = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
    const clean = raw.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 120);
    if (!clean) return 'document.pdf';
    return /\.pdf$/i.test(clean) ? clean : `${clean}.pdf`;
  } catch {
    return 'document.pdf';
  }
}

export function hostFromUrl(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, '');
  } catch {
    return '网页 PDF';
  }
}
