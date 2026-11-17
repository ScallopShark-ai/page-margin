import { useState, type CSSProperties } from 'react';
import {
  Check,
  Highlighter,
  MessageSquare,
  Strikethrough,
  Trash2,
  Underline,
  X,
} from 'lucide-react';
import type {
  AnnotationRect,
  AnnotationStyle,
  AnnotationVariant,
  PaperAnnotation,
} from '../types';

export interface AnnotationAnchor {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface AnnotationDraft {
  text: string;
  variant: AnnotationVariant;
  segments: { page: number; rects: AnnotationRect[] }[];
  anchor: AnnotationAnchor;
}

const HIGHLIGHT_COLORS = [
  { value: '#f2cf66', label: '黄色' },
  { value: '#9fd3a7', label: '绿色' },
  { value: '#9dc4e8', label: '蓝色' },
  { value: '#e8a8ba', label: '粉色' },
  { value: '#efb27a', label: '橙色' },
  { value: '#c9b5e6', label: '紫色' },
];

const LINE_COLORS = [
  { value: '#c65b3f', label: '红色' },
  { value: '#4f78a8', label: '蓝色' },
  { value: '#4f7d5f', label: '绿色' },
  { value: '#c08a35', label: '琥珀色' },
  { value: '#8a5f78', label: '紫色' },
  { value: '#736a58', label: '灰色' },
];

const STYLE_LABELS: Record<AnnotationStyle, string> = {
  highlight: '高亮',
  underline: '下划线',
  strike: '中划线',
  comment: '评论',
};

function toolbarPosition(
  anchor: AnnotationAnchor,
  width: number,
  hasTranslation: boolean,
) {
  const margin = 10;
  const half = width / 2;
  const left = Math.min(
    Math.max(anchor.left + anchor.width / 2, half + margin),
    Math.max(half + margin, window.innerWidth - half - margin),
  );
  const aboveSpace = Math.max(0, anchor.top - 10);
  const belowSpace = Math.max(0, window.innerHeight - anchor.bottom - 10);
  // TranslationPopover prefers the side with more room. Put the annotation
  // toolbar on the opposite side so the two selection surfaces do not stack.
  const translationAbove = aboveSpace > 200 && aboveSpace >= belowSpace;
  const below = hasTranslation ? translationAbove : anchor.top < 130;
  return {
    left,
    top: below ? anchor.bottom + 10 : anchor.top - 10,
    transform: below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
  };
}

export function AnnotationToolbar({
  draft,
  hasTranslation,
  onCreate,
  onClose,
}: {
  draft: AnnotationDraft;
  hasTranslation: boolean;
  onCreate: (
    style: AnnotationStyle,
    color: string,
    comment: string,
  ) => Promise<boolean>;
  onClose: () => void;
}) {
  const [palette, setPalette] = useState<'highlight' | 'underline' | 'strike' | null>(
    null,
  );
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const position = toolbarPosition(
    draft.anchor,
    commentOpen ? 320 : 284,
    hasTranslation,
  );

  const apply = async (style: AnnotationStyle, color: string, text = '') => {
    if (saving) return;
    setSaving(true);
    try {
      await onCreate(style, color, text);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`annotation-toolbar ${commentOpen ? 'has-comment-form' : ''}`}
      style={{
        left: position.left,
        top: position.top,
        transform: position.transform,
      }}
      role="toolbar"
      aria-label="划词标注工具"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="annotation-toolbar-row">
        {!commentOpen && (
          <>
            <button
              type="button"
              className={`annotation-tool ${palette === 'highlight' ? 'is-active' : ''}`}
              onClick={() =>
                setPalette((current) =>
                  current === 'highlight' ? null : 'highlight',
                )
              }
              aria-pressed={palette === 'highlight'}
              title="高亮，可选择颜色"
            >
              <Highlighter size={14} />
              高亮
            </button>
            <button
              type="button"
              className={`annotation-tool ${palette === 'underline' ? 'is-active' : ''}`}
              onClick={() =>
                setPalette((current) =>
                  current === 'underline' ? null : 'underline',
                )
              }
              aria-pressed={palette === 'underline'}
              title="下划线，可选择颜色"
            >
              <Underline size={14} />
              下划线
            </button>
            <button
              type="button"
              className={`annotation-tool ${palette === 'strike' ? 'is-active' : ''}`}
              onClick={() =>
                setPalette((current) =>
                  current === 'strike' ? null : 'strike',
                )
              }
              aria-pressed={palette === 'strike'}
              title="中划线，可选择颜色"
            >
              <Strikethrough size={14} />
              中划线
            </button>
            <span className="annotation-toolbar-divider" />
            <button
              type="button"
              className="annotation-tool"
              onClick={() => {
                setPalette(null);
                setCommentOpen(true);
              }}
              title="为选中的文字添加评论"
            >
              <MessageSquare size={14} />
              评论
            </button>
          </>
        )}
        {commentOpen && (
          <div className="annotation-comment-form">
            <div className="annotation-comment-heading">
              <span>
                <MessageSquare size={13} />
                添加评论
              </span>
              <button
                type="button"
                className="annotation-icon-button"
                onClick={onClose}
                aria-label="取消评论"
              >
                <X size={13} />
              </button>
            </div>
            <textarea
              autoFocus
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={500}
              placeholder="写下你的想法…"
              aria-label="评论内容"
            />
            <div className="annotation-comment-actions">
              <button type="button" onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={!comment.trim() || saving}
                onClick={() =>
                  void apply('comment', '#8a5f78', comment.trim())
                }
              >
                <Check size={12} />
                保存评论
              </button>
            </div>
          </div>
        )}
        {!commentOpen && (
          <button
            type="button"
            className="annotation-close"
            onClick={onClose}
            aria-label="关闭标注工具"
            title="关闭"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {!commentOpen && palette && (
        <div className="annotation-color-palette">
          <span>{STYLE_LABELS[palette]}颜色</span>
          <div>
            {(palette === 'highlight' ? HIGHLIGHT_COLORS : LINE_COLORS).map(
              (color) => (
                <button
                  key={color.value}
                  type="button"
                  className="annotation-color-swatch"
                  style={{ background: color.value }}
                  disabled={saving}
                  onClick={() =>
                    void apply(
                      palette,
                      color.value,
                      '',
                    )
                  }
                  aria-label={`${STYLE_LABELS[palette]}${color.label}`}
                  title={color.label}
                />
              ),
            )}
          </div>
        </div>
      )}
      <div className="annotation-toolbar-source" title={draft.text}>
        {draft.text}
      </div>
    </div>
  );
}

export function AnnotationLayer({
  annotations,
  page,
  activeId,
  onOpen,
}: {
  annotations: PaperAnnotation[];
  page: number;
  activeId: string | null;
  onOpen: (annotation: PaperAnnotation, anchor: AnnotationAnchor) => void;
}) {
  return (
    <div className="annotation-layer" aria-label="论文标注">
      {annotations.map((annotation) =>
        annotation.segments
          .filter((segment) => segment.page === page)
          .map((segment) =>
          segment.rects.map((rect, index) => (
            <button
              key={`${annotation.id}-${segment.page}-${index}`}
              type="button"
              className={`pdf-annotation-mark is-${annotation.style} ${
                activeId === annotation.id ? 'is-active' : ''
              } ${annotation.comment ? 'has-comment' : ''}`}
              style={
                {
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.width * 100}%`,
                  height: `${rect.height * 100}%`,
                  '--annotation-color': annotation.color,
                } as CSSProperties
              }
              onClick={(event) => {
                event.stopPropagation();
                const bounds = event.currentTarget.getBoundingClientRect();
                onOpen(annotation, {
                  top: bounds.top,
                  bottom: bounds.bottom,
                  left: bounds.left,
                  width: bounds.width,
                });
              }}
              aria-label={`${STYLE_LABELS[annotation.style]}：${annotation.text.slice(0, 80)}`}
              title={
                annotation.comment
                  ? `评论：${annotation.comment}`
                  : `${STYLE_LABELS[annotation.style]}，点击管理`
              }
            />
          )),
        ),
      )}
    </div>
  );
}

export function AnnotationPopover({
  annotation,
  anchor,
  onSaveComment,
  onDelete,
  onClose,
}: {
  annotation: PaperAnnotation;
  anchor: AnnotationAnchor;
  onSaveComment: (comment: string) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [comment, setComment] = useState(annotation.comment);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const width = 300;
  const half = width / 2;
  const margin = 10;
  const left = Math.min(
    Math.max(anchor.left + anchor.width / 2, half + margin),
    Math.max(half + margin, window.innerWidth - half - margin),
  );
  const below = anchor.top < 230;
  const top = below ? anchor.bottom + 8 : anchor.top - 8;
  const transform = below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)';

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSaveComment(comment.trim());
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (deleting) return;
    if (!window.confirm('删除这条标注？')) return;
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="annotation-popover"
      style={{
        left,
        top,
        width,
        transform,
        '--annotation-color': annotation.color,
      } as CSSProperties}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="annotation-popover-head">
        <span className={`annotation-popover-style is-${annotation.style}`}>
          {STYLE_LABELS[annotation.style]}
        </span>
        <span className="annotation-popover-color" aria-hidden="true" />
        <button
          type="button"
          className="annotation-icon-button"
          onClick={onClose}
          aria-label="关闭标注"
        >
          <X size={14} />
        </button>
      </div>
      <blockquote title={annotation.text}>{annotation.text}</blockquote>
      <textarea
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        maxLength={500}
        placeholder="添加评论…"
        aria-label="标注评论"
      />
      <div className="annotation-popover-actions">
        <button
          type="button"
          className="annotation-delete-button"
          onClick={() => void remove()}
          disabled={deleting || saving}
        >
          <Trash2 size={12} />
          删除
        </button>
        <div>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="is-primary"
            onClick={() => void save()}
            disabled={saving || deleting || comment.trim() === annotation.comment}
          >
            <Check size={12} />
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
