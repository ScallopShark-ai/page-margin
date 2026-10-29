import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  AlertCircle,
  FileText,
  Library,
  Loader2,
  Plus,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  ChatMessage,
  ConversationThread,
  Folder,
  JumpRequest,
  LoadProgress,
  ModelConfig,
  PaperMeta,
  PaperSession,
  ServerConfig,
  StoredPaper,
} from './types';
import { Landing } from './components/Landing';
import { PdfViewer } from './components/PdfViewer';
import { ChatPanel } from './components/ChatPanel';
import { SettingsModal } from './components/SettingsModal';
import { LibraryModal } from './components/LibraryModal';
import { Logo, LogoMark } from './components/Logo';
import {
  arxivToMeta,
  extractPageText,
  inferTitleFromPageText,
  loadPdfFromFile,
  loadPdfFromUrl,
  localToMeta,
  readPdfMetadata,
  renderThumbnail,
} from './lib/pdf';
import { fetchPdfBlob, resolveArxiv, streamPaperChat } from './lib/api';
import {
  hasSavedConfig,
  hasUsableModel,
  loadConfig,
  modelLabel,
  saveConfig,
} from './lib/config';
import {
  createFolder as createStoredFolder,
  deleteFolder as deleteStoredFolder,
  deletePaper as deleteStoredPaper,
  deleteThread as deleteStoredThread,
  getPaperBundle,
  getPaperRecord,
  isLibrarySupported,
  listFolders,
  listPapers,
  listThreads,
  messagesForStorage,
  renameFolder as renameStoredFolder,
  savePaper,
  saveThread,
  threadTitleFromQuestion,
  updatePaper,
} from './lib/library';

type MobileTab = 'paper' | 'chat';

interface RestoredThreads {
  threads: ConversationThread[];
  activeThreadId: string | null;
  messages: ChatMessage[];
  startPage: number;
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function arxivPaperId(meta: PaperMeta): string {
  const baseId = (meta.arxivId || '').replace(/v\d+$/i, '');
  return `arxiv-${baseId || hashString(meta.title)}`;
}

function localPaperId(file: File): string {
  return `local-${hashString(`${file.name}|${file.size}|${file.lastModified}`)}`;
}

function emptyThreadState(): RestoredThreads {
  return { threads: [], activeThreadId: null, messages: [], startPage: 1 };
}

function friendlyPdfError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'PasswordException') return '这份 PDF 受密码保护，暂时无法打开。';
  if (name === 'InvalidPDFException') return '无法解析这个文件，请确认它是有效的 PDF。';
  if (/MissingPDF|UnexpectedResponse/i.test(name) || /404|403/.test(message)) {
    return '论文 PDF 下载失败，请稍后重试，或先下载到本地再拖入。';
  }
  if (message) return message;
  return '载入论文时发生未知错误，请重试。';
}

export default function App() {
  const [paper, setPaper] = useState<PaperSession | null>(null);
  const paperRef = useRef<PaperSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const streamingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState<LoadProgress | null>(null);
  const [loadError, setLoadError] = useState('');
  const loadAbortRef = useRef<AbortController | null>(null);
  const [config, setConfig] = useState<ModelConfig>(() => loadConfig());
  const configRef = useRef(config);
  configRef.current = config;
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const currentPageRef = useRef(1);
  currentPageRef.current = currentPage;
  const [jumpRequest, setJumpRequest] = useState<JumpRequest | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>('paper');
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState('');
  const [papers, setPapers] = useState<StoredPaper[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState('');
  const [libraryBusyId, setLibraryBusyId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ConversationThread[]>([]);
  const threadsRef = useRef<ConversationThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [split, setSplit] = useState(() => {
    const raw = Number(localStorage.getItem('pagemargin.split'));
    return Number.isFinite(raw) && raw >= 38 && raw <= 68 ? raw : 56;
  });
  const dragDepth = useRef(0);
  const splitDrag = useRef<{ startX: number; startSplit: number; width: number } | null>(null);
  const bootRef = useRef(false);

  const modelReady = hasUsableModel(config, serverConfig);
  const modelStatusLabel = modelLabel(config, Boolean(serverConfig?.serverConfigured));

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    document.title = paper ? `${paper.meta.title.slice(0, 64)} · 页边` : '页边 · AI 论文精读';
  }, [paper]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 6500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const disposePaper = (target: PaperSession | null) => {
    if (!target) return;
    if (target.pdfHref.startsWith('blob:')) {
      URL.revokeObjectURL(target.pdfHref);
    }
    void target.doc.destroy().catch(() => undefined);
  };

  const activatePaper = (
    session: PaperSession,
    restored: RestoredThreads = emptyThreadState(),
  ) => {
    void saveCurrentThreadSnapshot();
    abortRef.current?.abort();
    abortRef.current = null;
    const previous = paperRef.current;
    paperRef.current = session;
    setPaper(session);
    setThreads(restored.threads);
    threadsRef.current = restored.threads;
    setActiveThreadId(restored.activeThreadId);
    activeThreadIdRef.current = restored.activeThreadId;
    setMessages(restored.messages);
    messagesRef.current = restored.messages;
    setHistoryOpen(false);
    setStreaming(false);
    streamingRef.current = false;
    const startPage = Math.max(1, restored.startPage || 1);
    setCurrentPage(startPage);
    setJumpRequest(startPage > 1 ? { page: startPage, nonce: Date.now() } : null);
    setMobileTab('paper');
    if (previous) window.setTimeout(() => disposePaper(previous), 400);
  };

  const refreshLibrary = async (initial = false) => {
    if (!isLibrarySupported()) {
      setLibraryLoading(false);
      setLibraryError('当前浏览器不支持本地文库，论文与对话不会被持久保存。');
      return;
    }
    if (initial) setLibraryLoading(true);
    try {
      const [rows, folderRows] = await Promise.all([listPapers(), listFolders()]);
      setPapers(rows);
      setFolders(folderRows);
      setLibraryError('');
    } catch (error) {
      console.warn('Failed to load library', error);
      setLibraryError(
        '无法读取本地文库。请检查浏览器是否允许本站使用 IndexedDB。',
      );
    } finally {
      setLibraryLoading(false);
    }
  };

  const readRestoredThreads = async (paperId: string): Promise<RestoredThreads> => {
    if (!isLibrarySupported()) return emptyThreadState();
    try {
      const [record, savedThreads] = await Promise.all([
        getPaperRecord(paperId),
        listThreads(paperId),
      ]);
      const first = savedThreads[0];
      return {
        threads: savedThreads,
        activeThreadId: first?.id ?? null,
        messages: first?.messages ?? [],
        startPage: record?.lastPage ?? 1,
      };
    } catch (error) {
      console.warn('Failed to restore paper history', error);
      return emptyThreadState();
    }
  };

  const persistSession = async (session: PaperSession, pdfBlobPromise: Promise<Blob | null>) => {
    try {
      const [thumbnail, pdfBlob] = await Promise.all([
        renderThumbnail(session.doc).catch(() => undefined),
        pdfBlobPromise.catch(() => null),
      ]);
      const result = await savePaper({
        id: session.key,
        meta: session.meta,
        pages: session.pages,
        pdfBlob,
        thumbnail,
      });
      if (paperRef.current?.key === session.key && currentPageRef.current > 1) {
        await updatePaper(session.key, { lastPage: currentPageRef.current });
      }
      await refreshLibrary();
      if (!result.blobSaved && session.meta.source === 'local') {
        setToast('浏览器存储空间不足：论文信息与对话已保存，但 PDF 原件未保存。');
      }
    } catch (error) {
      console.warn('Failed to add paper to library', error);
      setToast('论文已打开，但未能写入文库。');
    }
  };

  const saveCurrentThreadSnapshot = async (snapshot?: ChatMessage[]): Promise<void> => {
    const activePaper = paperRef.current;
    const threadId = activeThreadIdRef.current;
    const currentMessages = messagesForStorage(snapshot ?? messagesRef.current).map(
      (message) =>
        message.status === 'streaming'
          ? { ...message, status: 'stopped' as const }
          : message,
    );
    if (!activePaper || !threadId || currentMessages.length === 0) return;
    const thread = threadsRef.current.find((item) => item.id === threadId);
    if (!thread) return;
    const updated: ConversationThread = {
      ...thread,
      messages: currentMessages,
      updatedAt: Date.now(),
    };
    try {
      await saveThread(updated);
      // The reader may have switched papers while the write was in flight.
      if (paperRef.current?.key !== activePaper.key) return;
      const next = [updated, ...threadsRef.current.filter((item) => item.id !== updated.id)].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      );
      threadsRef.current = next;
      setThreads(next);
    } catch (error) {
      console.warn('Failed to save conversation', error);
      setToast('对话保存失败，请检查浏览器存储空间。');
    }
  };

  const pauseStreamForNavigation = (): ChatMessage[] => {
    if (!streamingRef.current) return messagesRef.current;
    abortRef.current?.abort();
    streamingRef.current = false;
    setStreaming(false);
    const next = messagesRef.current.map((message) =>
      message.status === 'streaming'
        ? { ...message, status: 'stopped' as const }
        : message,
    );
    messagesRef.current = next;
    setMessages(next);
    return next;
  };

  useEffect(() => {
    if (!paper) return;
    const paperId = paper.key;
    const page = currentPage;
    const timer = window.setTimeout(() => {
      void updatePaper(paperId, { lastPage: page })
        .then((updated) => {
          if (!updated) return;
          setPapers((current) =>
            current.map((item) => (item.id === updated.id ? updated : item)),
          );
        })
        .catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [paper, currentPage]);

  useEffect(() => {
    if (!paper || !activeThreadId || streaming) return;
    if (!messages.some((message) => message.content.trim())) return;
    const timer = window.setTimeout(() => {
      void saveCurrentThreadSnapshot(messages);
    }, 450);
    return () => window.clearTimeout(timer);
    // The ref-backed saver intentionally reads the latest thread object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper, activeThreadId, messages, streaming]);

  const startLoading = (progress: LoadProgress) => setLoading(progress);

  const openArxiv = async (input: string) => {
    setLibraryOpen(false);
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setLoadError('');
    setToast('');
    startLoading({
      stage: '连接 arXiv',
      detail: '正在读取论文元数据…',
      percent: 6,
    });

    try {
      const meta = await resolveArxiv(input, controller.signal);
      if (controller.signal.aborted) return;
      startLoading({
        stage: '下载论文 PDF',
        detail: meta.title,
        percent: 15,
      });

      const doc = await loadPdfFromUrl(meta.pdfUrl, ({ loaded, total }) => {
        if (controller.signal.aborted) return;
        const ratio = total > 0 ? loaded / total : 0.3;
        setLoading({
          stage: '下载论文 PDF',
          detail: `${meta.title}`,
          percent: 15 + Math.min(28, ratio * 28),
        });
      });
      if (controller.signal.aborted) {
        void doc.destroy();
        return;
      }

      const pdfMeta = await readPdfMetadata(doc);
      startLoading({
        stage: '提取论文全文',
        detail: `共 ${doc.numPages} 页，正在建立可检索文本…`,
        percent: 44,
      });

      const extraction = await extractPageText(doc, (page, total) => {
        if (controller.signal.aborted) return;
        setLoading({
          stage: '提取论文全文',
          detail: `正在解析第 ${page} / ${total} 页`,
          percent: 44 + (page / total) * 54,
        });
      });
      if (controller.signal.aborted) {
        void doc.destroy();
        return;
      }

      const mergedMeta = arxivToMeta(meta, doc.numPages, extraction.chars);
      if (mergedMeta.authors.length === 0) mergedMeta.authors = pdfMeta.authors;
      if (meta.metadataUnavailable || /^arXiv\s/i.test(mergedMeta.title)) {
        const inferredTitle = inferTitleFromPageText(extraction.pages[0]?.text ?? '');
        mergedMeta.title =
          inferredTitle ||
          (pdfMeta.title !== '未命名论文' ? pdfMeta.title : '') ||
          mergedMeta.title;
      }
      const paperId = arxivPaperId(mergedMeta);
      const restored = await readRestoredThreads(paperId);
      const session: PaperSession = {
        key: paperId,
        meta: mergedMeta,
        pages: extraction.pages,
        doc,
        pdfHref: meta.pdfUrl,
        extractedChars: extraction.chars,
      };

      startLoading({ stage: '准备阅读器', detail: '正在铺开论文页面…', percent: 100 });
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      if (controller.signal.aborted) {
        void doc.destroy();
        return;
      }
      activatePaper(session, restored);
      const url = new URL(window.location.href);
      url.searchParams.set('arxiv', meta.arxivId);
      window.history.replaceState({}, '', url);
      if (meta.warning) setToast(meta.warning);
      void persistSession(
        session,
        fetchPdfBlob(meta.pdfUrl).catch(() => null),
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = friendlyPdfError(error);
      if (paperRef.current) setToast(message);
      else setLoadError(message);
    } finally {
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null;
        setLoading(null);
      }
    }
  };

  const openLocalFile = async (file: File) => {
    setLibraryOpen(false);
    setLoadError('');
    setToast('');
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      if (paperRef.current) setToast('请选择 PDF 文件');
      else setLoadError('请选择 PDF 文件');
      return;
    }
    if (file.size > 80 * 1024 * 1024) {
      const message = 'PDF 文件过大（超过 80 MB）';
      if (paperRef.current) setToast(message);
      else setLoadError(message);
      return;
    }

    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const pdfHref = URL.createObjectURL(file);
    startLoading({ stage: '读取 PDF', detail: file.name, percent: 8 });

    try {
      const doc = await loadPdfFromFile(file);
      if (controller.signal.aborted) {
        URL.revokeObjectURL(pdfHref);
        void doc.destroy();
        return;
      }
      const pdfMeta = await readPdfMetadata(doc, file);
      startLoading({
        stage: '解析论文',
        detail: `共 ${doc.numPages} 页，正在提取文本…`,
        percent: 28,
      });
      const extraction = await extractPageText(doc, (page, total) => {
        if (controller.signal.aborted) return;
        setLoading({
          stage: '解析论文',
          detail: `正在解析第 ${page} / ${total} 页`,
          percent: 28 + (page / total) * 70,
        });
      });
      if (controller.signal.aborted) {
        URL.revokeObjectURL(pdfHref);
        void doc.destroy();
        return;
      }
      const inferredTitle = inferTitleFromPageText(extraction.pages[0]?.text ?? '');
      const paperId = localPaperId(file);
      const restored = await readRestoredThreads(paperId);
      const session: PaperSession = {
        key: paperId,
        meta: localToMeta(
          file,
          { ...pdfMeta, title: inferredTitle || pdfMeta.title },
          doc.numPages,
          extraction.chars,
        ),
        pages: extraction.pages,
        doc,
        pdfHref,
        localFile: file,
        extractedChars: extraction.chars,
      };
      startLoading({ stage: '准备阅读器', detail: '正在铺开论文页面…', percent: 100 });
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      activatePaper(session, restored);
      window.history.replaceState({}, '', window.location.pathname);
      void persistSession(session, Promise.resolve(file));
    } catch (error) {
      URL.revokeObjectURL(pdfHref);
      if (controller.signal.aborted) return;
      const message = friendlyPdfError(error);
      if (paperRef.current) setToast(message);
      else setLoadError(message);
    } finally {
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null;
        setLoading(null);
      }
    }
  };

  const clearWorkspace = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    loadAbortRef.current?.abort();
    loadAbortRef.current = null;
    streamingRef.current = false;
    setStreaming(false);
    setMessages([]);
    messagesRef.current = [];
    setThreads([]);
    threadsRef.current = [];
    setActiveThreadId(null);
    activeThreadIdRef.current = null;
    setHistoryOpen(false);
    setLibraryOpen(false);
    setLibraryBusyId(null);
    setLoading(null);
    setLoadError('');
    const previous = paperRef.current;
    paperRef.current = null;
    setPaper(null);
    setCurrentPage(1);
    setJumpRequest(null);
    if (previous) window.setTimeout(() => disposePaper(previous), 300);
    window.history.replaceState({}, '', window.location.pathname);
  };

  const goHome = () => {
    void saveCurrentThreadSnapshot();
    clearWorkspace();
  };

  const handleOpenLibrary = () => {
    setLibraryError('');
    const activePaper = paperRef.current;
    if (activePaper) {
      const page = currentPageRef.current;
      setPapers((current) =>
        current.map((item) => (item.id === activePaper.key ? { ...item, lastPage: page } : item)),
      );
      void updatePaper(activePaper.key, { lastPage: page })
        .then((updated) => {
          if (!updated) return;
          setPapers((current) =>
            current.map((item) => (item.id === updated.id ? updated : item)),
          );
        })
        .catch(() => undefined);
    }
    setLibraryOpen(true);
    void refreshLibrary(false);
  };

  const handleOpenStoredPaper = async (record: StoredPaper) => {
    if (paperRef.current?.key === record.id) {
      setLibraryOpen(false);
      return;
    }
    setLibraryError('');
    setLibraryBusyId(record.id);
    let blobHref: string | null = null;
    try {
      const bundle = await getPaperBundle(record.id);
      if (!bundle) throw new Error('这篇论文的文库记录已不存在');
      const content = bundle.content;
      let doc;
      let pdfHref: string;
      if (content?.pdfBlob) {
        doc = await loadPdfFromFile(content.pdfBlob);
        blobHref = URL.createObjectURL(content.pdfBlob);
        pdfHref = blobHref;
      } else if (record.source === 'arxiv' && record.arxivId) {
        pdfHref = `/api/arxiv/pdf?id=${encodeURIComponent(record.arxivId)}`;
        doc = await loadPdfFromUrl(pdfHref);
      } else {
        throw new Error('原始 PDF 未保存在浏览器中，请重新导入这份文件');
      }

      let pages = content?.pages?.filter((page) => page.text.trim()) ?? [];
      let extractedChars = record.chars;
      if (pages.length === 0) {
        const extraction = await extractPageText(doc);
        pages = extraction.pages;
        extractedChars = extraction.chars;
      }

      const meta: PaperMeta = {
        source: record.source,
        title: record.title,
        authors: record.authors,
        abstract: record.abstract,
        published: record.published,
        year: record.year,
        category: record.category,
        arxivId: record.arxivId,
        fileName: record.fileName,
        pages: doc.numPages,
        chars: record.chars || extractedChars,
      };
      const restoredThreads = await listThreads(record.id).catch(() => []);
      const latest = restoredThreads[0];
      const session: PaperSession = {
        key: record.id,
        meta,
        pages,
        doc,
        pdfHref,
        extractedChars,
      };
      activatePaper(session, {
        threads: restoredThreads,
        activeThreadId: latest?.id ?? null,
        messages: latest?.messages ?? [],
        startPage: record.lastPage || 1,
      });
      setLibraryOpen(false);
      setLibraryBusyId(null);
      const updated = await updatePaper(record.id, { lastOpenedAt: Date.now() });
      if (updated) {
        setPapers((current) =>
          current
            .map((item) => (item.id === updated.id ? updated : item))
            .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt),
        );
      }
      if (record.source === 'arxiv' && record.arxivId) {
        const url = new URL(window.location.href);
        url.searchParams.set('arxiv', record.arxivId);
        window.history.replaceState({}, '', url);
      } else {
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch (error) {
      if (blobHref) URL.revokeObjectURL(blobHref);
      setLibraryBusyId(null);
      setLibraryError(friendlyPdfError(error));
    }
  };

  const handleToggleFavorite = async (record: StoredPaper) => {
    const nextFavorite = !record.favorite;
    setPapers((current) =>
      current.map((item) =>
        item.id === record.id ? { ...item, favorite: nextFavorite } : item,
      ),
    );
    try {
      await updatePaper(record.id, { favorite: nextFavorite });
    } catch (error) {
      console.warn('Failed to update favorite', error);
      setPapers((current) =>
        current.map((item) =>
          item.id === record.id ? { ...item, favorite: record.favorite } : item,
        ),
      );
      setToast('收藏状态保存失败');
    }
  };

  const handleDeletePaper = async (record: StoredPaper) => {
    const isCurrent = paperRef.current?.key === record.id;
    const message = isCurrent
      ? `从文库删除《${record.title}》？当前正在阅读，删除后会返回首页。`
      : `从文库删除《${record.title}》？论文、阅读进度和所有对话都会删除，且无法恢复。`;
    if (!window.confirm(message)) return;
    try {
      await deleteStoredPaper(record.id);
      setPapers((current) => current.filter((item) => item.id !== record.id));
      if (isCurrent) {
        setLibraryOpen(false);
        clearWorkspace();
        setToast('已从文库删除');
      } else {
        setToast('已从文库删除');
      }
    } catch (error) {
      console.warn('Failed to delete paper', error);
      setToast('删除失败，请稍后重试');
    }
  };

  const handleCreateFolder = async (name: string): Promise<Folder | null> => {
    try {
      const folder = await createStoredFolder(name);
      setFolders((current) => [...current, folder]);
      return folder;
    } catch (error) {
      setToast(error instanceof Error ? error.message : '新建文件夹失败');
      return null;
    }
  };

  const handleRenameFolder = async (folder: Folder, name: string): Promise<boolean> => {
    try {
      const updated = await renameStoredFolder(folder.id, name);
      setFolders((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : '重命名文件夹失败');
      return false;
    }
  };

  const handleDeleteFolder = async (folder: Folder): Promise<boolean> => {
    try {
      await deleteStoredFolder(folder.id);
      setFolders((current) => current.filter((item) => item.id !== folder.id));
      setPapers((current) =>
        current.map((item) =>
          item.folderId === folder.id ? { ...item, folderId: null } : item,
        ),
      );
      setToast(`文件夹「${folder.name}」已删除，论文已移至未分类`);
      return true;
    } catch (error) {
      console.warn('Failed to delete folder', error);
      setToast('删除文件夹失败，请稍后重试');
      return false;
    }
  };

  const handleMovePaper = async (
    record: StoredPaper,
    folderId: string | null,
  ): Promise<boolean> => {
    try {
      const updated = await updatePaper(record.id, { folderId });
      if (!updated) return false;
      setPapers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      return true;
    } catch (error) {
      console.warn('Failed to move paper', error);
      setToast('移动论文失败，请稍后重试');
      return false;
    }
  };

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
      event.preventDefault();
    };
    const onDragLeave = (event: DragEvent) => {
      event.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const resetDragState = () => {
      dragDepth.current = 0;
      setDragging(false);
    };
    const onDropCapture = () => {
      // Always clear the overlay, even if a child stops the drop from bubbling.
      resetDragState();
    };
    const onDrop = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
      event.preventDefault();
      resetDragState();
      const file = event.dataTransfer?.files?.[0];
      if (file) void openLocalFile(file);
    };
    const onDragEnd = () => resetDragState();
    const onWindowBlur = () => resetDragState();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') resetDragState();
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDropCapture, true);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', onDragEnd);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDropCapture, true);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', onDragEnd);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('keydown', onKeyDown);
    };
    // openLocalFile intentionally uses refs for current state; bind once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    void refreshLibrary(true);
    const query = new URLSearchParams(window.location.search).get('arxiv');
    if (query) void openArxiv(query);

    let cancelled = false;
    void fetch('/api/config')
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as ServerConfig;
      })
      .then((server) => {
        if (cancelled || !server) return;
        setServerConfig(server);
        if (!hasSavedConfig() && server.serverConfigured) {
          setConfig((current) => ({
            ...current,
            provider: server.provider,
            baseUrl: server.baseUrl,
            model: server.model,
            apiKey: '',
          }));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      loadAbortRef.current?.abort();
      if (paperRef.current) disposePaper(paperRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateAssistant = (
    id: string,
    update: (message: ChatMessage) => ChatMessage,
  ) => {
    setMessages((current) => {
      const next = current.map((message) =>
        message.id === id ? update(message) : message,
      );
      messagesRef.current = next;
      return next;
    });
  };

  const syncConversationCount = async (paperId: string, count: number) => {
    try {
      const updated = await updatePaper(paperId, { conversationCount: count });
      if (!updated) return;
      setPapers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch {
      // The count will be recalculated the next time the paper is saved.
    }
  };

  const runChat = async (
    text: string,
    focusPage: number | null,
    baseMessages: ChatMessage[] = messages,
  ) => {
    const activePaper = paperRef.current;
    if (!activePaper || streamingRef.current) return;

    let threadId = activeThreadIdRef.current;
    if (!threadId) {
      const now = Date.now();
      const newThread: ConversationThread = {
        id: makeId(),
        paperId: activePaper.key,
        title: threadTitleFromQuestion(text),
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      threadId = newThread.id;
      activeThreadIdRef.current = threadId;
      setActiveThreadId(threadId);
      const nextThreads = [newThread, ...threadsRef.current];
      threadsRef.current = nextThreads;
      setThreads(nextThreads);
      try {
        await saveThread(newThread);
        void syncConversationCount(activePaper.key, nextThreads.length);
      } catch (error) {
        console.warn('Failed to create conversation', error);
        setToast('新对话未能保存到历史记录');
      }
    }

    const userMessage: ChatMessage = {
      id: makeId(),
      role: 'user',
      content: text,
      status: 'done',
      createdAt: Date.now(),
    };
    const assistantId = makeId();
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      status: 'streaming',
      createdAt: Date.now(),
    };

    const priorHistory = baseMessages
      .filter(
        (message) =>
          message.content.trim() &&
          message.status !== 'error' &&
          message.status !== 'stopped',
      )
      .map((message) => ({ role: message.role, content: message.content }));

    const nextMessages = [...baseMessages, userMessage, assistantMessage];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    streamingRef.current = true;
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    let pending = '';
    let frame = 0;
    const flush = () => {
      if (!pending) return;
      const value = pending;
      pending = '';
      updateAssistant(assistantId, (message) => ({
        ...message,
        content: message.content + value,
        status: 'streaming',
      }));
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        flush();
      });
    };

    try {
      await streamPaperChat({
        paper: activePaper.meta,
        pages: activePaper.pages,
        messages: [...priorHistory, { role: 'user', content: text }],
        config: configRef.current,
        focusPage,
        signal: controller.signal,
        onEvent: (event) => {
          if (paperRef.current?.key !== activePaper.key) return;
          if (event.type === 'delta' && event.text) {
            pending += event.text;
            schedule();
          } else if (event.type === 'meta' && event.meta) {
            updateAssistant(assistantId, (message) => ({
              ...message,
              meta: event.meta,
            }));
          } else if (event.type === 'error') {
            flush();
            updateAssistant(assistantId, (message) => ({
              ...message,
              status: 'error',
              error: event.message || '生成回答时出错',
            }));
          } else if (event.type === 'done') {
            flush();
            updateAssistant(assistantId, (message) =>
              message.status === 'streaming'
                ? { ...message, status: 'done' }
                : message,
            );
          } else if (event.type === 'aborted') {
            flush();
            updateAssistant(assistantId, (message) => ({
              ...message,
              status: 'stopped',
            }));
          }
        },
      });
      flush();
      updateAssistant(assistantId, (message) =>
        message.status === 'streaming' ? { ...message, status: 'done' } : message,
      );
    } catch (error) {
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      flush();
      const aborted =
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError');
      if (aborted) {
        updateAssistant(assistantId, (message) => ({
          ...message,
          status: 'stopped',
        }));
      } else {
        const typed = error as Error & { code?: string };
        updateAssistant(assistantId, (message) => ({
          ...message,
          status: 'error',
          error: typed.message || '生成回答时发生未知错误',
          errorCode: typed.code,
        }));
        if (typed.code === 'NO_API_KEY') setSettingsOpen(true);
      }
    } finally {
      if (frame) window.cancelAnimationFrame(frame);
      streamingRef.current = false;
      setStreaming(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const sendMessage = (text: string, focusPage: number | null) => {
    if (!modelReady) {
      setSettingsOpen(true);
      return;
    }
    void runChat(text, focusPage, messages);
  };

  const stopStreaming = () => {
    abortRef.current?.abort();
    streamingRef.current = false;
    setStreaming(false);
    const next = messagesRef.current.map((message) =>
      message.role === 'assistant' && message.status === 'streaming'
        ? { ...message, status: 'stopped' as const }
        : message,
    );
    messagesRef.current = next;
    setMessages(next);
  };

  const handleNewThread = async () => {
    const snapshot = pauseStreamForNavigation();
    await saveCurrentThreadSnapshot(snapshot);
    setHistoryOpen(false);
    activeThreadIdRef.current = null;
    setActiveThreadId(null);
    messagesRef.current = [];
    setMessages([]);
  };

  const handleSelectThread = async (thread: ConversationThread) => {
    if (thread.id === activeThreadIdRef.current) {
      setHistoryOpen(false);
      return;
    }
    const snapshot = pauseStreamForNavigation();
    await saveCurrentThreadSnapshot(snapshot);
    activeThreadIdRef.current = thread.id;
    setActiveThreadId(thread.id);
    messagesRef.current = thread.messages;
    setMessages(thread.messages);
    setHistoryOpen(false);
  };

  const handleDeleteThread = async (thread: ConversationThread) => {
    const isActive = thread.id === activeThreadIdRef.current;
    if (isActive) pauseStreamForNavigation();
    try {
      await deleteStoredThread(thread.id);
    } catch (error) {
      console.warn('Failed to delete conversation', error);
      setToast('删除对话失败，请稍后重试');
      return;
    }
    const nextThreads = threadsRef.current.filter((item) => item.id !== thread.id);
    threadsRef.current = nextThreads;
    setThreads(nextThreads);
    if (isActive) {
      activeThreadIdRef.current = null;
      setActiveThreadId(null);
      messagesRef.current = [];
      setMessages([]);
    }
    void syncConversationCount(thread.paperId, nextThreads.length);
  };

  const handleRenameThread = async (thread: ConversationThread, title: string) => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    const updated: ConversationThread = {
      ...thread,
      title: nextTitle,
      updatedAt: Date.now(),
    };
    try {
      await saveThread(updated);
      const nextThreads = threadsRef.current
        .map((item) => (item.id === updated.id ? updated : item))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      threadsRef.current = nextThreads;
      setThreads(nextThreads);
    } catch (error) {
      console.warn('Failed to rename conversation', error);
      setToast('重命名失败，请稍后重试');
    }
  };

  const retry = () => {
    if (streamingRef.current) return;
    const next = [...messages];
    while (
      next.length > 0 &&
      next[next.length - 1].role === 'assistant' &&
      ['error', 'stopped'].includes(next[next.length - 1].status ?? '')
    ) {
      next.pop();
    }
    const lastUser = next[next.length - 1];
    if (!lastUser || lastUser.role !== 'user') return;
    next.pop();
    void runChat(lastUser.content, null, next);
  };

  const jumpToPage = (page: number) => {
    setCurrentPage(page);
    setJumpRequest({ page, nonce: Date.now() });
    setMobileTab('paper');
  };

  const handleSaveConfig = (next: ModelConfig) => {
    saveConfig(next);
    setConfig(next);
    setSettingsOpen(false);
    setToast('模型配置已保存');
  };

  const beginSplit = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.innerWidth < 901) return;
    const workspace = event.currentTarget.parentElement;
    if (!workspace) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    splitDrag.current = {
      startX: event.clientX,
      startSplit: split,
      width: workspace.getBoundingClientRect().width,
    };
    document.body.classList.add('is-resizing');
  };

  const moveSplit = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = splitDrag.current;
    if (!drag) return;
    const next = Math.max(
      36,
      Math.min(68, drag.startSplit + ((event.clientX - drag.startX) / drag.width) * 100),
    );
    setSplit(Math.round(next * 10) / 10);
  };

  const endSplit = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!splitDrag.current) return;
    splitDrag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    document.body.classList.remove('is-resizing');
    try {
      localStorage.setItem('pagemargin.split', String(split));
    } catch {
      // ignore storage
    }
  };

  const settingsModal = (
    <SettingsModal
      open={settingsOpen}
      config={config}
      server={serverConfig}
      onClose={() => setSettingsOpen(false)}
      onSave={handleSaveConfig}
    />
  );

  const libraryModal = (
    <LibraryModal
      open={libraryOpen}
      papers={papers}
      folders={folders}
      loading={libraryLoading}
      error={libraryError}
      currentPaperId={paperRef.current?.key ?? null}
      busyPaperId={libraryBusyId}
      onClose={() => setLibraryOpen(false)}
      onOpenPaper={(record) => void handleOpenStoredPaper(record)}
      onToggleFavorite={(record) => void handleToggleFavorite(record)}
      onDeletePaper={(record) => void handleDeletePaper(record)}
      onCreateFolder={handleCreateFolder}
      onRenameFolder={handleRenameFolder}
      onDeleteFolder={handleDeleteFolder}
      onMovePaper={handleMovePaper}
    />
  );

  if (!paper) {
    return (
      <>
        <Landing
          loading={loading}
          error={loadError}
          papers={papers}
          modelReady={modelReady}
          modelLabel={modelStatusLabel}
          onArxiv={(input) => void openArxiv(input)}
          onFile={(file) => void openLocalFile(file)}
          onOpenLibrary={handleOpenLibrary}
          onOpenPaper={(record) => void handleOpenStoredPaper(record)}
          onOpenSettings={() => setSettingsOpen(true)}
          onDismissError={() => setLoadError('')}
        />
        {settingsModal}
        {libraryModal}
        {dragging && (
          <div className="drag-overlay" aria-hidden="true">
            <div className="drag-overlay-inner">
              <div className="drag-file-icon">
                <FileText size={30} />
              </div>
              <strong>松开以打开这份 PDF</strong>
              <span>文件只在本地浏览器中解析</span>
            </div>
          </div>
        )}
        {toast && (
          <div className="toast" role="status">
            <AlertCircle size={16} />
            <span>{toast}</span>
            <button type="button" onClick={() => setToast('')} aria-label="关闭提示">
              <X size={14} />
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="workspace-shell">
      <header className="workspace-header">
        <button type="button" className="workspace-logo" onClick={goHome} title="返回首页">
          <Logo compact />
        </button>
        <div className="header-paper">
          <span className={`source-badge source-${paper.meta.source}`}>
            {paper.meta.source === 'arxiv' ? 'ARXIV' : 'PDF'}
          </span>
          <span className="header-title" title={paper.meta.title}>
            {paper.meta.title}
          </span>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="header-library-button"
            onClick={handleOpenLibrary}
            title="我的文库"
          >
            <Library size={14} strokeWidth={1.8} />
            <span>文库</span>
            {papers.length > 0 && <em>{papers.length}</em>}
          </button>
          <button type="button" className="new-paper-button" onClick={goHome}>
            <Plus size={15} strokeWidth={2} />
            <span>新建</span>
          </button>
          <button
            type="button"
            className={`header-model ${modelReady ? 'is-ready' : ''}`}
            onClick={() => setSettingsOpen(true)}
            title="模型设置"
          >
            <Sparkles size={14} strokeWidth={1.8} />
            <span>{modelReady ? modelStatusLabel : '连接模型'}</span>
            <Settings2 size={13} className="header-model-gear" />
          </button>
        </div>
      </header>

      <div className="mobile-switcher" role="tablist" aria-label="切换论文与对话">
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === 'paper'}
          className={mobileTab === 'paper' ? 'is-active' : ''}
          onClick={() => setMobileTab('paper')}
        >
          <FileText size={15} />
          论文原文
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === 'chat'}
          className={mobileTab === 'chat' ? 'is-active' : ''}
          onClick={() => setMobileTab('chat')}
        >
          <Sparkles size={15} />
          AI 伴读
          {streaming && <i className="tab-live-dot" />}
        </button>
      </div>

      <main
        className={`workspace ${mobileTab === 'paper' ? 'show-paper' : 'show-chat'}`}
        style={{ '--split': split } as CSSProperties}
      >
        <section className="pdf-pane">
          <PdfViewer
            doc={paper.doc}
            pdfHref={paper.pdfHref}
            jumpRequest={jumpRequest}
            onPageChange={setCurrentPage}
            modelReady={modelReady}
            config={config}
            paperTitle={paper.meta.title}
            onOpenSettings={() => setSettingsOpen(true)}
            getPageContext={(page) =>
              paper.pages.find((item) => item.page === page)?.text ?? ''
            }
          />
        </section>
        <div
          className="splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整原文与对话区域宽度"
          onPointerDown={beginSplit}
          onPointerMove={moveSplit}
          onPointerUp={endSplit}
          onPointerCancel={endSplit}
        >
          <span />
        </div>
        <section className="chat-pane">
          <ChatPanel
            key={`${paper.key}:${activeThreadId ?? 'new'}`}
            paper={paper}
            messages={messages}
            streaming={streaming}
            modelReady={modelReady}
            modelLabel={modelStatusLabel}
            currentPage={currentPage}
            threads={threads}
            activeThreadId={activeThreadId}
            historyOpen={historyOpen}
            onSend={sendMessage}
            onStop={stopStreaming}
            onRetry={retry}
            onNewThread={() => void handleNewThread()}
            onOpenSettings={() => setSettingsOpen(true)}
            onJumpToPage={jumpToPage}
            onToggleHistory={() => setHistoryOpen((open) => !open)}
            onCloseHistory={() => setHistoryOpen(false)}
            onSelectThread={(thread) => void handleSelectThread(thread)}
            onDeleteThread={(thread) => void handleDeleteThread(thread)}
            onRenameThread={(thread, title) => void handleRenameThread(thread, title)}
          />
        </section>
      </main>

      {loading && (
        <div className="workspace-loading" role="status" aria-live="polite">
          <div className="workspace-loading-card">
            <div className="workspace-loading-mark">
              <LogoMark size={38} />
            </div>
            <span className="card-kicker">OPENING PAPER</span>
            <h2>{loading.stage}</h2>
            <p>{loading.detail}</p>
            <div className="progress-track wide">
              <span
                style={{ width: `${Math.max(5, Math.min(100, loading.percent ?? 28))}%` }}
              />
            </div>
            <span className="loading-note">
              <Loader2 size={13} className="spin" />
              当前论文会在新论文准备好后替换
            </span>
          </div>
        </div>
      )}

      {settingsModal}
      {libraryModal}

      {dragging && (
        <div className="drag-overlay" aria-hidden="true">
          <div className="drag-overlay-inner">
            <div className="drag-file-icon">
              <FileText size={30} />
            </div>
            <strong>松开以打开新的 PDF</strong>
            <span>当前论文会被替换，对话会保留在文库中</span>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <AlertCircle size={16} />
          <span>{toast}</span>
          <button type="button" onClick={() => setToast('')} aria-label="关闭提示">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
