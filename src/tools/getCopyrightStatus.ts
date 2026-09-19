/**
 * Tool: get_copyright_status
 *
 * Check copyright and open-access status for PubMed articles.
 * Maps PMIDs to PMCIDs with the NCBI ID Converter, then reads PMC's own
 * access metadata from E-utilities EFetch (db=pmc). The PMC OA Web Service
 * previously used here was retired by NCBI on 2026-08-25.
 *
 * has_full_text means get_full_text_article can return text for the article.
 * It is false for PubMed-only articles and for PMC articles whose publisher
 * does not allow full-text XML download.
 */

import { z } from 'zod';
import type { NcbiClient } from '../pubmed/client.js';
import type { GetCopyrightStatusResponse, CopyrightStatus } from '../pubmed/types.js';
import { parsePmcAccessXml, type PmcAccessInfo } from '../utils/xml.js';

export const getCopyrightStatusSchema = {
  pmids: z
    .array(z.string().min(1))
    .min(1)
    .max(50)
    .describe('Array of PubMed IDs (PMIDs) to check copyright status for.'),
};

export type GetCopyrightStatusParams = {
  pmids: string[];
};

/** Open-access articles come back as full JATS XML, so keep each EFetch modest. */
const EFETCH_BATCH_SIZE = 20;

export async function getCopyrightStatus(
  params: GetCopyrightStatusParams,
  client: NcbiClient
): Promise<GetCopyrightStatusResponse> {
  // Step 1: Convert PMIDs to PMCIDs using the ID Converter
  const convResponse = await client.idConvert({
    ids: params.pmids,
    idtype: 'pmid',
  });

  // Build a map: pmid → pmcid (may be undefined if not in PMC)
  const pmidToPmcid = new Map<string, string | undefined>();
  for (const record of convResponse.records) {
    const pmid = record.pmid ?? record['requested-id'];
    if (pmid) {
      pmidToPmcid.set(String(pmid), record.pmcid);
    }
  }

  // Step 2: Fetch PMC records in batches and read their access metadata.
  // Batches run sequentially so large inputs respect NCBI rate limits.
  const pmcids = [
    ...new Set(params.pmids.map((pmid) => pmidToPmcid.get(pmid)).filter(isString)),
  ];
  const accessByPmcid = new Map<string, PmcAccessInfo>();
  for (let i = 0; i < pmcids.length; i += EFETCH_BATCH_SIZE) {
    const batch = pmcids.slice(i, i + EFETCH_BATCH_SIZE);
    const xml = await client.efetch({
      db: 'pmc',
      id: batch.map((pmcid) => pmcid.replace(/^PMC/i, '')),
      retmode: 'xml',
    });
    for (const info of parsePmcAccessXml(xml)) {
      accessByPmcid.set(info.pmcid.toUpperCase(), info);
    }
  }

  const statuses: CopyrightStatus[] = params.pmids.map((pmid) => {
    const pmcid = pmidToPmcid.get(pmid);
    if (!pmcid) {
      return { pmid, has_full_text: false };
    }

    const info = accessByPmcid.get(pmcid.toUpperCase());
    if (!info) {
      // In PMC per the ID Converter, but EFetch returned no record for it.
      return { pmid, pmcid, has_full_text: false };
    }

    return {
      pmid,
      pmcid,
      has_full_text: info.hasFullText,
      ...(info.license ? { license: info.license } : {}),
      ...(info.copyrightStatement ? { copyright_statement: info.copyrightStatement } : {}),
      is_open_access: info.isOpenAccess,
    };
  });

  return {
    statuses,
    count: statuses.length,
  };
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string' && value !== '';
}
