import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  BookOpen,
  Bookmark,
  Check,
  ChevronDown,
  Copy,
  FlaskConical,
  History,
  KeyRound,
  Lightbulb,
  ListTree,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  SquarePen,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ChatMessage, ConversationThread, PaperSession } from '../types';
import { shortAuthors } from '../lib/pdf';
import { MarkdownMessage } from './MarkdownMessage';
import { HistoryDrawer } from './HistoryDrawer';

interface ChatPanelProps {
  paper: PaperSession;
  messages: ChatMessage[];
  streaming: boolean;
  modelReady: boolean;
  modelLabel: string;
  currentPage: number;
  threads: ConversationThread[];
  activeThreadId: string | null;
  historyOpen: boolean;
  onSend: (text: string, focusPage: number | null) => void;
  onStop: () => void;
  onRetry: () => void;
  onNewThread: () => void;
  onOpenSettings: () => void;
  onJumpToPage: (page: number) => void;
  onToggleHistory: () => void;
  onCloseHistory: () => void;
  onSelectThread: (thread: ConversationThread) => void;
  onDeleteThread: (thread: ConversationThread) => void;
  onRenameThread: (thread: ConversationThread, title: string) => void;
}

interface Prompt {
  icon: LucideIcon;
  title: string;
  description: string;
  prompt: string;
  accent?: boolean;
}

const PROMPTS: Prompt[] = [
  {
    icon: Sparkles,
    title: '一页速览',
    description: '研究问题、方法、结论，一次抓住',
    prompt:
      '请为这篇论文生成一页速览：研究问题与动机、核心方法（含关键公式的直观解释）、主要实验结果、作者结论。最后用 3 条列出这篇论文最值得记住的内容。',
    accent: true,
  },
  {
    icon: ListTree,
    title: '拆解方法',
    description: '把方法还原成一条可理解的流程',
    prompt:
      '请把论文的方法拆成一条清晰的流程：输入是什么、每一步做了什么、关键设计选择及原因、输出是什么。用一个具体例子走一遍，并指出方法成立依赖的关键假设。',
  },
  {
    icon: FlaskConical,
    title: '审视实验',
    description: '证据是否真的支持结论',
    prompt:
      '请审视论文的实验：每个实验想验证什么假设？baseline 和指标是否合适？结果在多大程度上支持作者的结论？有哪些缺失的消融或对照？',
  },
  {
    icon: Lightbulb,
    title: '局限与启发',
    description: '批判性阅读，寻找下一步',
    prompt:
      '请批判性地分析这篇论文：主要局限、作者承认与未承认的问题、可能被质疑的设置，以及它给后续研究或工程实践留下的 3 个具体机会。',
  },
];

function formatCount(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function pageReferences(content: string, maxPage: number): number[] {
  const found = new Set<number>();
  for (const match of content.matchAll(/第\s*(\d{1,4})\s*页/g)) {
    const page = Number(match[1]);
    if (page >= 1 && page <= maxPage) found.add(page);
  }
  return [...found].slice(0, 6);
}

function MessageItem({
  message,
  streaming,
  maxPage,
  onJumpToPage,
  onRetry,
}: {
  message: ChatMessage;
  streaming: boolean;
  maxPage: number;
  onJumpToPage: (page: number) => void;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const pages = message.role === 'assistant' ? pageReferences(message.content, maxPage) : [];
  const isStreamingThis = message.status === 'streaming' && streaming;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore clipboard denial
    }
  };

  if (message.role === 'user') {
    return (
      <article className="message message--user">
        <div className="user-bubble">{message.content}</div>
      </article>
    );
  }

  return (
    <article className="message message--assistant">
      <div className="assistant-identity">
        <span className="assistant-avatar">页</span>
        <span className="assistant-name">页边</span>
        {isStreamingThis && (
          <span className="generating-label">
            <i />
            正在阅读与组织
          </span>
        )}
      </div>

      <div className="assistant-content">
        {message.content ? (
          <MarkdownMessage content={message.content} />
        ) : (
          message.status === 'streaming' && (
            <div className="typing-dots" aria-label="正在生成">
              <span />
              <span />
              <span />
            </div>
          )
        )}

        {message.status === 'error' && (
          <div className="answer-error" role="alert">
            <div className="answer-error-head">
              <AlertCircle size={16} />
              <strong>回答中断</strong>
            </div>
            <p>{message.error || '生成回答时发生错误。'}</p>
            <div className="answer-error-actions">
              <button type="button" className="small-ghost-button" onClick={onRetry}>
                <RotateCcw size={13} />
                重试
              </button>
              {message.errorCode === 'NO_API_KEY' && (
                <span>请先在右上角配置模型。</span>
              )}
            </div>
          </div>
        )}

        {message.status === 'stopped' && (
          <div className="answer-stopped">已停止生成</div>
        )}

        {message.status !== 'streaming' && message.content && (
          <div className="answer-footer">
            <div className="page-references">
              {pages.map((page) => (
                <button
                  key={page}
                  type="button"
                  className="page-ref"
                  onClick={() => onJumpToPage(page)}
                  title={`跳转到第 ${page} 页`}
                >
                  <BookOpen size={12} strokeWidth={1.9} />
                  第 {page} 页
                </button>
              ))}
            </div>
            <div className="answer-tools">
              <button
                type="button"
                className="answer-tool"
                onClick={copy}
                title="复制回答"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? '已复制' : '复制'}
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

export function ChatPanel({
  paper,
  messages,
  streaming,
  modelReady,
  modelLabel,
  currentPage,
  threads,
  activeThreadId,
  historyOpen,
  onSend,
  onStop,
  onRetry,
  onNewThread,
  onOpenSettings,
  onJumpToPage,
  onToggleHistory,
  onCloseHistory,
  onSelectThread,
  onDeleteThread,
  onRenameThread,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [includePage, setIncludePage] = useState(false);
  const [abstractOpen, setAbstractOpen] = useState(false);
  const [pinned, setPinned] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(168, Math.max(24, element.scrollHeight))}px`;
  }, [input]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (pinnedRef.current) list.scrollTop = list.scrollHeight;
  }, [messages, streaming]);

  const handleScroll = () => {
    const list = listRef.current;
    if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 110;
    pinnedRef.current = atBottom;
    setPinned(atBottom);
  };

  const scrollToBottom = () => {
    const list = listRef.current;
    if (!list) return;
    pinnedRef.current = true;
    setPinned(true);
    list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  };

  const send = (text: string, focusPage: number | null = includePage ? currentPage : null) => {
    if (!text.trim() || streaming) return;
    if (!modelReady) {
      setInput(text);
      onOpenSettings();
      return;
    }
    pinnedRef.current = true;
    setPinned(true);
    onSend(text.trim(), focusPage);
    setInput('');
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  };

  const submit = () => send(input);

  const choosePrompt = (prompt: Prompt) => {
    if (modelReady) send(prompt.prompt);
    else {
      setInput(prompt.prompt);
      onOpenSettings();
    }
  };

  const activeThread = threads.find((thread) => thread.id === activeThreadId);

  return (
    <section className="chat-panel" aria-label="AI 论文对话">
      <header className="chat-header">
        <div className="chat-heading">
          <span className="chat-ai-mark">
            <Sparkles size={16} strokeWidth={1.9} />
          </span>
          <div>
            <strong>AI 伴读</strong>
            <span className="chat-subtitle" title={activeThread?.title}>
              {activeThread?.title || '与原文对话'}
            </span>
          </div>
        </div>
        <div className="chat-header-actions">
          <button
            type="button"
            className={`model-status ${modelReady ? 'is-ready' : ''}`}
            onClick={onOpenSettings}
            title="模型设置"
          >
            <span className={`status-dot ${modelReady ? 'is-ready' : ''}`} />
            <span className="model-status-text">{modelReady ? modelLabel : '连接模型'}</span>
            <ChevronDown size={13} />
          </button>
          <button
            type="button"
            className={`chat-tool ${historyOpen ? 'is-active' : ''}`}
            onClick={onToggleHistory}
            title="对话历史"
            aria-label="对话历史"
            aria-expanded={historyOpen}
          >
            <History size={15} />
            <span>{threads.length}</span>
          </button>
          <button
            type="button"
            className="icon-button clear-chat"
            onClick={onNewThread}
            title="开始新对话"
            aria-label="开始新对话"
          >
            <SquarePen size={15} />
          </button>
        </div>
      </header>

      <div className="chat-scroll" ref={listRef} onScroll={handleScroll}>
        {messages.length === 0 ? (
          <div className="chat-empty">
            <div className="paper-dossier">
              <div className="dossier-rule">
                <span>PAPER DOSSIER</span>
                <span>
                  {paper.meta.source === 'arxiv'
                    ? paper.meta.arxivId
                    : paper.meta.fileName || 'LOCAL PDF'}
                </span>
              </div>
              <h1>{paper.meta.title}</h1>
              <div className="dossier-meta">
                <span>{shortAuthors(paper.meta.authors, 4)}</span>
                {paper.meta.year && <span>{paper.meta.year}</span>}
                {paper.meta.category && <span className="meta-category">{paper.meta.category}</span>}
              </div>
              {paper.meta.abstract && (
                <div className={`dossier-abstract ${abstractOpen ? 'is-open' : ''}`}>
                  <p>{paper.meta.abstract}</p>
                  <button type="button" onClick={() => setAbstractOpen((value) => !value)}>
                    {abstractOpen ? '收起摘要' : '展开摘要'}
                  </button>
                </div>
              )}
              <div className="dossier-stats">
                <span>
                  <b>{paper.meta.pages}</b> 页
                </span>
                <i />
                <span>
                  <b>{formatCount(paper.extractedChars)}</b> 字符
                </span>
                <i />
                <span>全文索引就绪</span>
              </div>
            </div>

            {paper.extractedChars < 250 && (
              <div className="scan-warning">
                <AlertCircle size={15} />
                <span>
                  这份 PDF 可能是扫描件，可提取的文字很少。你仍可以阅读原文，但 AI
                  能依据的正文有限。
                </span>
              </div>
            )}

            {!modelReady && (
              <div className="connect-card">
                <div className="connect-icon">
                  <KeyRound size={18} strokeWidth={1.8} />
                </div>
                <div className="connect-copy">
                  <strong>连接一个模型，开始精读</strong>
                  <span>支持 DeepSeek、OpenAI、Claude 或任意兼容接口。</span>
                </div>
                <button type="button" className="primary-button compact" onClick={onOpenSettings}>
                  配置
                </button>
              </div>
            )}

            <div className="prompt-section-head">
              <span>从这里开始</span>
              <em>选择一个角度，或直接提问</em>
            </div>
            <div className="prompt-grid">
              {PROMPTS.map((prompt) => {
                const Icon = prompt.icon;
                return (
                  <button
                    key={prompt.title}
                    type="button"
                    className={`prompt-card ${prompt.accent ? 'is-accent' : ''}`}
                    onClick={() => choosePrompt(prompt)}
                  >
                    <span className="prompt-icon">
                      <Icon size={17} strokeWidth={1.75} />
                    </span>
                    <span className="prompt-copy">
                      <strong>{prompt.title}</strong>
                      <span>{prompt.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="prompt-footnote">
              回答会标注页码，点击页码可回到原文。遇到公式时，AI 会用 LaTeX 解释。
            </p>
          </div>
        ) : (
          <div className="message-list">
            {messages.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                streaming={streaming}
                maxPage={paper.meta.pages}
                onJumpToPage={onJumpToPage}
                onRetry={onRetry}
              />
            ))}
            <div className="message-list-tail" />
          </div>
        )}
      </div>

      {!pinned && messages.length > 0 && (
        <button type="button" className="scroll-bottom" onClick={scrollToBottom}>
          <ArrowDown size={14} />
          回到最新
        </button>
      )}

      <div className="composer-wrap">
        <div className={`composer ${includePage ? 'has-page-context' : ''}`}>
          <textarea
            ref={textareaRef}
            value={input}
            rows={1}
            placeholder={
              modelReady
                ? '追问方法细节、实验设置，或让它解释一段公式…'
                : '配置模型后，在这里向论文提问…'
            }
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                submit();
              }
            }}
            aria-label="向论文提问"
          />
          <div className="composer-bottom">
            <div className="composer-tools">
              <button
                type="button"
                className={`context-toggle ${includePage ? 'is-active' : ''}`}
                onClick={() => setIncludePage((value) => !value)}
                title="把当前阅读页作为重点上下文"
                aria-pressed={includePage}
              >
                <Bookmark size={13} />
                结合第 {currentPage} 页
              </button>
            </div>
            <div className="composer-send">
              <span className="keyboard-hint">Enter 发送 · Shift + Enter 换行</span>
              {streaming ? (
                <button type="button" className="stop-button" onClick={onStop} aria-label="停止生成">
                  <Square size={13} fill="currentColor" />
                  停止
                </button>
              ) : (
                <button
                  type="button"
                  className="send-button"
                  onClick={submit}
                  disabled={!input.trim()}
                  aria-label="发送问题"
                >
                  <Send size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
        <p className="composer-disclaimer">
          AI 可能犯错。涉及关键结论与数据时，请对照左侧原文。
        </p>
      </div>

      <HistoryDrawer
        open={historyOpen}
        threads={threads}
        activeThreadId={activeThreadId}
        onClose={onCloseHistory}
        onSelect={onSelectThread}
        onNew={onNewThread}
        onDelete={onDeleteThread}
        onRename={onRenameThread}
      />
    </section>
  );
}
