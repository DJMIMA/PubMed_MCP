/**
 * Tool: get_article_metadata
 *
 * Retrieve full metadata (title, abstract, authors, MeSH terms, etc.) for one
 * or more PubMed articles identified by their PMIDs.
 */

import { z } from 'zod';
import type { NcbiClient } from '../pubmed/client.js';
import type { ArticleAuthor, GetArticleMetadataResponse } from '../pubmed/types.js';
import { IMPORTANT_LEGAL_NOTICE } from '../pubmed/types.js';
import { parsePubmedEfetchXml } from '../utils/xml.js';

/** PMIDs per request; the CLI splits longer lists into batches of this size. */
export const MAX_METADATA_PMIDS = 200;

const AUTHOR_MODES = ['all', 'first_last', 'first', 'none'] as const;
export type AuthorMode = (typeof AUTHOR_MODES)[number];

export const getArticleMetadataSchema = {
  pmids: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_METADATA_PMIDS)
    .describe(
      'Array of PubMed IDs (PMIDs) to retrieve metadata for. ' +
        `Maximum ${MAX_METADATA_PMIDS} PMIDs per request.`
    ),
  authors: z
    .enum(AUTHOR_MODES)
    .default('all')
    .describe(
      'Which authors to return, to save context on long author lists:\n' +
        '  all        — every author (default)\n' +
        '  first_last — the first and last author (the last is usually the senior author)\n' +
        '  first      — the first author only\n' +
        '  none       — no authors\n' +
        'author_count always gives the full number of authors.'
    ),
  include_affiliations: z
    .boolean()
    .default(false)
    .describe(
      'Include the affiliations of each returned author (default false). ' +
        'Affiliations are repeated per author and often take most of the space; ' +
        'set true to get them.'
    ),
};

export type GetArticleMetadataParams = {
  pmids: string[];
  authors?: AuthorMode;
  include_affiliations?: boolean;
};

function selectAuthors(authors: ArticleAuthor[], mode: AuthorMode): ArticleAuthor[] {
  switch (mode) {
    case 'all':
      return authors;
    case 'first_last':
      return authors.length > 1 ? [authors[0], authors[authors.length - 1]] : authors;
    case 'first':
      return authors.slice(0, 1);
    case 'none':
      return [];
  }
}

function withoutAffiliations(author: ArticleAuthor): ArticleAuthor {
  const copy = { ...author };
  delete copy.affiliations;
  return copy;
}

export async function getArticleMetadata(
  params: GetArticleMetadataParams,
  client: NcbiClient
): Promise<GetArticleMetadataResponse> {
  const xml = await client.efetch({
    db: 'pubmed',
    id: params.pmids,
    retmode: 'xml',
    rettype: 'abstract',
  });

  const mode = params.authors ?? 'all';
  const includeAffiliations = params.include_affiliations ?? false;

  const articles = parsePubmedEfetchXml(xml).map((article) => ({
    ...article,
    authors: selectAuthors(article.authors, mode).map((author) =>
      includeAffiliations ? author : withoutAffiliations(author)
    ),
  }));

  return {
    articles,
    count: articles.length,
    important_legal_notice: IMPORTANT_LEGAL_NOTICE,
  };
}
