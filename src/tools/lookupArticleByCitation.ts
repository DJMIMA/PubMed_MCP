/**
 * Tool: lookup_article_by_citation
 *
 * Look up PubMed IDs for articles given structured citation metadata
 * (journal, year, volume, first page, author). Uses NCBI's ECitmatch endpoint.
 */

import { z } from 'zod';
import type { NcbiClient } from '../pubmed/client.js';
import type { LookupArticleByCitationResponse, CitationResult } from '../pubmed/types.js';

export const lookupArticleByCitationSchema = {
  citations: z
    .array(
      z.object({
        journal: z
          .string()
          .describe(
            'Journal name or abbreviation (e.g., "Nature", "J Immunol", ' +
              '"N Engl J Med"). Spaces should be included as-is.'
          ),
        year: z
          .number()
          .int()
          .min(1800)
          .max(2100)
          .describe('Publication year (e.g., 2023).'),
        volume: z
          .string()
          .default('')
          .optional()
          .describe('Journal volume number (e.g., "204"). Leave empty if unknown.'),
        first_page: z
          .string()
          .default('')
          .optional()
          .describe(
            'First page number of the article (e.g., "1234"). ' +
              'Leave empty if unknown.'
          ),
        author: z
          .string()
          .default('')
          .optional()
          .describe(
            'First author last name (e.g., "Smith"). ' +
              'Leave empty if unknown.'
          ),
        key: z
          .string()
          .describe(
            'Your own identifier for this citation (e.g., "ref1", "paper_A"). ' +
              'Echoed back in the response to correlate results.'
          ),
      })
    )
    .min(1)
    .max(100)
    .describe(
      'Array of citation objects to look up. ' +
        'Provide as much information as available for best match accuracy.'
    ),
};

export type LookupArticleByCitationParams = {
  citations: Array<{
    journal: string;
    year: number;
    volume?: string;
    first_page?: string;
    author?: string;
    key: string;
  }>;
};

/**
 * Parse the plain-text response from ecitmatch.cgi.
 *
 * Format: journal|year|volume|first_page|author|key|PMID_or_NOT_FOUND
 * One line per citation (empty lines ignored).
 */
function parseEcitmatchResponse(
  text: string,
  originalCitations: LookupArticleByCitationParams['citations']
): CitationResult[] {
  if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(text)) {
    throw new Error('ECitMatch returned HTML instead of citation match text');
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  return lines.map((line, idx) => {
    const parts = line.split('|');
    // Fields: [0]journal, [1]year, [2]volume, [3]first_page, [4]author, [5]key, [6]result
    const result = parts.at(-1)?.trim() ?? '';
    const isFound = result !== '' && result !== 'NOT_FOUND' && /^\d+$/.test(result);

    // Use original citation data where available (ecitmatch may alter formatting)
    const original = originalCitations[idx];
    const echoedKey = parts.length >= 7 ? parts[5] : parts[0];

    return {
      journal: original?.journal ?? parts[0] ?? '',
      year: String(original?.year ?? parts[1] ?? ''),
      volume: original?.volume ?? parts[2] ?? '',
      first_page: original?.first_page ?? parts[3] ?? '',
      author: original?.author ?? parts[4] ?? '',
      pmid: isFound ? result : '',
      key: original?.key ?? echoedKey ?? '',
    };
  });
}

export async function lookupArticleByCitation(
  params: LookupArticleByCitationParams,
  client: NcbiClient
): Promise<LookupArticleByCitationResponse> {
  const citations = params.citations.map((c) => ({
    journal: c.journal,
    year: c.year,
    volume: c.volume ?? '',
    first_page: c.first_page ?? '',
    author: c.author ?? '',
    key: c.key,
  }));

  const rawText = await client.ecitmatch(citations);
  const results = parseEcitmatchResponse(rawText, params.citations);

  return { citations: results };
}
