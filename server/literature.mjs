const OPENALEX_URL = 'https://api.openalex.org/works';
const MAX_RESULTS = 8;

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function arxivFromDoi(doi) {
  const match = String(doi ?? '').match(/10\.48550\/arxiv\.([^/?#]+)/i);
  return match ? `https://arxiv.org/abs/${match[1]}` : '';
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value ?? ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function normalizeWork(work) {
  const title = text(work?.title);
  if (!title) return null;
  const authors = (Array.isArray(work?.authorships) ? work.authorships : [])
    .map((entry) => text(entry?.author?.display_name))
    .filter(Boolean)
    .slice(0, 6);
  const doi = safeHttpUrl(work?.doi);
  const arxiv = arxivFromDoi(doi);
  const pdf =
    safeHttpUrl(work?.best_oa_location?.pdf_url) ||
    safeHttpUrl(work?.primary_location?.pdf_url) ||
    safeHttpUrl(work?.open_access?.oa_url);
  const landing =
    safeHttpUrl(work?.best_oa_location?.landing_page_url) ||
    safeHttpUrl(work?.primary_location?.landing_page_url);
  const url = arxiv || pdf || doi || landing;
  if (!url) return null;
  return {
    title,
    authors,
    year: Number(work?.publication_year) || null,
    venue: text(work?.primary_location?.source?.display_name),
    url,
    pdfUrl: pdf,
    arxivUrl: arxiv,
    doi,
  };
}

export async function searchOpenAlex(query, signal) {
  const cleanQuery = text(query).slice(0, 400);
  if (!cleanQuery) throw new Error('请输入要搜索的文献主题');
  const url = new URL(OPENALEX_URL);
  url.searchParams.set('search', cleanQuery);
  url.searchParams.set('per-page', String(MAX_RESULTS));
  url.searchParams.set(
    'select',
    'id,doi,title,publication_year,authorships,primary_location,best_oa_location,open_access,type',
  );
  if (process.env.OPENALEX_MAILTO) {
    url.searchParams.set('mailto', process.env.OPENALEX_MAILTO);
  }

  let response;
  try {
    response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'Haila/1.0 (local literature radar)',
      },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
    });
  } catch (error) {
    const detail =
      error?.name === 'TimeoutError'
        ? '连接超时'
        : error instanceof Error
          ? error.message
          : '连接失败';
    throw new Error(`OpenAlex 文献库连接失败：${detail}`);
  }
  if (!response.ok) {
    throw new Error(`OpenAlex 文献库返回 HTTP ${response.status}`);
  }
  const payload = await response.json();
  const results = (Array.isArray(payload?.results) ? payload.results : [])
    .map(normalizeWork)
    .filter(Boolean);
  if (results.length === 0) {
    throw new Error('OpenAlex 没有找到匹配的文献，请换一个更具体的关键词');
  }
  return results;
}

export function formatOpenAlexContext(results) {
  return results
    .map((result, index) => {
      const authors = result.authors.join(', ') || '作者未知';
      const year = result.year || '年份未知';
      const venue = result.venue ? `，${result.venue}` : '';
      return `${index + 1}. ${result.title}
   作者：${authors}
   年份/发表处：${year}${venue}
   链接：${result.url}
   ${result.pdfUrl || result.arxivUrl ? '可直接导入原文 PDF' : '没有开放 PDF 链接，只能提供元数据'}`;
    })
    .join('\n\n');
}
