import {
  strFromU8,
  strToU8,
  unzip,
  zip,
  type AsyncZippable,
  type AsyncZipOptions,
} from 'fflate';
import {
  LIBRARY_STORE_NAMES,
  openLibraryDatabase,
} from './library';

const BACKUP_FORMAT = 'haila-backup';
const BACKUP_VERSION = 1;
const PAPERS = 'papers';
const CONTENTS = 'contents';
const TRANSLATIONS = 'translations';
const STORE_NAMES = [...LIBRARY_STORE_NAMES];

export interface BackupSession {
  paperId: string | null;
  page: number;
  notesOpen: boolean;
}

interface BackupManifest {
  format: string;
  formatVersion: number;
  exportedAt: string;
  lastSession: BackupSession;
  localStorage: Record<string, string>;
  sessionStorage?: Record<string, string>;
  counts: Record<string, number>;
}

export interface RestoreResult {
  lastSession: BackupSession;
  counts: Record<string, number>;
}

function requestResult<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function readStore<T>(db: IDBDatabase, name: string): Promise<T[]> {
  const transaction = db.transaction(name, 'readonly');
  const rows = await requestResult<T[]>(
    transaction.objectStore(name).getAll(),
  );
  await transactionDone(transaction);
  return rows;
}

function zipAsync(files: AsyncZippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}

function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (error, files) => {
      if (error) reject(error);
      else resolve(files);
    });
  });
}

function collectStorage(storage: Storage): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !key.startsWith('pagemargin.')) continue;
    const value = storage.getItem(key);
    if (value !== null) values[key] = value;
  }
  return values;
}

function restoreStorage(storage: Storage, values: Record<string, string>) {
  const existing: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith('pagemargin.')) existing.push(key);
  }
  for (const key of existing) storage.removeItem(key);
  for (const [key, value] of Object.entries(values)) {
    storage.setItem(key, value);
  }
}

function backupFilename(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `haila-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate(),
  )}-${pad(now.getHours())}${pad(now.getMinutes())}.zip`;
}

export async function createBackup(
  lastSession: BackupSession,
): Promise<{ blob: Blob; filename: string; counts: Record<string, number> }> {
  const db = await openLibraryDatabase();
  const [papers, contents, conversations, folders, importRuns, translations, notes] =
    await Promise.all([
      readStore<Record<string, unknown>>(db, PAPERS),
      readStore<Record<string, unknown>>(db, CONTENTS),
      readStore<Record<string, unknown>>(db, 'conversations'),
      readStore<Record<string, unknown>>(db, 'folders'),
      readStore<Record<string, unknown>>(db, 'importRuns'),
      readStore<Record<string, unknown>>(db, TRANSLATIONS),
      readStore<Record<string, unknown>>(db, 'notes'),
    ]);

  const files: AsyncZippable = {};
  const counts: Record<string, number> = {
    papers: papers.length,
    contents: contents.length,
    conversations: conversations.length,
    folders: folders.length,
    importRuns: importRuns.length,
    translations: translations.length,
    notes: notes.length,
  };

  let contentBlobIndex = 0;
  const safeContents = [];
  for (const row of contents) {
    const { pdfBlob, ...rest } = row as Record<string, unknown> & {
      pdfBlob?: Blob;
    };
    if (pdfBlob instanceof Blob) {
      const path = `blobs/contents/${contentBlobIndex++}.pdf`;
      const options: AsyncZipOptions = { level: 0 };
      files[path] = [new Uint8Array(await pdfBlob.arrayBuffer()), options];
      safeContents.push({ ...rest, pdfFile: path });
    } else {
      safeContents.push(rest);
    }
  }

  let translationBlobIndex = 0;
  const safeTranslations = [];
  for (const row of translations) {
    const { blob, ...rest } = row as Record<string, unknown> & {
      blob?: Blob;
    };
    if (blob instanceof Blob) {
      const path = `blobs/translations/${translationBlobIndex++}.pdf`;
      const options: AsyncZipOptions = { level: 0 };
      files[path] = [new Uint8Array(await blob.arrayBuffer()), options];
      safeTranslations.push({ ...rest, blobFile: path });
    } else {
      safeTranslations.push(rest);
    }
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    lastSession,
    localStorage: collectStorage(localStorage),
    sessionStorage: collectStorage(sessionStorage),
    counts,
  };

  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  files[`data/${PAPERS}.json`] = strToU8(JSON.stringify(papers));
  files[`data/${CONTENTS}.json`] = strToU8(JSON.stringify(safeContents));
  files[`data/${TRANSLATIONS}.json`] = strToU8(
    JSON.stringify(safeTranslations),
  );
  files['data/conversations.json'] = strToU8(JSON.stringify(conversations));
  files['data/folders.json'] = strToU8(JSON.stringify(folders));
  files['data/importRuns.json'] = strToU8(JSON.stringify(importRuns));
  files['data/notes.json'] = strToU8(JSON.stringify(notes));

  const archive = await zipAsync(files);
  return {
    blob: new Blob([archive.buffer as ArrayBuffer], {
      type: 'application/zip',
    }),
    filename: backupFilename(),
    counts,
  };
}

function readJson<T>(
  files: Record<string, Uint8Array>,
  path: string,
): T {
  const data = files[path];
  if (!data) throw new Error(`备份缺少 ${path}`);
  try {
    return JSON.parse(strFromU8(data)) as T;
  } catch {
    throw new Error(`备份中的 ${path} 已损坏`);
  }
}

export async function restoreBackup(file: File): Promise<RestoreResult> {
  const archive = await unzipAsync(new Uint8Array(await file.arrayBuffer()));
  const manifest = readJson<BackupManifest>(archive, 'manifest.json');
  if (
    manifest.format !== BACKUP_FORMAT ||
    manifest.formatVersion > BACKUP_VERSION
  ) {
    throw new Error('这不是受支持的海拉备份文件');
  }

  const counts = manifest.counts || {};
  const rows: Record<string, Record<string, unknown>[]> = {
    papers: readJson(archive, 'data/papers.json'),
    contents: readJson(archive, 'data/contents.json'),
    conversations: readJson(archive, 'data/conversations.json'),
    folders: readJson(archive, 'data/folders.json'),
    importRuns: readJson(archive, 'data/importRuns.json'),
    translations: readJson(archive, 'data/translations.json'),
    notes: readJson(archive, 'data/notes.json'),
  };

  for (const row of rows.contents) {
    const path = row.pdfFile;
    if (typeof path === 'string') {
      const data = archive[path];
      if (!data) throw new Error('备份中的 PDF 文件缺失');
      row.pdfBlob = new Blob([data.buffer as ArrayBuffer], {
        type: 'application/pdf',
      });
      delete row.pdfFile;
    }
  }
  for (const row of rows.translations) {
    const path = row.blobFile;
    if (typeof path === 'string') {
      const data = archive[path];
      if (!data) throw new Error('备份中的翻译 PDF 缺失');
      row.blob = new Blob([data.buffer as ArrayBuffer], {
        type: 'application/pdf',
      });
      delete row.blobFile;
    }
  }

  const db = await openLibraryDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAMES, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    try {
      for (const name of STORE_NAMES) {
        transaction.objectStore(name).clear();
      }
      for (const name of STORE_NAMES) {
        const store = transaction.objectStore(name);
        for (const row of rows[name] ?? []) store.put(row);
      }
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });

  restoreStorage(localStorage, manifest.localStorage || {});
  restoreStorage(sessionStorage, manifest.sessionStorage || {});
  return {
    lastSession: manifest.lastSession || {
      paperId: null,
      page: 1,
      notesOpen: false,
    },
    counts,
  };
}
