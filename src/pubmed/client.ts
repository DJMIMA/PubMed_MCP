/**
 * NCBI E-utilities HTTP client.
 * Handles rate limiting, API key injection, and request construction.
 *
 * Base URL: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/
 * Rate limits:
 *   - Without API key: 3 requests/sec
 *   - With API key:   10 requests/sec
 */

import axios from 'axios';

const NCBI_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
const PMC_ID_CONVERTER_URL = 'https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/';
const PMC_OA_URL = 'https://www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi';

const TOOL_NAME = 'pubmed-mcp';
const TOOL_EMAIL = 'pubmed-mcp@example.com';

// ─── Rate limiter ────────────────────────────────────────────────────────────

class RateLimiter {
  private lastRequestTime = 0;
  private readonly minInterval: number; // ms

  constructor(requestsPerSecond: number) {
    this.minInterval = 1000 / requestsPerSecond;
  }

  async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minInterval) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, this.minInterval - elapsed)
      );
    }
    this.lastRequestTime = Date.now();
  }
}

// ─── Error types ─────────────────────────────────────────────────────────────

export class NcbiNetworkError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'NcbiNetworkError';
  }
}

export class NcbiApiError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'NcbiApiError';
  }
}

export class NcbiParseError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'NcbiParseError';
  }
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class NcbiClient {
  private readonly apiKey: string | undefined;
  private readonly rateLimiter: RateLimiter;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.NCBI_API_KEY;
    const rps = this.apiKey ? 9 : 3; // 9 req/s (safety margin below NCBI's 10 req/s limit)
    this.rateLimiter = new RateLimiter(rps);
  }

  private commonParams(): Record<string, string> {
    const params: Record<string, string> = {
      tool: TOOL_NAME,
      email: TOOL_EMAIL,
    };
    if (this.apiKey) {
      params['api_key'] = this.apiKey;
    }
    return params;
  }

  /**
   * ESearch — search PubMed for article IDs.
   * Returns the raw JSON response from NCBI.
   */
  async esearch(params: {
    term: string;
    retmax?: number;
    retstart?: number;
    sort?: string;
    datetype?: string;
    mindate?: string;
    maxdate?: string;
  }): Promise<EsearchResult> {
    await this.rateLimiter.throttle();
    try {
      const response = await axios.get(`${NCBI_BASE_URL}esearch.fcgi`, {
        params: {
          ...this.commonParams(),
          db: 'pubmed',
          retmode: 'json',
          retmax: params.retmax ?? 20,
          retstart: params.retstart ?? 0,
          term: params.term,
          ...(params.sort ? { sort: params.sort } : {}),
          ...(params.datetype ? { datetype: params.datetype } : {}),
          ...(params.mindate ? { mindate: params.mindate } : {}),
          ...(params.maxdate ? { maxdate: params.maxdate } : {}),
        },
      });
      return (response.data as { esearchresult: EsearchResult }).esearchresult;
    } catch (err) {
      throw wrapAxiosError(err, 'esearch');
    }
  }

  /**
   * EFetch — retrieve full records from PubMed or PMC.
   * Returns raw XML text.
   */
  async efetch(params: {
    db: string;
    id: string | string[];
    retmode?: string;
    rettype?: string;
  }): Promise<string> {
    await this.rateLimiter.throttle();
    const idStr = Array.isArray(params.id) ? params.id.join(',') : params.id;
    try {
      const response = await axios.get(`${NCBI_BASE_URL}efetch.fcgi`, {
        params: {
          ...this.commonParams(),
          db: params.db,
          id: idStr,
          retmode: params.retmode ?? 'xml',
          ...(params.rettype ? { rettype: params.rettype } : {}),
        },
        responseType: 'text',
      });
      return response.data as string;
    } catch (err) {
      throw wrapAxiosError(err, 'efetch');
    }
  }

  /**
   * ELink — find related articles or cross-database links.
   * Accepts multiple IDs and returns the raw JSON response.
   */
  async elink(params: {
    dbfrom: string;
    id: string[];
    linkname: string;
    cmd?: string;
  }): Promise<ElinkResponse> {
    await this.rateLimiter.throttle();
    // Build URL manually to allow repeated id= params
    const searchParams = new URLSearchParams({
      ...this.commonParams(),
      dbfrom: params.dbfrom,
      linkname: params.linkname,
      cmd: params.cmd ?? 'neighbor',
      retmode: 'json',
    });
    for (const id of params.id) {
      searchParams.append('id', id);
    }
    try {
      const response = await axios.get(
        `${NCBI_BASE_URL}elink.fcgi?${searchParams.toString()}`
      );
      return response.data as ElinkResponse;
    } catch (err) {
      throw wrapAxiosError(err, 'elink');
    }
  }

  /**
   * ECitmatch — look up PubMed IDs from structured citation data.
   * Returns raw text with pipe-delimited fields.
   */
  async ecitmatch(citations: CitationInput[]): Promise<string> {
    await this.rateLimiter.throttle();
    const bdata = citations
      .map(
        (c) =>
          `${c.journal}|${c.year}|${c.volume}|${c.first_page}|${c.author}|${c.key}|`
      )
      .join('\r');
    try {
      const response = await axios.get(`${NCBI_BASE_URL}ecitmatch.cgi`, {
        params: {
          ...this.commonParams(),
          db: 'pubmed',
          rettype: 'xml',
          bdata,
        },
        responseType: 'text',
      });
      return response.data as string;
    } catch (err) {
      throw wrapAxiosError(err, 'ecitmatch');
    }
  }

  /**
   * PMC ID Converter — convert between PMID, PMCID, and DOI.
   */
  async idConvert(params: {
    ids: string[];
    idtype?: string;
  }): Promise<IdConvResponse> {
    await this.rateLimiter.throttle();
    try {
      const response = await axios.get(PMC_ID_CONVERTER_URL, {
        params: {
          tool: TOOL_NAME,
          email: TOOL_EMAIL,
          ...(this.apiKey ? { api_key: this.apiKey } : {}),
          format: 'json',
          ids: params.ids.join(','),
          idtype: params.idtype ?? 'pmid',
          versions: 'no',
        },
      });
      return response.data as IdConvResponse;
    } catch (err) {
      throw wrapAxiosError(err, 'idConvert');
    }
  }

  /**
   * PMC OA Service — retrieve license/copyright info for a PMC article.
   * Returns raw XML text.
   */
  async oaFetch(pmcid: string): Promise<string> {
    await this.rateLimiter.throttle();
    try {
      const response = await axios.get(PMC_OA_URL, {
        params: { id: pmcid, format: 'xml' },
        responseType: 'text',
      });
      return response.data as string;
    } catch (err) {
      throw wrapAxiosError(err, 'oaFetch');
    }
  }
}

// ─── Internal NCBI response shapes ───────────────────────────────────────────

export interface EsearchResult {
  count: string;
  retmax: string;
  retstart: string;
  idlist: string[];
  translationset: unknown[];
  querytranslation: string;
  errorlist?: { phrasesnotfound?: string[]; fieldsnotfound?: string[] };
  warninglist?: { phrasesignored?: string[]; quotedphrasesnotfound?: string[] };
}

export interface ElinkResponse {
  header?: { type: string; version: string };
  linksets: ElinkLinkset[];
}

export interface ElinkLinkset {
  dbfrom: string;
  ids: string[];
  linksetdbs?: ElinkLinksetDb[];
  idurllist?: unknown[];
}

export interface ElinkLinksetDb {
  dbto: string;
  linkname: string;
  links: Array<{ id: string; score?: string } | string>;
}

export interface CitationInput {
  journal: string;
  year: number;
  volume: string;
  first_page: string;
  author: string;
  key: string;
}

export interface IdConvResponse {
  status: string;
  'response-date': string;
  request: {
    warnings: string[];
    format: string;
    idtype: string;
    ids: string[];
    email: string;
    tool: string;
    echo: string;
    versions: string;
    showaiid: string;
  };
  records: Array<{
    pmid?: string;
    pmcid?: string;
    doi?: string;
    'requested-id': string;
    errmsg?: string;
    [key: string]: string | undefined;
  }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function wrapAxiosError(err: unknown, operation: string): Error {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const message = (err.response?.data as string | undefined) ?? err.message;
    if (status !== undefined) {
      return new NcbiApiError(
        `NCBI ${operation} returned HTTP ${status}: ${message}`,
        status
      );
    }
    return new NcbiNetworkError(
      `Network error during NCBI ${operation}: ${err.message}`,
      err
    );
  }
  if (err instanceof Error) return err;
  return new Error(`Unknown error during NCBI ${operation}`);
}
