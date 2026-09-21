/**
 * Tool: get_full_text_article
 *
 * Retrieve the full text of articles from PubMed Central (PMC).
 * Only articles in the PMC Open Access Subset have full text available.
 * Articles not in PMC will return an error entry.
 */

import { z } from 'zod';
import type { NcbiClient } from '../pubmed/client.js';
import type { GetFullTextArticleResponse, FullTextArticle } from '../pubmed/types.js';
import { IMPORTANT_LEGAL_NOTICE } from '../pubmed/types.js';
import { parsePmcEfetchXml } from '../utils/xml.js';

/** PMCIDs per request; the CLI splits longer lists into batches of this size. */
export const MAX_FULL_TEXT_IDS = 20;

export const getFullTextArticleSchema = {
  pmc_ids: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_FULL_TEXT_IDS)
    .describe(
      'Array of PubMed Central IDs (PMCIDs) to retrieve full text for. ' +
        'PMCIDs must include the "PMC" prefix (e.g., ["PMC9583675", "PMC7984072"]). ' +
        'Only articles in the PMC Open Access Subset have full text available; ' +
        'unavailable articles are excluded from articles and reported in errors.'
    ),
};

export type GetFullTextArticleParams = {
  pmc_ids: string[];
};

/** Strip the PMC prefix to get the numeric portion NCBI expects. */
function stripPmcPrefix(id: string): string {
  const trimmed = id.trim();
  return trimmed.toUpperCase().startsWith('PMC') ? trimmed.slice(3) : trimmed;
}

function normalizePmcId(id: string): string {
  return `PMC${stripPmcPrefix(id)}`.toUpperCase();
}

export async function getFullTextArticle(
  params: GetFullTextArticleParams,
  client: NcbiClient
): Promise<GetFullTextArticleResponse> {
  // NCBI efetch for PMC expects numeric IDs (without "PMC" prefix)
  const numericIds = params.pmc_ids.map(stripPmcPrefix);

  const xml = await client.efetch({
    db: 'pmc',
    id: numericIds,
    retmode: 'xml',
  });

  let parsedArticles: FullTextArticle[];
  try {
    parsedArticles = parsePmcEfetchXml(xml);
  } catch (err) {
    process.stderr.write(`PMC XML parse error: ${String(err)}\n`);
    return {
      important_legal_notice: IMPORTANT_LEGAL_NOTICE,
      articles: [],
      errors: params.pmc_ids.map((pmcid) => ({
        pmcid: normalizePmcId(pmcid),
        error: 'Failed to parse the PMC EFetch response.',
      })),
      count: 0,
    };
  }

  const articles: FullTextArticle[] = [];
  const errors: GetFullTextArticleResponse['errors'] = [];
  const returnedIds = new Set<string>();

  for (const [index, article] of parsedArticles.entries()) {
    const pmcid = article.identifiers.pmcid
      ? normalizePmcId(article.identifiers.pmcid)
      : normalizePmcId(params.pmc_ids[index] ?? '');
    returnedIds.add(pmcid);

    if (article.full_text.trim()) {
      articles.push(article);
    } else {
      errors.push({
        pmcid,
        error: 'Full text is not available from PMC EFetch for this article.',
      });
    }
  }

  for (const pmcid of new Set(params.pmc_ids.map(normalizePmcId))) {
    if (!returnedIds.has(pmcid)) {
      errors.push({
        pmcid,
        error: 'PMC EFetch did not return this article.',
      });
    }
  }

  return {
    important_legal_notice: IMPORTANT_LEGAL_NOTICE,
    articles,
    errors,
    count: articles.length,
  };
}
