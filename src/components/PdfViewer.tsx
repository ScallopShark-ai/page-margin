import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { TextLayer } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Languages,
  Maximize2,
  Minus,
  Plus,
} from 'lucide-react';
import type { JumpRequest, ModelConfig } from '../types';
import { TranslationPopover } from './TranslationPopover';

interface PdfViewerProps {
  doc: PDFDocumentProxy;
  pdfHref: string;
  jumpRequest: JumpRequest | null;
  onPageChange: (page: number) => void;
  modelReady: boolean;
  config: ModelConfig;
  paperTitle: string;
  onOpenSettings: () => void;
  getPageContext: (page: number) => string;
}

interface SelectionPopup {
  id: number;
  text: string;
  page: number;
  anchor: { top: number; bottom: number; left: number; width: number };
}

interface PageSize {
  width: number;
  height: number;
}

const PAGE_GAP = 22;

function PageCanvas({
  doc,
  pageNumber,
  scale,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let task: RenderTask | null = null;
    let textLayer: TextLayer | null = null;
    let pageProxy: PDFPageProxy | null = null;
    setRendered(false);

    const render = async () => {
      try {
        const page = await doc.getPage(pageNumber);
        pageProxy = page;
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;

        const deviceDpr = Math.min(window.devicePixelRatio || 1, 2);
        const budgetDpr = Math.min(
          2,
          Math.max(0.75, 2800 / Math.max(1, viewport.width)),
        );
        const dpr = Math.min(deviceDpr, budgetDpr);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        task = page.render({
          canvas,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        const textContentPromise = page.getTextContent().catch(() => null);
        await task.promise;
        if (!cancelled) setRendered(true);

        const textContent = await textContentPromise;
        const container = textLayerRef.current;
        if (!cancelled && textContent && container && textContent.items.length > 0) {
          container.replaceChildren();
          textLayer = new TextLayer({
            textContentSource: textContent,
            container,
            viewport,
          });
          await textLayer.render();
        }
      } catch (error) {
        if (
          !cancelled &&
          !(error instanceof Error && error.name === 'RenderingCancelledException')
        ) {
          console.warn('PDF page render failed', pageNumber, error);
        }
      } finally {
        pageProxy?.cleanup();
      }
    };

    void render();
    return () => {
      cancelled = true;
      textLayer?.cancel();
      task?.cancel();
    };
  }, [doc, pageNumber, scale]);

  return (
    <>
      <canvas ref={canvasRef} className={`pdf-canvas ${rendered ? 'is-ready' : ''}`} />
      <div ref={textLayerRef} className="textLayer" />
      {!rendered && (
        <div className="page-loading" aria-hidden="true">
          <span />
        </div>
      )}
    </>
  );
}

function PageSlot({
  doc,
  pageNumber,
  size,
  scale,
  rootRef,
  highlighted,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  size: PageSize;
  scale: number;
  rootRef: RefObject<HTMLDivElement | null>;
  highlighted: boolean;
}) {
  const slotRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const width = Math.max(120, size.width * scale);
  const height = Math.max(160, size.height * scale);

  useEffect(() => {
    const element = slotRef.current;
    const root = rootRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setNearViewport(entries.some((entry) => entry.isIntersecting));
      },
      { root, rootMargin: '1200px 0px 1200px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootRef]);

  return (
    <div
      ref={slotRef}
      className={`page-slot ${highlighted ? 'is-highlighted' : ''}`}
      data-page={pageNumber}
      style={
        {
          width,
          height,
          '--scale-factor': scale,
          '--total-scale-factor': scale,
          '--scale-round-x': '1px',
          '--scale-round-y': '1px',
        } as CSSProperties
      }
    >
      {nearViewport ? (
        <PageCanvas doc={doc} pageNumber={pageNumber} scale={scale} />
      ) : (
        <div className="page-placeholder" />
      )}
      <span className="page-index" aria-hidden="true">
        {pageNumber}
      </span>
    </div>
  );
}

export function PdfViewer({
  doc,
  pdfHref,
  jumpRequest,
  onPageChange,
  modelReady,
  config,
  paperTitle,
  onOpenSettings,
  getPageContext,
}: PdfViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [highlightPage, setHighlightPage] = useState<number | null>(null);
  const [selectionPopup, setSelectionPopup] = useState<SelectionPopup | null>(null);
  const [translateSelection, setTranslateSelection] = useState(true);
  const translateSelectionRef = useRef(true);
  const currentPageRef = useRef(1);
  const scrollRaf = useRef(0);
  const highlightTimer = useRef<number | null>(null);
  const appliedJumpRef = useRef<number | null>(null);
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;
  translateSelectionRef.current = translateSelection;

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    let timer = 0;

    const inspectSelection = () => {
      if (!translateSelectionRef.current) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return;

      const text = selection
        .toString()
        .replace(/[\s\u00a0]+/g, ' ')
        .trim();
      if (text.length < 2 || text.length > 2000) return;
      if (!/[A-Za-z\u3400-\u9fff]/.test(text)) return;

      const startNode = range.startContainer;
      const startElement =
        startNode.nodeType === Node.ELEMENT_NODE
          ? (startNode as Element)
          : startNode.parentElement;
      const pageElement = startElement?.closest<HTMLElement>('[data-page]');
      const page = Number(pageElement?.dataset.page ?? currentPageRef.current) || 1;
      const rect = range.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;

      setSelectionPopup((previous) => {
        if (previous?.text === text && previous.page === page) return previous;
        return {
          id: Date.now() + Math.random(),
          text,
          page,
          anchor: {
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            width: rect.width,
          },
        };
      });
    };

    const onSelectionChange = () => {
      if (!translateSelectionRef.current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(inspectSelection, 280);
    };
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('.translation-popover, .modal-backdrop')) return;
      setSelectionPopup(null);
    };
    const onScroll = () => setSelectionPopup(null);
    const onResize = () => setSelectionPopup(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectionPopup(null);
    };

    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      root.removeEventListener('scroll', onScroll);
    };
  }, []);

  useEffect(() => {
    if (!translateSelection) setSelectionPopup(null);
  }, [translateSelection]);

  useEffect(() => {
    setSelectionPopup(null);
  }, [doc]);

  const baseScale = useMemo(() => {
    if (!containerWidth || sizes.length === 0) return 1;
    const horizontalPadding = containerWidth < 640 ? 28 : 88;
    const fit = (containerWidth - horizontalPadding) / sizes[0].width;
    return Math.max(0.32, Math.min(2.4, fit));
  }, [containerWidth, sizes]);

  const totalPages = doc.numPages;
  const scale = baseScale * zoom;

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const update = () => setContainerWidth(root.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSizes([]);
    (async () => {
      const next: PageSize[] = [];
      for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
        try {
          const page = await doc.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1 });
          next.push({ width: viewport.width, height: viewport.height });
          page.cleanup();
        } catch {
          next.push({ width: 595, height: 842 });
        }
      }
      if (!cancelled) setSizes(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
    setPageInput('1');
    currentPageRef.current = 1;
    setZoom(1);
    setHighlightPage(null);
    appliedJumpRef.current = null;
    scrollRef.current?.scrollTo({ top: 0 });
  }, [doc]);

  const updateCurrentPage = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    const marker = root.scrollTop + Math.min(root.clientHeight * 0.3, 260);
    const slots = root.querySelectorAll<HTMLElement>('[data-page]');
    let next = 1;
    for (const slot of slots) {
      if (slot.offsetTop <= marker) next = Number(slot.dataset.page ?? 1);
      else break;
    }
    if (next !== currentPageRef.current) {
      currentPageRef.current = next;
      setCurrentPage(next);
      setPageInput(String(next));
      onPageChangeRef.current(next);
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (scrollRaf.current) return;
    scrollRaf.current = window.requestAnimationFrame(() => {
      scrollRaf.current = 0;
      updateCurrentPage();
    });
  }, [updateCurrentPage]);

  const goToPage = useCallback(
    (page: number, behavior: ScrollBehavior = 'auto') => {
      const root = scrollRef.current;
      const target = Math.max(1, Math.min(totalPages, Math.round(page)));
      if (!root) return;
      const slot = root.querySelector<HTMLElement>(`[data-page="${target}"]`);
      if (!slot) return;
      root.scrollTo({ top: Math.max(0, slot.offsetTop - 66), behavior });
      currentPageRef.current = target;
      setCurrentPage(target);
      setPageInput(String(target));
      onPageChangeRef.current(target);
      setHighlightPage(target);
      if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
      highlightTimer.current = window.setTimeout(() => setHighlightPage(null), 1500);
    },
    [totalPages],
  );

  useEffect(() => {
    if (!jumpRequest || sizes.length === 0 || containerWidth === 0) return;
    if (appliedJumpRef.current === jumpRequest.nonce) return;
    appliedJumpRef.current = jumpRequest.nonce;
    goToPage(jumpRequest.page, 'auto');
  }, [jumpRequest, sizes.length, containerWidth, goToPage]);

  useEffect(() => {
    return () => {
      if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
      if (scrollRaf.current) window.cancelAnimationFrame(scrollRaf.current);
    };
  }, []);

  const commitPageInput = () => {
    const parsed = Number.parseInt(pageInput, 10);
    if (Number.isFinite(parsed)) goToPage(parsed);
    else setPageInput(String(currentPage));
  };

  const zoomBy = (delta: number) => {
    setZoom((value) => Math.max(0.55, Math.min(2.6, Math.round((value + delta) * 10) / 10)));
  };

  const isLoadingLayout = sizes.length === 0;
  const percent = Math.round(zoom * 100);

  return (
    <div className="pdf-shell">
      <div className="pdf-toolbar" role="toolbar" aria-label="PDF 阅读工具">
        <div className="toolbar-group page-nav">
          <button
            type="button"
            className="icon-button"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            aria-label="上一页"
          >
            <ChevronLeft size={17} />
          </button>
          <div className="page-field">
            <input
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value.replace(/[^\d]/g, ''))}
              onBlur={commitPageInput}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                  commitPageInput();
                }
                if (event.key === 'Escape') {
                  setPageInput(String(currentPage));
                  event.currentTarget.blur();
                }
              }}
              aria-label="当前页码"
              inputMode="numeric"
            />
            <span>/ {totalPages}</span>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
            aria-label="下一页"
          >
            <ChevronRight size={17} />
          </button>
        </div>

        <span className="toolbar-divider" aria-hidden="true" />

        <div className="toolbar-group zoom-group">
          <button
            type="button"
            className="icon-button"
            onClick={() => zoomBy(-0.1)}
            disabled={zoom <= 0.55}
            aria-label="缩小"
          >
            <Minus size={15} />
          </button>
          <button
            type="button"
            className="zoom-value"
            onClick={() => setZoom(1)}
            title="恢复适应宽度"
          >
            {percent}%
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => zoomBy(0.1)}
            disabled={zoom >= 2.6}
            aria-label="放大"
          >
            <Plus size={15} />
          </button>
          <button
            type="button"
            className="icon-button fit-button"
            onClick={() => setZoom(1)}
            aria-label="适应宽度"
            title="适应宽度"
          >
            <Maximize2 size={15} />
          </button>
        </div>

        <span className="toolbar-divider" aria-hidden="true" />

        <a
          className="icon-button toolbar-link"
          href={pdfHref}
          target="_blank"
          rel="noreferrer"
          aria-label="在新窗口打开原始 PDF"
          title="打开原始 PDF"
        >
          <ExternalLink size={16} />
        </a>

        <span className="toolbar-divider" aria-hidden="true" />

        <button
          type="button"
          className={`translate-toggle ${translateSelection ? 'is-active' : ''}`}
          onClick={() => setTranslateSelection((value) => !value)}
          aria-pressed={translateSelection}
          aria-label={translateSelection ? '关闭划词自动翻译' : '开启划词自动翻译'}
          title={translateSelection ? '划选文字自动翻译：已开启' : '划选文字自动翻译：已关闭'}
        >
          <Languages size={15} />
          <span>划词</span>
        </button>
      </div>

      <div
        ref={scrollRef}
        className="pdf-scroll"
        onScroll={handleScroll}
        aria-label="论文 PDF 原文"
      >
        {isLoadingLayout ? (
          <div className="pdf-layout-loading">
            <div className="layout-loader-page" />
            <span>正在排版页面…</span>
          </div>
        ) : (
          <div className="pdf-pages">
            {sizes.map((size, index) => (
              <PageSlot
                key={index + 1}
                doc={doc}
                pageNumber={index + 1}
                size={size}
                scale={scale}
                rootRef={scrollRef}
                highlighted={highlightPage === index + 1}
              />
            ))}
            <div className="pdf-end-mark">
              <span />
              论文结束
              <span />
            </div>
            <div style={{ height: PAGE_GAP }} />
          </div>
        )}
      </div>

      {selectionPopup && (
        <TranslationPopover
          key={selectionPopup.id}
          text={selectionPopup.text}
          page={selectionPopup.page}
          anchor={selectionPopup.anchor}
          pageContext={getPageContext(selectionPopup.page)}
          paperTitle={paperTitle}
          config={config}
          modelReady={modelReady}
          onClose={() => setSelectionPopup(null)}
          onOpenSettings={onOpenSettings}
        />
      )}
    </div>
  );
}
