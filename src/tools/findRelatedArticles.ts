/**
 * Tool: find_related_articles
 *
 * Find articles related to one or more PubMed articles using NCBI's ELink
 * service. Supports cross-database links (PubMed→PubMed, PubMed→PMC, etc.).
 */

import { z } from 'zod';
import type { NcbiClient, ElinkLinksetDb } from '../pubmed/client.js';
import type { FindRelatedArticlesResponse, Linkset } from '../pubmed/types.js';

export const findRelatedArticlesSchema = {
  pmids: z
    .array(z.string().min(1))
    .min(1)
    .describe('Array of source PubMed IDs to find related articles for.'),
  link_type: z
    .enum([
      'pubmed_pubmed',
      'pubmed_pmc',
      'pubmed_gene',
      'pubmed_protein',
      'pubmed_nucleotide',
    ])
    .default('pubmed_pubmed')
    .optional()
    .describe(
      'Type of link to follow:\n' +
        '  pubmed_pubmed     — related articles in PubMed (default)\n' +
        '  pubmed_pmc        — full-text articles in PubMed Central\n' +
        '  pubmed_gene       — related gene records in NCBI Gene\n' +
        '  pubmed_protein    — related protein records\n' +
        '  pubmed_nucleotide — related nucleotide sequences'
    ),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe(
      'Maximum number of related article IDs to return per source article. ' +
        'Note: NCBI does not natively limit ELink results; this is a client-side cap.'
    ),
};

export type FindRelatedArticlesParams = {
  pmids: string[];
  link_type?: 'pubmed_pubmed' | 'pubmed_pmc' | 'pubmed_gene' | 'pubmed_protein' | 'pubmed_nucleotide';
  max_results?: number;
};

// Mapping from tool link_type values to NCBI elink linkname values
const LINK_TYPE_MAP: Record<string, string> = {
  pubmed_pubmed: 'pubmed_pubmed',
  pubmed_pmc: 'pubmed_pmc_refs',
  pubmed_gene: 'pubmed_gene',
  pubmed_protein: 'pubmed_protein_refseq',
  pubmed_nucleotide: 'pubmed_nuccore_refseqrna',
};

export async function findRelatedArticles(
  params: FindRelatedArticlesParams,
  client: NcbiClient
): Promise<FindRelatedArticlesResponse> {
  const linkname = LINK_TYPE_MAP[params.link_type ?? 'pubmed_pubmed'];

  const response = await client.elink({
    dbfrom: 'pubmed',
    id: params.pmids,
    linkname,
    cmd: 'neighbor',
  });

  const maxResults = params.max_results;

  const linksets: Linkset[] = (response.linksets ?? []).map((ls) => ({
    dbfrom: ls.dbfrom,
    ids: ls.ids,
    linksetdbs: (ls.linksetdbs ?? []).map((lsdb: ElinkLinksetDb) => {
      // Transform link objects to plain PMID strings and optionally cap results
      let links = lsdb.links.map((link) => {
        if (typeof link === 'string') return link;
        return link.id;
      });
      if (maxResults !== undefined) {
        links = links.slice(0, maxResults);
      }
      return {
        dbto: lsdb.dbto,
        linkname: lsdb.linkname,
        links,
      };
    }),
  }));

  return { linksets };
}
