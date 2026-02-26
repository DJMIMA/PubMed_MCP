/**
 * Tool: get_copyright_status
 *
 * Check copyright and open-access status for PubMed articles.
 * Uses the PMC Open Access Service and NCBI ID Converter to determine
 * whether full text is available and under what license.
 *
 * Note: This tool can only report OA status for articles indexed in PMC.
 * For PubMed-only articles (no PMC record), has_full_text will be false.
 */

import { z } from 'zod';
import type { NcbiClient } from '../pubmed/client.js';
import type { GetCopyrightStatusResponse, CopyrightStatus } from '../pubmed/types.js';
import { parsePmcOaXml } from '../utils/xml.js';

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
      pmidToPmcid.set(pmid, record.pmcid);
    }
  }

  // Step 2: For each PMID that has a PMCID, query the OA service
  const statuses: CopyrightStatus[] = await Promise.all(
    params.pmids.map(async (pmid): Promise<CopyrightStatus> => {
      const pmcid = pmidToPmcid.get(pmid);

      if (!pmcid) {
        return {
          pmid,
          has_full_text: false,
        };
      }

      try {
        const oaXml = await client.oaFetch(pmcid);
        const oaResult = parsePmcOaXml(oaXml, pmcid);
        return {
          pmid,
          pmcid,
          has_full_text: true,
          ...(oaResult.license ? { license: oaResult.license } : {}),
          is_open_access: oaResult.isOpenAccess,
        };
      } catch {
        // PMC record exists but OA service failed — article is in PMC but
        // may not be open access
        return {
          pmid,
          pmcid,
          has_full_text: true,
          is_open_access: false,
        };
      }
    })
  );

  return {
    statuses,
    count: statuses.length,
  };
}
