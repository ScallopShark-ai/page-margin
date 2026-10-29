import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  FileText,
  Folder,
  Layers3,
  Link2,
  Loader2,
  Upload,
  X,
} from 'lucide-react';
import type { Folder as FolderRecord } from '../types';
import type { BatchImportItem } from '../lib/batchImport';
import { importBatchItem, newBatchTaskId } from '../lib/batchImport';
import { extractLinksFromText } from '../lib/linkText';
import { isArxivReference, isWebPdfUrl } from '../lib/paperId';

interface BatchImportModalProps {
  open: boolean;
  folders: FolderRecord[];
  initialFiles?: File[];
  onClose: () => void;
  onFinished: () => void;
  onOpenLibrary: () => void;
}

type TaskStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

interface ImportTask {
  id: string;
  item: BatchImportItem;
  label: string;
  invalid?: boolean;
  status: TaskStatus;
  detail: string;
  percent: number;
  title?: string;
  warning?: string;
}

const MAX_FILE_BYTES = 80 * 1024 * 1024;

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return '导入失败，请重试';
}

export function BatchImportModal({
  open,
  folders,
  initialFiles = [],
  onClose,
  onFinished,
  onOpenLibrary,
}: BatchImportModalProps) {
  const [phase, setPhase] = useState<'setup' | 'running' | 'done'>('setup');
  const [linkText, setLinkText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [tasks, setTasks] = useState<ImportTask[]>([]);
  const [error, setError] = useState('');
  const [txtNotice, setTxtNotice] = useState('');
  const [targetFolderId, setTargetFolderId] = useState('');
  const [dragging, setDragging] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const txtRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPhase('setup');
    setLinkText('');
    setTasks([]);
    setError('');
    setTxtNotice('');
    setTargetFolderId('');
    setDragging(false);
    setFiles(
      initialFiles.filter(
        (file) => isPdfFile(file) && file.size <= MAX_FILE_BYTES,
      ),
    );
    // Initial files are a seed for the next opening only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (targetFolderId && !folders.some((folder) => folder.id === targetFolderId)) {
      setTargetFolderId('');
    }
  }, [folders, targetFolderId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (phase === 'running') return;
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, phase, onClose]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  const links = useMemo(
    () =>
      Array.from(
        new Set(
          linkText
            .split(/[\r\n\s]+/)
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ),
    [linkText],
  );

  const invalidLinks = useMemo(
    () =>
      links.filter(
        (link) => !isArxivReference(link) && !isWebPdfUrl(link),
      ),
    [links],
  );

  const addFiles = (incoming: FileList | File[] | null) => {
    if (!incoming) return;
    setError('');
    const list = Array.from(incoming);
    const next = [...files];
    let rejected = 0;
    for (const file of list) {
      if (!isPdfFile(file) || file.size > MAX_FILE_BYTES) {
        rejected += 1;
        continue;
      }
      if (
        !next.some(
          (item) =>
            item.name === file.name &&
            item.size === file.size &&
            item.lastModified === file.lastModified,
        )
      ) {
        next.push(file);
      }
    }
    setFiles(next);
    if (rejected > 0) {
      setError(`已忽略 ${rejected} 个非 PDF 或超过 80 MB 的文件`);
    }
  };

  const importTxt = async (file?: File | null) => {
    if (!file) return;
    setError('');
    setTxtNotice('');
    if (!file.name.toLowerCase().endsWith('.txt') && file.type !== 'text/plain') {
      setError('请选择 .txt 文本文件');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('TXT 文件超过 2 MB');
      return;
    }
    try {
      const text = await file.text();
      const extracted = extractLinksFromText(text);
      if (extracted.totalLines === 0) {
        setTxtNotice('TXT 文件是空的');
        return;
      }
      const existing = new Set(
        linkText
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter(Boolean),
      );
      const fresh = extracted.links.filter((value) => !existing.has(value));
      if (fresh.length > 0) {
        setLinkText((current) =>
          [current.trim(), ...fresh].filter(Boolean).join('\n'),
        );
      }
      const duplicateCount = extracted.links.length - fresh.length;
      const parts = [
        `已读取 ${extracted.totalLines} 行`,
        `识别 ${extracted.recognizedLines} 行`,
        `加入 ${fresh.length} 个链接`,
      ];
      if (extracted.skippedLines > 0) {
        parts.push(`跳过 ${extracted.skippedLines} 行`);
      }
      if (duplicateCount > 0) {
        parts.push(`${duplicateCount} 个已存在`);
      }
      setTxtNotice(parts.join('，'));
      if (extracted.links.length === 0) {
        setError('没有识别到 arXiv 或 PDF 直链，无法识别的行已跳过');
      }
    } catch {
      setError('读取 TXT 文件失败');
    }
  };

  const total = links.length + files.length;
  const validLinkCount = links.length - invalidLinks.length;
  const completed = tasks.filter(
    (task) => task.status === 'done' || task.status === 'error' || task.status === 'cancelled',
  ).length;
  const succeeded = tasks.filter((task) => task.status === 'done').length;
  const failed = tasks.filter((task) => task.status === 'error').length;
  const cancelled = tasks.filter((task) => task.status === 'cancelled').length;
  const runningTask = tasks.find((task) => task.status === 'running');
  const overallPercent =
    phase === 'done'
      ? 100
      : tasks.length === 0
        ? 0
        : Math.round(
            ((completed + (runningTask ? runningTask.percent / 100 : 0)) /
              tasks.length) *
              100,
          );

  const updateTask = (id: string, patch: Partial<ImportTask>) => {
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, ...patch } : task)),
    );
  };

  const start = async () => {
    if (phase === 'running' || total === 0) return;
    const nextTasks: ImportTask[] = [
      ...links.map((value) => ({
        id: newBatchTaskId(),
        item: { kind: 'link' as const, value },
        label: value,
        invalid: !isArxivReference(value) && !isWebPdfUrl(value),
        status: 'queued' as const,
        detail: '等待导入',
        percent: 0,
      })),
      ...files.map((file) => ({
        id: newBatchTaskId(),
        item: { kind: 'file' as const, file },
        label: file.name,
        status: 'queued' as const,
        detail: '等待导入',
        percent: 0,
      })),
    ];
    if (nextTasks.length === 0) return;

    setTasks(nextTasks);
    setPhase('running');
    setError('');
    const folderId = targetFolderId || undefined;
    const controller = new AbortController();
    controllerRef.current = controller;

    for (const task of nextTasks) {
      if (controller.signal.aborted) {
        updateTask(task.id, { status: 'cancelled', detail: '已取消', percent: 0 });
        continue;
      }
      if (task.invalid) {
        updateTask(task.id, {
          status: 'error',
          detail: '不是有效的 arXiv 或 PDF 链接',
          percent: 0,
        });
        continue;
      }
      updateTask(task.id, { status: 'running', detail: '准备导入…', percent: 2 });
      try {
        const result = await importBatchItem(
          task.item,
          (progress) => {
            updateTask(task.id, {
              status: 'running',
              detail: progress.detail
                ? `${progress.stage} · ${progress.detail}`
                : progress.stage,
              percent: Math.max(2, Math.min(100, progress.percent)),
            });
          },
          controller.signal,
          { folderId },
        );
        updateTask(task.id, {
          status: 'done',
          detail: result.warning || '已保存到文库',
          percent: 100,
          title: result.title,
          warning: result.warning,
        });
      } catch (importError) {
        const aborted = controller.signal.aborted || (importError as Error)?.name === 'AbortError';
        updateTask(task.id, {
          status: aborted ? 'cancelled' : 'error',
          detail: aborted ? '已取消' : errorMessage(importError),
          percent: 0,
        });
        if (aborted) {
          for (const rest of nextTasks) {
            if (rest.id === task.id) continue;
            setTasks((current) =>
              current.map((item) =>
                item.id === rest.id && item.status === 'queued'
                  ? { ...item, status: 'cancelled', detail: '已取消' }
                  : item,
              ),
            );
          }
          break;
        }
      }
    }

    controllerRef.current = null;
    setPhase('done');
    onFinished();
  };

  const stop = () => {
    controllerRef.current?.abort();
  };

  const reset = () => {
    setPhase('setup');
    setTasks([]);
    setLinkText('');
    setFiles([]);
    setError('');
  };

  const handleClose = () => {
    if (phase === 'running') {
      if (!window.confirm('停止导入并关闭？已完成的论文会保留在文库中。')) return;
      controllerRef.current?.abort();
    }
    onClose();
  };

  const openLibrary = () => {
    onFinished();
    onOpenLibrary();
  };

  if (!open) return null;

  return (
    <div
      className="batch-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDragging(false);
        if (phase === 'running') return;
        addFiles(event.dataTransfer.files);
      }}
    >
      <div
        className="batch-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="batch-head">
          <span className="batch-head-icon">
            <Layers3 size={19} strokeWidth={1.7} />
          </span>
          <div className="batch-head-copy">
            <span className="batch-kicker">BATCH IMPORT</span>
            <h2 id="batch-title">批量导入论文</h2>
            <p>混合导入多个 arXiv 链接、任意 PDF 直链和本地文件。</p>
          </div>
          <button
            type="button"
            className="batch-close"
            onClick={handleClose}
            aria-label="关闭批量导入"
          >
            <X size={17} />
          </button>
        </header>

        {phase === 'setup' ? (
          <>
            <div className="batch-section">
              <div className="batch-label">
                <label className="batch-label-main" htmlFor="batch-links">
                  <Link2 size={14} />
                  链接
                </label>
                <button
                  type="button"
                  className="batch-txt-button"
                  onClick={() => txtRef.current?.click()}
                >
                  <FileText size={12} />
                  导入 TXT
                </button>
                <span>每行一个，支持 arXiv 和任意 PDF 直链</span>
                <input
                  ref={txtRef}
                  type="file"
                  accept=".txt,text/plain"
                  hidden
                  onChange={(event) => {
                    void importTxt(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
              </div>
              <textarea
                id="batch-links"
                className="batch-links"
                value={linkText}
                onChange={(event) => {
                  setLinkText(event.target.value);
                  setTxtNotice('');
                }}
                placeholder={`https://arxiv.org/abs/1706.03762\nhttps://example.com/paper.pdf\n2501.12948`}
                rows={5}
                spellCheck={false}
                autoFocus
              />
              {links.length > 0 && (
                <div className="batch-hint">
                  已识别 {links.length} 个链接
                  {invalidLinks.length > 0 && (
                    <strong>{invalidLinks.length} 个格式无法识别</strong>
                  )}
                </div>
              )}
              {txtNotice && (
                <p className="batch-txt-notice" role="status">
                  {txtNotice}
                </p>
              )}
            </div>

            <div className="batch-section">
              <span className="batch-label">
                <Upload size={14} />
                本地 PDF
                <span>可多选；只在当前浏览器中解析</span>
              </span>
              <div
                className={`batch-dropzone ${dragging ? 'is-dragging' : ''}`}
                onClick={() => fileRef.current?.click()}
                onDragEnter={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDragging(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDragging(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDragging(false);
                  addFiles(event.dataTransfer.files);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    fileRef.current?.click();
                  }
                }}
              >
                <Upload size={18} strokeWidth={1.7} />
                <div>
                  <strong>拖入多个 PDF，或点击选择</strong>
                  <span>单份不超过 80 MB</span>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  hidden
                  onChange={(event) => {
                    addFiles(event.target.files);
                    event.target.value = '';
                  }}
                />
              </div>

              {files.length > 0 && (
                <div className="batch-files">
                  {files.map((file) => (
                    <div className="batch-file" key={`${file.name}-${file.size}-${file.lastModified}`}>
                      <FileText size={14} />
                      <span title={file.name}>{file.name}</span>
                      <em>{Math.max(1, Math.round(file.size / 1024))} KB</em>
                      <button
                        type="button"
                        onClick={() =>
                          setFiles((current) =>
                            current.filter(
                              (item) =>
                                !(
                                  item.name === file.name &&
                                  item.size === file.size &&
                                  item.lastModified === file.lastModified
                                ),
                            ),
                          )
                        }
                        aria-label={`移除 ${file.name}`}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="batch-section">
              <label className="batch-label" htmlFor="batch-folder">
                <Folder size={14} />
                导入到文件夹
                <span>本次导入的论文都会放入这里</span>
              </label>
              <div className="batch-folder-row">
                <Folder size={15} />
                <select
                  id="batch-folder"
                  value={targetFolderId}
                  onChange={(event) => setTargetFolderId(event.target.value)}
                >
                  <option value="">不指定（保留原文件夹 / 未分类）</option>
                  {folders.map((folder) => (
                    <option value={folder.id} key={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              </div>
              {folders.length === 0 ? (
                <p className="batch-folder-note">
                  还没有文件夹；可以先在文库左侧新建，或直接导入到未分类。
                </p>
              ) : (
                <p className="batch-folder-note">
                  已存在的论文如果再次导入，也会移动到所选文件夹。
                </p>
              )}
            </div>

            {error && (
              <div className="batch-inline-error" role="alert">
                <AlertCircle size={14} />
                {error}
              </div>
            )}

            <footer className="batch-foot">
              <span className="batch-total">
                {total > 0 ? `将导入 ${total} 项` : '添加链接或选择文件开始'}
              </span>
              <div>
                <button type="button" className="batch-cancel" onClick={onClose}>
                  取消
                </button>
                <button
                  type="button"
                  className="batch-primary"
                  onClick={() => void start()}
                  disabled={total === 0 || (validLinkCount === 0 && files.length === 0)}
                >
                  开始导入
                  <ArrowRight size={15} />
                </button>
              </div>
            </footer>
          </>
        ) : (
          <>
            <div className="batch-progress-head">
              <div>
                <strong>
                  {phase === 'done'
                    ? failed > 0
                      ? `完成 ${succeeded} 篇，失败 ${failed} 篇`
                      : `已导入 ${succeeded} 篇论文`
                    : `正在导入 ${completed + 1} / ${tasks.length}`}
                </strong>
                <span>
                  {phase === 'done'
                    ? cancelled > 0
                      ? `另有 ${cancelled} 项已取消`
                      : '可以进入文库继续阅读'
                    : '请保持页面打开，完成后会自动保存到文库'}
                </span>
              </div>
              <em>{overallPercent}%</em>
            </div>
            <div className="batch-progress-track">
              <span style={{ width: `${Math.max(2, overallPercent)}%` }} />
            </div>

            <div className="batch-task-list" aria-live="polite">
              {tasks.map((task) => (
                <div className={`batch-task is-${task.status}`} key={task.id}>
                  <span className="batch-task-status">
                    {task.status === 'running' ? (
                      <Loader2 size={15} className="spin" />
                    ) : task.status === 'done' ? (
                      <CheckCircle2 size={15} />
                    ) : task.status === 'error' ? (
                      <AlertCircle size={15} />
                    ) : task.status === 'cancelled' ? (
                      <X size={14} />
                    ) : (
                      <span className="batch-queued-dot" />
                    )}
                  </span>
                  <div className="batch-task-copy">
                    <strong title={task.title || task.label}>
                      {task.title || task.label}
                    </strong>
                    <span>{task.detail}</span>
                    {task.status === 'running' && (
                      <span className="batch-task-track">
                        <i style={{ width: `${Math.max(3, task.percent)}%` }} />
                      </span>
                    )}
                  </div>
                  {task.status === 'done' && <Check size={14} className="batch-done-check" />}
                </div>
              ))}
            </div>

            <footer className="batch-foot">
              <span className="batch-total">
                {phase === 'running' ? '正在逐篇保存，请稍候' : '导入结果已写入本地文库'}
              </span>
              <div>
                {phase === 'running' ? (
                  <button type="button" className="batch-cancel" onClick={stop}>
                    停止导入
                  </button>
                ) : (
                  <>
                    <button type="button" className="batch-cancel" onClick={reset}>
                      再次导入
                    </button>
                    <button type="button" className="batch-primary" onClick={openLibrary}>
                      查看文库
                      <ArrowRight size={15} />
                    </button>
                  </>
                )}
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
