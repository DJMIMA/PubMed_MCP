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

    it('keeps "|" and line breaks inside a field from splitting the citation', async () => {
      mockedAxios.get = vi.fn().mockResolvedValue({
        data: '',
        headers: { 'content-type': 'text/plain' },
        status: 200,
      });

      await client.ecitmatch([
        {
          journal: 'J|Med\r\nX',
          year: 2020,
          volume: '1',
          first_page: '2',
          author: 'Smith|1999',
          key: 'k\r1',
        },
      ]);

      const call = (mockedAxios.get as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1].params.bdata).toBe('J Med X|2020|1|2|Smith 1999|k 1|');
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
          email: 'pubmed-mcp.github.ointment121@simplelogin.com',
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

  describe('tool and email', () => {
    it('sends the registered tool name and developer email to E-utilities', async () => {
      mockedAxios.get = vi.fn().mockResolvedValue({ data: '<xml/>' });

      await client.efetch({ db: 'pubmed', id: '1' });

      const callParams = mockedAxios.get.mock.calls[0][1].params;
      expect(callParams.tool).toBe('pubmed-mcp');
      expect(callParams.email).toBe('pubmed-mcp.github.ointment121@simplelogin.com');
    });

    it('sends the same tool and email to the PMC ID Converter', async () => {
      mockedAxios.get = vi.fn().mockResolvedValue({
        data: { status: 'ok', request: { echo: '' }, records: [] },
      });

      await client.idConvert({ ids: ['1'] });

      const callParams = mockedAxios.get.mock.calls[0][1].params;
      expect(callParams.tool).toBe('pubmed-mcp');
      expect(callParams.email).toBe('pubmed-mcp.github.ointment121@simplelogin.com');
      expect(callParams.api_key).toBe('test-api-key');
    });
  });

  describe('https agent', () => {
    it('sends every request through a keep-alive agent that offers ALPN http/1.1', async () => {
      mockedAxios.get = vi.fn().mockResolvedValue({ data: { linksets: [] } });

      await client.elink({ dbfrom: 'pubmed', id: ['1'], linkname: 'pubmed_pubmed' });
      await client.efetch({ db: 'pmc', id: '1' });

      for (const call of (mockedAxios.get as ReturnType<typeof vi.fn>).mock.calls) {
        const agent = call[1].httpsAgent;
        expect(agent.options.ALPNProtocols).toEqual(['http/1.1']);
        expect(agent.keepAlive).toBe(true);
      }
    });
  });

  // ── timeouts, redirects, and API key redaction ────────────────────────────

  describe('request safety', () => {
    const citation = {
      journal: 'Nature',
      year: 2021,
      volume: '596',
      first_page: '583',
      author: 'Jumper',
      key: '1',
    };

    it('sets a timeout and a redirect guard on every request', async () => {
      mockedAxios.get = vi
        .fn()
        .mockResolvedValueOnce({ data: { esearchresult: { idlist: [] } } })
        .mockResolvedValueOnce({ data: '<xml/>' })
        .mockResolvedValueOnce({ data: { linksets: [] } })
        .mockResolvedValueOnce({ data: '', headers: {} })
        .mockResolvedValueOnce({ data: { request: { echo: '' }, records: [] } });

      await client.esearch({ term: 'x' });
      await client.efetch({ db: 'pubmed', id: '1' });
      await client.elink({ dbfrom: 'pubmed', id: ['1'], linkname: 'pubmed_pubmed' });
      await client.ecitmatch([citation]);
      await client.idConvert({ ids: ['1'] });

      const calls = (mockedAxios.get as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(5);
      for (const call of calls) {
        expect(call[1].timeout).toBe(60_000);
        expect(call[1].beforeRedirect).toBeTypeOf('function');
      }
    });

    it('follows redirects only to NCBI over HTTPS', async () => {
      mockedAxios.get = vi.fn().mockResolvedValue({ data: '<xml/>' });
      await client.efetch({ db: 'pmc', id: '1' });
      const guard = (mockedAxios.get as ReturnType<typeof vi.fn>).mock.calls[0][1]
        .beforeRedirect as (options: Record<string, unknown>) => void;

      // The ID Converter's real redirect.
      expect(() =>
        guard({ href: 'https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/?ids=1&api_key=k' })
      ).not.toThrow();

      for (const href of [
        'http://pmc.ncbi.nlm.nih.gov/?api_key=k',
        'https://example.com/?api_key=k',
        'https://ncbi.nlm.nih.gov.example.com/?api_key=k',
        'https://evilncbi.nlm.nih.gov/?api_key=k',
      ]) {
        expect(() => guard({ href })).toThrow(/^refused redirect to https?:\/\/[^?]+$/);
      }
    });

    it('redacts the API key from network errors and drops the axios error', async () => {
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);
      mockedAxios.get = vi.fn().mockRejectedValue(
        Object.assign(new Error('socket hang up for /esearch.fcgi?api_key=test-api-key'), {
          isAxiosError: true,
          config: { params: { api_key: 'test-api-key' } },
        })
      );

      const error = await client.esearch({ term: 'x' }).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(NcbiNetworkError);
      expect((error as Error).message).not.toContain('test-api-key');
      expect((error as NcbiNetworkError).cause).toBeUndefined();
    });

    it('redacts the API key wherever an error body echoes it', async () => {
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);
      mockedAxios.get = vi.fn().mockRejectedValue(
        Object.assign(new Error('Request failed with status code 502'), {
          isAxiosError: true,
          response: {
            status: 502,
            data: '<a href="/efetch.fcgi?db=pmc&amp;api_key=test-api-key&amp;id=1">Retry</a>',
          },
        })
      );

      const error = await client.efetch({ db: 'pmc', id: '1' }).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(NcbiApiError);
      expect((error as Error).message).toContain('api_key=<redacted>');
      expect((error as Error).message).not.toContain('test-api-key');
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
});
