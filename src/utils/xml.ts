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

// PubMed titles and abstracts use mixed-content formatting tags. Unwrapping
// only these presentation elements preserves their text in sentence order.
const PUBMED_INLINE_TAGS_TO_UNWRAP = ['b', 'i', 'sup', 'sub', 'u'];

const PMC_INLINE_TAGS_TO_UNWRAP = [
  'bold',
  'italic',
  'monospace',
  'overline',
  'roman',
  'sans-serif',
  'sc',
  'strike',
  'styled-content',
  'sub',
  'sup',
  'underline',
  'xref',
  'ext-link',
  'uri',
  'email',
  'named-content',
];

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
  const doc = pubmedParser.parse(normalizePubmedInlineXml(xml)) as any;
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
  const doc = pmcParser.parse(normalizePmcInlineXml(xml)) as any;
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
  const title = cleanPmcText(extractText(articleMeta?.['title-group']?.['article-title']));

  // Abstract
  const abstractNodes = asArray(articleMeta?.abstract);
  const abstract = cleanPmcText(
    abstractNodes
      .map((a: unknown) => extractPmcAbstract(a))
      .join('\n')
  );

  // Full text from body + back
  const bodyText = body ? extractPmcSectionText(body) : '';
  const backText = back ? extractPmcBackText(back) : '';
  const full_text = cleanPmcText([bodyText, backText].filter(Boolean).join('\n\n'));

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

  const refLists = findNodesByKey(back, 'ref-list');
  for (const refList of refLists) {
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

// ─── PMC JATS XML → access / license status ──────────────────────────────────

export interface PmcAccessInfo {
  pmcid: string;
  /** PMC's own flag (custom-meta "pmc-prop-open-access"). */
  isOpenAccess: boolean;
  /** Same test get_full_text_article applies: EFetch returned body/back text. */
  hasFullText: boolean;
  /** Short license code from custom-meta "pmc-license-ref", e.g. "CC BY-NC-ND". */
  license?: string;
  copyrightStatement?: string;
}

/**
 * Read access and license status from efetch.fcgi (db=pmc) XML.
 * Replaces the PMC OA Web Service (oa.fcgi), which NCBI retired on 2026-08-25.
 */
export function parsePmcAccessXml(xml: string): PmcAccessInfo[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = pmcParser.parse(normalizePmcInlineXml(xml)) as any;
  const articleSet = doc?.['pmc-articleset'] ?? doc;
  const articles: unknown[] = asArray(articleSet?.article);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return articles.map((article: any): PmcAccessInfo => {
    const articleMeta = article?.front?.['article-meta'] ?? {};
    const meta = new Map<string, string>();
    for (const group of asArray(articleMeta?.['custom-meta-group'])) {
      for (const entry of asArray((group as Record<string, unknown>)?.['custom-meta'])) {
        const e = entry as Record<string, unknown>;
        meta.set(extractText(e?.['meta-name']), extractText(e?.['meta-value']));
      }
    }

    const { identifiers, full_text } = parsePmcArticle(article);
    const license = meta.get('pmc-license-ref');
    const copyrightStatement = cleanPmcText(
      extractText(articleMeta?.permissions?.['copyright-statement'])
    );

    return {
      pmcid: identifiers.pmcid,
      isOpenAccess: meta.get('pmc-prop-open-access') === 'yes',
      hasFullText: full_text.trim() !== '',
      ...(license ? { license } : {}),
      ...(copyrightStatement ? { copyrightStatement } : {}),
    };
  });
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

function normalizePubmedInlineXml(xml: string): string {
  return unwrapInlineTags(xml, PUBMED_INLINE_TAGS_TO_UNWRAP);
}

function normalizePmcInlineXml(xml: string): string {
  return unwrapInlineTags(xml, PMC_INLINE_TAGS_TO_UNWRAP);
}

function unwrapInlineTags(xml: string, tags: readonly string[]): string {
  let normalized = xml;
  for (const tag of tags) {
    const tagPattern = new RegExp(
      `<${tag}\\b(?![^>]*\\/\\s*>)[^>]*>([\\s\\S]*?)<\\/${tag}>`,
      'gi'
    );
    let previous: string;
    do {
      previous = normalized;
      normalized = normalized.replace(tagPattern, '$1');
    } while (normalized !== previous);
  }
  return normalized;
}

export function cleanPmcText(text: string): string {
  return text
    .replace(/(^|[\s([{:;,.])\+(?:\s+\+)+(?=$|[\s)\]}:;,.])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function findNodesByKey(node: unknown, key: string): any[] {
  if (!node || typeof node !== 'object') return [];

  if (Array.isArray(node)) {
    return node.flatMap((item) => findNodesByKey(item, key));
  }

  const obj = node as Record<string, unknown>;
  const matches = asArray(obj[key]);
  const nested = Object.entries(obj)
    .filter(([childKey]) => !childKey.startsWith('_') && childKey !== key)
    .flatMap(([, value]) => findNodesByKey(value, key));

  return [...matches, ...nested];
}
