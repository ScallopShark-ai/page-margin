import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Languages,
  LockKeyhole,
} from 'lucide-react';
import {
  applyPdf2zhApiUrl,
  PDF2ZH_SERVICE_OPTIONS,
  type Pdf2zhConfig,
} from '../lib/pdfTranslation';

interface DeepSeekSetupModalProps {
  open: boolean;
  initial: Pdf2zhConfig;
  onSave: (config: Pdf2zhConfig) => void;
}

export function DeepSeekSetupModal({
  open,
  initial,
  onSave,
}: DeepSeekSetupModalProps) {
  const [draft, setDraft] = useState<Pdf2zhConfig>(initial);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(initial);
    setShowKey(false);
    setError('');
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
    };
    // Seed once when the mandatory modal opens; typing must not be reset by a
    // parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const apiUrl = draft.apiUrl.trim().replace(/\/+$/, '');
    const apiKey = draft.apiKey.trim();
    const model = draft.model.trim();
    try {
      const url = new URL(apiUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
    } catch {
      setError('请填写有效的 API Base URL');
      return;
    }
    if (!apiKey) {
      setError('请填写 API Key');
      return;
    }
    if (!model) {
      setError('请填写模型名称');
      return;
    }
    setError('');
    onSave({ ...draft, apiUrl, apiKey, model });
  };

  return (
    <div className="deepseek-setup-backdrop">
      <div
        className="deepseek-setup-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="deepseek-setup-title"
      >
        <div className="deepseek-setup-mark">
          <Languages size={21} />
        </div>
        <span className="card-kicker">FIRST RUN SETUP</span>
        <h2 id="deepseek-setup-title">配置翻译模型 API</h2>
        <p className="deepseek-setup-lead">
          填写任意 OpenAI 兼容服务的 API。「翻译 PDF」会使用这里的模型；
          也可以使用 DeepSeek、OpenAI 或自己的网关。
        </p>

        <form onSubmit={submit}>
          <label className="settings-field">
            接口类型
            <select
              value={draft.service}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  service: event.target.value,
                }))
              }
              aria-label="PDF 翻译接口类型"
            >
              {PDF2ZH_SERVICE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              {!PDF2ZH_SERVICE_OPTIONS.some(
                (option) => option.value === draft.service,
              ) && (
                <option value={draft.service}>
                  {draft.service || '自定义服务'}
                </option>
              )}
            </select>
          </label>

          <label className="settings-field">
            API Base URL
            <input
              ref={inputRef}
              value={draft.apiUrl}
              onChange={(event) =>
                setDraft((current) =>
                  applyPdf2zhApiUrl(current, event.target.value),
                )
              }
              placeholder={
                draft.service === 'deepseek'
                  ? 'https://api.deepseek.com'
                  : draft.service === 'openai'
                    ? 'https://api.openai.com/v1'
                    : 'https://your-api.example.com/v1'
              }
              spellCheck={false}
              autoComplete="url"
              aria-label="翻译 API Base URL"
            />
          </label>

          <label className="settings-field">
            API Key
            <div className="deepseek-key-field">
              <span className="deepseek-key-icon">
                <KeyRound size={14} />
              </span>
              <input
                type={showKey ? 'text' : 'password'}
                value={draft.apiKey}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    apiKey: event.target.value,
                  }))
                }
                placeholder="sk-…"
                spellCheck={false}
                autoComplete="off"
                aria-label="翻译 API Key"
              />
              <button
                type="button"
                className="reveal-button"
                onClick={() => setShowKey((value) => !value)}
                aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
              >
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </label>

          <label className="settings-field">
            模型名称
            <input
              value={draft.model}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  model: event.target.value,
                }))
              }
              placeholder={
                draft.service === 'deepseek'
                  ? 'deepseek-flash'
                  : draft.service === 'openai'
                    ? 'gpt-4o-mini'
                    : '你的模型名称'
              }
              spellCheck={false}
              aria-label="PDF 翻译模型"
            />
          </label>

          {error && (
            <p className="settings-error" role="alert">
              {error}
            </p>
          )}

          <div className="deepseek-setup-note">
            <LockKeyhole size={13} />
            <span>
              Key 保存在当前浏览器，用于 PDF 全文翻译。选择 DeepSeek 且尚未配置
              对话模型时，也会作为默认对话模型。
            </span>
          </div>

          <button type="submit" className="primary-button deepseek-setup-save">
            <Check size={15} />
            保存并开始使用
          </button>
        </form>
      </div>
    </div>
  );
}
