import type {
  ChatMessage,
  ConversationThread,
  Folder,
  ImportHistoryRun,
  PageText,
  PaperContent,
  PaperMeta,
  PaperNote,
  PaperStatus,
  StoredPaper,
} from '../types';

const DB_NAME = 'pagemargin.library.v1';
const DB_VERSION = 5;
const PAPERS = 'papers';
const CONTENTS = 'contents';
const CONVERSATIONS = 'conversations';
const FOLDERS = 'folders';
const IMPORT_RUNS = 'importRuns';
const TRANSLATIONS = 'translations';
const NOTES = 'notes';
const MAX_IMPORT_RUNS = 200;

export const LIBRARY_DB_NAME = DB_NAME;
export const LIBRARY_STORE_NAMES = [
  PAPERS,
  CONTENTS,
  CONVERSATIONS,
  FOLDERS,
  IMPORT_RUNS,
  TRANSLATIONS,
  NOTES,
] as const;

const FOLDER_COLORS = [
  '#c65b3f',
  '#58755f',
  '#a0783f',
  '#566d88',
  '#8a5f78',
  '#736a58',
  '#407b7d',
  '#8b6444',
];

let databasePromise: Promise<IDBDatabase> | null = null;

export function openLibraryDatabase(): Promise<IDBDatabase> {
  return openDatabase();
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持 IndexedDB'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PAPERS)) {
        db.createObjectStore(PAPERS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(CONTENTS)) {
        db.createObjectStore(CONTENTS, { keyPath: 'paperId' });
      }
      if (!db.objectStoreNames.contains(CONVERSATIONS)) {
        const store = db.createObjectStore(CONVERSATIONS, { keyPath: 'id' });
        store.createIndex('paperId', 'paperId', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(FOLDERS)) {
        db.createObjectStore(FOLDERS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(IMPORT_RUNS)) {
        const store = db.createObjectStore(IMPORT_RUNS, { keyPath: 'id' });
        store.createIndex('startedAt', 'startedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(TRANSLATIONS)) {
        db.createObjectStore(TRANSLATIONS, { keyPath: 'paperId' });
      }
      if (!db.objectStoreNames.contains(NOTES)) {
        db.createObjectStore(NOTES, { keyPath: 'paperId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开本地文库'));
    request.onblocked = () => reject(new Error('本地文库被另一个页面占用'));
  });

  databasePromise = promise;
  promise.catch(() => {
    databasePromise = null;
  });
  return promise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('本地存储操作失败'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('本地存储事务失败'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('本地存储事务已取消'));
  });
}

function isQuotaError(error: unknown): boolean {
  return (
    (error instanceof DOMException &&
      (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')) ||
    (error instanceof Error && /quota/i.test(error.message))
  );
}

export function isLibrarySupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

function isPaperStatus(value: unknown): value is PaperStatus {
  return (
    value === 'unread' ||
    value === 'reading' ||
    value === 'read' ||
    value === 'archived'
  );
}

function normalizePaper(row: StoredPaper): StoredPaper {
  return {
    ...row,
    folderId: row.folderId ?? null,
    status: isPaperStatus(row.status) ? row.status : 'unread',
    archivedAt: row.archivedAt ?? null,
    archivedFrom: isPaperStatus(row.archivedFrom) ? row.archivedFrom : null,
  };
}

export async function listPapers(): Promise<StoredPaper[]> {
  const db = await openDatabase();
  const transaction = db.transaction(PAPERS, 'readonly');
  const rows = await requestResult(transaction.objectStore(PAPERS).getAll());
  await transactionDone(transaction);
  return (rows as StoredPaper[])
    .map(normalizePaper)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export async function getPaperRecord(id: string): Promise<StoredPaper | null> {
  const db = await openDatabase();
  const transaction = db.transaction(PAPERS, 'readonly');
  const result = await requestResult(transaction.objectStore(PAPERS).get(id));
  await transactionDone(transaction);
  return result ? normalizePaper(result as StoredPaper) : null;
}

export async function listFolders(): Promise<Folder[]> {
  const db = await openDatabase();
  const transaction = db.transaction(FOLDERS, 'readonly');
  const rows = await requestResult(transaction.objectStore(FOLDERS).getAll());
  await transactionDone(transaction);
  return (rows as Folder[])
    .map((folder) => ({
      ...folder,
      parentId: folder.parentId ?? null,
    }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function folderPathLabel(
  folders: Folder[],
  folderId: string | null | undefined,
): string {
  if (!folderId) return '';
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.join(' / ');
}

export function folderScopeIds(folders: Folder[]): Map<string, Set<string>> {
  const children = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const parentId = folder.parentId ?? null;
    const siblings = children.get(parentId) ?? [];
    siblings.push(folder);
    children.set(parentId, siblings);
  }
  const scopes = new Map<string, Set<string>>();
  const collect = (id: string, visiting = new Set<string>()): Set<string> => {
    const existing = scopes.get(id);
    if (existing) return existing;
    const scope = new Set<string>([id]);
    scopes.set(id, scope);
    if (visiting.has(id)) return scope;
    visiting.add(id);
    for (const child of children.get(id) ?? []) {
      for (const childId of collect(child.id, visiting)) scope.add(childId);
    }
    visiting.delete(id);
    return scope;
  };
  for (const folder of folders) collect(folder.id);
  return scopes;
}

function folderName(value: string): string {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('文件夹名称不能为空');
  if (name.length > 30) throw new Error('文件夹名称不能超过 30 个字符');
  if (name === '全部' || name === '未分类') {
    throw new Error('这个名称是系统保留名称，请换一个');
  }
  return name;
}

async function assertFolderNameAvailable(
  name: string,
  parentId: string | null,
  exceptId?: string,
): Promise<void> {
  const folders = await listFolders();
  if (
    folders.some(
      (folder) =>
        folder.id !== exceptId &&
        (folder.parentId ?? null) === parentId &&
        folder.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    throw new Error('同级目录下已经有同名文件夹了');
  }
}

function makeFolderId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `folder-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function createFolder(
  name: string,
  parentId: string | null = null,
): Promise<Folder> {
  const cleanName = folderName(name);
  const folders = await listFolders();
  const parent = parentId
    ? folders.find((folder) => folder.id === parentId)
    : null;
  if (parentId && !parent) throw new Error('父文件夹不存在');
  await assertFolderNameAvailable(cleanName, parentId);
  const folder: Folder = {
    id: makeFolderId(),
    name: cleanName,
    color: parent?.color ?? FOLDER_COLORS[folders.length % FOLDER_COLORS.length],
    parentId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const db = await openDatabase();
  const transaction = db.transaction(FOLDERS, 'readwrite');
  transaction.objectStore(FOLDERS).put(folder);
  await transactionDone(transaction);
  return folder;
}

export async function renameFolder(id: string, name: string): Promise<Folder> {
  const cleanName = folderName(name);
  const db = await openDatabase();
  const readTransaction = db.transaction(FOLDERS, 'readonly');
  const folder = await requestResult(
    readTransaction.objectStore(FOLDERS).get(id),
  ) as Folder | undefined;
  await transactionDone(readTransaction);
  if (!folder) throw new Error('文件夹不存在');
  await assertFolderNameAvailable(cleanName, folder.parentId ?? null, id);
  const updated: Folder = {
    ...folder,
    parentId: folder.parentId ?? null,
    name: cleanName,
    updatedAt: Date.now(),
  };
  const transaction = db.transaction(FOLDERS, 'readwrite');
  transaction.objectStore(FOLDERS).put(updated);
  await transactionDone(transaction);
  return updated;
}

export async function moveFolder(
  id: string,
  parentId: string | null,
): Promise<Folder> {
  const folders = await listFolders();
  const folder = folders.find((item) => item.id === id);
  if (!folder) throw new Error('文件夹不存在');
  const nextParentId = parentId ?? null;
  if (nextParentId === id) throw new Error('不能把文件夹移动到自身');
  const parent = nextParentId
    ? folders.find((item) => item.id === nextParentId)
    : null;
  if (nextParentId && !parent) throw new Error('目标文件夹不存在');

  let cursor = parent;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor.id === id) {
      throw new Error('不能把文件夹移动到它自己的子文件夹里');
    }
    if (seen.has(cursor.id)) break;
    seen.add(cursor.id);
    const parentOfCursor = cursor.parentId;
    cursor = parentOfCursor
      ? folders.find((item) => item.id === parentOfCursor)
      : undefined;
  }

  if ((folder.parentId ?? null) === nextParentId) return folder;
  if (
    folders.some(
      (item) =>
        item.id !== id &&
        (item.parentId ?? null) === nextParentId &&
        item.name.toLowerCase() === folder.name.toLowerCase(),
    )
  ) {
    throw new Error('目标文件夹下已经有同名文件夹');
  }

  const updated: Folder = {
    ...folder,
    parentId: nextParentId,
    updatedAt: Date.now(),
  };
  const db = await openDatabase();
  const transaction = db.transaction(FOLDERS, 'readwrite');
  transaction.objectStore(FOLDERS).put(updated);
  await transactionDone(transaction);
  return updated;
}

export async function moveFolders(
  ids: string[],
  parentId: string | null,
): Promise<Folder[]> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) return [];
  const folders = await listFolders();
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const selected = uniqueIds
    .map((id) => byId.get(id))
    .filter((folder): folder is Folder => Boolean(folder));
  if (selected.length !== uniqueIds.length) {
    throw new Error('有文件夹不存在，请刷新后重试');
  }

  const nextParentId = parentId ?? null;
  if (nextParentId && !byId.has(nextParentId)) {
    throw new Error('目标文件夹不存在');
  }

  const isUnder = (candidateId: string, ancestorId: string): boolean => {
    const seen = new Set<string>();
    let current = byId.get(candidateId)?.parentId ?? null;
    while (current && !seen.has(current)) {
      if (current === ancestorId) return true;
      seen.add(current);
      current = byId.get(current)?.parentId ?? null;
    }
    return false;
  };

  if (nextParentId) {
    for (const folder of selected) {
      if (nextParentId === folder.id || isUnder(nextParentId, folder.id)) {
        throw new Error('不能把文件夹移动到它自己的子文件夹里');
      }
    }
  }

  const selectedSet = new Set(uniqueIds);
  const roots = selected.filter((folder) => {
    const seen = new Set<string>();
    let current = folder.parentId ?? null;
    while (current && !seen.has(current)) {
      if (selectedSet.has(current)) return false;
      seen.add(current);
      current = byId.get(current)?.parentId ?? null;
    }
    return true;
  });
  const rootIds = new Set(roots.map((folder) => folder.id));
  const seenNames = new Set<string>();
  for (const folder of roots) {
    const key = folder.name.toLowerCase();
    if (seenNames.has(key)) {
      throw new Error('选中的文件夹里有同名的，不能移动到同一级');
    }
    seenNames.add(key);
    const conflict = folders.some(
      (item) =>
        !rootIds.has(item.id) &&
        (item.parentId ?? null) === nextParentId &&
        item.name.toLowerCase() === key,
    );
    if (conflict) throw new Error('目标文件夹下已经有同名文件夹');
  }

  const now = Date.now();
  const updated = roots.map((folder) => ({
    ...folder,
    parentId: nextParentId,
    updatedAt: now,
  }));
  const db = await openDatabase();
  const transaction = db.transaction(FOLDERS, 'readwrite');
  for (const folder of updated) transaction.objectStore(FOLDERS).put(folder);
  await transactionDone(transaction);
  return updated;
}

export async function deleteFolder(id: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([FOLDERS, PAPERS], 'readwrite');
  const folderStore = transaction.objectStore(FOLDERS);
  const folder = await requestResult(folderStore.get(id)) as Folder | undefined;
  if (!folder) {
    transaction.abort();
    throw new Error('文件夹不存在');
  }
  const parentId = folder.parentId ?? null;
  folderStore.delete(id);
  const folderCursor = folderStore.openCursor();
  folderCursor.onsuccess = () => {
    const cursor = folderCursor.result;
    if (!cursor) return;
    const child = cursor.value as Folder;
    if ((child.parentId ?? null) === id) {
      cursor.update({ ...child, parentId, updatedAt: Date.now() });
    }
    cursor.continue();
  };
  const papers = transaction.objectStore(PAPERS);
  const paperCursor = papers.openCursor();
  paperCursor.onsuccess = () => {
    const cursor = paperCursor.result;
    if (!cursor) return;
    const paper = cursor.value as StoredPaper;
    if (paper.folderId === id) {
      cursor.update({ ...paper, folderId: parentId, updatedAt: Date.now() });
    }
    cursor.continue();
  };
  await transactionDone(transaction);
}

export async function getPaperContent(id: string): Promise<PaperContent | null> {
  const db = await openDatabase();
  const transaction = db.transaction(CONTENTS, 'readonly');
  const result = await requestResult(transaction.objectStore(CONTENTS).get(id));
  await transactionDone(transaction);
  return (result as PaperContent | undefined) ?? null;
}

export async function getPaperBundle(
  id: string,
): Promise<{ paper: StoredPaper; content: PaperContent | null } | null> {
  const [paper, content] = await Promise.all([getPaperRecord(id), getPaperContent(id)]);
  if (!paper) return null;
  return { paper, content };
}

async function writePaperBundle(
  paper: StoredPaper,
  pages: PageText[],
  pdfBlob: Blob | null | undefined,
): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([PAPERS, CONTENTS], 'readwrite');
  transaction.objectStore(PAPERS).put(paper);
  transaction.objectStore(CONTENTS).put({
    paperId: paper.id,
    pages,
    ...(pdfBlob ? { pdfBlob } : {}),
  });
  await transactionDone(transaction);
}

export interface SavePaperInput {
  id: string;
  meta: PaperMeta;
  pages: PageText[];
  pdfBlob?: Blob | null;
  thumbnail?: string;
  folderId?: string | null;
}

export async function savePaper(
  input: SavePaperInput,
): Promise<{ paper: StoredPaper; blobSaved: boolean }> {
  const existing = await getPaperRecord(input.id).catch(() => null);
  const existingContent = input.pdfBlob === undefined
    ? await getPaperContent(input.id).catch(() => null)
    : null;
  const conversationCount = await countThreads(input.id).catch(
    () => existing?.conversationCount ?? 0,
  );
  const now = Date.now();
  const pdfBlob =
    input.pdfBlob === undefined ? existingContent?.pdfBlob ?? null : input.pdfBlob;

  const record: StoredPaper = {
    id: input.id,
    source: input.meta.source,
    arxivId: input.meta.arxivId,
    sourceUrl: input.meta.sourceUrl,
    title: input.meta.title,
    authors: input.meta.authors,
    abstract: input.meta.abstract,
    published: input.meta.published,
    year: input.meta.year,
    category: input.meta.category,
    fileName: input.meta.fileName,
    pageCount: input.meta.pages || input.pages.length,
    chars: input.meta.chars || input.pages.reduce((sum, page) => sum + page.text.length, 0),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastOpenedAt: now,
    lastPage: existing?.lastPage ?? 1,
    favorite: existing?.favorite ?? false,
    conversationCount,
    folderId:
      input.folderId !== undefined
        ? input.folderId
        : existing?.folderId ?? null,
    thumbnail: input.thumbnail ?? existing?.thumbnail,
    pdfBytes: pdfBlob?.size ?? 0,
    status:
      existing?.status === 'archived' && input.pdfBlob !== undefined
        ? 'unread'
        : existing?.status ?? 'unread',
    archivedAt:
      existing?.status === 'archived' && input.pdfBlob !== undefined
        ? null
        : existing?.archivedAt ?? null,
    archivedFrom:
      existing?.status === 'archived' && input.pdfBlob !== undefined
        ? null
        : existing?.archivedFrom ?? null,
  };

  try {
    await writePaperBundle(record, input.pages, pdfBlob);
    return { paper: record, blobSaved: Boolean(pdfBlob) };
  } catch (error) {
    if (pdfBlob && isQuotaError(error)) {
      const fallback: StoredPaper = { ...record, pdfBytes: 0 };
      await writePaperBundle(fallback, input.pages, null);
      return { paper: fallback, blobSaved: false };
    }
    throw error;
  }
}

export async function updatePaper(
  id: string,
  patch: Partial<
    Pick<
      StoredPaper,
      | 'favorite'
      | 'lastPage'
      | 'lastOpenedAt'
      | 'conversationCount'
      | 'thumbnail'
      | 'title'
      | 'folderId'
      | 'updatedAt'
      | 'status'
      | 'archivedAt'
      | 'archivedFrom'
    >
  >,
): Promise<StoredPaper | null> {
  const existing = await getPaperRecord(id);
  if (!existing) return null;
  const next: StoredPaper = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };
  const db = await openDatabase();
  const transaction = db.transaction(PAPERS, 'readwrite');
  transaction.objectStore(PAPERS).put(next);
  await transactionDone(transaction);
  return next;
}

export async function setPaperStatus(
  id: string,
  status: PaperStatus,
): Promise<StoredPaper | null> {
  if (status === 'archived') return archivePaper(id);
  return updatePaper(id, {
    status,
    archivedAt: null,
    archivedFrom: null,
  });
}

export async function archivePaper(id: string): Promise<StoredPaper | null> {
  const db = await openDatabase();
  const transaction = db.transaction(
    [PAPERS, CONTENTS, TRANSLATIONS],
    'readwrite',
  );
  const papers = transaction.objectStore(PAPERS);
  const existing = (await requestResult(papers.get(id))) as
    | StoredPaper
    | undefined;
  if (!existing) {
    await transactionDone(transaction);
    return null;
  }

  const now = Date.now();
  const archivedFrom =
    existing.status && existing.status !== 'archived'
      ? existing.status
      : existing.archivedFrom ?? 'unread';
  const next: StoredPaper = {
    ...existing,
    status: 'archived',
    archivedAt: existing.archivedAt ?? now,
    archivedFrom,
    pdfBytes: 0,
    lastPage: 0,
    updatedAt: now,
  };
  papers.put(next);
  transaction.objectStore(CONTENTS).delete(id);
  transaction.objectStore(TRANSLATIONS).delete(id);
  await transactionDone(transaction);
  return normalizePaper(next);
}

export async function movePapersToFolder(
  ids: string[],
  folderId: string | null,
): Promise<number> {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) return 0;
  const db = await openDatabase();
  const transaction = db.transaction(PAPERS, 'readwrite');
  const store = transaction.objectStore(PAPERS);
  const now = Date.now();
  let updated = 0;
  for (const id of uniqueIds) {
    const row = (await requestResult(store.get(id))) as StoredPaper | undefined;
    if (!row) continue;
    store.put({ ...row, folderId, updatedAt: now });
    updated += 1;
  }
  await transactionDone(transaction);
  return updated;
}

export interface StoredTranslation {
  paperId: string;
  blob: Blob;
  createdAt: number;
  sourceBytes: number;
}

export async function getTranslatedPdf(
  paperId: string,
): Promise<StoredTranslation | null> {
  const db = await openDatabase();
  const transaction = db.transaction(TRANSLATIONS, 'readonly');
  const row = (await requestResult(
    transaction.objectStore(TRANSLATIONS).get(paperId),
  )) as StoredTranslation | undefined;
  await transactionDone(transaction);
  return row ?? null;
}

export async function saveTranslatedPdf(
  paperId: string,
  blob: Blob,
  sourceBytes = 0,
): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(TRANSLATIONS, 'readwrite');
  transaction.objectStore(TRANSLATIONS).put({
    paperId,
    blob,
    createdAt: Date.now(),
    sourceBytes,
  } satisfies StoredTranslation);
  await transactionDone(transaction);
}

export async function deleteTranslatedPdf(paperId: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(TRANSLATIONS, 'readwrite');
  transaction.objectStore(TRANSLATIONS).delete(paperId);
  await transactionDone(transaction);
}

export async function getPaperNote(paperId: string): Promise<PaperNote | null> {
  const db = await openDatabase();
  const transaction = db.transaction(NOTES, 'readonly');
  const row = (await requestResult(
    transaction.objectStore(NOTES).get(paperId),
  )) as PaperNote | undefined;
  await transactionDone(transaction);
  return row ?? null;
}

export async function savePaperNote(
  paperId: string,
  markdown: string,
): Promise<PaperNote> {
  const db = await openDatabase();
  const transaction = db.transaction(NOTES, 'readwrite');
  const store = transaction.objectStore(NOTES);
  const existing = (await requestResult(store.get(paperId))) as
    | PaperNote
    | undefined;
  const now = Date.now();
  const next: PaperNote = {
    paperId,
    markdown,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  store.put(next);
  await transactionDone(transaction);
  return next;
}

export async function deletePaperNote(paperId: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(NOTES, 'readwrite');
  transaction.objectStore(NOTES).delete(paperId);
  await transactionDone(transaction);
}

export async function deletePaper(id: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(
    [PAPERS, CONTENTS, CONVERSATIONS, TRANSLATIONS, NOTES],
    'readwrite',
  );
  transaction.objectStore(PAPERS).delete(id);
  transaction.objectStore(CONTENTS).delete(id);
  transaction.objectStore(TRANSLATIONS).delete(id);
  transaction.objectStore(NOTES).delete(id);
  const index = transaction.objectStore(CONVERSATIONS).index('paperId');
  const cursorRequest = index.openCursor(IDBKeyRange.only(id));
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    cursor.delete();
    cursor.continue();
  };
  await transactionDone(transaction);
}

export async function listThreads(paperId: string): Promise<ConversationThread[]> {
  const db = await openDatabase();
  const transaction = db.transaction(CONVERSATIONS, 'readonly');
  const rows = await requestResult(
    transaction.objectStore(CONVERSATIONS).index('paperId').getAll(paperId),
  );
  await transactionDone(transaction);
  return (rows as ConversationThread[]).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveThread(thread: ConversationThread): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(CONVERSATIONS, 'readwrite');
  transaction.objectStore(CONVERSATIONS).put(thread);
  await transactionDone(transaction);
}

export async function countThreads(paperId: string): Promise<number> {
  const db = await openDatabase();
  const transaction = db.transaction(CONVERSATIONS, 'readonly');
  const countPromise = requestResult(
    transaction.objectStore(CONVERSATIONS).index('paperId').count(paperId),
  );
  await transactionDone(transaction);
  return await countPromise;
}

export async function deleteThread(id: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(CONVERSATIONS, 'readwrite');
  transaction.objectStore(CONVERSATIONS).delete(id);
  await transactionDone(transaction);
}

export function threadTitleFromQuestion(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '新的对话';
  return clean.length > 34 ? `${clean.slice(0, 34)}…` : clean;
}

export function messagesForStorage(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter(
      (message) =>
        message.content.trim().length > 0 ||
        (message.images?.length ?? 0) > 0 ||
        message.status === 'error',
    )
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      ...(message.images && message.images.length > 0
        ? { images: message.images }
        : {}),
      status: message.status,
      error: message.error,
      errorCode: message.errorCode,
      meta: message.meta,
      createdAt: message.createdAt,
    }));
}

export async function saveImportRun(run: ImportHistoryRun): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(IMPORT_RUNS, 'readwrite');
  const store = transaction.objectStore(IMPORT_RUNS);
  store.put(run);
  const rows = (await requestResult(store.getAll())) as ImportHistoryRun[];
  if (rows.length > MAX_IMPORT_RUNS) {
    const extra = rows
      .sort((a, b) => a.startedAt - b.startedAt)
      .slice(0, rows.length - MAX_IMPORT_RUNS);
    for (const item of extra) store.delete(item.id);
  }
  await transactionDone(transaction);
}

export async function listImportRuns(): Promise<ImportHistoryRun[]> {
  const db = await openDatabase();
  const transaction = db.transaction(IMPORT_RUNS, 'readonly');
  const rows = await requestResult(transaction.objectStore(IMPORT_RUNS).getAll());
  await transactionDone(transaction);
  return (rows as ImportHistoryRun[]).sort((a, b) => b.startedAt - a.startedAt);
}

export async function clearImportRuns(): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(IMPORT_RUNS, 'readwrite');
  transaction.objectStore(IMPORT_RUNS).clear();
  await transactionDone(transaction);
}

export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export async function storageUsage(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
    };
  } catch {
    return null;
  }
}
