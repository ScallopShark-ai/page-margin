import type { PDFDocumentProxy } from 'pdfjs-dist';

export type ProviderId = 'deepseek' | 'openai' | 'anthropic' | 'custom';

export interface ModelConfig {
  provider: ProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  remember: boolean;
}

export interface ServerConfig {
  serverConfigured: boolean;
  provider: ProviderId;
  model: string;
  baseUrl: string;
}

export interface ModelListItem {
  id: string;
  name?: string;
  ownedBy?: string;
}

export interface PaperMeta {
  source: 'arxiv' | 'local' | 'web';
  title: string;
  authors: string[];
  abstract: string;
  published: string;
  year: string;
  category: string;
  arxivId?: string;
  absUrl?: string;
  pdfUrl?: string;
  sourceUrl?: string;
  fileName?: string;
  pages: number;
  chars: number;
}

export interface PageText {
  page: number;
  text: string;
}

export interface PaperSession {
  key: string;
  meta: PaperMeta;
  pages: PageText[];
  doc: PDFDocumentProxy;
  localFile?: File;
  pdfHref: string;
  extractedChars: number;
}

export interface ArcherResult {
  source: 'arxiv';
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  published: string;
  year: string;
  category: string;
  absUrl: string;
  pdfUrl: string;
  metadataUnavailable?: boolean;
  warning?: string;
}

export interface StreamMeta {
  provider: string;
  model: string;
  contextChars: number;
  selectedChunks: number;
  totalChunks: number;
  paperPages: number;
  paperCharacters: number;
  note?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: 'streaming' | 'done' | 'error' | 'stopped';
  error?: string;
  errorCode?: string;
  meta?: StreamMeta;
  createdAt: number;
}

export interface LoadProgress {
  stage: string;
  detail: string;
  percent: number | null;
}

export interface StoredPaper {
  id: string;
  source: 'arxiv' | 'local' | 'web';
  arxivId?: string;
  sourceUrl?: string;
  title: string;
  authors: string[];
  abstract: string;
  published: string;
  year: string;
  category: string;
  fileName?: string;
  pageCount: number;
  chars: number;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  lastPage: number;
  favorite: boolean;
  conversationCount: number;
  folderId: string | null;
  thumbnail?: string;
  pdfBytes: number;
}

export interface Folder {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface PaperContent {
  paperId: string;
  pages: PageText[];
  pdfBlob?: Blob;
}

export interface ConversationThread {
  id: string;
  paperId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface JumpRequest {
  page: number;
  nonce: number;
}
