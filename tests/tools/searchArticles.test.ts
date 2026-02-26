/**
 * Unit tests for the search_articles tool handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NcbiClient } from '../../src/pubmed/client.js';
import { searchArticles } from '../../src/tools/searchArticles.js';

const mockEsearch = vi.fn();

const mockClient = {
  esearch: mockEsearch,
} as unknown as NcbiClient;

describe('searchArticles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns expected fields from a successful search', async () => {
    mockEsearch.mockResolvedValue({
      count: '117',
      retmax: '20',
      retstart: '0',
      idlist: ['41372162', '41161891'],
      translationset: [],
      querytranslation: '"gamma delta T cell"[All Fields] AND "CAR-T"[All Fields]',
    });

    const result = await searchArticles(
      { query: 'gamma delta T cell CAR-T therapy', max_results: 2 },
      mockClient
    );

    expect(result.pmids).toEqual(['41372162', '41161891']);
    expect(result.total_count).toBe(117);
    expect(result.returned_count).toBe(2);
    expect(result.query).toBe('gamma delta T cell CAR-T therapy');
    expect(result.query_translation).toContain('gamma delta T cell');
    expect(result.has_more).toBe(true);
  });

  it('sets has_more to false when all results are returned', async () => {
    mockEsearch.mockResolvedValue({
      count: '2',
      retmax: '20',
      retstart: '0',
      idlist: ['111', '222'],
      translationset: [],
      querytranslation: 'test',
    });

    const result = await searchArticles({ query: 'test' }, mockClient);
    expect(result.has_more).toBe(false);
  });

  it('maps sort parameter values to NCBI API values', async () => {
    mockEsearch.mockResolvedValue({
      count: '0',
      retmax: '20',
      retstart: '0',
      idlist: [],
      translationset: [],
      querytranslation: '',
    });

    await searchArticles(
      { query: 'test', sort: 'author' },
      mockClient
    );

    expect(mockEsearch).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'Author' })
    );
  });

  it('passes date_from and date_to as mindate/maxdate', async () => {
    mockEsearch.mockResolvedValue({
      count: '5',
      retmax: '20',
      retstart: '0',
      idlist: ['123'],
      translationset: [],
      querytranslation: 'test',
    });

    await searchArticles(
      { query: 'test', date_from: '2020/01/01', date_to: '2023/12/31', datetype: 'pdat' },
      mockClient
    );

    expect(mockEsearch).toHaveBeenCalledWith(
      expect.objectContaining({
        mindate: '2020/01/01',
        maxdate: '2023/12/31',
        datetype: 'pdat',
      })
    );
  });

  it('handles pagination via retstart', async () => {
    mockEsearch.mockResolvedValue({
      count: '50',
      retmax: '10',
      retstart: '20',
      idlist: Array.from({ length: 10 }, (_, i) => String(i + 100)),
      translationset: [],
      querytranslation: 'test',
    });

    const result = await searchArticles(
      { query: 'test', max_results: 10, retstart: 20 },
      mockClient
    );

    expect(result.returned_count).toBe(10);
    expect(result.has_more).toBe(true); // 20 + 10 = 30 < 50
  });
});
