/**
 * Tool: get_article_metadata
 *
 * Retrieve full metadata (title, abstract, authors, MeSH terms, etc.) for one
 * or more PubMed articles identified by their PMIDs.
 */

import { z } from 'zod';
import type { NcbiClient } from '../pubmed/client.js';
import type { GetArticleMetadataResponse } from '../pubmed/types.js';
import { IMPORTANT_LEGAL_NOTICE } from '../pubmed/types.js';
import { parsePubmedEfetchXml } from '../utils/xml.js';

/** PMIDs per request; the CLI splits longer lists into batches of this size. */
export const MAX_METADATA_PMIDS = 200;

export const getArticleMetadataSchema = {
  pmids: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_METADATA_PMIDS)
    .describe(
      'Array of PubMed IDs (PMIDs) to retrieve metadata for. ' +
        `Maximum ${MAX_METADATA_PMIDS} PMIDs per request.`
    ),
};

export type GetArticleMetadataParams = {
  pmids: string[];
};

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

  const articles = parsePubmedEfetchXml(xml);

  return {
    articles,
    count: articles.length,
    important_legal_notice: IMPORTANT_LEGAL_NOTICE,
  };
}
