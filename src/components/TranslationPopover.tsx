import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  KeyRound,
  Languages,
  Loader2,
  RotateCcw,
  X,
} from 'lucide-react';
import type { ModelConfig } from '../types';
import { streamTranslation } from '../lib/api';

interface TranslationPopoverProps {
  text: string;
  page: number;
  anchor: { top: number; bottom: number; left: number; width: number };
  pageContext: string;
  paperTitle: string;
  config: ModelConfig;
  modelReady: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

type TranslationStatus = 'loading' | 'done' | 'error' | 'needs-key';

function guessTarget(text: string): 'zh' | 'en' {
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const letters = (text.match(/[A-Za-z\u3400-\u9fff]/g) ?? []).length;
  return letters > 0 && cjk / letters > 0.25 ? 'en' : 'zh';
}

export function TranslationPopover({
  text,
  page,
  anchor,
  pageContext,
  paperTitle,
  config,
  modelReady,
  onClose,
  onOpenSettings,
}: TranslationPopoverProps) {
  const [translation, setTranslation] = useState('');
  const [status, setStatus] = useState<TranslationStatus>(
    modelReady ? 'loading' : 'needs-key',
  );
  const [error, setError] = useState('');
  const [targetLanguage, setTargetLanguage] = useState<'zh' | 'en'>(() =>
    guessTarget(text),
  );
  const [retryToken, setRetryToken] = useState(0);
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => {
    const viewportWidth = typeof window === 'undefined' ? 1200 : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight;
    const width = Math.min(372, viewportWidth - 24);
    const center = anchor.left + anchor.width / 2;
    const left = Math.max(
      width / 2 + 12,
      Math.min(viewportWidth - width / 2 - 12, center),
    );
    const margin = 12;
    const gap = 8;
    const aboveSpace = Math.max(0, anchor.top - margin - gap);
    const belowSpace = Math.max(0, viewportHeight - anchor.bottom - margin - gap);
    const putAbove = aboveSpace > 200 && aboveSpace >= belowSpace;
    const availableHeight = Math.max(160, putAbove ? aboveSpace : belowSpace);
    return {
      left,
      top: putAbove ? anchor.top - gap : anchor.bottom + gap,
      width,
      maxHeight: Math.min(430, availableHeight),
      transform: putAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
    };
  }, [anchor]);

  useEffect(() => {
    if (!modelReady) {
      setStatus('needs-key');
      setTranslation('');
      return;
    }
    const controller = new AbortController();
    let active = true;
    setTranslation('');
    setError('');
    setStatus('loading');
    setTargetLanguage(guessTarget(text));

    void streamTranslation({
      text,
      context: pageContext.slice(0, 2600),
      paperTitle,
      config,
      signal: controller.signal,
      onEvent: (event) => {
        if (!active) return;
        if (event.type === 'meta' && event.targetLanguage) {
          setTargetLanguage(event.targetLanguage);
        } else if (event.type === 'delta' && event.text) {
          setTranslation((current) => current + event.text);
        } else if (event.type === 'done') {
          setStatus('done');
        } else if (event.type === 'error') {
          setError(event.message || '翻译失败');
          setStatus('error');
        }
      },
    })
      .then(() => {
        if (!active) return;
        setStatus((current) => (current === 'loading' ? 'done' : current));
      })
      .catch((reason: unknown) => {
        if (!active || controller.signal.aborted) return;
        const typed = reason as Error & { code?: string };
        if (typed.code === 'NO_API_KEY') {
          setStatus('needs-key');
          return;
        }
        setError(typed.message || '翻译失败，请稍后重试');
        setStatus('error');
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [text, pageContext, paperTitle, config, modelReady, retryToken]);

  const copy = async () => {
    if (!translation) return;
    try {
      await navigator.clipboard.writeText(translation);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be denied; the translation stays selectable.
    }
  };

  const targetLabel = targetLanguage === 'zh' ? '中文' : 'English';
  const isStreaming = status === 'loading';

  return (
    <div
      ref={popoverRef}
      className="translation-popover"
      style={{
        left: layout.left,
        top: layout.top,
        width: layout.width,
        maxHeight: layout.maxHeight,
        transform: layout.transform,
      }}
      role="dialog"
      aria-label="划词翻译"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="translation-head">
        <span className="translation-icon">
          <Languages size={15} strokeWidth={1.9} />
        </span>
        <div className="translation-heading">
          <strong>划词翻译</strong>
          <span>
            译为 {targetLabel} · 第 {page} 页
          </span>
        </div>
        {isStreaming && <Loader2 size={14} className="spin translation-spinner" />}
        <button type="button" className="translation-close" onClick={onClose} aria-label="关闭翻译">
          <X size={14} />
        </button>
      </div>

      <div className="translation-source" title={text}>
        {text}
      </div>

      {status === 'needs-key' ? (
        <div className="translation-connect">
          <span className="translation-connect-icon">
            <KeyRound size={16} />
          </span>
          <div>
            <strong>配置模型后自动翻译</strong>
            <p>划词翻译会使用你为海拉配置的模型。</p>
          </div>
          <button type="button" onClick={onOpenSettings}>
            去配置
          </button>
        </div>
      ) : (
        <div className={`translation-result ${isStreaming ? 'is-streaming' : ''}`}>
          {translation || (isStreaming ? '' : '（没有返回译文）')}
          {isStreaming && <span className="translation-caret" />}
        </div>
      )}

      {status === 'error' && (
        <div className="translation-error">
          <span>{error || '翻译失败，请重试。'}</span>
          <button type="button" onClick={() => setRetryToken((value) => value + 1)}>
            <RotateCcw size={12} />
            重试
          </button>
        </div>
      )}

      <div className="translation-foot">
        <span>{isStreaming ? '正在翻译选中文本…' : '仅翻译，不发送到对话'}</span>
        <div>
          <button
            type="button"
            className="translation-action"
            onClick={copy}
            disabled={!translation}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? '已复制' : '复制'}
          </button>
          <button type="button" className="translation-action" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}