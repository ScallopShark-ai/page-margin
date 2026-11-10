import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  Archive,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  Circle,
  Clock3,
  Folder as FolderIcon,
  FolderInput,
  FolderPlus,
  Globe2,
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
import type { Folder, PaperStatus, StoredPaper } from '../types';
import {
  folderPathLabel,
  folderScopeIds,
  formatRelativeTime,
  storageUsage,
} from '../lib/library';
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
  onSetPaperStatus: (paper: StoredPaper, status: PaperStatus) => void;
  onCreateFolder: (
    name: string,
    parentId: string | null,
  ) => Promise<Folder | null>;
  onRenameFolder: (folder: Folder, name: string) => Promise<boolean>;
  onDeleteFolder: (folder: Folder) => Promise<boolean>;
  onMovePapers: (papers: StoredPaper[], folderId: string | null) => Promise<boolean>;
  onOpenBatchImport: () => void;
  onOpenImportHistory: () => void;
  onOpenSearch: () => void;
}

type Filter = 'all' | 'arxiv' | 'local' | 'web' | 'favorite';
type StatusFilter = 'active' | PaperStatus;
type Sort =
  | 'recent'
  | 'added'
  | 'progress-desc'
  | 'progress-asc'
  | 'title-asc'
  | 'title-desc'
  | 'published-desc'
  | 'published-asc';
type FolderSelection = 'all' | 'unfiled' | string;

const STATUS_OPTIONS: {
  id: StatusFilter;
  label: string;
  icon: typeof Circle;
}[] = [
  { id: 'active', label: '常规', icon: BookOpen },
  { id: 'unread', label: '未读', icon: Circle },
  { id: 'reading', label: '进行中', icon: Clock3 },
  { id: 'read', label: '已读', icon: Check },
  { id: 'archived', label: '归档', icon: Archive },
];

const PAPER_STATUS_LABELS: Record<PaperStatus, string> = {
  unread: '未读',
  reading: '进行中',
  read: '已读',
  archived: '归档',
};

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

function readingProgress(paper: StoredPaper): number {
  if (paper.pageCount <= 0) return 0;
  return Math.min(1, Math.max(0, paper.lastPage / paper.pageCount));
}

function publicationTime(paper: StoredPaper): number | null {
  if (paper.published) {
    const parsed = Date.parse(paper.published);
    if (Number.isFinite(parsed)) return parsed;
  }
  const year = Number(paper.year);
  if (Number.isFinite(year) && year > 0) {
    return Date.UTC(year, 0, 1);
  }
  return null;
}

function compareTitles(a: StoredPaper, b: StoredPaper): number {
  return a.title.localeCompare(b.title, 'zh-CN', { sensitivity: 'base' });
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
  onSetPaperStatus,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMovePapers,
  onOpenBatchImport,
  onOpenImportHistory,
  onOpenSearch,
}: LibraryModalProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [sort, setSort] = useState<Sort>('recent');
  const [selectedFolder, setSelectedFolder] = useState<FolderSelection>('all');
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderParentId, setNewFolderParentId] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState('');
  const [folderSaving, setFolderSaving] = useState(false);
  const [movingPapers, setMovingPapers] = useState<StoredPaper[]>([]);
  const [moveTarget, setMoveTarget] = useState<string | 'unfiled' | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const libraryScrollRef = useRef<HTMLDivElement>(null);
  const libraryScrollTopRef = useRef(0);
  const libraryScrollRestoredRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (
        document.querySelector(
          '.batch-backdrop, .import-history-backdrop, .modal-backdrop, .search-screen',
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
    if (!open) {
      libraryScrollRestoredRef.current = false;
      return;
    }
    if (libraryScrollRestoredRef.current || loading) return;
    const element = libraryScrollRef.current;
    if (!element) return;
    libraryScrollRestoredRef.current = true;
    const target = libraryScrollTopRef.current;
    if (target <= 0) return;
    const frame = window.requestAnimationFrame(() => {
      element.scrollTop = target;
    });
    const timer = window.setTimeout(() => {
      element.scrollTop = target;
    }, 80);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [open, loading, papers.length]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void storageUsage().then((value) => {
      if (!cancelled) setStorage(value);
    });
    return () => {
      cancelled = true;
    };
  }, [open, papers]);

  useEffect(() => {
    if (
      selectedFolder !== 'all' &&
      selectedFolder !== 'unfiled' &&
      !folders.some((folder) => folder.id === selectedFolder)
    ) {
      setSelectedFolder('unfiled');
    }
  }, [folders, selectedFolder]);

  useEffect(() => {
    if (!open) {
      setSelectionMode(false);
      setSelectedIds(new Set());
      setMovingPapers([]);
      setCreatingFolder(false);
      setNewFolderName('');
      setNewFolderParentId(null);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [filter, search, selectedFolder, sort, statusFilter]);

  const folderChildren = useMemo(() => {
    const folderIds = new Set(folders.map((folder) => folder.id));
    const map = new Map<string | null, Folder[]>();
    for (const folder of folders) {
      const parentId =
        folder.parentId && folderIds.has(folder.parentId)
          ? folder.parentId
          : null;
      const siblings = map.get(parentId) ?? [];
      siblings.push(folder);
      map.set(parentId, siblings);
    }
    for (const siblings of map.values()) {
      siblings.sort((a, b) => a.createdAt - b.createdAt);
    }
    return map;
  }, [folders]);

  const folderScopes = useMemo(() => folderScopeIds(folders), [folders]);

  const statusPool = useMemo(() => {
    if (statusFilter === 'active') {
      return papers.filter(
        (paper) => paper.status !== 'archived' && paper.status !== 'read',
      );
    }
    if (statusFilter === 'archived') {
      return papers.filter((paper) => paper.status === 'archived');
    }
    return papers.filter((paper) => paper.status === statusFilter);
  }, [papers, statusFilter]);

  const readPapers = useMemo(
    () => papers.filter((paper) => paper.status === 'read'),
    [papers],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const selectedScope =
      selectedFolder !== 'all' && selectedFolder !== 'unfiled'
        ? folderScopes.get(selectedFolder) ?? new Set([selectedFolder])
        : null;
    const rows = statusPool.filter((paper) => {
      if (selectedFolder === 'unfiled' && paper.folderId) return false;
      if (
        selectedScope &&
        (!paper.folderId || !selectedScope.has(paper.folderId))
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
      if (sort === 'title-asc') {
        return compareTitles(a, b) || b.lastOpenedAt - a.lastOpenedAt;
      }
      if (sort === 'title-desc') {
        return compareTitles(b, a) || b.lastOpenedAt - a.lastOpenedAt;
      }
      if (sort === 'progress-desc') {
        return (
          readingProgress(b) - readingProgress(a) ||
          compareTitles(a, b) ||
          b.lastOpenedAt - a.lastOpenedAt
        );
      }
      if (sort === 'progress-asc') {
        return (
          readingProgress(a) - readingProgress(b) ||
          compareTitles(a, b) ||
          b.lastOpenedAt - a.lastOpenedAt
        );
      }
      if (sort === 'published-desc' || sort === 'published-asc') {
        const aTime = publicationTime(a);
        const bTime = publicationTime(b);
        if (aTime === null && bTime === null) return compareTitles(a, b);
        if (aTime === null) return 1;
        if (bTime === null) return -1;
        const diff = sort === 'published-desc' ? bTime - aTime : aTime - bTime;
        return diff || compareTitles(a, b);
      }
      if (sort === 'added') return b.createdAt - a.createdAt;
      return b.lastOpenedAt - a.lastOpenedAt;
    });
  }, [statusPool, search, filter, sort, selectedFolder, folderScopes]);

  if (!open) return null;

  const selectedPapers = filtered.filter((paper) => selectedIds.has(paper.id));
  const selectedCount = selectedPapers.length;
  const allVisibleSelected =
    filtered.length > 0 && filtered.every((paper) => selectedIds.has(paper.id));

  const activePapers = papers.filter(
    (paper) => paper.status !== 'archived',
  );
  const totalConversations = activePapers.reduce(
    (sum, paper) => sum + paper.conversationCount,
    0,
  );
  const favoriteCount = activePapers.filter((paper) => paper.favorite).length;
  const statusCounts: Record<StatusFilter, number> = {
    active: activePapers.filter((paper) => paper.status !== 'read').length,
    unread: activePapers.filter((paper) => paper.status === 'unread').length,
    reading: activePapers.filter((paper) => paper.status === 'reading').length,
    read: readPapers.length,
    archived: papers.filter((paper) => paper.status === 'archived').length,
  };
  const unfiledCount = statusPool.filter((paper) => !paper.folderId).length;
  const folderCount = (folderId: string) => {
    const scope = folderScopes.get(folderId) ?? new Set([folderId]);
    return statusPool.filter(
      (paper) => paper.folderId && scope.has(paper.folderId),
    ).length;
  };
  const currentFolder = folders.find((folder) => folder.id === selectedFolder);
  const selectedFolderLabel =
    selectedFolder === 'all'
      ? '全部文献'
      : selectedFolder === 'unfiled'
        ? '未分类'
        : folderPathLabel(folders, selectedFolder) || '文件夹';
  const selectedFolderPaperCount =
    selectedFolder === 'all'
      ? statusPool.length
      : selectedFolder === 'unfiled'
        ? unfiledCount
        : currentFolder
          ? folderCount(currentFolder.id)
          : 0;
  const statusLabel =
    STATUS_OPTIONS.find((item) => item.id === statusFilter)?.label ?? '全部文献';
  const readInSelection =
    statusFilter === 'active'
      ? readPapers.filter((paper) => {
          if (selectedFolder === 'all') return true;
          if (selectedFolder === 'unfiled') return !paper.folderId;
          if (!paper.folderId) return false;
          const scope =
            folderScopes.get(selectedFolder) ?? new Set([selectedFolder]);
          return scope.has(paper.folderId);
        }).length
      : 0;
  const onlyReadInSelection =
    statusFilter === 'active' && readInSelection > 0;

  const beginCreateFolder = (parentId: string | null) => {
    setEditingFolderId(null);
    setCreatingFolder(true);
    setNewFolderName('');
    setNewFolderParentId(parentId);
  };

  const cancelCreateFolder = () => {
    setCreatingFolder(false);
    setNewFolderName('');
    setNewFolderParentId(null);
  };

  const submitCreateFolder = async (event: FormEvent) => {
    event.preventDefault();
    if (!newFolderName.trim() || folderSaving) return;
    setFolderSaving(true);
    const folder = await onCreateFolder(newFolderName, newFolderParentId);
    setFolderSaving(false);
    if (!folder) return;
    setNewFolderName('');
    setCreatingFolder(false);
    setNewFolderParentId(null);
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
    const childCount = folders.filter(
      (item) => (item.parentId ?? null) === folder.id,
    ).length;
    const destination = folder.parentId
      ? `「${folderPathLabel(folders, folder.parentId)}」`
      : '「未分类」';
    if (
      !window.confirm(
        `删除文件夹「${folder.name}」？${
          childCount > 0
            ? `${childCount} 个子文件夹会移到上一级；`
            : ''
        }直属论文会移动到${destination}，不会删除论文和对话。`,
      )
    ) {
      return;
    }
    const ok = await onDeleteFolder(folder);
    if (ok && selectedFolder === folder.id) {
      setSelectedFolder(folder.parentId ?? 'unfiled');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const enterSelectionMode = () => {
    setSelectionMode(true);
    setSelectedIds(new Set());
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const selectAllVisible = () => {
    setSelectedIds(new Set(filtered.map((paper) => paper.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const openBatchMove = () => {
    if (selectedPapers.length > 0) setMovingPapers(selectedPapers);
  };

  const commonFolderId =
    movingPapers.length > 0 &&
    movingPapers.every((paper) => paper.folderId === movingPapers[0].folderId)
      ? movingPapers[0].folderId
      : '__mixed__';

  const movePapersTo = async (target: string | null) => {
    if (movingPapers.length === 0) return;
    setMoveTarget(target ?? 'unfiled');
    const ok = await onMovePapers(movingPapers, target);
    setMoveTarget(null);
    if (ok) {
      setMovingPapers([]);
      setSelectedIds(new Set());
    }
  };

  const renderCreateFolderForm = (depth: number, parentId: string | null) => (
    <form
      className="folder-create-form"
      style={{ marginLeft: `${depth * 14}px` }}
      onSubmit={(event) => void submitCreateFolder(event)}
    >
      <FolderPlus size={13} />
      <input
        autoFocus
        value={newFolderName}
        onChange={(event) => setNewFolderName(event.target.value)}
        placeholder={parentId ? '子文件夹名称' : '文件夹名称'}
        maxLength={30}
        aria-label={parentId ? '新子文件夹名称' : '新文件夹名称'}
        onKeyDown={(event) => {
          if (event.key === 'Escape') cancelCreateFolder();
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
        onClick={cancelCreateFolder}
        aria-label="取消创建文件夹"
      >
        <X size={12} />
      </button>
    </form>
  );

  const renderFolder = (folder: Folder, depth: number): ReactNode => {
    const active = selectedFolder === folder.id;
    const editing = editingFolderId === folder.id;
    const children = folderChildren.get(folder.id) ?? [];
    return (
      <div className="folder-node" key={folder.id}>
        {editing ? (
          <form
            className="folder-edit-form"
            style={{ marginLeft: `${depth * 14}px` }}
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
        ) : (
          <div
            className={`folder-row-wrap ${active ? 'is-active' : ''}`}
          >
            <button
              type="button"
              className={`folder-row ${active ? 'is-active' : ''}`}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              onClick={() => setSelectedFolder(folder.id)}
              title={folderPathLabel(folders, folder.id)}
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
                onClick={() => beginCreateFolder(folder.id)}
                aria-label="新建子文件夹"
                title="新建子文件夹"
              >
                <FolderPlus size={12} />
              </button>
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
        )}
        {children.map((child) => renderFolder(child, depth + 1))}
        {creatingFolder &&
          newFolderParentId === folder.id &&
          renderCreateFolderForm(depth + 1, folder.id)}
      </div>
    );
  };

  return (
    <div
      className={`library-screen ${selectionMode ? 'is-selecting' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="我的文库"
    >
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
          className="library-import-button library-search-agent-button"
          onClick={onOpenSearch}
          title="通过对话联网搜索文献"
        >
          <Globe2 size={14} />
          搜文献
        </button>
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

      <div
        className="library-scroll"
        ref={libraryScrollRef}
        onScroll={(event) => {
          libraryScrollTopRef.current = event.currentTarget.scrollTop;
        }}
      >
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
                <strong>{activePapers.length}</strong>
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
                  <em>{statusPool.length}</em>
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

                {(folderChildren.get(null) ?? []).map((folder) =>
                  renderFolder(folder, 0),
                )}

                {creatingFolder &&
                  newFolderParentId === null &&
                  renderCreateFolderForm(0, null)}

              </div>

              <button
                type="button"
                className="folder-add-button"
                onClick={() => beginCreateFolder(null)}
              >
                <FolderPlus size={13} />
                新建文件夹
              </button>
              <p className="folder-note">支持多级子文件夹；删除文件夹不会删除论文</p>
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
                <optgroup label="时间">
                  <option value="recent">最近打开</option>
                  <option value="added">最近添加</option>
                </optgroup>
                <optgroup label="阅读进度">
                  <option value="progress-desc">阅读进度：从高到低</option>
                  <option value="progress-asc">阅读进度：从低到高</option>
                </optgroup>
                <optgroup label="标题">
                  <option value="title-asc">标题：升序</option>
                  <option value="title-desc">标题：降序</option>
                </optgroup>
                <optgroup label="发表时间">
                  <option value="published-desc">发表时间：新 → 旧</option>
                  <option value="published-asc">发表时间：旧 → 新</option>
                </optgroup>
              </select>
            </label>
          </div>

          <div className="library-status-bar" role="group" aria-label="按阅读状态筛选">
            <span className="library-status-label">阅读状态</span>
            {STATUS_OPTIONS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`library-status-filter ${
                    statusFilter === item.id ? 'is-active' : ''
                  } ${item.id === 'archived' ? 'is-archived' : ''}`}
                  onClick={() => setStatusFilter(item.id)}
                >
                  <Icon size={12} />
                  {item.label}
                  <em>{statusCounts[item.id]}</em>
                </button>
              );
            })}
            {statusFilter === 'active' && readInSelection > 0 && (
              <button
                type="button"
                className="library-read-hidden"
                onClick={() => setStatusFilter('read')}
                title="已读论文默认从常规视图隐藏"
              >
                已读 {readInSelection} 篇已隐藏 · 查看
              </button>
            )}
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
                {onlyReadInSelection
                  ? selectedFolder === 'unfiled'
                    ? '未分类里只有已读论文'
                    : '这个文件夹里只有已读论文'
                  : selectedFolder === 'unfiled'
                    ? '未分类里还没有论文'
                    : '这个文件夹还没有论文'}
              </h2>
              <p>
                {onlyReadInSelection
                  ? '已读论文默认从常规视图隐藏；分类、原文和报告都保留。'
                  : '打开「全部文献」中的卡片，使用文件夹按钮把论文移到这里。'}
              </p>
              <button
                type="button"
                className="library-empty-button"
                onClick={() =>
                  onlyReadInSelection
                    ? setStatusFilter('read')
                    : setSelectedFolder('all')
                }
              >
                {onlyReadInSelection
                  ? `查看 ${readInSelection} 篇已读`
                  : '查看全部文献'}
              </button>
            </div>
          ) : filtered.length === 0 && onlyReadInSelection ? (
            <div className="library-empty compact">
              <div className="library-empty-mark">
                <Check size={25} strokeWidth={1.4} />
              </div>
              <h2>常规视图没有论文</h2>
              <p>已读论文默认隐藏，但仍保留分类、原文和报告。</p>
              <button
                type="button"
                className="library-empty-button"
                onClick={() => setStatusFilter('read')}
              >
                查看 {readInSelection} 篇已读
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
                  setStatusFilter('active');
                }}
              >
                清空筛选
              </button>
            </div>
          ) : (
            <>
              <div className="library-result-line">
                <span>
                  {selectedFolderLabel} · {statusLabel} · {filtered.length} 篇
                  {search ? ` · “${search}”` : ''}
                </span>
                <div className="library-result-tools">
                  <span>
                    {selectionMode
                      ? '点击卡片选择'
                      : statusFilter === 'archived'
                        ? '点击卡片查看归档名片'
                        : '点击卡片继续阅读'}
                  </span>
                  <button
                    type="button"
                    className={`library-organize-toggle ${
                      selectionMode ? 'is-active' : ''
                    }`}
                    onClick={
                      selectionMode ? exitSelectionMode : enterSelectionMode
                    }
                  >
                    <FolderInput size={12} />
                    {selectionMode ? '退出整理' : '批量整理'}
                  </button>
                </div>
              </div>
              <div className="library-grid">
                {filtered.map((paper) => {
                  const isCurrent = paper.id === currentPaperId;
                  const isBusy = busyPaperId === paper.id;
                  const isSelected = selectedIds.has(paper.id);
                  const progress =
                    paper.pageCount > 0
                      ? Math.min(100, Math.max(0, (paper.lastPage / paper.pageCount) * 100))
                      : 0;
                  const unavailable =
                    paper.status === 'archived' ||
                    ((paper.source === 'local' || paper.source === 'web') &&
                      paper.pdfBytes === 0);
                  const archiveLink =
                    paper.source === 'arxiv' && paper.arxivId
                      ? `https://arxiv.org/abs/${paper.arxivId}`
                      : paper.sourceUrl ?? '';
                  return (
                    <article
                      key={paper.id}
                      className={`library-card ${isCurrent ? 'is-current' : ''} ${
                        isBusy ? 'is-busy' : ''
                      } ${selectionMode ? 'is-selecting' : ''} ${
                        isSelected ? 'is-selected' : ''
                      }`}
                      onClick={() => {
                        if (isBusy) return;
                        if (selectionMode) {
                          toggleSelect(paper.id);
                        } else if (paper.status === 'archived') {
                          if (archiveLink) {
                            window.open(
                              archiveLink,
                              '_blank',
                              'noopener,noreferrer',
                            );
                          }
                        } else {
                          onOpenPaper(paper);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (!isBusy && (event.key === 'Enter' || event.key === ' ')) {
                          event.preventDefault();
                          if (selectionMode) {
                            toggleSelect(paper.id);
                          } else if (paper.status === 'archived') {
                            if (archiveLink) {
                              window.open(
                                archiveLink,
                                '_blank',
                                'noopener,noreferrer',
                              );
                            }
                          } else {
                            onOpenPaper(paper);
                          }
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={
                        selectionMode
                          ? `${isSelected ? '取消选择' : '选择'}论文：${paper.title}`
                          : paper.status === 'archived'
                            ? `归档论文：${paper.title}`
                            : `打开论文：${paper.title}`
                      }
                      aria-pressed={selectionMode ? isSelected : undefined}
                    >
                      <div className="library-cover">
                        <PaperCover paper={paper} />
                        <div className="library-cover-shade" />
                        {!selectionMode && (
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
                              setMovingPapers([paper]);
                            }}
                            aria-label="移动到文件夹"
                            title="移动到文件夹"
                          >
                            <FolderInput size={13} />
                          </button>
                          {paper.status !== 'archived' && (
                            <button
                              type="button"
                              className="card-archive-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onSetPaperStatus(paper, 'archived');
                              }}
                              aria-label="归档并删除全文"
                              title="归档并删除全文"
                            >
                              <Archive size={13} />
                            </button>
                          )}
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
                        )}
                        {selectionMode && (
                          <button
                            type="button"
                            className={`library-card-select ${
                              isSelected ? 'is-selected' : ''
                            }`}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleSelect(paper.id);
                            }}
                            aria-label={
                              isSelected ? '取消选择' : '选择这篇论文'
                            }
                            aria-pressed={isSelected}
                          >
                            {isSelected && <Check size={14} />}
                          </button>
                        )}
                        <div className="library-cover-badges">
                          <span className={`source-badge source-${paper.source}`}>
                            {paper.source === 'arxiv'
                              ? 'ARXIV'
                              : paper.source === 'web'
                                ? 'WEB'
                                : 'PDF'}
                          </span>
                          <span className={`status-badge status-${paper.status}`}>
                            {PAPER_STATUS_LABELS[paper.status]}
                          </span>
                          {isCurrent && <span className="current-badge">正在阅读</span>}
                          {unavailable && paper.status !== 'archived' && (
                            <span className="missing-badge">缺少文件</span>
                          )}
                        </div>
                        {!selectionMode && (
                          <div className="library-open-hint">
                            {isBusy ? (
                              <>
                                <Loader2 size={14} className="spin" />
                                正在打开
                              </>
                            ) : paper.status === 'archived' ? (
                              archiveLink ? (
                                <>
                                  查看原文
                                  <ArrowUpRight size={14} />
                                </>
                              ) : (
                                '仅保留名片'
                              )
                            ) : unavailable ? (
                              '需重新导入'
                            ) : (
                              <>
                                继续阅读
                                <ArrowUpRight size={14} />
                              </>
                            )}
                          </div>
                        )}
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
                        {!selectionMode && (
                          <label
                            className={`library-card-status status-${paper.status}`}
                            onClick={(event) => event.stopPropagation()}
                            onMouseDown={(event) => event.stopPropagation()}
                          >
                            <span>状态</span>
                            <select
                              value={paper.status}
                              disabled={isBusy}
                              onChange={(event) => {
                                event.stopPropagation();
                                onSetPaperStatus(
                                  paper,
                                  event.target.value as PaperStatus,
                                );
                              }}
                              aria-label={`设置《${paper.title}》的阅读状态`}
                            >
                              {(
                                Object.keys(PAPER_STATUS_LABELS) as PaperStatus[]
                              ).map((status) => (
                                <option key={status} value={status}>
                                  {PAPER_STATUS_LABELS[status]}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
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
                                  {folderPathLabel(folders, folder.id)}
                                </span>
                              ) : null;
                            })()}
                        </div>
                        {paper.status === 'archived' ? (
                          <div className="library-archived-note">
                            <Archive size={12} />
                            全文已删除，仅保留名片和链接
                          </div>
                        ) : (
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
                        )}
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

      {selectionMode && (
        <div className="library-selection-bar" role="region" aria-label="批量整理论文">
          <div className="library-selection-info">
            <strong>已选 {selectedCount} 篇</strong>
            <span>{selectedFolderLabel} · 点击卡片继续选择</span>
          </div>
          <div className="library-selection-actions">
            <button
              type="button"
              onClick={allVisibleSelected ? clearSelection : selectAllVisible}
              disabled={filtered.length === 0}
            >
              {allVisibleSelected ? '取消全选' : '全选当前'}
            </button>
            <button
              type="button"
              onClick={clearSelection}
              disabled={selectedCount === 0}
            >
              清空
            </button>
            <button
              type="button"
              className="library-selection-primary"
              onClick={openBatchMove}
              disabled={selectedCount === 0}
            >
              <FolderInput size={13} />
              移动到文件夹
            </button>
            <button type="button" onClick={exitSelectionMode}>
              完成
            </button>
          </div>
        </div>
      )}

      {movingPapers.length > 0 && (
        <div
          className="folder-picker-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMovingPapers([]);
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
                <strong>
                  {movingPapers.length === 1
                    ? '移动到文件夹'
                    : `移动 ${movingPapers.length} 篇论文`}
                </strong>
                <span>
                  {movingPapers.length === 1
                    ? movingPapers[0].title
                    : '为本次选中的论文选择目标文件夹'}
                </span>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setMovingPapers([])}
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </div>

            <div className="folder-picker-list">
              <button
                type="button"
                className={`folder-picker-row ${
                  commonFolderId === null ? 'is-active' : ''
                }`}
                disabled={moveTarget !== null}
                onClick={() => void movePapersTo(null)}
              >
                <span className="folder-picker-row-icon">
                  <Inbox size={14} />
                </span>
                <span>未分类</span>
                {commonFolderId === null && <Check size={14} />}
              </button>
              {folders.map((folder) => {
                const active = commonFolderId === folder.id;
                return (
                  <button
                    key={folder.id}
                    type="button"
                    className={`folder-picker-row ${active ? 'is-active' : ''}`}
                    disabled={moveTarget !== null}
                    onClick={() => void movePapersTo(folder.id)}
                  >
                    <span
                      className="folder-dot"
                      style={{ background: folder.color }}
                    />
                    <span>{folderPathLabel(folders, folder.id)}</span>
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
              <button type="button" onClick={() => setMovingPapers([])}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
