import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  Clock3,
  Folder as FolderIcon,
  FolderInput,
  FolderPlus,
  History,
  Inbox,
  Loader2,
  MessageSquare,
  Pencil,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { Folder, StoredPaper } from '../types';
import { formatRelativeTime, storageUsage } from '../lib/library';
import { Logo } from './Logo';

interface LibraryModalProps {
  open: boolean;
  papers: StoredPaper[];
  folders: Folder[];
  loading: boolean;
  error: string;
  currentPaperId: string | null;
  busyPaperId: string | null;
  onClose: () => void;
  onGoHome: () => void;
  onOpenPaper: (paper: StoredPaper) => void;
  onToggleFavorite: (paper: StoredPaper) => void;
  onDeletePaper: (paper: StoredPaper) => void;
  onCreateFolder: (name: string) => Promise<Folder | null>;
  onRenameFolder: (folder: Folder, name: string) => Promise<boolean>;
  onDeleteFolder: (folder: Folder) => Promise<boolean>;
  onMovePaper: (paper: StoredPaper, folderId: string | null) => Promise<boolean>;
  onOpenBatchImport: () => void;
  onOpenImportHistory: () => void;
}

type Filter = 'all' | 'arxiv' | 'local' | 'web' | 'favorite';
type Sort = 'recent' | 'added' | 'title';
type FolderSelection = 'all' | 'unfiled' | string;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'arxiv', label: 'arXiv' },
  { id: 'local', label: '本地 PDF' },
  { id: 'web', label: '网页 PDF' },
  { id: 'favorite', label: '收藏' },
];

function formatBytes(bytes: number): string {
  if (!bytes) return '0 MB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function PaperCover({ paper }: { paper: StoredPaper }) {
  if (paper.thumbnail) {
    return <img className="library-cover-image" src={paper.thumbnail} alt="" loading="lazy" />;
  }
  return (
    <div className="library-cover-fallback">
      <span>
        {paper.source === 'arxiv' ? 'ARXIV' : paper.source === 'web' ? 'WEB PDF' : 'LOCAL PDF'}
      </span>
      <strong>{paper.title}</strong>
      <i>{paper.year || paper.category || 'PAPER'}</i>
    </div>
  );
}

export function LibraryModal({
  open,
  papers,
  folders,
  loading,
  error,
  currentPaperId,
  busyPaperId,
  onClose,
  onGoHome,
  onOpenPaper,
  onToggleFavorite,
  onDeletePaper,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMovePaper,
  onOpenBatchImport,
  onOpenImportHistory,
}: LibraryModalProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [selectedFolder, setSelectedFolder] = useState<FolderSelection>('all');
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState('');
  const [folderSaving, setFolderSaving] = useState(false);
  const [movingPaper, setMovingPaper] = useState<StoredPaper | null>(null);
  const [moveTarget, setMoveTarget] = useState<string | 'unfiled' | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (
        document.querySelector(
          '.batch-backdrop, .import-history-backdrop, .modal-backdrop',
        )
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void storageUsage().then((value) => {
      if (!cancelled) setStorage(value);
    });
    return () => {
      cancelled = true;
    };
  }, [open, papers.length]);

  useEffect(() => {
    if (
      selectedFolder !== 'all' &&
      selectedFolder !== 'unfiled' &&
      !folders.some((folder) => folder.id === selectedFolder)
    ) {
      setSelectedFolder('unfiled');
    }
  }, [folders, selectedFolder]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = papers.filter((paper) => {
      if (selectedFolder === 'unfiled' && paper.folderId) return false;
      if (
        selectedFolder !== 'all' &&
        selectedFolder !== 'unfiled' &&
        paper.folderId !== selectedFolder
      ) {
        return false;
      }
      if (filter === 'favorite' && !paper.favorite) return false;
      if (filter === 'arxiv' && paper.source !== 'arxiv') return false;
      if (filter === 'local' && paper.source !== 'local') return false;
      if (filter === 'web' && paper.source !== 'web') return false;
      if (!query) return true;
      return `${paper.title} ${paper.authors.join(' ')} ${paper.abstract} ${
        paper.arxivId ?? ''
      } ${paper.sourceUrl ?? ''} ${paper.fileName ?? ''} ${paper.category}`
        .toLowerCase()
        .includes(query);
    });
    return [...rows].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'zh-CN');
      if (sort === 'added') return b.createdAt - a.createdAt;
      return b.lastOpenedAt - a.lastOpenedAt;
    });
  }, [papers, search, filter, sort, selectedFolder]);

  if (!open) return null;

  const totalConversations = papers.reduce(
    (sum, paper) => sum + paper.conversationCount,
    0,
  );
  const favoriteCount = papers.filter((paper) => paper.favorite).length;
  const unfiledCount = papers.filter((paper) => !paper.folderId).length;
  const folderCount = (folderId: string) =>
    papers.filter((paper) => paper.folderId === folderId).length;
  const currentFolder = folders.find((folder) => folder.id === selectedFolder);
  const selectedFolderLabel =
    selectedFolder === 'all'
      ? '全部文献'
      : selectedFolder === 'unfiled'
        ? '未分类'
        : currentFolder?.name ?? '文件夹';
  const selectedFolderPaperCount =
    selectedFolder === 'all'
      ? papers.length
      : selectedFolder === 'unfiled'
        ? unfiledCount
        : currentFolder
          ? folderCount(currentFolder.id)
          : 0;

  const submitCreateFolder = async (event: FormEvent) => {
    event.preventDefault();
    if (!newFolderName.trim() || folderSaving) return;
    setFolderSaving(true);
    const folder = await onCreateFolder(newFolderName);
    setFolderSaving(false);
    if (!folder) return;
    setNewFolderName('');
    setCreatingFolder(false);
    setSelectedFolder(folder.id);
  };

  const beginRenameFolder = (folder: Folder) => {
    setEditingFolderId(folder.id);
    setFolderDraft(folder.name);
  };

  const submitRenameFolder = async (folder: Folder) => {
    if (!folderDraft.trim() || folderSaving) return;
    setFolderSaving(true);
    const ok = await onRenameFolder(folder, folderDraft);
    setFolderSaving(false);
    if (ok) {
      setEditingFolderId(null);
      setFolderDraft('');
    }
  };

  const confirmDeleteFolder = async (folder: Folder) => {
    if (
      !window.confirm(
        `删除文件夹「${folder.name}」？其中的论文会移动到「未分类」，不会删除论文和对话。`,
      )
    ) {
      return;
    }
    const ok = await onDeleteFolder(folder);
    if (ok && selectedFolder === folder.id) setSelectedFolder('unfiled');
  };

  const movePaperTo = async (target: string | null) => {
    if (!movingPaper) return;
    setMoveTarget(target ?? 'unfiled');
    const ok = await onMovePaper(movingPaper, target);
    setMoveTarget(null);
    if (ok) setMovingPaper(null);
  };

  return (
    <div className="library-screen" role="dialog" aria-modal="true" aria-label="我的文库">
      <header className="library-topbar">
        <button
          type="button"
          className="library-logo-button"
          onClick={onGoHome}
          title="返回首页"
          aria-label="返回首页"
        >
          <Logo compact />
        </button>
        <span className="library-breadcrumb">我的文库</span>
        <button
          type="button"
          className="library-import-button"
          onClick={onOpenBatchImport}
          title="批量导入链接或本地 PDF"
        >
          <Upload size={14} />
          批量导入
        </button>
        <button
          type="button"
          className="library-history-button"
          onClick={onOpenImportHistory}
          title="查看导入失败记录"
        >
          <History size={14} />
          <span>导入记录</span>
        </button>
        <button type="button" className="library-close" onClick={onClose}>
          <ArrowLeft size={14} />
          返回
        </button>
      </header>

      <div className="library-scroll">
        <main className="library-main">
          <div className="library-hero">
            <div>
              <span className="eyebrow">
                <span className="eyebrow-rule" />
                READING ARCHIVE
              </span>
              <h1>我的文库</h1>
              <p>读过的论文、停下的页码，以及和它们进行过的对话。</p>
            </div>
            <div className="library-stats" aria-label="文库统计">
              <div>
                <strong>{papers.length}</strong>
                <span>篇论文</span>
              </div>
              <i />
              <div>
                <strong>{totalConversations}</strong>
                <span>段对话</span>
              </div>
              <i />
              <div>
                <strong>{favoriteCount}</strong>
                <span>篇收藏</span>
              </div>
              {storage && (
                <div className="storage-stat">
                  <span>本地存储</span>
                  <strong>{formatBytes(storage.usage)}</strong>
                </div>
              )}
            </div>
          </div>

          <div className="library-body">
            <aside className="folder-panel" aria-label="论文文件夹">
              <div className="folder-panel-head">
                <span>文件夹</span>
                <em>{folders.length}</em>
              </div>
              <div className="folder-list">
                <button
                  type="button"
                  className={`folder-row ${selectedFolder === 'all' ? 'is-active' : ''}`}
                  onClick={() => setSelectedFolder('all')}
                >
                  <BookOpen size={13} />
                  <span className="folder-row-name">全部文献</span>
                  <em>{papers.length}</em>
                </button>
                <button
                  type="button"
                  className={`folder-row ${
                    selectedFolder === 'unfiled' ? 'is-active' : ''
                  }`}
                  onClick={() => setSelectedFolder('unfiled')}
                >
                  <Inbox size={13} />
                  <span className="folder-row-name">未分类</span>
                  <em>{unfiledCount}</em>
                </button>

                {folders.length > 0 && <div className="folder-divider" />}

                {folders.map((folder) => {
                  const active = selectedFolder === folder.id;
                  const editing = editingFolderId === folder.id;
                  if (editing) {
                    return (
                      <form
                        key={folder.id}
                        className="folder-edit-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void submitRenameFolder(folder);
                        }}
                      >
                        <span
                          className="folder-dot"
                          style={{ background: folder.color }}
                        />
                        <input
                          autoFocus
                          value={folderDraft}
                          onChange={(event) => setFolderDraft(event.target.value)}
                          maxLength={30}
                          aria-label="文件夹名称"
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              setEditingFolderId(null);
                              setFolderDraft('');
                            }
                          }}
                        />
                        <button
                          type="submit"
                          disabled={folderSaving}
                          aria-label="保存文件夹名称"
                        >
                          <Check size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingFolderId(null);
                            setFolderDraft('');
                          }}
                          aria-label="取消重命名"
                        >
                          <X size={12} />
                        </button>
                      </form>
                    );
                  }
                  return (
                    <div
                      key={folder.id}
                      className={`folder-row-wrap ${active ? 'is-active' : ''}`}
                    >
                      <button
                        type="button"
                        className={`folder-row ${active ? 'is-active' : ''}`}
                        onClick={() => setSelectedFolder(folder.id)}
                      >
                        <span
                          className="folder-dot"
                          style={{ background: folder.color }}
                        />
                        <span className="folder-row-name">{folder.name}</span>
                        <em>{folderCount(folder.id)}</em>
                      </button>
                      <div className="folder-row-actions">
                        <button
                          type="button"
                          onClick={() => beginRenameFolder(folder)}
                          aria-label="重命名文件夹"
                          title="重命名"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void confirmDeleteFolder(folder)}
                          aria-label="删除文件夹"
                          title="删除"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {creatingFolder && (
                  <form
                    className="folder-create-form"
                    onSubmit={(event) => void submitCreateFolder(event)}
                  >
                    <FolderPlus size={13} />
                    <input
                      autoFocus
                      value={newFolderName}
                      onChange={(event) => setNewFolderName(event.target.value)}
                      placeholder="文件夹名称"
                      maxLength={30}
                      aria-label="新文件夹名称"
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          setCreatingFolder(false);
                          setNewFolderName('');
                        }
                      }}
                    />
                    <button
                      type="submit"
                      disabled={!newFolderName.trim() || folderSaving}
                      aria-label="创建文件夹"
                    >
                      <Check size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCreatingFolder(false);
                        setNewFolderName('');
                      }}
                      aria-label="取消创建文件夹"
                    >
                      <X size={12} />
                    </button>
                  </form>
                )}
              </div>

              <button
                type="button"
                className="folder-add-button"
                onClick={() => setCreatingFolder(true)}
              >
                <FolderPlus size={13} />
                新建文件夹
              </button>
              <p className="folder-note">删除文件夹不会删除论文</p>
            </aside>

            <div className="library-content">
          <div className="library-toolbar">
            <label className="library-search">
              <Search size={15} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索标题、作者或链接"
                aria-label="搜索文库"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} aria-label="清空搜索">
                  <X size={13} />
                </button>
              )}
            </label>

            <div className="library-filters" role="group" aria-label="筛选论文">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={filter === item.id ? 'is-active' : ''}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <label className="library-sort">
              <span>排序</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                <option value="recent">最近打开</option>
                <option value="added">最近添加</option>
                <option value="title">标题</option>
              </select>
            </label>
          </div>

          {error && <div className="library-error">{error}</div>}

          {loading ? (
            <div className="library-grid" aria-label="正在载入文库">
              {Array.from({ length: 4 }).map((_, index) => (
                <div className="library-card library-card--skeleton" key={index}>
                  <div className="skeleton-cover" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line short" />
                </div>
              ))}
            </div>
          ) : papers.length === 0 ? (
            <div className="library-empty">
              <div className="library-empty-mark">
                <BookOpen size={28} strokeWidth={1.4} />
              </div>
              <h2>文库还是空的</h2>
              <p>导入第一篇论文，或从链接、本地 PDF 批量加入文库。</p>
              <button type="button" className="library-empty-button" onClick={onClose}>
                {currentPaperId ? '返回阅读' : '去导入论文'}
                <ArrowUpRight size={14} />
              </button>
            </div>
          ) : filtered.length === 0 && selectedFolder !== 'all' && selectedFolderPaperCount === 0 ? (
            <div className="library-empty compact folder-empty">
              <div className="library-empty-mark">
                <FolderIcon size={25} strokeWidth={1.4} />
              </div>
              <h2>
                {selectedFolder === 'unfiled' ? '未分类里还没有论文' : '这个文件夹还没有论文'}
              </h2>
              <p>打开「全部文献」中的卡片，使用文件夹按钮把论文移到这里。</p>
              <button
                type="button"
                className="library-empty-button"
                onClick={() => setSelectedFolder('all')}
              >
                查看全部文献
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="library-empty compact">
              <h2>没有匹配的论文</h2>
              <p>试试其他关键词，或清空筛选项。</p>
              <button
                type="button"
                className="library-empty-button"
                onClick={() => {
                  setSearch('');
                  setFilter('all');
                }}
              >
                清空筛选
              </button>
            </div>
          ) : (
            <>
              <div className="library-result-line">
                <span>
                  {selectedFolderLabel} · {filtered.length} 篇
                  {search ? ` · “${search}”` : ''}
                </span>
                <span>点击卡片继续阅读</span>
              </div>
              <div className="library-grid">
                {filtered.map((paper) => {
                  const isCurrent = paper.id === currentPaperId;
                  const isBusy = busyPaperId === paper.id;
                  const progress =
                    paper.pageCount > 0
                      ? Math.min(100, Math.max(0, (paper.lastPage / paper.pageCount) * 100))
                      : 0;
                  const unavailable =
                    (paper.source === 'local' || paper.source === 'web') &&
                    paper.pdfBytes === 0;
                  return (
                    <article
                      key={paper.id}
                      className={`library-card ${isCurrent ? 'is-current' : ''} ${
                        isBusy ? 'is-busy' : ''
                      }`}
                      onClick={() => {
                        if (!isBusy) onOpenPaper(paper);
                      }}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if ((event.key === 'Enter' || event.key === ' ') && !isBusy) {
                          event.preventDefault();
                          onOpenPaper(paper);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`打开论文：${paper.title}`}
                    >
                      <div className="library-cover">
                        <PaperCover paper={paper} />
                        <div className="library-cover-shade" />
                        <div className="library-card-actions">
                          <button
                            type="button"
                            className={`favorite-button ${paper.favorite ? 'is-favorite' : ''}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              onToggleFavorite(paper);
                            }}
                            aria-label={paper.favorite ? '取消收藏' : '收藏论文'}
                            title={paper.favorite ? '取消收藏' : '收藏'}
                          >
                            <Star size={14} fill={paper.favorite ? 'currentColor' : 'none'} />
                          </button>
                          <button
                            type="button"
                            className="card-folder-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setMovingPaper(paper);
                            }}
                            aria-label="移动到文件夹"
                            title="移动到文件夹"
                          >
                            <FolderInput size={13} />
                          </button>
                          <button
                            type="button"
                            className="card-delete-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onDeletePaper(paper);
                            }}
                            aria-label="从文库删除"
                            title="从文库删除"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                        <div className="library-cover-badges">
                          <span className={`source-badge source-${paper.source}`}>
                            {paper.source === 'arxiv'
                              ? 'ARXIV'
                              : paper.source === 'web'
                                ? 'WEB'
                                : 'PDF'}
                          </span>
                          {isCurrent && <span className="current-badge">正在阅读</span>}
                          {unavailable && <span className="missing-badge">缺少文件</span>}
                        </div>
                        <div className="library-open-hint">
                          {isBusy ? (
                            <>
                              <Loader2 size={14} className="spin" />
                              正在打开
                            </>
                          ) : unavailable ? (
                            '需重新导入'
                          ) : (
                            <>
                              继续阅读
                              <ArrowUpRight size={14} />
                            </>
                          )}
                        </div>
                      </div>

                      <div className="library-card-body">
                        <span
                          className="library-source-line"
                          title={
                            paper.source === 'web'
                              ? paper.sourceUrl || paper.fileName
                              : paper.source === 'local'
                                ? paper.fileName
                                : undefined
                          }
                        >
                          {paper.source === 'arxiv'
                            ? `${paper.year || 'arXiv'} · ${paper.category || paper.arxivId}`
                            : paper.source === 'web'
                              ? `网页 PDF · ${paper.pageCount} 页`
                              : `本地 PDF · ${paper.pageCount} 页`}
                        </span>
                        <h3>{paper.title}</h3>
                        <p className="library-authors">
                          {paper.authors.length > 0
                            ? paper.authors.slice(0, 3).join('、') +
                              (paper.authors.length > 3 ? ' 等' : '')
                            : '作者未知'}
                        </p>
                        <div className="library-card-meta">
                          <span>
                            <MessageSquare size={12} />
                            {paper.conversationCount > 0
                              ? `${paper.conversationCount} 段对话`
                              : '暂无对话'}
                          </span>
                          <span>
                            <Clock3 size={12} />
                            {formatRelativeTime(paper.lastOpenedAt)}
                          </span>
                          {selectedFolder === 'all' &&
                            paper.folderId &&
                            (() => {
                              const folder = folders.find(
                                (item) => item.id === paper.folderId,
                              );
                              return folder ? (
                                <span className="library-folder-label">
                                  <FolderIcon size={11} />
                                  {folder.name}
                                </span>
                              ) : null;
                            })()}
                        </div>
                        <div className="library-progress">
                          <div className="library-progress-track">
                            <span style={{ width: `${progress}%` }} />
                          </div>
                          <span>
                            {paper.pageCount > 0
                              ? `${paper.lastPage} / ${paper.pageCount} 页`
                              : '页面信息缺失'}
                          </span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
            </div>
          </div>
        </main>
        <footer className="library-footer">
          <span>海拉 · 本地文库</span>
          <span>论文、阅读进度和对话均保存在当前浏览器</span>
        </footer>
      </div>

      {movingPaper && (
        <div
          className="folder-picker-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMovingPaper(null);
          }}
        >
          <div
            className="folder-picker"
            role="dialog"
            aria-modal="true"
            aria-label="移动到文件夹"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="folder-picker-head">
              <span className="folder-picker-icon">
                <FolderInput size={17} />
              </span>
              <div>
                <strong>移动到文件夹</strong>
                <span>{movingPaper.title}</span>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setMovingPaper(null)}
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </div>

            <div className="folder-picker-list">
              <button
                type="button"
                className={`folder-picker-row ${
                  !movingPaper.folderId ? 'is-active' : ''
                }`}
                disabled={moveTarget !== null}
                onClick={() => void movePaperTo(null)}
              >
                <span className="folder-picker-row-icon">
                  <Inbox size={14} />
                </span>
                <span>未分类</span>
                {!movingPaper.folderId && <Check size={14} />}
              </button>
              {folders.map((folder) => {
                const active = movingPaper.folderId === folder.id;
                return (
                  <button
                    key={folder.id}
                    type="button"
                    className={`folder-picker-row ${active ? 'is-active' : ''}`}
                    disabled={moveTarget !== null}
                    onClick={() => void movePaperTo(folder.id)}
                  >
                    <span
                      className="folder-dot"
                      style={{ background: folder.color }}
                    />
                    <span>{folder.name}</span>
                    {active && <Check size={14} />}
                  </button>
                );
              })}
            </div>

            {folders.length === 0 && (
              <p className="folder-picker-hint">
                还没有文件夹。关闭此窗口后，可在左侧新建文件夹。
              </p>
            )}

            <div className="folder-picker-foot">
              <button type="button" onClick={() => setMovingPaper(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
