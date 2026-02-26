/**
 * Unit tests for NcbiClient.
 * All HTTP calls are mocked — no real network requests are made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { NcbiClient, NcbiApiError, NcbiNetworkError } from '../../src/pubmed/client.js';

vi.mock('axios');

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  isAxiosError: ReturnType<typeof vi.fn>;
};

describe('NcbiClient', () => {
  let client: NcbiClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new NcbiClient('test-api-key');
    mockedAxios.get = vi.fn();
    mockedAxios.isAxiosError = vi.fn();
  });

  // ── esearch ───────────────────────────────────────────────────────────────

  describe('esearch', () => {
    it('returns the esearchresult from the NCBI JSON response', async () => {
      const mockData = {
        esearchresult: {
          count: '42',
          retmax: '20',
          retstart: '0',
          idlist: ['12345', '67890'],
          translationset: [],
          querytranslation: '"CRISPR"[All Fields]',
        },
      };
      mockedAxios.get = vi.fn().mockResolvedValue({ data: mockData });

      const result = await client.esearch({ term: 'CRISPR' });

      expect(result.count).toBe('42');
      expect(result.idlist).toEqual(['12345', '67890']);
      expect(result.querytranslation).toBe('"CRISPR"[All Fields]');

      const callParams = (mockedAxios.get as ReturnType<typeof vi.fn>).mock.calls[0][1].params;
      expect(callParams.db).toBe('pubmed');
      expect(callParams.retmode).toBe('json');
      expect(callParams.term).toBe('CRISPR');
      expect(callParams.api_key).toBe('test-api-key');
    });

    it('passes sort and date parameters correctly', async () => {
      const mockData = {
        esearchresult: {
          count: '5',
          retmax: '10',
          retstart: '0',
          idlist: ['11111'],
          translationset: [],
          querytranslation: 'test',
        },
      };
      mockedAxios.get = vi.fn().mockResolvedValue({ data: mockData });

      await client.esearch({
        term: 'test',
        sort: 'pub_date',
        mindate: '2020/01/01',
        maxdate: '2023/12/31',
        datetype: 'pdat',
      });

      const callParams = (mockedAxios.get as ReturnType<typeof vi.fn>).mock.calls[0][1].params;
      expect(callParams.sort).toBe('pub_date');
      expect(callParams.mindate).toBe('2020/01/01');
      expect(callParams.maxdate).toBe('2023/12/31');
      expect(callParams.datetype).toBe('pdat');
    });

    it('throws NcbiApiError on HTTP error', async () => {
      const axiosError = Object.assign(new Error('Not Found'), {
        isAxiosError: true,
        response: { status: 404, data: 'Not Found' },
      });
      mockedAxios.get = vi.fn().mockRejectedValue(axiosError);
      mockedAxios.isAxiosError = vi.fn().mockReturnValue(true);

      // Patch axios.isAxiosError to use our mock
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(client.esearch({ term: 'test' })).rejects.toThrow(NcbiApiError);
    });
  });

  // ── efetch ────────────────────────────────────────────────────────────────

  describe('efetch', () => {
    it('joins multiple IDs with commas', async () => {
      mockedAxios.get = vi.fn().mockResolvedValue({ data: '<xml/>' });

      await client.efetch({ db: 'pubmed', id: ['111', '222', '333'] });

      const callParams = (mockedAxios.get as ReturnType<typeof vi.fn>).mock.calls[0][1].params;
      expect(callParams.id).toBe('111,222,333');
    });

    it('returns raw XML text', async () => {
      const xmlText = '<PubmedArticleSet><PubmedArticle/></PubmedArticleSet>';
      mockedAxios.get = vi.fn().mockResolvedValue({ data: xmlText });

      const result = await client.efetch({ db: 'pubmed', id: '99999' });
      expect(result).toBe(xmlText);
    });
  });

  // ── idConvert ─────────────────────────────────────────────────────────────

  describe('idConvert', () => {
    it('calls the PMC ID converter endpoint with correct params', async () => {
      const mockResponse = {
        status: 'ok',
        'response-date': '2024-01-01 00:00:00',
        request: {
          warnings: [],
          format: 'json',
          idtype: 'pmid',
          ids: ['33526711'],
          email: 'pubmed-mcp@example.com',
          tool: 'pubmed-mcp',
          echo: '',
          versions: 'no',
          showaiid: 'no',
        },
        records: [
          {
            pmid: '33526711',
            pmcid: 'PMC7984072',
            doi: '10.1038/s41586-021-03819-2',
            'requested-id': '33526711',
          },
        ],
      };
      mockedAxios.get = vi.fn().mockResolvedValue({ data: mockResponse });

      const result = await client.idConvert({ ids: ['33526711'], idtype: 'pmid' });

      expect(result.records[0].pmcid).toBe('PMC7984072');
      expect(result.records[0].doi).toBe('10.1038/s41586-021-03819-2');
    });
  });
});
