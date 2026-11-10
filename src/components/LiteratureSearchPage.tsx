import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUp,
  BookPlus,
  Check,
  FolderInput,
  Globe2,
  Loader2,
  MessageSquarePlus,
  Search,
  Settings2,
  Sparkles,
  Square,
} from 'lucide-react';
import type { Folder, ModelConfig } from '../types';
import { streamLiteratureSearch } from '../lib/api';
import { importBatchItem } from '../lib/batchImport';
import { folderPathLabel } from '../lib/library';
import { MarkdownMessage } from './MarkdownMessage';

interface LiteratureSearchPageProps {
  open: boolean;
  config: ModelConfig;
  modelReady: boolean;
  folders: Folder[];
  onClose: () => void;
  onOpenSettings: () => void;
  onImported: () => void;
}

interface SearchMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: 'streaming' | 'done' | 'error' | 'stopped';
  error?: string;
}

interface ImportableLink {
  url: string;
  label: string;
}

const WELCOME = `你好，我是**文献雷达**。

告诉我你的研究方向、目标年份、方法或应用场景，我会联网检索真实存在的论文，并整理成可以直接导入文库的链接。

你可以在右上角选择一个**固定导入位置**，然后逐篇或批量导入结果。`;

const SUGGESTIONS = [
  '找近三年关于多模态推理的顶会论文',
  '找一篇适合入门的扩散模型综述',
  '找用强化学习做代码生成的论文',
];

function newMessageId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `search-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isImportableUrl(url: string): boolean {
  return (
    /^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i.test(url) ||
    /\.pdf(?:[?#]|$)/i.test(url) ||
    /\/pdf(?:[?#/]|$)/i.test(url)
  );
}

function linkLabel(url: string): string {
  const arxiv = url.match(/arxiv\.org\/(?:abs|pdf)\/([^/?#]+)/i);
  if (arxiv) return `arXiv · ${arxiv[1].replace(/\.pdf$/i, '')}`;
  try {
    const parsed = new URL(url);
    const file = parsed.pathname.split('/').filter(Boolean).at(-1);
    return file ? decodeURIComponent(file) : parsed.hostname;
  } catch {
    return url;
  }
}

function extractImportableLinks(content: string): ImportableLink[] {
  const raw = content.match(/https?:\/\/[^\s<>"'`]+/g) ?? [];
  const seen = new Set<string>();
  const links: ImportableLink[] = [];
  for (const match of raw) {
    const url = match.replace(/[.,;:!?）)\]}]+$/g, '');
    if (!url || seen.has(url) || !isImportableUrl(url)) continue;
    seen.add(url);
    links.push({ url, label: linkLabel(url) });
  }
  return links.slice(0, 12);
}

export function LiteratureSearchPage({
  open,
  config,
  modelReady,
  folders,
  onClose,
  onOpenSettings,
  onImported,
}: LiteratureSearchPageProps) {
  const [messages, setMessages] = useState<SearchMessage[]>(() => [
    {
      id: 'welcome',
      role: 'assistant',
      content: WELCOME,
      status: 'done',
    },
  ]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);
  const [importingUrl, setImportingUrl] = useState<string | null>(null);
  const [imported, setImported] = useState<
    Record<string, { title: string; folder: string }>
  >({});
  const [searchMode, setSearchMode] = useState<'web' | 'openalex'>(
    config.provider === 'openai' ? 'web' : 'openalex',
  );
  const abortRef = useRef<AbortController | null>(null);
  const importingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const targetFolderName = targetFolderId
    ? folderPathLabel(folders, targetFolderId) || '文件夹'
    : '未分类';
  const onlyWelcome = messages.length === 1;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 80);
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
  }, [open, messages, streaming]);

  useEffect(() => {
    setSearchMode(config.provider === 'openai' ? 'web' : 'openalex');
  }, [config.provider]);

  useEffect(() => {
    if (!open) return;
    if (
      targetFolderId &&
      !folders.some((folder) => folder.id === targetFolderId)
    ) {
      setTargetFolderId(null);
    }
  }, [open, folders, targetFolderId]);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      setStreaming(false);
    }
  }, [open]);

  if (!open) return null;

  const resetConversation = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setError('');
    setInput('');
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: WELCOME,
        status: 'done',
      },
    ]);
  };

  const updateAssistant = (
    id: string,
    updater: (message: SearchMessage) => SearchMessage,
  ) => {
    setMessages((current) =>
      current.map((message) => (message.id === id ? updater(message) : message)),
    );
  };

  const send = async (rawText?: string) => {
    const text = (rawText ?? input).trim();
    if (!text || streaming) return;
    if (!modelReady) {
      setError('请先配置可用的 OpenAI 模型和 API Key。');
      return;
    }

    const userMessage: SearchMessage = {
      id: newMessageId(),
      role: 'user',
      content: text,
      status: 'done',
    };
    const assistantId = newMessageId();
    const assistantMessage: SearchMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      status: 'streaming',
    };
    const requestMessages = [...messages, userMessage]
      .filter((message) => message.role === 'user' || message.content.trim())
      .map((message) => ({ role: message.role, content: message.content }));

    setMessages((current) => [...current, userMessage, assistantMessage]);
    setInput('');
    setError('');
    setStreaming(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamLiteratureSearch({
        messages: requestMessages,
        config,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'meta' && event.meta?.searchMode) {
            setSearchMode(event.meta.searchMode);
            return;
          }
          if (event.type === 'delta' && event.text) {
            updateAssistant(assistantId, (message) => ({
              ...message,
              content: message.content + event.text,
            }));
            return;
          }
          if (event.type === 'done') {
            updateAssistant(assistantId, (message) => ({
              ...message,
              status: 'done',
              content:
                message.content ||
                '搜索完成了，但没有返回可展示的内容。请换个问法再试。',
            }));
            return;
          }
          if (event.type === 'aborted') {
            updateAssistant(assistantId, (message) => ({
              ...message,
              status: 'stopped',
            }));
            return;
          }
          if (event.type === 'error') {
            const message = event.message || '文献搜索失败';
            setError(message);
            updateAssistant(assistantId, (current) => ({
              ...current,
              status: 'error',
              error: message,
            }));
          }
        },
      });
      updateAssistant(assistantId, (message) =>
        message.status === 'streaming'
          ? {
              ...message,
              status: 'done',
              content:
                message.content ||
                '搜索完成了，但没有返回可展示的内容。请换个问法再试。',
            }
          : message,
      );
    } catch (caught) {
      if (controller.signal.aborted) {
        updateAssistant(assistantId, (message) => ({
          ...message,
          status: 'stopped',
        }));
      } else {
        const message =
          caught instanceof Error ? caught.message : '文献搜索失败，请稍后重试';
        setError(message);
        updateAssistant(assistantId, (current) => ({
          ...current,
          status: 'error',
          error: message,
        }));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setStreaming(false);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const importLink = async (url: string) => {
    if (importingRef.current) return;
    importingRef.current = true;
    setImportingUrl(url);
    setError('');
    try {
      const result = await importBatchItem(
        { kind: 'link', value: url },
        () => undefined,
        undefined,
        { folderId: targetFolderId },
      );
      setImported((current) => ({
        ...current,
        [url]: { title: result.title, folder: targetFolderName },
      }));
      onImported();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '导入失败，请稍后重试',
      );
    } finally {
      importingRef.current = false;
      setImportingUrl(null);
    }
  };

  const importAll = async (links: ImportableLink[]) => {
    if (importingRef.current) return;
    importingRef.current = true;
    setError('');
    try {
      for (const link of links) {
        if (imported[link.url]) continue;
        setImportingUrl(link.url);
        const result = await importBatchItem(
          { kind: 'link', value: link.url },
          () => undefined,
          undefined,
          { folderId: targetFolderId },
        );
        setImported((current) => ({
          ...current,
          [link.url]: { title: result.title, folder: targetFolderName },
        }));
      }
      onImported();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '导入失败，请稍后重试',
      );
    } finally {
      importingRef.current = false;
      setImportingUrl(null);
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="search-screen" role="dialog" aria-modal="true" aria-label="文献雷达">
      <header className="search-header">
        <button
          type="button"
          className="search-back"
          onClick={onClose}
          title="返回"
          aria-label="返回"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="search-brand">
          <span className="search-brand-mark">
            <Globe2 size={20} strokeWidth={1.7} />
          </span>
          <div>
            <span className="search-kicker">LITERATURE RADAR · WEB SEARCH</span>
            <h1>文献雷达</h1>
          </div>
        </div>
        <div className="search-header-actions">
          <label className="search-target">
            <FolderInput size={13} />
            <span>导入到</span>
            <select
              value={targetFolderId ?? ''}
              onChange={(event) =>
                setTargetFolderId(event.target.value || null)
              }
              aria-label="搜索结果导入位置"
            >
              <option value="">未分类</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folderPathLabel(folders, folder.id)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="search-header-button"
            onClick={resetConversation}
            title="新对话"
            aria-label="新对话"
          >
            <MessageSquarePlus size={15} />
          </button>
          <button
            type="button"
            className="search-header-button"
            onClick={onOpenSettings}
            title="模型设置"
            aria-label="模型设置"
          >
            <Settings2 size={15} />
          </button>
        </div>
      </header>

      <main className="search-main">
        <div className="search-thread" ref={scrollRef}>
          <div className="search-thread-inner">
            {messages.map((message) => {
              const links =
                message.role === 'assistant' && message.content
                  ? extractImportableLinks(message.content)
                  : [];
              return (
                <div
                  key={message.id}
                  className={`search-message search-message-${message.role} ${
                    message.status === 'error' ? 'is-error' : ''
                  }`}
                >
                  <div className="search-message-author">
                    {message.role === 'user' ? (
                      '你'
                    ) : (
                      <>
                        <Sparkles size={12} />
                        文献雷达
                      </>
                    )}
                  </div>
                  <div className="search-bubble">
                    {message.content ? (
                      message.role === 'assistant' ? (
                        <MarkdownMessage content={message.content} />
                      ) : (
                        <p>{message.content}</p>
                      )
                    ) : message.status === 'streaming' ? (
                      <span className="search-thinking">
                        <Loader2 size={13} className="spin" />
                        正在联网检索并整理文献…
                      </span>
                    ) : message.status === 'stopped' ? (
                      <span className="search-muted">已停止生成</span>
                    ) : null}
                    {message.error && (
                      <p className="search-message-error">{message.error}</p>
                    )}
                    {message.status === 'streaming' && message.content && (
                      <span className="search-typing" aria-label="正在生成" />
                    )}
                  </div>
                  {links.length > 0 && message.status !== 'streaming' && (
                    <div className="search-importables">
                      <div className="search-importables-head">
                        <span>
                          <BookPlus size={13} />
                          可导入文献 · {links.length}
                        </span>
                        {links.filter((link) => !imported[link.url]).length >
                          1 && (
                          <button
                            type="button"
                            onClick={() =>
                              void importAll(
                                links.filter((link) => !imported[link.url]),
                              )
                            }
                            disabled={Boolean(importingUrl)}
                          >
                            全部导入到「{targetFolderName}」
                          </button>
                        )}
                      </div>
                      {links.map((link) => {
                        const done = imported[link.url];
                        const busy = importingUrl === link.url;
                        return (
                          <div className="search-import-row" key={link.url}>
                            <Globe2 size={13} />
                            <span className="search-import-label" title={link.url}>
                              {link.label}
                            </span>
                            {done ? (
                              <span className="search-import-done">
                                <Check size={12} />
                                已导入「{done.folder}」
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void importLink(link.url)}
                                disabled={Boolean(importingUrl)}
                              >
                                {busy ? (
                                  <Loader2 size={12} className="spin" />
                                ) : (
                                  <BookPlus size={12} />
                                )}
                                {busy
                                  ? '导入中'
                                  : `导入到「${targetFolderName}」`}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {onlyWelcome && (
              <div className="search-suggestions" aria-label="搜索建议">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void send(suggestion)}
                  >
                    <Search size={12} />
                    {suggestion}
                  </button>
                ))}
              </div>
            )}

          </div>
        </div>

        {error && (
          <div className="search-error" role="alert">
            <AlertCircle size={14} />
            <span>{error}</span>
            <button type="button" onClick={() => setError('')}>
              关闭
            </button>
          </div>
        )}

        <form
          className="search-composer"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder="描述你要找的论文，例如：找近三年多模态推理的顶会论文…"
            rows={1}
            disabled={streaming}
            aria-label="文献搜索需求"
          />
          {streaming ? (
            <button
              type="submit"
              className="search-send is-stop"
              onClick={(event) => {
                event.preventDefault();
                stop();
              }}
              aria-label="停止搜索"
              title="停止搜索"
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              className="search-send"
              disabled={!input.trim()}
              aria-label="发送"
              title="发送"
            >
              <ArrowUp size={17} />
            </button>
          )}
        </form>
        <p className="search-composer-note">
          {searchMode === 'web'
            ? 'OpenAI 联网搜索'
            : '当前模型通过 OpenAlex 学术文献库检索'}{' '}
          · 结果只在你点击导入后写入文库 · Enter 发送 / Shift + Enter 换行
        </p>
      </main>
    </div>
  );
}
