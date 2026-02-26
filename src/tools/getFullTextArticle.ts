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

export const getFullTextArticleSchema = {
  pmc_ids: z
    .array(z.string().min(1))
    .min(1)
    .max(20)
    .describe(
      'Array of PubMed Central IDs (PMCIDs) to retrieve full text for. ' +
        'PMCIDs must include the "PMC" prefix (e.g., ["PMC9583675", "PMC7984072"]). ' +
        'Only articles in the PMC Open Access Subset have full text available; ' +
        'subscription articles will be absent from results.'
    ),
};

export type GetFullTextArticleParams = {
  pmc_ids: string[];
};

/** Strip the PMC prefix to get the numeric portion NCBI expects. */
function stripPmcPrefix(id: string): string {
  return id.toUpperCase().startsWith('PMC') ? id.slice(3) : id;
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

  let articles: FullTextArticle[];
  try {
    articles = parsePmcEfetchXml(xml);
  } catch (err) {
    // If parsing fails entirely, return empty with a note
    process.stderr.write(`PMC XML parse error: ${String(err)}\n`);
    articles = [];
  }

  return {
    important_legal_notice: IMPORTANT_LEGAL_NOTICE,
    articles,
    count: articles.length,
  };
}
