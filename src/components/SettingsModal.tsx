import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Bookmark,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Languages,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  Server,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { fetchModelList } from '../lib/api';
import { PROVIDERS } from '../lib/config';
import {
  loadSavedModels,
  profileToConfig,
  removeSavedModel,
  upsertSavedModel,
  type SavedModelProfile,
} from '../lib/modelProfiles';
import type {
  ModelConfig,
  ModelListItem,
  ProviderId,
  ServerConfig,
} from '../types';
import type { Pdf2zhConfig, Pdf2zhEngine } from '../lib/pdfTranslation';

interface SettingsModalProps {
  open: boolean;
  config: ModelConfig;
  server: ServerConfig | null;
  pdf2zhConfig: Pdf2zhConfig;
  onClose: () => void;
  onSave: (config: ModelConfig) => void;
  onSavePdf2zh: (config: Pdf2zhConfig) => void;
}

const PROVIDER_ORDER: ProviderId[] = ['deepseek', 'openai', 'anthropic', 'custom'];

const KEY_LINKS: Record<ProviderId, string | null> = {
  deepseek: 'https://platform.deepseek.com/api_keys',
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  custom: null,
};

function providerMonogram(id: ProviderId): string {
  if (id === 'deepseek') return 'DS';
  if (id === 'openai') return 'OA';
  if (id === 'anthropic') return 'AN';
  return '··';
}

export function SettingsModal({
  open,
  config,
  server,
  pdf2zhConfig,
  onClose,
  onSave,
  onSavePdf2zh,
}: SettingsModalProps) {
  const [draft, setDraft] = useState<ModelConfig>(config);
  const [pdf2zhDraft, setPdf2zhDraft] = useState<Pdf2zhConfig>(pdf2zhConfig);
  const [showKey, setShowKey] = useState(false);
  const [showPdfKey, setShowPdfKey] = useState(false);
  const [error, setError] = useState('');
  const [modelOptions, setModelOptions] = useState<ModelListItem[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [profiles, setProfiles] = useState<SavedModelProfile[]>([]);
  const [savedNotice, setSavedNotice] = useState('');
  const modelsAbortRef = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(config);
    setPdf2zhDraft(pdf2zhConfig);
    setShowKey(false);
    setShowPdfKey(false);
    setError('');
    setProfiles(loadSavedModels());
    setSavedNotice('');
    const timer = window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [open, config, pdf2zhConfig]);

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

  useEffect(() => {
    modelsAbortRef.current?.abort();
    modelsAbortRef.current = null;
    setModelsLoading(false);
    setModelOptions([]);
    setModelsError('');
    setModelPickerOpen(false);
    setModelSearch('');
  }, [open, draft.provider, draft.baseUrl, draft.apiKey]);

  useEffect(() => {
    if (!savedNotice) return;
    const timer = window.setTimeout(() => setSavedNotice(''), 2600);
    return () => window.clearTimeout(timer);
  }, [savedNotice]);

  if (!open) return null;

  const loadModels = async () => {
    const baseUrl = draft.baseUrl.trim() || PROVIDERS[draft.provider].baseUrl;
    setModelPickerOpen(true);
    setModelsError('');
    setModelSearch('');
    if (!baseUrl) {
      setModelsError('请先填写 API Base URL');
      return;
    }
    try {
      const parsed = new URL(baseUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('bad protocol');
      }
    } catch {
      setModelsError('Base URL 需要是完整的 http(s) 地址');
      return;
    }

    modelsAbortRef.current?.abort();
    const controller = new AbortController();
    modelsAbortRef.current = controller;
    setModelsLoading(true);
    try {
      const options = await fetchModelList(
        {
          provider: draft.provider,
          apiKey: draft.apiKey.trim(),
          baseUrl,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setModelOptions(options);
      if (options.length === 0) {
        setModelsError('接口返回了 0 个模型，请检查这个网关是否开放 /models');
      }
    } catch (caught) {
      if (controller.signal.aborted) return;
      setModelsError(
        caught instanceof Error ? caught.message : '读取模型列表失败',
      );
    } finally {
      if (modelsAbortRef.current === controller) {
        modelsAbortRef.current = null;
        setModelsLoading(false);
      }
    }
  };

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

  const normalizeDraft = (): ModelConfig | null => {
    const next: ModelConfig = {
      ...draft,
      apiKey: draft.apiKey.trim(),
      baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
      model: draft.model.trim(),
    };
    if (!next.model) {
      setError('请填写模型名称');
      return null;
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
        return null;
      }
    } else if (next.provider === 'custom') {
      setError('请填写 API Base URL');
      return null;
    }
    return next;
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextPdf2zh: Pdf2zhConfig = {
      baseUrl: pdf2zhDraft.baseUrl.trim().replace(/\/+$/, ''),
      engine: pdf2zhDraft.engine,
      service: pdf2zhDraft.service.trim(),
      apiUrl: pdf2zhDraft.apiUrl.trim().replace(/\/+$/, ''),
      apiKey: pdf2zhDraft.apiKey.trim(),
      model: pdf2zhDraft.model.trim(),
    };
    if (nextPdf2zh.baseUrl) {
      try {
        const url = new URL(nextPdf2zh.baseUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('bad protocol');
      } catch {
        setError('PDF 翻译服务地址需要是完整的 http(s) 地址');
        return;
      }
    }
    if (!nextPdf2zh.apiKey || !nextPdf2zh.apiUrl || !nextPdf2zh.model) {
      setError('PDF 全文翻译必须配置 DeepSeek API Key、Base URL 和模型');
      return;
    }
    const next = normalizeDraft();
    if (!next) return;
    setProfiles(upsertSavedModel(profiles, next));
    onSavePdf2zh(nextPdf2zh);
    onSave(next);
  };

  const saveCurrentProfile = () => {
    const next = normalizeDraft();
    if (!next) return;
    setProfiles(upsertSavedModel(profiles, next));
    setSavedNotice('已保存当前模型');
    setError('');
  };

  const useSavedProfile = (profile: SavedModelProfile) => {
    onSave(profileToConfig(profile, draft.remember));
  };

  const deleteSavedProfile = (profile: SavedModelProfile) => {
    if (!window.confirm(`删除常用模型「${profile.name}」？`)) return;
    setProfiles(removeSavedModel(profiles, profile.id));
    setSavedNotice('已删除常用模型');
  };

  const provider = PROVIDERS[draft.provider];
  const keyLink = KEY_LINKS[draft.provider];
  const usesServerKey =
    Boolean(server?.serverConfigured) &&
    server?.provider === draft.provider &&
    !draft.apiKey.trim();
  const normalizedSearch = modelSearch.trim().toLowerCase();
  const filteredModels = normalizedSearch
    ? modelOptions.filter((model) =>
        `${model.id} ${model.name ?? ''} ${model.ownedBy ?? ''}`
          .toLowerCase()
          .includes(normalizedSearch),
      )
    : modelOptions;

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
            <p>海拉通过你选择的模型来解读论文。</p>
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
          <section className="saved-models" aria-label="常用模型">
            <div className="saved-models-head">
              <span>
                <Bookmark size={13} strokeWidth={1.8} />
                常用模型
                {profiles.length > 0 && <em>{profiles.length}</em>}
              </span>
              <button
                type="button"
                className="saved-save-button"
                onClick={saveCurrentProfile}
              >
                <Plus size={12} />
                保存当前配置
              </button>
            </div>

            {savedNotice && (
              <p className="saved-notice" role="status">
                {savedNotice}
              </p>
            )}

            {profiles.length === 0 ? (
              <p className="saved-models-empty">
                配置好模型后点「保存当前配置」，下次可以直接使用，不用重新填写 Key 和地址。
              </p>
            ) : (
              <div className="saved-model-list">
                {profiles.map((profile) => (
                  <div className="saved-model-row" key={profile.id}>
                    <span className="saved-model-monogram">
                      {providerMonogram(profile.provider)}
                    </span>
                    <div className="saved-model-copy">
                      <strong>{profile.name}</strong>
                      <span>
                        {profile.baseUrl} ·{' '}
                        {profile.apiKey ? '已保存 Key' : '无 Key / 服务器 Key'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="saved-use-button"
                      onClick={() => useSavedProfile(profile)}
                    >
                      使用
                    </button>
                    <button
                      type="button"
                      className="saved-delete-button"
                      onClick={() => deleteSavedProfile(profile)}
                      aria-label={`删除常用模型 ${profile.name}`}
                      title="删除常用模型"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <p className="saved-models-note">
              <KeyRound size={11} />
              常用模型包含 API Key，只保存在当前浏览器。
            </p>
          </section>

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
                    {providerMonogram(id)}
                  </span>
                  <span>{PROVIDERS[id].label}</span>
                  {draft.provider === id && <Check size={14} className="provider-check" />}
                </button>
              ))}
            </div>
            <p className="field-hint">{provider.hint}</p>
          </fieldset>

          <div className="field-row">
            <div className="settings-field">
              <span className="model-field-head">
                模型名称
                <button
                  type="button"
                  className="model-fetch-button"
                  onClick={() => void loadModels()}
                  disabled={modelsLoading}
                  aria-expanded={modelPickerOpen}
                  aria-controls="model-picker"
                  title="从 Base URL 读取可用模型"
                >
                  {modelsLoading ? (
                    <Loader2 size={11} className="spin" />
                  ) : (
                    <RefreshCw size={11} />
                  )}
                  {modelsLoading ? '读取中' : modelOptions.length > 0 ? '刷新' : '获取列表'}
                </button>
              </span>
              <input
                value={draft.model}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, model: event.target.value }))
                }
                placeholder={provider.model}
                spellCheck={false}
                aria-label="模型名称"
              />
            </div>
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

          {modelPickerOpen && (
            <div className="model-picker" id="model-picker" aria-live="polite">
              <div className="model-picker-head">
                <div>
                  <strong>可用模型</strong>
                  <span>
                    {modelsLoading
                      ? '正在从接口读取…'
                      : `${modelOptions.length} 个模型`}
                  </span>
                </div>
                <button
                  type="button"
                  className="model-picker-close"
                  onClick={() => setModelPickerOpen(false)}
                  aria-label="收起模型列表"
                >
                  <X size={14} />
                </button>
              </div>

              {modelsLoading ? (
                <div className="model-picker-state">
                  <Loader2 size={15} className="spin" />
                  正在连接模型网关…
                </div>
              ) : modelsError ? (
                <div className="model-picker-state is-error">
                  <AlertCircle size={15} />
                  <div>
                    <span>{modelsError}</span>
                    <button type="button" onClick={() => void loadModels()}>
                      重试
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {modelOptions.length > 5 && (
                    <label className="model-picker-search">
                      <Search size={13} />
                      <input
                        value={modelSearch}
                        onChange={(event) => setModelSearch(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') return;
                          event.preventDefault();
                          const first = filteredModels[0];
                          if (!first) return;
                          setDraft((current) => ({
                            ...current,
                            model: first.id,
                          }));
                          setModelPickerOpen(false);
                          setError('');
                        }}
                        placeholder="搜索模型名称"
                        spellCheck={false}
                        autoFocus
                        aria-label="搜索模型"
                      />
                    </label>
                  )}
                  {filteredModels.length === 0 ? (
                    <div className="model-picker-state">
                      没有匹配的模型
                    </div>
                  ) : (
                    <div className="model-picker-list">
                      {filteredModels.map((option) => {
                        const selected = draft.model === option.id;
                        return (
                          <button
                            type="button"
                            key={option.id}
                            className={`model-option ${selected ? 'is-active' : ''}`}
                            onClick={() => {
                              setDraft((current) => ({
                                ...current,
                                model: option.id,
                              }));
                              setModelPickerOpen(false);
                              setError('');
                            }}
                            title={option.name || option.id}
                          >
                            <span className="model-option-text">
                              <strong>{option.id}</strong>
                              {option.name && <small>{option.name}</small>}
                            </span>
                            {option.ownedBy && (
                              <em className="model-option-owner">{option.ownedBy}</em>
                            )}
                            {selected && <Check size={13} />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              <p className="model-picker-note">
                列表来自当前 Base URL 的模型接口；选择后仍可手动修改模型名称。
              </p>
            </div>
          )}

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

          <section className="settings-pdf2zh" aria-label="PDF 全文翻译">
            <div className="settings-pdf2zh-head">
              <span>
                <Languages size={14} />
                PDF 全文翻译
              </span>
              <em>首次必配</em>
            </div>
            <p>
              连接本机的 zotero-pdf2zh 服务。首次在阅读器点击「翻译 PDF」时，
              会生成中文单语 PDF，并在原阅读器中切换显示。
            </p>
            <label className="settings-field">
              服务地址
              <input
                value={pdf2zhDraft.baseUrl}
                onChange={(event) =>
                  setPdf2zhDraft((current) => ({
                    ...current,
                    baseUrl: event.target.value,
                  }))
                }
                placeholder="http://127.0.0.1:8891"
                spellCheck={false}
                aria-label="PDF 翻译服务地址"
              />
            </label>
            <div className="settings-pdf2zh-grid">
              <label className="settings-field">
                翻译引擎
                <select
                  value={pdf2zhDraft.engine}
                  onChange={(event) =>
                    setPdf2zhDraft((current) => ({
                      ...current,
                      engine: event.target.value as Pdf2zhEngine,
                    }))
                  }
                  aria-label="PDF 翻译引擎"
                >
                  <option value="pdf2zh_next">pdf2zh_next / BabelDOC</option>
                  <option value="pdf2zh">pdf2zh 1.x</option>
                </select>
              </label>
              <label className="settings-field">
                翻译服务
                <input
                  value={pdf2zhDraft.service}
                  onChange={(event) =>
                    setPdf2zhDraft((current) => ({
                      ...current,
                      service: event.target.value,
                    }))
                  }
                  placeholder={
                    pdf2zhDraft.engine === 'pdf2zh' ? 'bing' : 'deepseek'
                  }
                  spellCheck={false}
                  aria-label="PDF 翻译服务"
                />
              </label>
            </div>
            <label className="settings-field">
              DeepSeek API Base URL
              <input
                value={pdf2zhDraft.apiUrl}
                onChange={(event) =>
                  setPdf2zhDraft((current) => ({
                    ...current,
                    apiUrl: event.target.value,
                  }))
                }
                placeholder="https://api.deepseek.com"
                spellCheck={false}
                aria-label="DeepSeek 翻译 API Base URL"
              />
            </label>
            <label className="settings-field">
              DeepSeek API Key
              <div className="deepseek-key-field">
                <span className="deepseek-key-icon">
                  <KeyRound size={14} />
                </span>
                <input
                  type={showPdfKey ? 'text' : 'password'}
                  value={pdf2zhDraft.apiKey}
                  onChange={(event) =>
                    setPdf2zhDraft((current) => ({
                      ...current,
                      apiKey: event.target.value,
                    }))
                  }
                  placeholder="sk-…"
                  spellCheck={false}
                  autoComplete="off"
                  aria-label="DeepSeek 翻译 API Key"
                />
                <button
                  type="button"
                  className="reveal-button"
                  onClick={() => setShowPdfKey((value) => !value)}
                  aria-label={showPdfKey ? '隐藏翻译 API Key' : '显示翻译 API Key'}
                >
                  {showPdfKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </label>
            <label className="settings-field">
              DeepSeek 翻译模型
              <input
                value={pdf2zhDraft.model}
                onChange={(event) =>
                  setPdf2zhDraft((current) => ({
                    ...current,
                    model: event.target.value,
                  }))
                }
                placeholder="deepseek-chat"
                spellCheck={false}
                aria-label="DeepSeek 翻译模型"
              />
            </label>
            <p className="settings-pdf2zh-hint">
              服务名称需与 pdf2zh 服务端配置一致，例如 openai、deepseek、bing。
              DeepSeek Key 保存在当前浏览器，用于整篇 PDF 翻译；本地运行时不写入
              项目仓库。这里只生成中文单语 PDF，不额外显示双语文件。
            </p>
          </section>

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
