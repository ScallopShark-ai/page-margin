import express from 'express';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const imageDir = path.join(root, '.runtime', 'images');
const indexPath = path.join(imageDir, 'index.json');
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MIME_EXTENSION = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const IMAGE_URL_PREFIX = '/api/images/';

let lock = Promise.resolve();

function withLock(task) {
  const run = lock.then(task, task);
  lock = run.catch(() => undefined);
  return run;
}

async function ensureStore() {
  await fs.mkdir(imageDir, { recursive: true });
}

async function readIndex() {
  try {
    const raw = await fs.readFile(indexPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.images)) return parsed.images;
  } catch {
    // Missing or corrupt index starts from an empty list.
  }
  return [];
}

async function writeIndex(images) {
  await ensureStore();
  const temp = `${indexPath}.${process.pid}.tmp`;
  await fs.writeFile(
    temp,
    `${JSON.stringify({ version: 1, images }, null, 2)}\n`,
    'utf8',
  );
  await fs.rename(temp, indexPath);
}

function safeText(value, maxLength = 300) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl ?? '').match(
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i,
  );
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const extension = MIME_EXTENSION[mimeType];
  if (!extension) return null;
  const base64 = match[2].replace(/\s+/g, '');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
  return { mimeType, extension, bytes };
}

export async function listImages() {
  return withLock(async () => {
    const images = await readIndex();
    return [...images].sort((a, b) => b.createdAt - a.createdAt);
  });
}

export async function saveImage(input) {
  const parsed = parseDataUrl(input?.dataUrl);
  if (!parsed) {
    const error = new Error('图片格式不支持，或图片超过 8 MB');
    error.status = 400;
    throw error;
  }
  const id = `img_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
  const fileName = `${id}.${parsed.extension}`;
  const absolutePath = path.join(imageDir, fileName);
  const image = {
    id,
    url: `${IMAGE_URL_PREFIX}${id}`,
    fileName,
    name: safeText(input?.name, 160) || '论文图片',
    mimeType: parsed.mimeType,
    bytes: parsed.bytes.length,
    width: Math.max(0, Math.round(Number(input?.width) || 0)),
    height: Math.max(0, Math.round(Number(input?.height) || 0)),
    paperId: safeText(input?.paperId, 200),
    paperTitle: safeText(input?.paperTitle, 240),
    alt: safeText(input?.alt, 300),
    page: Math.max(0, Math.round(Number(input?.page) || 0)),
    source: ['chat', 'figure', 'upload'].includes(input?.source)
      ? input.source
      : 'upload',
    createdAt: Date.now(),
  };

  await ensureStore();
  await fs.writeFile(absolutePath, parsed.bytes);
  try {
    return await withLock(async () => {
      const images = await readIndex();
      await writeIndex([image, ...images].slice(0, 500));
      return image;
    });
  } catch (error) {
    await fs.rm(absolutePath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function deleteImage(id) {
  if (!/^img_[a-z0-9_]+$/i.test(String(id ?? ''))) {
    const error = new Error('无效的图片 ID');
    error.status = 400;
    throw error;
  }
  return withLock(async () => {
    const images = await readIndex();
    const image = images.find((item) => item.id === id);
    if (!image) return false;
    await fs
      .rm(path.join(imageDir, image.fileName), { force: true })
      .catch(() => undefined);
    await writeIndex(images.filter((item) => item.id !== id));
    return true;
  });
}

export async function resolveImage(id) {
  if (!/^img_[a-z0-9_]+$/i.test(String(id ?? ''))) return null;
  const images = await readIndex();
  const image = images.find((item) => item.id === id);
  if (!image) return null;
  return { ...image, absolutePath: path.join(imageDir, image.fileName) };
}

export function createImagesRouter() {
  const router = express.Router();

  router.get('/', async (_req, res, next) => {
    try {
      res.json({ images: await listImages() });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const image = await saveImage(req.body);
      res.status(201).json({ image });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const removed = await deleteImage(req.params.id);
      if (!removed) {
        res.status(404).json({ error: '图片不存在' });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const image = await resolveImage(req.params.id);
      if (!image) {
        res.status(404).json({ error: '图片不存在' });
        return;
      }
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.type(image.mimeType);
      res.sendFile(image.absolutePath, (error) => {
        if (error && !res.headersSent) next(error);
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
