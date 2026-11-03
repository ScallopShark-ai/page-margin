import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ChatImage } from '../types';

interface CaptionLine {
  text: string;
  x: number;
  y: number;
  height: number;
  isTable: boolean;
}

const CAPTION_PATTERN =
  /^\s*(?:figure|fig\.?|table|图|表)\s*([0-9]+|[ivxlcdm]+)\b/i;

function imageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `figure-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function canvasToImage(
  source: HTMLCanvasElement,
  crop: { x: number; y: number; width: number; height: number },
  name: string,
  page: number,
): ChatImage {
  const width = Math.max(1, Math.round(crop.width));
  const height = Math.max(1, Math.round(crop.height));
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const context = output.getContext('2d');
  if (!context) throw new Error('无法创建图表裁剪画布');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(
    source,
    Math.round(crop.x),
    Math.round(crop.y),
    width,
    height,
    0,
    0,
    width,
    height,
  );

  let dataUrl = output.toDataURL('image/png');
  let mimeType = 'image/png';
  if (dataUrl.length > 2_600_000) {
    dataUrl = output.toDataURL('image/jpeg', 0.88);
    mimeType = 'image/jpeg';
  }
  return {
    id: imageId(),
    dataUrl,
    mimeType,
    name,
    width,
    height,
    page,
    source: 'figure',
  };
}

export async function extractPageFigures(
  doc: PDFDocumentProxy,
  pageNumber: number,
): Promise<ChatImage[]> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2, Math.max(1.15, 1400 / Math.max(1, base.width)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  await page.render({ canvas, viewport }).promise;

  const text = await page.getTextContent().catch(() => null);
  if (!text) {
    return [
      canvasToImage(
        canvas,
        { x: 0, y: 0, width: canvas.width, height: canvas.height },
        `第 ${pageNumber} 页`,
        pageNumber,
      ),
    ];
  }

  const lines: CaptionLine[] = [];
  for (const item of text.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const match = item.str.match(CAPTION_PATTERN);
    if (!match) continue;
    const [x, y] = viewport.convertToViewportPoint(
      item.transform[4],
      item.transform[5],
    );
    const height = Math.max(9, Math.abs(item.height * scale));
    lines.push({
      text: item.str.trim().slice(0, 140),
      x,
      y,
      height,
      isTable: /table|表/i.test(match[0]),
    });
  }

  if (lines.length === 0) {
    return [
      canvasToImage(
        canvas,
        { x: 0, y: 0, width: canvas.width, height: canvas.height },
        `第 ${pageNumber} 页`,
        pageNumber,
      ),
    ];
  }

  const deduped = lines
    .sort((a, b) => a.y - b.y)
    .filter(
      (line, index, list) =>
        index === 0 ||
        Math.abs(line.y - list[index - 1].y) > line.height * 0.7,
    )
    .slice(0, 4);

  const pageWidth = canvas.width;
  const pageHeight = canvas.height;
  const left = pageWidth * 0.045;
  const right = pageWidth * 0.955;

  return deduped.map((line, index) => {
    let top: number;
    let bottom: number;
    if (line.isTable) {
      top = line.y - line.height * 0.6;
      bottom = line.y + pageHeight * 0.42;
    } else {
      top = line.y - pageHeight * 0.42;
      bottom = line.y + line.height * 0.8;
    }
    top = Math.max(0, Math.min(pageHeight - 20, top));
    bottom = Math.max(top + 20, Math.min(pageHeight, bottom));
    const name =
      line.text.replace(/\s+/g, ' ').trim() ||
      `第 ${pageNumber} 页 · 图表 ${index + 1}`;
    return canvasToImage(
      canvas,
      {
        x: left,
        y: top,
        width: Math.max(20, right - left),
        height: bottom - top,
      },
      name,
      pageNumber,
    );
  });
}
