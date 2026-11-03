import type { ChatImage } from '../types';

export const MAX_CHAT_IMAGES = 4;
export const MAX_IMAGE_FILE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1600;
const MAX_DATA_URL_CHARS = 2_800_000;

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `image-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('这张图片无法读取'));
    };
    image.src = url;
  });
}

export async function prepareChatImage(file: File): Promise<ChatImage> {
  if (!/^image\/(?:png|jpe?g|webp)$/i.test(file.type)) {
    throw new Error('只支持 PNG、JPEG 或 WebP 图片');
  }
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    throw new Error('单张图片不能超过 15 MB');
  }

  const image = await loadImage(file);
  const scale = Math.min(
    1,
    MAX_IMAGE_EDGE / Math.max(image.naturalWidth || 1, image.naturalHeight || 1),
  );
  const width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法处理图片');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  let dataUrl = canvas.toDataURL('image/png');
  let mimeType = 'image/png';
  if (dataUrl.length > MAX_DATA_URL_CHARS) {
    dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    mimeType = 'image/jpeg';
  }
  if (dataUrl.length > MAX_DATA_URL_CHARS) {
    dataUrl = canvas.toDataURL('image/jpeg', 0.76);
    mimeType = 'image/jpeg';
  }
  if (dataUrl.length > MAX_DATA_URL_CHARS) {
    throw new Error('图片压缩后仍然过大，请裁切后再试');
  }

  return {
    id: makeId(),
    dataUrl,
    mimeType,
    name: file.name || '粘贴的图片',
    width,
    height,
    source: 'chat',
  };
}

export function imageFilesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  if (files.length > 0) return files;
  return Array.from(data.files).filter((file) =>
    file.type.startsWith('image/'),
  );
}
