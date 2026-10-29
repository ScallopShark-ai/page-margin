import { useEffect, useRef, useState } from 'react';
import {
  Check,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { ConversationThread } from '../types';
import { formatRelativeTime } from '../lib/library';

interface HistoryDrawerProps {
  open: boolean;
  threads: ConversationThread[];
  activeThreadId: string | null;
  onClose: () => void;
  onSelect: (thread: ConversationThread) => void;
  onNew: () => void;
  onDelete: (thread: ConversationThread) => void;
  onRename: (thread: ConversationThread, title: string) => void;
}

export function HistoryDrawer({
  open,
  threads,
  activeThreadId,
  onClose,
  onSelect,
  onNew,
  onDelete,
  onRename,
}: HistoryDrawerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setDraft('');
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !editingId) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, editingId, onClose]);

  useEffect(() => {
    if (!editingId) return;
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [editingId]);

  if (!open) return null;

  const beginRename = (thread: ConversationThread) => {
    setEditingId(thread.id);
    setDraft(thread.title);
  };

  const commitRename = (thread: ConversationThread) => {
    const title = draft.trim();
    if (title && title !== thread.title) onRename(thread, title);
    setEditingId(null);
    setDraft('');
  };

  return (
    <div className="history-layer">
      <button
        type="button"
        className="history-scrim"
        onClick={onClose}
        aria-label="关闭对话历史"
      />
      <aside className="history-drawer" role="dialog" aria-label="对话历史">
        <div className="history-head">
          <div>
            <span className="card-kicker">CONVERSATION LOG</span>
            <h2>对话历史</h2>
            <p>{threads.length > 0 ? `${threads.length} 段对话，保存在本机` : '这篇论文的对话会保存在本机'}</p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="关闭对话历史"
          >
            <X size={17} />
          </button>
        </div>

        <button type="button" className="new-thread-button" onClick={onNew}>
          <Plus size={15} strokeWidth={2} />
          开始新对话
        </button>

        <div className="thread-list">
          {threads.length === 0 ? (
            <div className="thread-empty">
              <span className="thread-empty-icon">
                <MessageSquare size={20} strokeWidth={1.5} />
              </span>
              <strong>还没有历史对话</strong>
              <p>发送第一个问题后，这段对话会自动保存在这里。</p>
            </div>
          ) : (
            threads.map((thread) => {
              const active = thread.id === activeThreadId;
              const editing = thread.id === editingId;
              const messageCount = thread.messages.filter(
                (message) => message.role === 'user',
              ).length;
              return (
                <div
                  key={thread.id}
                  className={`thread-item ${active ? 'is-active' : ''}`}
                >
                  {editing ? (
                    <form
                      className="thread-edit-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        commitRename(thread);
                      }}
                    >
                      <input
                        ref={inputRef}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            setEditingId(null);
                            setDraft('');
                          }
                        }}
                        maxLength={70}
                        aria-label="对话标题"
                      />
                      <button type="submit" aria-label="保存标题">
                        <Check size={14} />
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="thread-main"
                      onClick={() => onSelect(thread)}
                    >
                      <span className="thread-title-row">
                        <span className="thread-title">{thread.title}</span>
                        {active && <span className="thread-current">当前</span>}
                      </span>
                      <span className="thread-meta">
                        {messageCount} 个问题 · {formatRelativeTime(thread.updatedAt)}
                      </span>
                    </button>
                  )}

                  {!editing && (
                    <div className="thread-actions">
                      <button
                        type="button"
                        onClick={() => beginRename(thread)}
                        aria-label="重命名对话"
                        title="重命名"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm('删除这段对话？此操作无法撤销。')) {
                            onDelete(thread);
                          }
                        }}
                        aria-label="删除对话"
                        title="删除"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="history-foot">对话仅保存在当前浏览器，不会上传到服务器。</div>
      </aside>
    </div>
  );
}
