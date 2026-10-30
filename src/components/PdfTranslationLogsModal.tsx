import { useEffect, useRef, useState } from 'react';
import {
  Bug,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';

interface PdfTranslationLogsModalProps {
  open: boolean;
  onClose: () => void;
}

type LogSource = 'pdf2zh' | 'haila';

interface LogResult {
  source: LogSource;
  path?: string;
  size?: number;
  mtime?: string;
  truncated?: boolean;
  scanned?: number;
  matched?: number;
  missing?: boolean;
  lines: string[];
}

const SOURCES: { id: LogSource; label: string; file: string }[] = [
  { id: 'pdf2zh', label: 'pdf2zh 服务', file: '.runtime/pdf2zh-service.log' },
  { id: 'haila', label: '海拉启动', file: '.runtime/haila-boot.log' },
];

function formatBytes(bytes = 0): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

export function PdfTranslationLogsModal({
  open,
  onClose,
}: PdfTranslationLogsModalProps) {
  const [source, setSource] = useState<LogSource>('pdf2zh');
  const [search, setSearch] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [result, setResult] = useState<LogResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          source,
          limit: '700',
          ...(search.trim() ? { q: search.trim() } : {}),
        });
        const response = await fetch(`/api/pdf2zh/logs?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          let message = `HTTP ${response.status}`;
          try {
            const payload = (await response.json()) as { error?: string };
            if (payload.error) message = payload.error;
          } catch {
            // Keep the HTTP status when the body is not JSON.
          }
          throw new Error(message);
        }
        const payload = (await response.json()) as LogResult;
        if (cancelled) return;
        setResult(payload);
        setError('');
      } catch (caught) {
        if (cancelled || controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : '读取日志失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const initial = window.setTimeout(load, search.trim() ? 280 : 0);
    const interval = autoRefresh ? window.setInterval(load, 4000) : null;
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(initial);
      if (interval) window.clearInterval(interval);
    };
  }, [open, source, search, autoRefresh, refreshKey]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!open) return null;

  const lines = result?.lines ?? [];
  const activeSource = SOURCES.find((item) => item.id === source) ?? SOURCES[0];

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
    } catch {
      setError('复制失败，请使用下载按钮');
    }
  };

  const downloadLogs = () => {
    const blob = new Blob([lines.join('\n')], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `haila-${source}-logs-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}.log`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div
      className="pdf-logs-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="pdf-logs-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-logs-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="pdf-logs-head">
          <span className="pdf-logs-mark">
            <Bug size={17} />
          </span>
          <div>
            <span className="batch-kicker">PDF TRANSLATION DEBUG</span>
            <h2 id="pdf-logs-title">PDF 翻译日志</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="关闭日志"
          >
            <X size={17} />
          </button>
        </header>

        <div className="pdf-logs-toolbar">
          <div className="pdf-logs-tabs" role="tablist" aria-label="日志来源">
            {SOURCES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={source === item.id}
                className={source === item.id ? 'is-active' : ''}
                onClick={() => {
                  setSource(item.id);
                  setResult(null);
                  setError('');
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="pdf-logs-search">
            <Search size={13} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索 Traceback、error、任务 ID…"
              spellCheck={false}
              aria-label="搜索日志"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="清除搜索"
              >
                <X size={12} />
              </button>
            )}
          </label>
          <button
            type="button"
            className="pdf-logs-icon-button"
            onClick={() => setRefreshKey((value) => value + 1)}
            title="刷新日志"
            aria-label="刷新日志"
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
          <label className="pdf-logs-auto">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
            自动刷新
          </label>
        </div>

        <div className="pdf-logs-meta">
          <span>
            <FileText size={12} />
            {result?.path ?? activeSource.file}
          </span>
          {result?.truncated && <em>仅显示最近 2 MB</em>}
          {result?.missing && <em>日志文件尚未生成</em>}
          {!result?.missing && result && (
            <span>
              {formatBytes(result.size)} · {result.matched ?? 0} 条匹配 ·{' '}
              {formatTime(result.mtime)}
            </span>
          )}
        </div>

        {error && <div className="pdf-logs-error">{error}</div>}

        <div ref={logRef} className="pdf-logs-body" aria-live="polite">
          {loading && lines.length === 0 ? (
            <div className="pdf-logs-state">
              <Loader2 size={17} className="spin" />
              正在读取日志…
            </div>
          ) : lines.length === 0 ? (
            <div className="pdf-logs-state">
              {result?.missing
                ? '日志文件尚未生成。启动 pdf2zh 或发起一次翻译后再查看。'
                : search
                  ? '没有匹配的日志行。'
                  : '暂无日志。'}
            </div>
          ) : (
            <div className="pdf-logs-lines">
              {lines.map((line, index) => {
                const level = /traceback|exception|error|failed|fatal|错误|失败/i.test(
                  line,
                )
                  ? 'is-error'
                  : /\bwarn(?:ing)?\b/i.test(line)
                    ? 'is-warning'
                    : '';
                return (
                  <div className={`pdf-log-line ${level}`} key={index}>
                    <span className="pdf-log-number">{index + 1}</span>
                    <code>{line}</code>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <footer className="pdf-logs-foot">
          <span>
            完整日志按行读取，Key 等敏感字段会在返回前脱敏。
          </span>
          <div>
            <a
              className="pdf-logs-icon-button"
              href="http://127.0.0.1:8891/"
              target="_blank"
              rel="noreferrer"
              title="打开 pdf2zh 服务页面"
              aria-label="打开 pdf2zh 服务页面"
            >
              <ExternalLink size={13} />
            </a>
            <button
              type="button"
              className="pdf-logs-action"
              onClick={() => void copyLogs()}
              disabled={lines.length === 0}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? '已复制' : '复制'}
            </button>
            <button
              type="button"
              className="pdf-logs-action"
              onClick={downloadLogs}
              disabled={lines.length === 0}
            >
              <Download size={13} />
              下载
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
