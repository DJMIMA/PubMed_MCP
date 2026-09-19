/**
 * Unit tests for NcbiClient.
 * All HTTP calls are mocked — no real network requests are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
          warninglist: {
            phrasesignored: [],
            quotedphrasesnotfound: ['"CRISPR gene therapy"'],
            outputmessages: ['Quoted phrase not found.'],
          },
          errorlist: {
            phrasesnotfound: ['missing phrase'],
            fieldsnotfound: [],
          },
        },
      };
      mockedAxios.get = vi.fn().mockResolvedValue({ data: mockData });

      const result = await client.esearch({ term: 'CRISPR' });

      expect(result.count).toBe('42');
      expect(result.idlist).toEqual(['12345', '67890']);
      expect(result.querytranslation).toBe('"CRISPR"[All Fields]');
      expect(result.warninglist?.quotedphrasesnotfound).toEqual([
        '"CRISPR gene therapy"',
      ]);
      expect(result.warninglist?.outputmessages).toEqual([
        'Quoted phrase not found.',
      ]);
      expect(result.errorlist?.phrasesnotfound).toEqual(['missing phrase']);

      const callParams = (mockedAxios.get as ReturnType<typeof vi.fn>).mock.calls[0][1].params;
      expect(callParams.db).toBe('pubmed');
      expect(callParams.retmode).toBe('json');
      expect(callParams.term).toBe('CRISPR');
      expect(callParams.api_key).toBe('test-api-key');
      expect(callParams.field).toBeUndefined();
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
        field: 'tiab',
        mindate: '2020/01/01',
        maxdate: '2023/12/31',
        datetype: 'pdat',
      });

      const callParams = (mockedAxios.get as ReturnType<typeof vi.fn>).mock.calls[0][1].params;
      expect(callParams.sort).toBe('pub_date');
      expect(callParams.field).toBe('tiab');
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

  // ── ecitmatch ────────────────────────────────────────────────────────────

  describe('ecitmatch', () => {
    it('calls ECitMatch with pipe-delimited bdata and XML mode', async () => {
      mockedAxios.get = vi.fn().mockResolvedValue({
        data: 'N Engl J Med|2019|380|45|Schuster|ref1|30501490',
        headers: { 'content-type': 'text/plain' },
        status: 200,
      });

      const result = await client.ecitmatch([
        {
          journal: 'N Engl J Med',
          year: 2019,
          volume: '380',
          first_page: '45',
          author: 'Schuster',
          key: 'ref1',
        },
      ]);

      expect(result).toContain('30501490');

      const call = (mockedAxios.get as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('ecitmatch.cgi');
      expect(call[1].params).toMatchObject({
        db: 'pubmed',
        retmode: 'xml',
        rettype: 'xml',
        bdata: 'N Engl J Med|2019|380|45|Schuster|ref1|',
      });
      expect(call[1].responseType).toBe('text');
    });

    it('rejects HTML responses instead of passing them to citation parsing', async () => {
      mockedAxios.get = vi.fn().mockResolvedValue({
        data: '<html><title>Batch Citation Matcher - PubMed</title></html>',
        headers: { 'content-type': 'text/html; charset=utf-8' },
        status: 200,
      });

      await expect(
        client.ecitmatch([
          {
            journal: 'N Engl J Med',
            year: 2019,
            volume: '380',
            first_page: '45',
            author: 'Schuster',
            key: 'ref1',
          },
        ])
      ).rejects.toThrow(NcbiApiError);
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
          echo: 'api_key=test-api-key&ids=33526711&format=json',
          versions: 'no',
          showaiid: 'no',
        },
        records: [
          {
            pmid: 33526711,
            pmcid: 'PMC7984072',
            doi: '10.1038/s41586-021-03819-2',
            'requested-id': '33526711',
          },
        ],
      };
      mockedAxios.get = vi.fn().mockResolvedValue({ data: mockResponse });

      const result = await client.idConvert({ ids: ['33526711'], idtype: 'pmid' });

      expect(result.records[0].pmid).toBe('33526711');
      expect(result.records[0].pmcid).toBe('PMC7984072');
      expect(result.records[0].doi).toBe('10.1038/s41586-021-03819-2');
      expect(result.request.echo).toBe('api_key=<redacted>&ids=33526711&format=json');
    });
  });

  // ── HTTPS agent ───────────────────────────────────────────────────────────

  describe('https agent', () => {
    it('sends every request through a keep-alive agent that offers ALPN http/1.1', async () => {
      mockedAxios.get = vi.fn().mockResolvedValue({ data: { linksets: [] } });

      await client.elink({ dbfrom: 'pubmed', id: ['1'], linkname: 'pubmed_pubmed' });
      await client.oaFetch('PMC1');

      for (const call of (mockedAxios.get as ReturnType<typeof vi.fn>).mock.calls) {
        const agent = call[1].httpsAgent;
        expect(agent.options.ALPNProtocols).toEqual(['http/1.1']);
        expect(agent.keepAlive).toBe(true);
      }
    });
  });

  // ── rate limiting & 429 handling ──────────────────────────────────────────

  describe('rate limiting', () => {
    const esearchOk = { data: { esearchresult: { idlist: [] } } };
    const rateLimited = (headers: Record<string, string> = {}) =>
      Object.assign(new Error('Request failed with status code 429'), {
        isAxiosError: true,
        response: {
          status: 429,
          headers,
          data: { error: 'API rate limit exceeded', 'api-key': 'test-api-key', count: '11', limit: '10' },
        },
      });

    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(axios, 'isAxiosError').mockImplementation(
        (e: unknown) => Boolean((e as { isAxiosError?: boolean })?.isAxiosError)
      );
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('spaces concurrent calls at 8 req/s instead of firing them together', async () => {
      const sendTimes: number[] = [];
      mockedAxios.get = vi.fn().mockImplementation(async () => {
        sendTimes.push(Date.now());
        return esearchOk;
      });

      const calls = Array.from({ length: 5 }, () => client.esearch({ term: 'x' }));
      await vi.runAllTimersAsync();
      await Promise.all(calls);

      const gaps = sendTimes.slice(1).map((t, i) => t - sendTimes[i]);
      expect(gaps).toHaveLength(4);
      for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(125);
    });

    it('retries after HTTP 429 and succeeds', async () => {
      mockedAxios.get = vi
        .fn()
        .mockRejectedValueOnce(rateLimited())
        .mockResolvedValueOnce(esearchOk);

      const call = client.esearch({ term: 'x' });
      await vi.runAllTimersAsync();

      await expect(call).resolves.toEqual({ idlist: [] });
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });

    it('gives up after 2 retries with a readable, key-redacted error body', async () => {
      mockedAxios.get = vi.fn().mockRejectedValue(rateLimited({ 'retry-after': '1' }));

      const call = client.esearch({ term: 'x' });
      const assertion = expect(call).rejects.toThrow(
        /HTTP 429: \{"error":"API rate limit exceeded","api-key":"<redacted>"/
      );
      await vi.runAllTimersAsync();
      await assertion;
      expect(mockedAxios.get).toHaveBeenCalledTimes(3);
    });
  });

  // ── oaFetch ───────────────────────────────────────────────────────────────

  describe('oaFetch', () => {
    it('calls the PMC OA endpoint without a format filter', async () => {
      mockedAxios.get = vi.fn().mockResolvedValue({ data: '<OA/>' });

      await client.oaFetch('PMC9321363');

      const call = (mockedAxios.get as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1].params).toEqual({ id: 'PMC9321363' });
      expect(call[1].responseType).toBe('text');
    });
  });
});
