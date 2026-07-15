/**
 * Tool: search_articles
 *
 * Search PubMed for biomedical articles using standard PubMed syntax or
 * keywords. Returns a list of PMIDs plus metadata about the result set.
 */

import { z } from 'zod';
import type { NcbiClient } from '../pubmed/client.js';
import type { SearchArticlesResponse } from '../pubmed/types.js';

// Sort parameter mapping: tool value → NCBI API value
const SORT_MAP: Record<string, string> = {
  relevance: 'relevance',
  pub_date: 'pub_date',
  author: 'Author',
  journal_name: 'JournalName',
};

const SEARCH_FIELDS = [
  'title',
  'tiab',
  'mesh',
  'author',
  'journal',
  'affiliation',
] as const;

export const searchArticlesSchema = {
  query: z
    .string()
    .min(1)
    .describe(
      'PubMed search query using standard PubMed syntax or plain keywords. ' +
        'Supports Boolean operators (AND, OR, NOT), field tags ([Title], [Author], ' +
        '[MeSH Terms], etc.), and date ranges.'
    ),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(20)
    .optional()
    .describe('Maximum number of article IDs to return (default: 20, max: 10000).'),
  retstart: z
    .number()
    .int()
    .min(0)
    .default(0)
    .optional()
    .describe(
      'Zero-based offset of the first result to return. ' +
        'Use with max_results for pagination.'
    ),
  sort: z
    .enum(['relevance', 'pub_date', 'author', 'journal_name'])
    .optional()
    .describe(
      'Sort order for results. ' +
        'relevance: most relevant first; ' +
        'pub_date: most recent first; ' +
        'author: alphabetical by first author; ' +
        'journal_name: alphabetical by journal.'
    ),
  field: z
    .enum(SEARCH_FIELDS)
    .optional()
    .describe(
      'Optional PubMed field applied to every untagged term in the query: ' +
        'title, tiab (title/abstract), mesh, author, journal, or affiliation. ' +
        'This prevents cross-field automatic term mapping for those terms. ' +
        'An explicit field tag in the query takes precedence for the tagged term.'
    ),
  date_from: z
    .string()
    .optional()
    .describe(
      'Start of date range filter (YYYY/MM/DD, YYYY/MM, or YYYY). ' +
        'Applied to the date type specified by datetype.'
    ),
  date_to: z
    .string()
    .optional()
    .describe(
      'End of date range filter (YYYY/MM/DD, YYYY/MM, or YYYY). ' +
        'Applied to the date type specified by datetype.'
    ),
  datetype: z
    .enum(['pdat', 'edat', 'mdat'])
    .default('pdat')
    .describe(
      'Date type to filter on: ' +
        'pdat = publication date (default); ' +
        'edat = Entrez date (date added to PubMed); ' +
        'mdat = modification date.'
    ),
};

export type SearchArticlesParams = {
  query: string;
  max_results?: number;
  retstart?: number;
  sort?: 'relevance' | 'pub_date' | 'author' | 'journal_name';
  field?: (typeof SEARCH_FIELDS)[number];
  date_from?: string;
  date_to?: string;
  datetype?: 'pdat' | 'edat' | 'mdat';
};

export async function searchArticles(
  params: SearchArticlesParams,
  client: NcbiClient
): Promise<SearchArticlesResponse> {
  const retmax = params.max_results ?? 20;
  const retstart = params.retstart ?? 0;

  const result = await client.esearch({
    term: params.query,
    retmax,
    retstart,
    sort: params.sort ? SORT_MAP[params.sort] : undefined,
    ...(params.field ? { field: params.field } : {}),
    datetype: params.datetype ?? 'pdat',
    mindate: params.date_from,
    maxdate: params.date_to,
  });

  const total_count = parseInt(result.count, 10);
  const returned_count = result.idlist.length;
  const has_more = retstart + returned_count < total_count;

  return {
    pmids: result.idlist,
    total_count,
    returned_count,
    query: params.query,
    query_translation: result.querytranslation ?? '',
    has_more,
    warnings: {
      phrases_ignored: result.warninglist?.phrasesignored ?? [],
      quoted_phrases_not_found: result.warninglist?.quotedphrasesnotfound ?? [],
      output_messages: result.warninglist?.outputmessages ?? [],
    },
    errors: {
      phrases_not_found: result.errorlist?.phrasesnotfound ?? [],
      fields_not_found: result.errorlist?.fieldsnotfound ?? [],
    },
  };
}
