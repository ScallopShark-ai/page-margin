import { useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Clock,
  FileText,
  Layers3,
  Library,
  Link2,
  Loader2,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react';
import type { LoadProgress, StoredPaper } from '../types';
import { Logo } from './Logo';

interface LandingProps {
  loading: LoadProgress | null;
  error: string;
  papers: StoredPaper[];
  modelReady: boolean;
  modelLabel: string;
  onOpenLink: (input: string) => void;
  onFile: (file: File) => void;
  onOpenBatchImport: () => void;
  onOpenLibrary: () => void;
  onOpenPaper: (paper: StoredPaper) => void;
  onOpenSettings: () => void;
  onDismissError: () => void;
}

const EXAMPLES = [
  { id: '1706.03762', label: 'Attention Is All You Need' },
  { id: '2303.08774', label: 'GPT-4 Technical Report' },
  { id: '2501.12948', label: 'DeepSeek-R1' },
];

export function Landing({
  loading,
  error,
  papers,
  modelReady,
  modelLabel,
  onOpenLink,
  onFile,
  onOpenBatchImport,
  onOpenLibrary,
  onOpenPaper,
  onOpenSettings,
  onDismissError,
}: LandingProps) {
  const recent = papers.slice(0, 3);
  const [input, setInput] = useState('');
  const [localError, setLocalError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError('');
    if (!input.trim()) {
      setLocalError('先粘贴一个 arXiv 或 PDF 链接');
      return;
    }
    onOpenLink(input.trim());
  };

  const handleFiles = (files: FileList | null) => {
    setLocalError('');
    const file = files?.[0];
    if (!file) return;
    const isPdf =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setLocalError('请选择 PDF 文件');
      return;
    }
    if (file.size > 80 * 1024 * 1024) {
      setLocalError('PDF 文件过大（超过 80 MB）');
      return;
    }
    onFile(file);
  };

  return (
    <div className="landing">
      <div className="landing-grain" aria-hidden="true" />
      <header className="landing-nav">
        <Logo />
        <div className="landing-nav-actions">
          <button className="library-nav-button" type="button" onClick={onOpenLibrary}>
            <Library size={14} strokeWidth={1.7} />
            <span>我的文库</span>
            {papers.length > 0 && <em>{papers.length}</em>}
          </button>
          <button className="model-pill" type="button" onClick={onOpenSettings}>
            <span className={`status-dot ${modelReady ? 'is-ready' : ''}`} />
            <span>{modelReady ? modelLabel : '配置 AI 模型'}</span>
            <Sparkles size={13} strokeWidth={1.8} />
          </button>
          <a className="nav-link" href="#how">
            关于海拉
          </a>
        </div>
      </header>

      <main className="hero">
        <section className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-rule" />
            AI PAPER COMPANION
          </div>
          <h1>
            把论文读薄，
            <br />
            <span className="hero-em">把思路读厚。</span>
          </h1>
          <p className="hero-lede">
            左边是论文原文，右边是一位读过全文的 AI 研究伙伴。
            <br className="desktop-only" />
            从摘要、方法到实验细节，边看边问，不用在标签页之间来回跳。
          </p>

          <div className="hero-features">
            <div className="hero-feature">
              <BookOpen size={17} strokeWidth={1.7} />
              <span>原文与对话并排</span>
            </div>
            <div className="hero-feature">
              <Layers3 size={17} strokeWidth={1.7} />
              <span>全文检索式理解</span>
            </div>
            <div className="hero-feature">
              <MessageSquareText size={17} strokeWidth={1.7} />
              <span>回答标注页码</span>
            </div>
          </div>

          <div className="hero-note" aria-hidden="true">
            <span className="hero-note-line" />
            <div>
              <span className="hero-note-quote">“这篇论文到底解决了什么？”</span>
              <span className="hero-note-caption">从这一个问题开始。</span>
            </div>
          </div>
        </section>

        <section className="import-section" aria-label="导入论文">
          <div className="import-orbit" aria-hidden="true" />
          <div className="import-card">
            <div className="import-card-head">
              <span className="card-kicker">OPEN A PAPER</span>
              <h2>开始精读</h2>
              <p>粘贴论文链接，或从电脑拖入一份 PDF。</p>
            </div>

            <form className="arxiv-form" onSubmit={submit}>
              <label className="field-label" htmlFor="arxiv-input">
                论文链接
                <span>arXiv 编号 / 任意 PDF 直链</span>
              </label>
              <div className={`arxiv-input-row ${localError ? 'has-error' : ''}`}>
                <Link2 size={18} strokeWidth={1.8} className="input-icon" />
                <input
                  id="arxiv-input"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="https://arxiv.org/abs/1706.03762 或 PDF 直链"
                  disabled={Boolean(loading)}
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  type="submit"
                  className="open-button"
                  disabled={Boolean(loading)}
                  aria-label="打开论文"
                >
                  {loading ? <Loader2 size={18} className="spin" /> : <ArrowRight size={18} />}
                </button>
              </div>
              <div className="example-row">
                <span>试试</span>
                {EXAMPLES.map((example) => (
                  <button
                    key={example.id}
                    type="button"
                    className="example-chip"
                    onClick={() => setInput(example.id)}
                    title={example.label}
                  >
                    {example.label}
                  </button>
                ))}
              </div>
            </form>

            <div className="divider-label">
              <span />
              <em>或</em>
              <span />
            </div>

            <div
              className={`dropzone ${loading ? 'is-disabled' : ''}`}
              onClick={() => {
                if (!loading) fileRef.current?.click();
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') fileRef.current?.click();
              }}
            >
              <div className="dropzone-icon">
                <Upload size={21} strokeWidth={1.7} />
              </div>
              <div className="dropzone-text">
                <strong>拖入 PDF 文件</strong>
                <span>
                  或 <u>从电脑选择</u>
                  <small>仅在本机浏览器解析</small>
                </span>
              </div>
              <FileText size={30} strokeWidth={1.1} className="dropzone-watermark" />
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,.pdf"
                hidden
                onChange={(event) => {
                  handleFiles(event.target.files);
                  event.target.value = '';
                }}
              />
            </div>

            <button
              type="button"
              className="batch-import-button"
              onClick={onOpenBatchImport}
              disabled={Boolean(loading)}
            >
              <Layers3 size={16} strokeWidth={1.8} />
              <span>
                <strong>批量导入</strong>
                <small>多个链接或本地 PDF，一次加入文库</small>
              </span>
              <ArrowUpRight size={15} strokeWidth={1.7} />
            </button>

            {localError && <p className="inline-error">{localError}</p>}
            {error && (
              <div className="import-error" role="alert">
                <span>{error}</span>
                <button type="button" onClick={onDismissError} aria-label="关闭错误提示">
                  ×
                </button>
              </div>
            )}

            {loading && (
              <div className="loading-panel" role="status" aria-live="polite">
                <div className="loading-topline">
                  <Loader2 size={17} className="spin" />
                  <strong>{loading.stage}</strong>
                  {loading.percent !== null && <span>{Math.round(loading.percent)}%</span>}
                </div>
                <div className="progress-track">
                  <span
                    style={{
                      width: `${Math.max(6, Math.min(100, loading.percent ?? 32))}%`,
                    }}
                  />
                </div>
                <p>{loading.detail}</p>
              </div>
            )}

            {recent.length > 0 && !loading && (
              <div className="recent">
                <div className="recent-head">
                  <span className="recent-head-label">
                    <Clock size={14} strokeWidth={1.8} />
                    <span>最近阅读</span>
                  </span>
                  <button type="button" onClick={onOpenLibrary}>
                    全部 {papers.length} 篇
                  </button>
                </div>
                {recent.map((paper) => (
                  <button
                    key={paper.id}
                    type="button"
                    className="recent-item"
                    onClick={() => onOpenPaper(paper)}
                  >
                    <span className="recent-title">{paper.title}</span>
                    <span className="recent-meta">
                      {paper.source === 'arxiv'
                        ? `${paper.year || 'arXiv'} · ${paper.arxivId}`
                        : paper.source === 'web'
                          ? `网页 PDF · ${paper.pageCount} 页`
                          : `本地 · ${paper.pageCount} 页`}
                    </span>
                    <ArrowUpRight size={15} strokeWidth={1.7} />
                  </button>
                ))}
              </div>
            )}

            <div className="import-footnote">
              <ShieldCheck size={14} strokeWidth={1.8} />
              <span>本地文件只在本机解析；仅相关段落会随问题发送给模型。</span>
            </div>
          </div>

          <div className="import-side-note" aria-hidden="true">
            <span>PDF</span>
            <span>·</span>
            <span>ARXIV</span>
            <span>·</span>
            <span>AI</span>
          </div>
        </section>
      </main>

      <footer className="landing-footer" id="how">
        <div>
          <span className="footer-mark">01</span>
          <strong>导入</strong>
          <span>论文链接、本地 PDF 或批量导入</span>
        </div>
        <div>
          <span className="footer-mark">02</span>
          <strong>阅读</strong>
          <span>原始版面，连续滚动</span>
        </div>
        <div>
          <span className="footer-mark">03</span>
          <strong>追问</strong>
          <span>有页码依据的逐段解读</span>
        </div>
        <p>海拉不是摘要生成器，而是一张可以随时提问的书桌。</p>
      </footer>
    </div>
  );
}
