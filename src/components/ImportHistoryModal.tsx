import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Clock3,
  FileText,
  Folder,
  History,
  Link2,
  Loader2,
  Trash2,
  X,
} from 'lucide-react';
import type { ImportHistoryRun } from '../types';
import {
  clearImportRuns,
  listImportRuns,
} from '../lib/library';

interface ImportHistoryModalProps {
  open: boolean;
  onClose: () => void;
}

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function dayLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((today - target) / 86_400_000);
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}

function formatTime(timestamp: number): string {
  return timeFormatter.format(new Date(timestamp));
}

export function ImportHistoryModal({ open, onClose }: ImportHistoryModalProps) {
  const [runs, setRuns] = useState<ImportHistoryRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    void listImportRuns()
      .then((rows) => {
        if (!cancelled) setRuns(rows);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : '读取导入记录失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
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

  const groups = useMemo(() => {
    const map = new Map<string, ImportHistoryRun[]>();
    for (const run of runs) {
      const key = dayKey(run.startedAt);
      const rows = map.get(key) ?? [];
      rows.push(run);
      map.set(key, rows);
    }
    return Array.from(map.entries());
  }, [runs]);

  const clear = async () => {
    if (!window.confirm('清空所有导入失败记录？此操作不会影响文库中的论文。')) return;
    setClearing(true);
    try {
      await clearImportRuns();
      setRuns([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '清空导入记录失败');
    } finally {
      setClearing(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="import-history-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="import-history-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-history-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="import-history-head">
          <span className="import-history-icon">
            <History size={19} strokeWidth={1.7} />
          </span>
          <div>
            <span className="batch-kicker">IMPORT HISTORY</span>
            <h2 id="import-history-title">导入失败记录</h2>
            <p>按日期和时间查看每次有失败或中断的批量导入。</p>
          </div>
          <button
            type="button"
            className="batch-close"
            onClick={onClose}
            aria-label="关闭导入记录"
          >
            <X size={17} />
          </button>
        </header>

        <div className="import-history-toolbar">
          <span>
            <Clock3 size={13} />
            {runs.length > 0 ? `${runs.length} 次有问题的导入` : '尚无记录'}
          </span>
          {runs.length > 0 && (
            <button
              type="button"
              className="import-history-clear"
              onClick={() => void clear()}
              disabled={clearing}
            >
              {clearing ? <Loader2 size={12} className="spin" /> : <Trash2 size={12} />}
              清空记录
            </button>
          )}
        </div>

        <div className="import-history-body" aria-live="polite">
          {loading ? (
            <div className="import-history-state">
              <Loader2 size={18} className="spin" />
              正在读取导入记录…
            </div>
          ) : error ? (
            <div className="import-history-state is-error">
              <AlertCircle size={17} />
              <span>{error}</span>
            </div>
          ) : groups.length === 0 ? (
            <div className="import-history-empty">
              <div className="import-history-empty-mark">
                <History size={26} strokeWidth={1.4} />
              </div>
              <strong>还没有失败记录</strong>
              <p>当批量导入中有文章失败或被中断时，这里会记录当时的日期、时间和具体条目。</p>
            </div>
          ) : (
            groups.map(([key, rows]) => (
              <section className="import-history-day" key={key}>
                <h3>{dayLabel(rows[0].startedAt)}</h3>
                {rows.map((run) => {
                  const issues = run.items.filter((item) => item.status !== 'done');
                  return (
                    <article className="import-run" key={run.id}>
                      <div className="import-run-head">
                        <span className="import-run-time">{formatTime(run.startedAt)}</span>
                        <div className="import-run-copy">
                          <strong>
                            {run.failed > 0
                              ? `${run.failed} 项失败`
                              : `${run.cancelled} 项取消`}
                            {run.failed > 0 && run.cancelled > 0
                              ? ` · ${run.cancelled} 项取消`
                              : ''}
                          </strong>
                          <span>
                            共 {run.total} 项 · 成功 {run.succeeded}
                            {run.folderName ? ` · 文件夹：${run.folderName}` : ''}
                          </span>
                        </div>
                        {run.folderName && <Folder size={13} className="import-run-folder" />}
                      </div>
                      <div className="import-run-items">
                        {issues.map((item) => (
                          <div
                            className={`import-run-item is-${item.status}`}
                            key={item.id}
                          >
                            <span className="import-run-item-icon">
                              {item.kind === 'file' ? (
                                <FileText size={14} />
                              ) : (
                                <Link2 size={14} />
                              )}
                            </span>
                            <div className="import-run-item-copy">
                              <strong title={item.label}>{item.label}</strong>
                              <span>{item.error || '已取消'}</span>
                            </div>
                            <em>{item.kind === 'file' ? '本地文件' : '链接'}</em>
                          </div>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </section>
            ))
          )}
        </div>

        <footer className="import-history-foot">
          <span>记录保存在当前浏览器，最多保留 200 次。</span>
          <button type="button" className="batch-cancel" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}
