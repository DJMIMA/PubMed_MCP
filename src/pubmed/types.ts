/**
 * TypeScript types for PubMed MCP tool responses.
 * These match the exact API surface of the official Anthropic PubMed connector.
 */

// ─── search_articles ────────────────────────────────────────────────────────

export interface SearchArticlesWarnings {
  phrases_ignored: string[];
  quoted_phrases_not_found: string[];
  output_messages: string[];
}

/** NCBI ESearch query diagnostics, not transport or MCP execution errors. */
export interface SearchArticlesErrors {
  phrases_not_found: string[];
  fields_not_found: string[];
}

export interface SearchArticlesResponse {
  pmids: string[];
  total_count: number;
  returned_count: number;
  query: string;
  query_translation: string;
  has_more: boolean;
  warnings: SearchArticlesWarnings;
  errors: SearchArticlesErrors;
}

// ─── get_article_metadata ────────────────────────────────────────────────────

export interface ArticleIdentifiers {
  pmid: string;
  doi?: string;
  pii?: string;
  pmcid?: string;
}

export interface ArticleJournal {
  title: string;
  iso_abbreviation: string;
}

export interface ArticleAuthor {
  last_name: string;
  fore_name: string;
  initials: string;
  /** Group author (e.g. a study group); the name fields above are empty for it. */
  collective_name?: string;
  affiliations?: string[];
}

export interface ArticlePublicationDate {
  year: string;
  month?: string;
  day?: string;
}

export interface ArticleCitation {
  volume?: string;
  issue?: string;
  pages?: string;
}

export interface ArticleMetadata {
  identifiers: ArticleIdentifiers;
  title: string;
  abstract: string;
  doi?: string;
  journal: ArticleJournal;
  authors: ArticleAuthor[];
  /** Number of authors PubMed lists, even when `authors` was cut down. */
  author_count: number;
  publication_date: ArticlePublicationDate;
  keywords: string[];
  mesh_terms: string[];
  article_types: string[];
  language: string;
  citation: ArticleCitation;
}

export interface GetArticleMetadataResponse {
  articles: ArticleMetadata[];
  count: number;
  important_legal_notice: string;
}

// ─── find_related_articles ───────────────────────────────────────────────────

export interface LinksetDb {
  dbto: string;
  linkname: string;
  links: string[];
}

export interface Linkset {
  dbfrom: string;
  ids: string[];
  linksetdbs: LinksetDb[];
}

export interface FindRelatedArticlesResponse {
  linksets: Linkset[];
}

// ─── lookup_article_by_citation ──────────────────────────────────────────────

export interface CitationResult {
  journal: string;
  year: string;
  volume: string;
  first_page: string;
  author: string;
  pmid: string;
  key: string;
}

export interface LookupArticleByCitationResponse {
  citations: CitationResult[];
}

// ─── convert_article_ids ─────────────────────────────────────────────────────

export interface IdConversionRecord {
  pmid?: string;
  pmcid?: string;
  doi?: string;
  'requested-id': string;
  errmsg?: string;
  [key: string]: string | undefined;
}

export interface IdConversionRequest {
  warnings: string[];
  format: string;
  idtype: string;
  ids: string[];
  email: string;
  tool: string;
  echo: string;
  versions: string;
  showaiid: string;
}

export interface ConvertArticleIdsResponse {
  status: string;
  'response-date': string;
  request: IdConversionRequest;
  records: IdConversionRecord[];
}

// ─── get_full_text_article ───────────────────────────────────────────────────

export interface FullTextIdentifiers {
  pmcid: string;
  pmid?: string;
  doi?: string;
}

export interface FullTextArticle {
  identifiers: FullTextIdentifiers;
  title: string;
  abstract: string;
  doi?: string;
  full_text: string;
}

export interface FullTextArticleError {
  pmcid: string;
  error: string;
}

export interface GetFullTextArticleResponse {
  important_legal_notice: string;
  articles: FullTextArticle[];
  errors: FullTextArticleError[];
  count: number;
}

// ─── get_copyright_status ────────────────────────────────────────────────────

export interface CopyrightStatus {
  pmid: string;
  pmcid?: string;
  has_full_text: boolean;
  license?: string;
  copyright_statement?: string;
  is_open_access?: boolean;
}

export interface GetCopyrightStatusResponse {
  statuses: CopyrightStatus[];
  count: number;
}

// ─── Shared constants ────────────────────────────────────────────────────────

export const IMPORTANT_LEGAL_NOTICE =
  'PubMed data is provided by the National Library of Medicine (NLM). ' +
  'When citing articles, include the complete DOI as required by the journal and publisher. ' +
  'Use of this data is subject to NLM copyright and terms of use. ' +
  'For PubMed Central full-text articles, proper attribution including the PMCID is required. ' +
  'See: https://www.ncbi.nlm.nih.gov/home/about/policies/';
