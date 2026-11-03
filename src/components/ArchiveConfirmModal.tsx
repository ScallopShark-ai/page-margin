import { useEffect } from 'react';
import {
  Archive,
  BellOff,
  Check,
  Loader2,
  AlertTriangle,
  X,
} from 'lucide-react';

interface ArchiveConfirmModalProps {
  open: boolean;
  title: string;
  busy?: boolean;
  dontRemind: boolean;
  onToggleDontRemind: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ArchiveConfirmModal({
  open,
  title,
  busy = false,
  dontRemind,
  onToggleDontRemind,
  onCancel,
  onConfirm,
}: ArchiveConfirmModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="archive-confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className="archive-confirm-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="archive-confirm-title"
        aria-describedby="archive-confirm-description"
      >
        <header className="archive-confirm-head">
          <span className="archive-confirm-icon">
            <Archive size={20} strokeWidth={1.7} />
          </span>
          <div>
            <span className="archive-confirm-eyebrow">ARCHIVE PAPER</span>
            <h2 id="archive-confirm-title">归档这篇论文？</h2>
          </div>
          <button
            type="button"
            className="archive-confirm-close"
            onClick={onCancel}
            disabled={busy}
            aria-label="关闭"
          >
            <X size={15} />
          </button>
        </header>

        <div id="archive-confirm-description" className="archive-confirm-body">
          <p className="archive-confirm-paper">{title}</p>
          <p>归档会从当前浏览器删除这篇论文的完整内容，只保留一张可检索的名片：</p>
          <div className="archive-confirm-columns">
            <div className="archive-confirm-column is-removed">
              <strong>会删除</strong>
              <span>PDF 原件</span>
              <span>抽取全文</span>
              <span>中文翻译 PDF</span>
            </div>
            <div className="archive-confirm-column is-kept">
              <strong>会保留</strong>
              <span>标题、作者、摘要</span>
              <span>原文链接与封面</span>
              <span>对话和阅读笔记</span>
            </div>
          </div>
          <p className="archive-confirm-local">
            <AlertTriangle size={13} />
            归档内容无法直接恢复；改回其他状态后，需要重新导入 PDF 才能阅读。
          </p>
        </div>

        <footer className="archive-confirm-footer">
          <button
            type="button"
            className={`archive-dont-remind ${dontRemind ? 'is-active' : ''}`}
            onClick={onToggleDontRemind}
            aria-pressed={dontRemind}
            disabled={busy}
          >
            <span className="archive-dont-remind-check">
              {dontRemind ? <Check size={10} /> : <BellOff size={11} />}
            </span>
            以后不再提醒
          </button>
          <div className="archive-confirm-actions">
            <button
              type="button"
              className="text-button"
              onClick={onCancel}
              disabled={busy}
            >
              取消
            </button>
            <button
              type="button"
              className="primary-button archive-confirm-submit"
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? <Loader2 size={14} className="spin" /> : <Archive size={14} />}
              确认归档
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
