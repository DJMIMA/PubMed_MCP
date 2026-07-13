/**
 * Tool: find_related_articles
 *
 * Find articles related to one or more PubMed articles using NCBI's ELink
 * service. Supports cross-database links (PubMed→PubMed, PubMed→PMC, etc.).
 */

import { z } from 'zod';
import type { NcbiClient, ElinkLinksetDb } from '../pubmed/client.js';
import type { FindRelatedArticlesResponse, Linkset } from '../pubmed/types.js';

const LINK_TYPES = [
  'similar_articles',
  'citing_pmc_articles',
  'linked_gene_records',
  'linked_refseq_proteins',
  'linked_refseq_nucleotides',
] as const;
export type FindRelatedLinkType = (typeof LINK_TYPES)[number];

export const findRelatedArticlesSchema = {
  pmids: z
    .array(z.string().min(1))
    .min(1)
    .describe('Array of source PubMed IDs to find related articles for.'),
  link_type: z
    .enum(LINK_TYPES)
    .default('similar_articles')
    .describe(
      'Type of link to follow:\n' +
        '  similar_articles           — computationally similar PubMed articles (default)\n' +
        '  citing_pmc_articles        — PMC articles that cite the source article\n' +
        '  linked_gene_records        — linked NCBI Gene records\n' +
        '  linked_refseq_proteins     — linked RefSeq protein records\n' +
        '  linked_refseq_nucleotides  — linked RefSeq nucleotide records'
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
  link_type?: FindRelatedLinkType;
  max_results?: number;
};

// Mapping from tool link_type values to NCBI elink linkname values
const LINK_TYPE_MAP: Record<FindRelatedLinkType, string> = {
  similar_articles: 'pubmed_pubmed',
  citing_pmc_articles: 'pubmed_pmc_refs',
  linked_gene_records: 'pubmed_gene',
  linked_refseq_proteins: 'pubmed_protein_refseq',
  linked_refseq_nucleotides: 'pubmed_nuccore_refseq',
};

export async function findRelatedArticles(
  params: FindRelatedArticlesParams,
  client: NcbiClient
): Promise<FindRelatedArticlesResponse> {
  const linkname = LINK_TYPE_MAP[params.link_type ?? 'similar_articles'];

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
