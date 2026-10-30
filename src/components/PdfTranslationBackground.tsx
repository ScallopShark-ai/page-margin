import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, X } from 'lucide-react';

export interface BackgroundPdfJob {
  paperId: string;
  title: string;
  status: 'running' | 'error';
  progress: number;
  error: string;
}

interface PdfTranslationBackgroundProps {
  job: BackgroundPdfJob;
  runningCount: number;
  onOpenLogs: () => void;
  onDismiss: () => void;
}

export function PdfTranslationBackground({
  job,
  runningCount,
  onOpenLogs,
  onDismiss,
}: PdfTranslationBackgroundProps) {
  const [collapsed, setCollapsed] = useState(false);
  const hoveredRef = useRef(false);

  useEffect(() => {
    if (job.status !== 'running') {
      setCollapsed(false);
      return;
    }
    setCollapsed(false);
    const timer = window.setTimeout(() => {
      if (!hoveredRef.current) setCollapsed(true);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [job.paperId, job.status]);

  const expand = () => {
    hoveredRef.current = true;
    setCollapsed(false);
  };

  const collapse = () => {
    hoveredRef.current = false;
    if (job.status === 'running') setCollapsed(true);
  };

  return (
    <div
      className={`pdf-translation-background ${
        job.status === 'error' ? 'is-error' : ''
      } ${collapsed ? 'is-collapsed' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={`PDF 翻译：${job.title}`}
      tabIndex={collapsed ? 0 : -1}
      title={collapsed ? `${job.title} · 点击展开` : undefined}
      onMouseEnter={expand}
      onMouseLeave={collapse}
      onFocus={expand}
      onBlur={collapse}
      onClick={() => {
        if (collapsed) expand();
      }}
      onKeyDown={(event) => {
        if (collapsed && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          expand();
        }
      }}
    >
      <span className="pdf-translation-background-mark">
        {job.status === 'running' ? (
          <Loader2 size={16} className="spin" />
        ) : (
          <AlertCircle size={16} />
        )}
      </span>
      <div className="pdf-translation-background-copy">
        <strong>
          {job.status === 'running'
            ? runningCount > 1
              ? `正在后台翻译 ${runningCount} 篇 PDF`
              : '正在后台翻译 PDF'
            : 'PDF 翻译失败'}
        </strong>
        <span title={job.title}>
          {job.title}
          {job.status === 'running'
            ? job.progress > 1
              ? ` · ${job.progress}%`
              : ' · 处理中'
            : ` · ${job.error}`}
        </span>
        {job.status === 'running' && (
          <span className="pdf-translation-background-track">
            <i style={{ width: `${Math.max(2, job.progress)}%` }} />
          </span>
        )}
      </div>
      <button
        type="button"
        className="pdf-translation-background-log"
        onClick={(event) => {
          event.stopPropagation();
          onOpenLogs();
        }}
      >
        日志
      </button>
      {job.status === 'error' && (
        <button
          type="button"
          className="pdf-translation-background-close"
          onClick={(event) => {
            event.stopPropagation();
            onDismiss();
          }}
          aria-label="关闭翻译失败提示"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
