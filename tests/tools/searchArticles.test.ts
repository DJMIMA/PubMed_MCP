/**
 * Unit tests for the search_articles tool handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NcbiClient } from '../../src/pubmed/client.js';
import { searchArticles, searchArticlesSchema } from '../../src/tools/searchArticles.js';

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
    expect(result.warnings).toEqual({
      phrases_ignored: [],
      quoted_phrases_not_found: [],
      output_messages: [],
    });
    expect(result.errors).toEqual({
      phrases_not_found: [],
      fields_not_found: [],
    });
  });

  it('normalizes ESearch warnings and preserves their values verbatim', async () => {
    mockEsearch.mockResolvedValue({
      count: '0',
      retmax: '0',
      retstart: '0',
      idlist: [],
      translationset: [],
      querytranslation: '"aberrant"[All Fields] AND "salience"[All Fields]',
      warninglist: {
        phrasesignored: ['of'],
        quotedphrasesnotfound: ['"aberrant salience nonexistent phrase xyz"'],
        outputmessages: ['No items found.'],
      },
    });

    const result = await searchArticles(
      { query: '"aberrant salience nonexistent phrase xyz"' },
      mockClient
    );

    expect(result.warnings).toEqual({
      phrases_ignored: ['of'],
      quoted_phrases_not_found: ['"aberrant salience nonexistent phrase xyz"'],
      output_messages: ['No items found.'],
    });
    expect(result.errors).toEqual({
      phrases_not_found: [],
      fields_not_found: [],
    });
  });

  it('normalizes ESearch phrase and field errors', async () => {
    mockEsearch.mockResolvedValue({
      count: '0',
      retmax: '0',
      retstart: '0',
      idlist: [],
      translationset: [],
      querytranslation: 'aberrant salience',
      errorlist: {
        phrasesnotfound: ['aberrant', 'salience'],
        fieldsnotfound: ['unsupported field'],
      },
    });

    const result = await searchArticles({ query: 'aberrant salience' }, mockClient);

    expect(result.errors).toEqual({
      phrases_not_found: ['aberrant', 'salience'],
      fields_not_found: ['unsupported field'],
    });
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

  it('completes a one-sided date range with an open bound (NCBI ignores it otherwise)', async () => {
    mockEsearch.mockResolvedValue({
      count: '0',
      retmax: '20',
      retstart: '0',
      idlist: [],
      translationset: [],
      querytranslation: '',
    });

    await searchArticles({ query: 'test', date_to: '2024' }, mockClient);
    await searchArticles({ query: 'test', date_from: '2020/06' }, mockClient);
    await searchArticles({ query: 'test' }, mockClient);

    expect(mockEsearch.mock.calls[0][0]).toMatchObject({ mindate: '1000', maxdate: '2024' });
    expect(mockEsearch.mock.calls[1][0]).toMatchObject({ mindate: '2020/06', maxdate: '3000' });
    expect(mockEsearch.mock.calls[2][0]).not.toHaveProperty('mindate');
    expect(mockEsearch.mock.calls[2][0]).not.toHaveProperty('maxdate');
  });

  it('passes a supported field only when specified', async () => {
    mockEsearch.mockResolvedValue({
      count: '5',
      retmax: '20',
      retstart: '0',
      idlist: ['123'],
      translationset: [],
      querytranslation: '"dopamine"[Title/Abstract]',
    });

    await searchArticles({ query: 'dopamine', field: 'tiab' }, mockClient);

    expect(mockEsearch).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'tiab' })
    );

    await searchArticles({ query: 'dopamine' }, mockClient);

    expect(mockEsearch.mock.calls[1][0]).not.toHaveProperty('field');
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

  it('defaults date filtering to publication date when datetype is omitted', async () => {
    mockEsearch.mockResolvedValue({
      count: '0',
      retmax: '20',
      retstart: '0',
      idlist: [],
      translationset: [],
      querytranslation: '',
    });

    await searchArticles(
      { query: 'test', date_from: '2024', date_to: '2024' },
      mockClient
    );

    expect(mockEsearch).toHaveBeenCalledWith(
      expect.objectContaining({ datetype: 'pdat' })
    );
  });

  it('rejects the unsupported title sort value', () => {
    expect(searchArticlesSchema.sort.safeParse('title').success).toBe(false);
  });

  it('accepts only the supported PubMed field values', () => {
    for (const field of [
      'title',
      'tiab',
      'mesh',
      'author',
      'journal',
      'affiliation',
    ]) {
      expect(searchArticlesSchema.field.safeParse(field).success).toBe(true);
    }

    expect(searchArticlesSchema.field.safeParse('all').success).toBe(false);
    expect(searchArticlesSchema.field.safeParse('not_a_real_field').success).toBe(false);
  });
});
