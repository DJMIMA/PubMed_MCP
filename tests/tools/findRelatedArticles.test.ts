/**
 * Unit tests for the find_related_articles tool handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NcbiClient } from '../../src/pubmed/client.js';
import { findRelatedArticles } from '../../src/tools/findRelatedArticles.js';

const mockElink = vi.fn();
const mockClient = { elink: mockElink } as unknown as NcbiClient;

const MOCK_ELINK_RESPONSE = {
  header: { type: 'elink', version: '0.3' },
  linksets: [
    {
      dbfrom: 'pubmed',
      ids: ['33526711'],
      linksetdbs: [
        {
          dbto: 'pubmed',
          linkname: 'pubmed_pubmed',
          links: [
            { id: '33526711', score: '73333' },
            { id: '30082870', score: '71000' },
            { id: '25057292', score: '68500' },
          ],
        },
      ],
    },
  ],
};

describe('findRelatedArticles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockElink.mockResolvedValue(MOCK_ELINK_RESPONSE);
  });

  it('transforms link objects to plain PMID strings', async () => {
    const result = await findRelatedArticles({ pmids: ['33526711'] }, mockClient);

    const links = result.linksets[0].linksetdbs[0].links;
    expect(links).toEqual(['33526711', '30082870', '25057292']);
    // All should be strings, not objects
    links.forEach((link) => expect(typeof link).toBe('string'));
  });

  it('preserves linkset structure from NCBI response', async () => {
    const result = await findRelatedArticles({ pmids: ['33526711'] }, mockClient);

    expect(result.linksets[0].dbfrom).toBe('pubmed');
    expect(result.linksets[0].ids).toEqual(['33526711']);
    expect(result.linksets[0].linksetdbs[0].dbto).toBe('pubmed');
    expect(result.linksets[0].linksetdbs[0].linkname).toBe('pubmed_pubmed');
  });

  it('respects max_results cap', async () => {
    const result = await findRelatedArticles(
      { pmids: ['33526711'], max_results: 2 },
      mockClient
    );

    expect(result.linksets[0].linksetdbs[0].links).toHaveLength(2);
  });

  it('uses correct linkname for pubmed_pmc link type', async () => {
    await findRelatedArticles({ pmids: ['33526711'], link_type: 'pubmed_pmc' }, mockClient);

    expect(mockElink).toHaveBeenCalledWith(
      expect.objectContaining({ linkname: 'pubmed_pmc_refs' })
    );
  });

  it('defaults to pubmed_pubmed link type', async () => {
    await findRelatedArticles({ pmids: ['33526711'] }, mockClient);

    expect(mockElink).toHaveBeenCalledWith(
      expect.objectContaining({ linkname: 'pubmed_pubmed' })
    );
  });
});
