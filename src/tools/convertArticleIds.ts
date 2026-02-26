/**
 * Tool: convert_article_ids
 *
 * Convert between different article identifier types: PMID, PMCID, and DOI.
 * Uses the NCBI PMC ID Converter API.
 */

import { z } from 'zod';
import type { NcbiClient } from '../pubmed/client.js';
import type { ConvertArticleIdsResponse } from '../pubmed/types.js';

export const convertArticleIdsSchema = {
  ids: z
    .array(z.string().min(1))
    .min(1)
    .max(200)
    .describe(
      'Array of article IDs to convert. ' +
        'Format depends on id_type: PMIDs are numeric strings (e.g., "33526711"), ' +
        'PMCIDs include the "PMC" prefix (e.g., "PMC7984072"), ' +
        'DOIs are standard DOI strings (e.g., "10.1038/s41586-021-03819-2").'
    ),
  id_type: z
    .enum(['pmid', 'pmcid', 'doi'])
    .default('pmid')
    .optional()
    .describe(
      'Type of the input IDs:\n' +
        '  pmid  — PubMed IDs (default)\n' +
        '  pmcid — PubMed Central IDs (with or without "PMC" prefix)\n' +
        '  doi   — Digital Object Identifiers'
    ),
};

export type ConvertArticleIdsParams = {
  ids: string[];
  id_type?: 'pmid' | 'pmcid' | 'doi';
};

export async function convertArticleIds(
  params: ConvertArticleIdsParams,
  client: NcbiClient
): Promise<ConvertArticleIdsResponse> {
  const idType = params.id_type ?? 'pmid';

  // PMCIDs may come with or without the "PMC" prefix.
  // The NCBI ID Converter API accepts both, but let's normalise.
  const ids =
    idType === 'pmcid'
      ? params.ids.map((id) => (id.toUpperCase().startsWith('PMC') ? id : `PMC${id}`))
      : params.ids;

  const response = await client.idConvert({ ids, idtype: idType });

  // Pass through the NCBI response shape, which already matches our type
  return response as ConvertArticleIdsResponse;
}
