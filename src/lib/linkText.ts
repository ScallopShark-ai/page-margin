import { isArxivReference, isWebPdfUrl } from './paperId';

export interface TextLinkExtraction {
  links: string[];
  totalLines: number;
  recognizedLines: number;
  skippedLines: number;
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;

function cleanUrl(value: string): string {
  return value
    .replace(/^[<([{'"`]+/, '')
    .replace(/[>)\]}"'`,.;:!?，。；：！？、]+$/g, '')
    .trim();
}

function isPdfUrl(value: string): boolean {
  if (isArxivReference(value)) return true;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const pathname = url.pathname.toLowerCase();
    return /\.pdf$/.test(pathname) || /\/pdf(?:\/|$)/.test(pathname);
  } catch {
    return false;
  }
}

function isStandaloneUrlLine(line: string): boolean {
  const markdownLink =
    /^\s*(?:[-*•]\s*)?\[[^\]]*\]\(\s*https?:\/\/[^\s)]+\s*\)\s*$/i.test(line);
  if (markdownLink) return true;

  const withoutUrls = line.replace(URL_PATTERN, '');
  const residue = withoutUrls
    .replace(/^\s*(?:[-*•]\s+|\d+[.)、]\s+)/, '')
    .replace(/[\[\]()<>{}"'`*_,.;:!?，。；：！？、\s-]/g, '');
  return residue.length === 0;
}

function bareArxivReference(line: string): string {
  const value = line
    .replace(/^\s*(?:[-*•]\s+|\d+[.)、]\s+)/, '')
    .replace(/[<>\[\]()"'`]/g, '')
    .replace(/[.,;:!?，。；：！？]+$/g, '')
    .trim();
  if (!value || /\s/.test(value)) return '';
  return isArxivReference(value) ? value : '';
}

export function extractLinksFromText(text: string): TextLinkExtraction {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const links: string[] = [];
  const seen = new Set<string>();
  let totalLines = 0;
  let recognizedLines = 0;
  let skippedLines = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    totalLines += 1;

    const standalone = isStandaloneUrlLine(line);
    const candidates: string[] = [];
    for (const match of line.match(URL_PATTERN) ?? []) {
      const url = cleanUrl(match);
      if (!isWebPdfUrl(url)) continue;
      if (standalone || isPdfUrl(url)) candidates.push(url);
    }

    if (candidates.length === 0) {
      const bare = bareArxivReference(line);
      if (bare) candidates.push(bare);
    }

    if (candidates.length === 0) {
      skippedLines += 1;
      continue;
    }
    recognizedLines += 1;
    for (const link of candidates) {
      if (seen.has(link)) continue;
      seen.add(link);
      links.push(link);
    }
  }

  return { links, totalLines, recognizedLines, skippedLines };
}
