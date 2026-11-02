import { useState } from 'react';
import {
  ArrowLeft,
  Check,
  Columns2,
  Eye,
  FileText,
  Loader2,
  PencilLine,
} from 'lucide-react';
import { MarkdownMessage } from './MarkdownMessage';

interface PaperNotesProps {
  paperTitle: string;
  markdown: string;
  loading: boolean;
  saving: boolean;
  savedAt: number | null;
  onChange: (markdown: string) => void;
  onClose: () => void;
}

type NotesMode = 'split' | 'edit' | 'preview';

export function PaperNotes({
  paperTitle,
  markdown,
  loading,
  saving,
  savedAt,
  onChange,
  onClose,
}: PaperNotesProps) {
  const [mode, setMode] = useState<NotesMode>('split');
  const words = markdown.trim() ? markdown.trim().split(/\s+/).length : 0;
  const chars = markdown.length;

  return (
    <div className={`paper-notes mode-${mode}`}>
      <header className="paper-notes-head">
        <div className="paper-notes-heading">
          <span className="paper-notes-mark">
            <FileText size={16} />
          </span>
          <div>
            <span className="paper-notes-kicker">PAPER NOTES · MARKDOWN</span>
            <h2>阅读笔记</h2>
            <p title={paperTitle}>{paperTitle}</p>
          </div>
        </div>
        <div className="paper-notes-actions">
          <span className={`paper-notes-save ${saving ? 'is-saving' : ''}`}>
            {saving ? (
              <>
                <Loader2 size={12} className="spin" />
                保存中
              </>
            ) : savedAt ? (
              <>
                <Check size={12} />
                已保存
              </>
            ) : (
              '自动保存'
            )}
          </span>
          <button
            type="button"
            className="paper-notes-close"
            onClick={onClose}
            title="返回论文"
          >
            <ArrowLeft size={13} />
            论文
          </button>
        </div>
      </header>

      <div className="paper-notes-toolbar">
        <div
          className="paper-notes-modes"
          role="group"
          aria-label="笔记显示模式"
        >
          <button
            type="button"
            className={mode === 'edit' ? 'is-active' : ''}
            onClick={() => setMode('edit')}
          >
            <PencilLine size={12} />
            编辑
          </button>
          <button
            type="button"
            className={mode === 'split' ? 'is-active' : ''}
            onClick={() => setMode('split')}
          >
            <Columns2 size={12} />
            分栏
          </button>
          <button
            type="button"
            className={mode === 'preview' ? 'is-active' : ''}
            onClick={() => setMode('preview')}
          >
            <Eye size={12} />
            预览
          </button>
        </div>
        <div className="paper-notes-meta">
          <span>{words} 个词</span>
          <i />
          <span>{chars} 字符</span>
          <span className="paper-notes-tip">支持 Markdown 与 LaTeX</span>
        </div>
      </div>

      <div className="paper-notes-workspace">
        <section className="paper-notes-editor" aria-label="Markdown 笔记编辑">
          <div className="paper-notes-pane-label">
            <span>MARKDOWN</span>
            <em>自动保存到当前浏览器</em>
          </div>
          {loading ? (
            <div className="paper-notes-loading">
              <Loader2 size={16} className="spin" />
              正在读取笔记…
            </div>
          ) : (
            <textarea
              value={markdown}
              onChange={(event) => onChange(event.target.value)}
              placeholder={`# ${paperTitle}\n\n## 核心问题\n\n- \n\n## 方法\n\n\n## 实验与结论\n\n\n## 我的想法\n\n`}
              spellCheck={false}
              aria-label="阅读笔记 Markdown 编辑器"
            />
          )}
        </section>
        <section className="paper-notes-preview" aria-label="Markdown 笔记预览">
          <div className="paper-notes-pane-label">
            <span>PREVIEW</span>
            <em>Markdown 渲染</em>
          </div>
          <div className="paper-notes-preview-scroll">
            {markdown.trim() ? (
              <MarkdownMessage content={markdown} />
            ) : (
              <div className="paper-notes-empty">
                <FileText size={24} strokeWidth={1.3} />
                <strong>还没有笔记</strong>
                <span>记录问题、方法、结论，或者让右侧对话帮你整理。</span>
                <code># 标题</code>
                <code>## 小节</code>
                <code>- 列表 / **重点** / $公式$</code>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
