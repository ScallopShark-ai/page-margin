import { useEffect, useState } from 'react';
import {
  Check,
  Clipboard,
  Copy,
  Images,
  Loader2,
  Trash2,
  X,
} from 'lucide-react';
import type { StoredImage } from '../types';
import {
  absoluteSiteUrl,
  deleteSiteImage,
  listSiteImages,
} from '../lib/api';

interface ImageLibraryModalProps {
  open: boolean;
  onClose: () => void;
  currentPaperId?: string;
  onInsertToNote?: (markdown: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(date.getDate()).padStart(2, '0')}`;
}

function imageMarkdown(image: StoredImage): string {
  return `![${image.alt || image.name}](${absoluteSiteUrl(image.url)})`;
}

export function ImageLibraryModal({
  open,
  onClose,
  currentPaperId,
  onInsertToNote,
}: ImageLibraryModalProps) {
  const [images, setImages] = useState<StoredImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');
    void listSiteImages()
      .then((rows) => setImages(rows))
      .catch((reason) => {
        setError(
          reason instanceof Error ? reason.message : '无法读取站点图片',
        );
      })
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const copyText = async (text: string, imageId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(imageId);
      window.setTimeout(() => {
        setCopiedId((current) => (current === imageId ? null : current));
      }, 1800);
    } catch {
      window.prompt('复制图片链接', text);
    }
  };

  const removeImage = async (image: StoredImage) => {
    if (pendingDeleteId !== image.id) {
      setPendingDeleteId(image.id);
      return;
    }
    setPendingDeleteId(null);
    setBusyId(image.id);
    try {
      await deleteSiteImage(image.id);
      setImages((current) => current.filter((item) => item.id !== image.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除失败');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className="image-library-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="image-library-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-library-title"
      >
        <header className="image-library-head">
          <span className="image-library-mark">
            <Images size={19} strokeWidth={1.7} />
          </span>
          <div>
            <span className="image-library-eyebrow">SITE IMAGE STORE</span>
            <h2 id="image-library-title">图片管理</h2>
            <p>发给智能体的图片会自动存入站点，并获得可直接写入报告或笔记的链接。</p>
          </div>
          <button
            type="button"
            className="image-library-close"
            onClick={onClose}
            aria-label="关闭图片管理"
          >
            <X size={16} />
          </button>
        </header>

        <div className="image-library-toolbar">
          <span>
            {loading ? '正在读取…' : `${images.length} 张图片`}
            {currentPaperId ? ' · 可插入当前笔记' : ''}
          </span>
          <button
            type="button"
            className="image-library-refresh"
            onClick={() => {
              setLoading(true);
              setError('');
              void listSiteImages()
                .then((rows) => setImages(rows))
                .catch((reason) =>
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : '无法读取站点图片',
                  ),
                )
                .finally(() => setLoading(false));
            }}
          >
            <Loader2 size={12} className={loading ? 'spin' : ''} />
            刷新
          </button>
        </div>

        {error && <p className="image-library-error">{error}</p>}

        <div className="image-library-scroll">
          {images.length === 0 && !loading ? (
            <div className="image-library-empty">
              <Images size={24} />
              <strong>还没有站点图片</strong>
              <span>在聊天框粘贴图片并发送后，图片会自动出现在这里。</span>
            </div>
          ) : (
            <div className="image-library-grid">
              {images.map((image) => (
                <article className="image-library-item" key={image.id}>
                  <a
                    className="image-library-preview"
                    href={absoluteSiteUrl(image.url)}
                    target="_blank"
                    rel="noreferrer"
                    title="打开原图"
                  >
                    <img src={absoluteSiteUrl(image.url)} alt={image.alt || image.name} />
                  </a>
                  <div className="image-library-info">
                    <strong title={image.alt || image.name}>
                      {image.alt || image.name}
                    </strong>
                    <span>
                      {image.paperTitle || '未关联论文'}
                      {image.page ? ` · 第 ${image.page} 页` : ''}
                    </span>
                    <span>
                      {formatDate(image.createdAt)} · {formatBytes(image.bytes)}
                      {image.width && image.height
                        ? ` · ${image.width}×${image.height}`
                        : ''}
                    </span>
                  </div>
                  <div className="image-library-actions">
                    <button
                      type="button"
                      onClick={() =>
                        void copyText(absoluteSiteUrl(image.url), image.id)
                      }
                      title="复制图片链接"
                    >
                      {copiedId === image.id ? (
                        <Check size={12} />
                      ) : (
                        <Copy size={12} />
                      )}
                      链接
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void copyText(imageMarkdown(image), image.id)
                      }
                      title="复制 Markdown 图片引用"
                    >
                      <Clipboard size={12} />
                      Markdown
                    </button>
                    {onInsertToNote && (
                      <button
                        type="button"
                        className="image-library-insert"
                        onClick={() => onInsertToNote(imageMarkdown(image))}
                        title="把图片插入当前论文笔记"
                      >
                        <Check size={12} />
                        插入笔记
                      </button>
                    )}
                    <button
                      type="button"
                      className={`image-library-delete ${
                        pendingDeleteId === image.id ? 'is-confirming' : ''
                      }`}
                      onClick={() => void removeImage(image)}
                      disabled={busyId === image.id}
                      title={
                        pendingDeleteId === image.id
                          ? '再次点击确认删除，已写入笔记的链接会失效'
                          : '删除图片'
                      }
                      aria-label={
                        pendingDeleteId === image.id
                          ? '再次点击确认删除图片'
                          : '删除图片'
                      }
                    >
                      {busyId === image.id ? (
                        <Loader2 size={12} className="spin" />
                      ) : (
                        <Trash2 size={12} />
                      )}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
