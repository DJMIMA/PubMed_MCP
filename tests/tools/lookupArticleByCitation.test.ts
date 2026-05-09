/**
 * Unit tests for the lookup_article_by_citation tool handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NcbiClient } from '../../src/pubmed/client.js';
import { lookupArticleByCitation } from '../../src/tools/lookupArticleByCitation.js';

const mockEcitmatch = vi.fn();

const mockClient = {
  ecitmatch: mockEcitmatch,
} as unknown as NcbiClient;

describe('lookupArticleByCitation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a PMID matched by ECitMatch and preserves the caller key', async () => {
    mockEcitmatch.mockResolvedValue(
      'N Engl J Med|2019|380|45|Schuster|ref1|30501490'
    );

    const result = await lookupArticleByCitation(
      {
        citations: [
          {
            author: 'Schuster',
            first_page: '45',
            journal: 'N Engl J Med',
            key: 'ref1',
            volume: '380',
            year: 2019,
          },
        ],
      },
      mockClient
    );

    expect(mockEcitmatch).toHaveBeenCalledWith([
      {
        author: 'Schuster',
        first_page: '45',
        journal: 'N Engl J Med',
        key: 'ref1',
        volume: '380',
        year: 2019,
      },
    ]);
    expect(result.citations).toEqual([
      {
        journal: 'N Engl J Med',
        year: '2019',
        volume: '380',
        first_page: '45',
        author: 'Schuster',
        pmid: '30501490',
        key: 'ref1',
      },
    ]);
  });

  it('keeps the caller key when ECitMatch reports NOT_FOUND', async () => {
    mockEcitmatch.mockResolvedValue(
      'N Engl J Med|2019|380|45|Schuster|ref1|NOT_FOUND'
    );

    const result = await lookupArticleByCitation(
      {
        citations: [
          {
            author: 'Schuster',
            first_page: '45',
            journal: 'N Engl J Med',
            key: 'ref1',
            volume: '380',
            year: 2019,
          },
        ],
      },
      mockClient
    );

    expect(result.citations[0]).toMatchObject({
      pmid: '',
      key: 'ref1',
    });
  });

  it('rejects accidental HTML before creating bogus citation rows', async () => {
    mockEcitmatch.mockResolvedValue(
      '<html><title>Batch Citation Matcher - PubMed</title></html>'
    );

    await expect(
      lookupArticleByCitation(
        {
          citations: [
            {
              author: 'Schuster',
              first_page: '45',
              journal: 'N Engl J Med',
              key: 'ref1',
              volume: '380',
              year: 2019,
            },
          ],
        },
        mockClient
      )
    ).rejects.toThrow('ECitMatch returned HTML');
  });
});
