import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Server,
  Sparkles,
  X,
} from 'lucide-react';
import { PROVIDERS } from '../lib/config';
import type { ModelConfig, ProviderId, ServerConfig } from '../types';

interface SettingsModalProps {
  open: boolean;
  config: ModelConfig;
  server: ServerConfig | null;
  onClose: () => void;
  onSave: (config: ModelConfig) => void;
}

const PROVIDER_ORDER: ProviderId[] = ['deepseek', 'openai', 'anthropic', 'custom'];

const KEY_LINKS: Record<ProviderId, string | null> = {
  deepseek: 'https://platform.deepseek.com/api_keys',
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  custom: null,
};

export function SettingsModal({ open, config, server, onClose, onSave }: SettingsModalProps) {
  const [draft, setDraft] = useState<ModelConfig>(config);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(config);
    setShowKey(false);
    setError('');
    const timer = window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [open, config]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const chooseProvider = (provider: ProviderId) => {
    setDraft((current) => ({
      ...current,
      provider,
      baseUrl: PROVIDERS[provider].baseUrl,
      model: PROVIDERS[provider].model,
      apiKey: provider === current.provider ? current.apiKey : '',
    }));
    setError('');
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: ModelConfig = {
      ...draft,
      apiKey: draft.apiKey.trim(),
      baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
      model: draft.model.trim(),
    };
    if (!next.model) {
      setError('请填写模型名称');
      return;
    }
    if (next.provider !== 'custom' && !next.baseUrl) {
      next.baseUrl = PROVIDERS[next.provider].baseUrl;
    }
    if (next.baseUrl) {
      try {
        const url = new URL(next.baseUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('bad protocol');
      } catch {
        setError('Base URL 需要是完整的 http(s) 地址');
        return;
      }
    } else if (next.provider === 'custom') {
      setError('请填写 API Base URL');
      return;
    }
    onSave(next);
  };

  const provider = PROVIDERS[draft.provider];
  const keyLink = KEY_LINKS[draft.provider];
  const usesServerKey =
    Boolean(server?.serverConfigured) &&
    server?.provider === draft.provider &&
    !draft.apiKey.trim();

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        ref={dialogRef}
      >
        <div className="settings-head">
          <div>
            <span className="card-kicker">MODEL CONNECTION</span>
            <h2 id="settings-title">连接 AI 模型</h2>
            <p>页边通过你选择的模型来解读论文。</p>
          </div>
          <button type="button" className="icon-button modal-close" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        {server?.serverConfigured && (
          <div className="server-banner">
            <Server size={16} strokeWidth={1.8} />
            <div>
              <strong>此站点已配置服务器模型</strong>
              <span>
                {PROVIDERS[server.provider]?.label ?? server.provider} · {server.model}
                。留空 Key 即可直接使用。
              </span>
            </div>
          </div>
        )}

        <form onSubmit={submit} className="settings-form">
          <fieldset className="provider-fieldset">
            <legend>服务商</legend>
            <div className="provider-grid">
              {PROVIDER_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`provider-option ${draft.provider === id ? 'is-active' : ''}`}
                  onClick={() => chooseProvider(id)}
                >
                  <span className="provider-monogram">
                    {id === 'deepseek' ? 'DS' : id === 'openai' ? 'OA' : id === 'anthropic' ? 'AN' : '··'}
                  </span>
                  <span>{PROVIDERS[id].label}</span>
                  {draft.provider === id && <Check size={14} className="provider-check" />}
                </button>
              ))}
            </div>
            <p className="field-hint">{provider.hint}</p>
          </fieldset>

          <div className="field-row">
            <label className="settings-field">
              <span>模型名称</span>
              <input
                value={draft.model}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, model: event.target.value }))
                }
                placeholder={provider.model}
                spellCheck={false}
              />
            </label>
            <label className="settings-field">
              <span>API Base URL</span>
              <input
                value={draft.baseUrl}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, baseUrl: event.target.value }))
                }
                placeholder={provider.baseUrl}
                spellCheck={false}
              />
            </label>
          </div>

          <label className="settings-field">
            <span className="label-with-icon">
              <KeyRound size={14} strokeWidth={1.8} />
              API Key
              {usesServerKey && <em>可留空，使用服务器配置</em>}
            </span>
            <div className="password-field">
              <input
                type={showKey ? 'text' : 'password'}
                value={draft.apiKey}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, apiKey: event.target.value }))
                }
                placeholder={draft.provider === 'custom' ? provider.keyPlaceholder : 'sk-…'}
                spellCheck={false}
                autoComplete="off"
                aria-label="API Key"
              />
              <button
                type="button"
                className="reveal-button"
                onClick={() => setShowKey((value) => !value)}
                aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <div className="key-help">
              <span>密钥只保存在当前浏览器，不会写入服务器。</span>
              {keyLink && (
                <a href={keyLink} target="_blank" rel="noreferrer">
                  获取 Key <ExternalLink size={11} />
                </a>
              )}
            </div>
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.remember}
              onChange={(event) =>
                setDraft((current) => ({ ...current, remember: event.target.checked }))
              }
            />
            <span className="fake-checkbox">
              <Check size={11} />
            </span>
            <span>
              在这台电脑上记住配置
              <small>{draft.remember ? '关闭浏览器后仍保留' : '仅保留到本次标签页关闭'}</small>
            </span>
          </label>

          {draft.provider === 'custom' && (
            <div className="local-hint">
              <Sparkles size={15} />
              <span>
                本地服务（localhost / 127.0.0.1）可以留空 Key。例如 Ollama 的 OpenAI
                兼容地址为 <code>http://127.0.0.1:11434/v1</code>。
              </span>
            </div>
          )}

          {error && <p className="settings-error">{error}</p>}

          <div className="settings-actions">
            <span className="security-note">
              <LockKeyhole size={13} />
              请求由本地服务转发，不经过第三方中转。
            </span>
            <div>
              <button type="button" className="text-button" onClick={onClose}>
                取消
              </button>
              <button type="submit" className="primary-button">
                保存并使用
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
