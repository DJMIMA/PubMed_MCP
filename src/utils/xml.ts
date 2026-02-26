/**
 * XML parsing utilities for NCBI E-utilities responses.
 *
 * PubMed returns XML by default from efetch.fcgi.
 * PMC full-text articles use the JATS XML format.
 */

import { XMLParser } from 'fast-xml-parser';
import type {
  ArticleAuthor,
  ArticleCitation,
  ArticleIdentifiers,
  ArticleJournal,
  ArticleMetadata,
  ArticlePublicationDate,
  FullTextArticle,
  FullTextIdentifiers,
} from '../pubmed/types.js';

// Tags that should always be parsed as arrays even when only one element exists
const ALWAYS_ARRAY_PUBMED = new Set([
  'PubmedArticle',
  'PubmedBookArticle',
  'Author',
  'ArticleId',
  'MeshHeading',
  'Keyword',
  'PublicationType',
  'AbstractText',
  'AffiliationInfo',
  'OtherAbstract',
  'ELocationID',
  'Grant',
]);

const ALWAYS_ARRAY_PMC = new Set([
  'article',
  'article-id',
  'sec',
  'p',
  'ref',
  'fig',
  'table-wrap',
  'contrib',
  'aff',
  'kwd',
  'abstract',
  'list-item',
]);

// ─── PubMed efetch XML parser ─────────────────────────────────────────────────

const pubmedParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '_',
  textNodeName: '#text',
  parseAttributeValue: false,
  parseTagValue: true,
  trimValues: true,
  isArray: (name) => ALWAYS_ARRAY_PUBMED.has(name),
});

// ─── PMC JATS XML parser ──────────────────────────────────────────────────────

const pmcParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '_',
  textNodeName: '#text',
  parseAttributeValue: false,
  parseTagValue: true,
  trimValues: true,
  isArray: (name) => ALWAYS_ARRAY_PMC.has(name),
});

// ─── PubMed XML → ArticleMetadata ─────────────────────────────────────────────

/**
 * Parse the XML returned by efetch.fcgi (db=pubmed) into ArticleMetadata objects.
 */
export function parsePubmedEfetchXml(xml: string): ArticleMetadata[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = pubmedParser.parse(xml) as any;
  const articleSet = doc?.PubmedArticleSet ?? doc;
  const articles: unknown[] = asArray(articleSet?.PubmedArticle);

  return articles.map((articleWrapper) => parsePubmedArticle(articleWrapper));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePubmedArticle(wrapper: any): ArticleMetadata {
  const citation = wrapper?.MedlineCitation ?? {};
  const article = citation?.Article ?? {};
  const journal = article?.Journal ?? {};
  const journalIssue = journal?.JournalIssue ?? {};
  const pubDate = journalIssue?.PubDate ?? {};
  const pagination = article?.Pagination ?? {};
  const pubmedData = wrapper?.PubmedData ?? {};
  const articleIdList = asArray(pubmedData?.ArticleIdList?.ArticleId);

  // Identifiers
  const identifiers: ArticleIdentifiers = {
    pmid: String(citation?.PMID?.['#text'] ?? citation?.PMID ?? ''),
  };
  for (const idNode of articleIdList) {
    const idObj = idNode as Record<string, unknown>;
    const idType = String(idObj['_IdType'] ?? '');
    const idValue = String(idObj['#text'] ?? idNode ?? '');
    if (idType === 'doi') identifiers.doi = idValue;
    else if (idType === 'pii') identifiers.pii = idValue;
    else if (idType === 'pmc') identifiers.pmcid = idValue;
  }

  // Title
  const title = extractText(article?.ArticleTitle);

  // Abstract
  const abstractNode = article?.Abstract;
  const abstract = parseAbstract(abstractNode);

  // Journal
  const journalInfo: ArticleJournal = {
    title: extractText(journal?.Title),
    iso_abbreviation: extractText(journal?.ISOAbbreviation),
  };

  // Authors
  const authorList = asArray(article?.AuthorList?.Author);
  const authors: ArticleAuthor[] = authorList.map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (a: any): ArticleAuthor => {
      const affiliations = asArray(a?.AffiliationInfo)
        .map((ai: unknown) => extractText((ai as Record<string, unknown>)?.Affiliation))
        .filter(Boolean);
      return {
        last_name: extractText(a?.LastName),
        fore_name: extractText(a?.ForeName),
        initials: extractText(a?.Initials),
        ...(affiliations.length > 0 ? { affiliations } : {}),
      };
    }
  );

  // Publication date
  const pubDateParsed: ArticlePublicationDate = {
    year: extractText(pubDate?.Year) || extractText(pubDate?.MedlineDate)?.slice(0, 4) || '',
  };
  const month = extractText(pubDate?.Month);
  const day = extractText(pubDate?.Day);
  if (month) pubDateParsed.month = month;
  if (day) pubDateParsed.day = day;

  // Keywords
  const keywordList = asArray(citation?.KeywordList?.Keyword);
  const keywords = keywordList.map((k: unknown) => extractText(k)).filter(Boolean);

  // MeSH terms
  const meshList = asArray(citation?.MeshHeadingList?.MeshHeading);
  const mesh_terms = meshList
    .map((m: unknown) => extractText((m as Record<string, unknown>)?.DescriptorName))
    .filter(Boolean);

  // Article types
  const pubTypeList = asArray(article?.PublicationTypeList?.PublicationType);
  const article_types = pubTypeList
    .map((pt: unknown) => extractText(pt))
    .filter(Boolean);

  // Language
  const language = extractText(article?.Language) || 'eng';

  // Citation
  const citationInfo: ArticleCitation = {};
  const volume = extractText(journalIssue?.Volume);
  const issue = extractText(journalIssue?.Issue);
  const pages = extractText(pagination?.MedlinePgn);
  if (volume) citationInfo.volume = volume;
  if (issue) citationInfo.issue = issue;
  if (pages) citationInfo.pages = pages;

  return {
    identifiers,
    title,
    abstract,
    ...(identifiers.doi ? { doi: identifiers.doi } : {}),
    journal: journalInfo,
    authors,
    publication_date: pubDateParsed,
    keywords,
    mesh_terms,
    article_types,
    language,
    citation: citationInfo,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseAbstract(abstractNode: any): string {
  if (!abstractNode) return '';

  // Structured abstract: multiple AbstractText elements with Label attribute
  const texts = asArray(abstractNode?.AbstractText);
  if (texts.length === 0) return '';

  return texts
    .map((t: unknown) => {
      const label =
        (t as Record<string, string | undefined>)?._Label ??
        (t as Record<string, string | undefined>)?._NlmCategory;
      const text = extractText(t);
      if (label && label !== 'UNLABELED') {
        return `${label}: ${text}`;
      }
      return text;
    })
    .filter(Boolean)
    .join('\n');
}

// ─── PMC JATS XML → FullTextArticle ─────────────────────────────────────────

/**
 * Parse the XML returned by efetch.fcgi (db=pmc) into FullTextArticle objects.
 */
export function parsePmcEfetchXml(xml: string): FullTextArticle[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = pmcParser.parse(xml) as any;
  const articleSet = doc?.['pmc-articleset'] ?? doc;
  const articles: unknown[] = asArray(articleSet?.article);

  return articles.map((a) => parsePmcArticle(a));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePmcArticle(article: any): FullTextArticle {
  const front = article?.front ?? {};
  const articleMeta = front?.['article-meta'] ?? {};
  const body = article?.body;
  const back = article?.back;

  // Identifiers
  const articleIds = asArray(articleMeta?.['article-id']);
  const identifiers: FullTextIdentifiers = { pmcid: '' };
  let doi: string | undefined;

  for (const idNode of articleIds) {
    const idObj = idNode as Record<string, unknown>;
    const idType = String(idObj['_pub-id-type'] ?? '');
    const idValue = extractText(idNode);
    if (idType === 'pmc' || idType === 'pmcid') {
      identifiers.pmcid = idValue.startsWith('PMC') ? idValue : `PMC${idValue}`;
    } else if (idType === 'pmid') {
      identifiers.pmid = idValue;
    } else if (idType === 'doi') {
      identifiers.doi = idValue;
      doi = idValue;
    }
  }

  // Title
  const title = extractText(articleMeta?.['title-group']?.['article-title']);

  // Abstract
  const abstractNodes = asArray(articleMeta?.abstract);
  const abstract = abstractNodes
    .map((a: unknown) => extractPmcAbstract(a))
    .join('\n')
    .trim();

  // Full text from body + back
  const bodyText = body ? extractPmcSectionText(body) : '';
  const backText = back ? extractPmcBackText(back) : '';
  const full_text = [bodyText, backText].filter(Boolean).join('\n\n').trim();

  return {
    identifiers,
    title,
    abstract,
    ...(doi ? { doi } : {}),
    full_text,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractPmcAbstract(abstractNode: any): string {
  if (!abstractNode) return '';
  // Structured abstract with sections
  const secs = asArray(abstractNode?.sec);
  if (secs.length > 0) {
    return secs
      .map((sec: unknown) => {
        const s = sec as Record<string, unknown>;
        const title = extractText(s?.title);
        const paras = asArray(s?.p)
          .map((p: unknown) => extractText(p))
          .join(' ');
        return title ? `${title}: ${paras}` : paras;
      })
      .join('\n');
  }
  // Simple abstract
  return asArray(abstractNode?.p)
    .map((p: unknown) => extractText(p))
    .join('\n');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractPmcSectionText(node: any, depth: number = 0): string {
  if (!node || typeof node !== 'object') return '';

  const parts: string[] = [];

  // Sections
  const secs = asArray(node.sec);
  for (const sec of secs) {
    const secText = extractPmcSectionText(sec, depth + 1);
    if (secText) parts.push(secText);
  }

  // Title (after processing sub-sections so the title comes first)
  if (node.title) {
    const titleText = extractText(node.title);
    if (titleText) parts.unshift(titleText);
  }

  // Paragraphs
  const paras = asArray(node.p);
  for (const p of paras) {
    const pText = extractText(p);
    if (pText) parts.push(pText);
  }

  // Figures
  const figs = asArray(node.fig);
  for (const fig of figs) {
    const label = extractText((fig as Record<string, unknown>)?.label);
    const caption = extractText((fig as Record<string, unknown>)?.caption);
    if (label || caption) parts.push([label, caption].filter(Boolean).join(': '));
  }

  // Tables
  const tables = asArray(node['table-wrap']);
  for (const table of tables) {
    const label = extractText((table as Record<string, unknown>)?.label);
    const caption = extractText((table as Record<string, unknown>)?.caption);
    if (label || caption) parts.push([label, caption].filter(Boolean).join(': '));
  }

  return parts.join('\n');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractPmcBackText(back: any): string {
  if (!back) return '';
  const parts: string[] = [];

  const refList = back?.['ref-list'];
  if (refList) {
    const title = extractText(refList?.title);
    if (title) parts.push(title);
    const refs = asArray(refList?.ref);
    for (const ref of refs) {
      const r = ref as Record<string, unknown>;
      const label = extractText(r?.label);
      const citation =
        r?.['element-citation'] ??
        r?.['mixed-citation'] ??
        r?.['nlm-citation'] ??
        r?.citation;
      const citText = extractText(citation);
      parts.push([label, citText].filter(Boolean).join(' '));
    }
  }

  return parts.join('\n');
}

// ─── PMC OA XML parser ────────────────────────────────────────────────────────

export interface OaResult {
  pmcid: string;
  license?: string;
  ftp?: string;
  isOpenAccess: boolean;
}

export function parsePmcOaXml(xml: string, pmcid: string): OaResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '_' }).parse(xml) as any;
  const oa = doc?.OA;

  if (!oa || oa?.error) {
    return { pmcid, isOpenAccess: false };
  }

  const record = oa?.records?.record;
  const license = record?._license ?? undefined;
  const ftp = record?.links?.link?._href ?? undefined;

  return {
    pmcid,
    license: license ? String(license) : undefined,
    ftp: ftp ? String(ftp) : undefined,
    isOpenAccess: !!license,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Ensure a value is an array (wrap singletons; filter null/undefined). */
function asArray(val: unknown): unknown[] {
  if (val === null || val === undefined) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

/**
 * Recursively extract all plain text from a parsed XML node.
 * Inline elements (italic, bold, sup, sub, etc.) are flattened to text.
 */
export function extractText(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (Array.isArray(node)) {
    return node.map(extractText).join(' ');
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    // If there's a text node key, return it directly
    if ('#text' in obj) {
      const text = String(obj['#text']);
      // Also gather inline element text and interleave
      const inlineText = Object.entries(obj)
        .filter(([k]) => k !== '#text' && !k.startsWith('_'))
        .map(([, v]) => extractText(v))
        .join(' ');
      return inlineText ? `${text} ${inlineText}`.trim() : text;
    }
    // Otherwise concatenate all non-attribute children
    return Object.entries(obj)
      .filter(([k]) => !k.startsWith('_'))
      .map(([, v]) => extractText(v))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return '';
}
