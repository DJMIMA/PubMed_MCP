/**
 * NCBI E-utilities HTTP client.
 * Handles rate limiting, API key injection, and request construction.
 *
 * Base URL: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/
 * Rate limits:
 *   - Without API key: 3 requests/sec
 *   - With API key:   10 requests/sec
 * NCBI counts requests by arrival time, so we send at 8 req/s with a key to
 * absorb network jitter, and retry briefly on HTTP 429.
 */

import https from 'node:https';
import axios from 'axios';

const NCBI_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
const PMC_ID_CONVERTER_URL = 'https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/';
const PMC_OA_URL = 'https://www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi';

/**
 * Shared agent for every NCBI request.
 * - ALPN: pmc.ncbi.nlm.nih.gov answers 403 to Node's default TLS handshake,
 *   which advertises no ALPN protocol; offering http/1.1 is accepted.
 * - keepAlive: reuse TLS connections across calls instead of re-handshaking.
 */
const HTTPS_AGENT = new https.Agent({
  ALPNProtocols: ['http/1.1'],
  keepAlive: true,
});

const TOOL_NAME = 'pubmed-mcp';
const TOOL_EMAIL = 'pubmed-mcp@example.com';

// ─── Rate limiter ────────────────────────────────────────────────────────────

class RateLimiter {
  private nextSlot = 0;
  private readonly minInterval: number; // ms

  constructor(requestsPerSecond: number) {
    this.minInterval = 1000 / requestsPerSecond;
  }

  /**
   * Reserve the next send slot synchronously, then wait for it.
   * Reserving before awaiting keeps concurrent callers spaced out instead of
   * letting them all read the same timestamp and fire together.
   */
  async throttle(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.minInterval;
    if (slot > now) {
      await sleep(slot - now);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Retries after an HTTP 429 before giving up. */
const MAX_RATE_LIMIT_RETRIES = 2;
/** Backoff per retry when NCBI sends no usable Retry-After header. */
const RATE_LIMIT_BACKOFF_MS = 1000;

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
    // Trim whitespace/newlines that can sneak in from Secret Manager or .env files.
    const raw = apiKey ?? process.env.NCBI_API_KEY;
    this.apiKey = raw?.trim() || undefined;
    const rps = this.apiKey ? 8 : 3; // 8 req/s (margin below NCBI's 10 req/s limit for arrival jitter)
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
   * Throttle, send, and retry on HTTP 429. Every NCBI call goes through here
   * so each attempt (including retries) takes its own rate-limiter slot.
   */
  private async request<T>(operation: string, send: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.rateLimiter.throttle();
      try {
        return await send();
      } catch (err) {
        if (attempt < MAX_RATE_LIMIT_RETRIES && isRateLimited(err)) {
          await sleep(retryDelayMs(err, attempt));
          continue;
        }
        throw wrapAxiosError(err, operation);
      }
    }
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
    field?: string;
    datetype?: string;
    mindate?: string;
    maxdate?: string;
  }): Promise<EsearchResult> {
    const response = await this.request('esearch', () =>
      axios.get(`${NCBI_BASE_URL}esearch.fcgi`, {
        httpsAgent: HTTPS_AGENT,
        params: {
          ...this.commonParams(),
          db: 'pubmed',
          retmode: 'json',
          retmax: params.retmax ?? 20,
          retstart: params.retstart ?? 0,
          term: params.term,
          ...(params.sort ? { sort: params.sort } : {}),
          ...(params.field ? { field: params.field } : {}),
          ...(params.datetype ? { datetype: params.datetype } : {}),
          ...(params.mindate ? { mindate: params.mindate } : {}),
          ...(params.maxdate ? { maxdate: params.maxdate } : {}),
        },
      })
    );
    return (response.data as { esearchresult: EsearchResult }).esearchresult;
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
    const idStr = Array.isArray(params.id) ? params.id.join(',') : params.id;
    const response = await this.request('efetch', () =>
      axios.get(`${NCBI_BASE_URL}efetch.fcgi`, {
        httpsAgent: HTTPS_AGENT,
        params: {
          ...this.commonParams(),
          db: params.db,
          id: idStr,
          retmode: params.retmode ?? 'xml',
          ...(params.rettype ? { rettype: params.rettype } : {}),
        },
        responseType: 'text',
      })
    );
    return response.data as string;
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
    const response = await this.request('elink', () =>
      axios.get(`${NCBI_BASE_URL}elink.fcgi?${searchParams.toString()}`, {
        httpsAgent: HTTPS_AGENT,
      })
    );
    return response.data as ElinkResponse;
  }

  /**
   * ECitmatch — look up PubMed IDs from structured citation data.
   * Returns raw text with pipe-delimited fields.
   */
  async ecitmatch(citations: CitationInput[]): Promise<string> {
    const bdata = citations
      .map(
        (c) =>
          `${c.journal}|${c.year}|${c.volume}|${c.first_page}|${c.author}|${c.key}|`
      )
      .join('\r');
    const response = await this.request('ecitmatch', () =>
      axios.get(`${NCBI_BASE_URL}ecitmatch.cgi`, {
        httpsAgent: HTTPS_AGENT,
        params: {
          ...this.commonParams(),
          db: 'pubmed',
          retmode: 'xml',
          rettype: 'xml',
          bdata,
        },
        responseType: 'text',
      })
    );
    const contentType = String(response.headers?.['content-type'] ?? '').toLowerCase();
    const text = String(response.data ?? '');
    if (contentType.includes('html') || looksLikeHtml(text)) {
      throw new NcbiApiError(
        'NCBI ecitmatch returned HTML instead of citation match text. ' +
          'Check the ECitMatch endpoint and bdata parameter format.',
        response.status
      );
    }
    return text;
  }

  /**
   * PMC ID Converter — convert between PMID, PMCID, and DOI.
   */
  async idConvert(params: {
    ids: string[];
    idtype?: string;
  }): Promise<IdConvResponse> {
    const response = await this.request('idConvert', () =>
      axios.get(PMC_ID_CONVERTER_URL, {
        httpsAgent: HTTPS_AGENT,
        params: {
          tool: TOOL_NAME,
          email: TOOL_EMAIL,
          ...(this.apiKey ? { api_key: this.apiKey } : {}),
          format: 'json',
          ids: params.ids.join(','),
          idtype: params.idtype ?? 'pmid',
          versions: 'no',
        },
      })
    );
    return sanitizeIdConvResponse(response.data as IdConvResponse);
  }

  /**
   * PMC OA Service — retrieve license/copyright info for a PMC article.
   * Returns raw XML text.
   */
  async oaFetch(pmcid: string): Promise<string> {
    const response = await this.request('oaFetch', () =>
      axios.get(PMC_OA_URL, {
        httpsAgent: HTTPS_AGENT,
        params: { id: pmcid },
        responseType: 'text',
      })
    );
    return response.data as string;
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
  warninglist?: {
    phrasesignored?: string[];
    quotedphrasesnotfound?: string[];
    outputmessages?: string[];
  };
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
  if (err instanceof NcbiApiError || err instanceof NcbiNetworkError) {
    return err;
  }
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    if (status !== undefined) {
      const body = describeResponseBody(err.response?.data);
      const message = redactApiKey(body || err.message);
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

const MAX_ERROR_BODY_LENGTH = 300;

/** Render an error response body (JSON object, string, or buffer) as readable text. */
function describeResponseBody(data: unknown): string {
  if (data === undefined || data === null) return '';
  let text: string;
  if (typeof data === 'string') {
    text = data;
  } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    text = Buffer.from(data as ArrayBuffer).toString('utf8');
  } else {
    try {
      text = JSON.stringify(data);
    } catch {
      text = String(data);
    }
  }
  text = text.trim();
  return text.length > MAX_ERROR_BODY_LENGTH
    ? `${text.slice(0, MAX_ERROR_BODY_LENGTH)}…`
    : text;
}

function isRateLimited(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 429;
}

/** Honor a numeric Retry-After header (seconds, capped); otherwise back off linearly. */
function retryDelayMs(err: unknown, attempt: number): number {
  const fallback = RATE_LIMIT_BACKOFF_MS * (attempt + 1);
  if (!axios.isAxiosError(err)) return fallback;
  const headers = err.response?.headers as Record<string, unknown> | undefined;
  const seconds = Number(headers?.['retry-after']);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 10_000);
  }
  return fallback;
}

function looksLikeHtml(text: string): boolean {
  return /^\s*(?:<!doctype\s+html|<html\b)/i.test(text);
}

function sanitizeIdConvResponse(response: IdConvResponse): IdConvResponse {
  return {
    ...response,
    request: {
      ...response.request,
      echo: redactApiKey(response.request.echo),
    },
    records: response.records.map((record) => ({
      ...record,
      ...(record.pmid !== undefined ? { pmid: String(record.pmid) } : {}),
      ...(record.pmcid !== undefined ? { pmcid: String(record.pmcid) } : {}),
      ...(record.doi !== undefined ? { doi: String(record.doi) } : {}),
      ...(record['requested-id'] !== undefined
        ? { 'requested-id': String(record['requested-id']) }
        : {}),
    })),
  };
}

function redactApiKey(value: string): string {
  // NCBI echoes the key both as a query param and as "api-key" in JSON error bodies.
  return value
    .replace(/(^|[?&])(api_key=)[^&\s]+/gi, '$1$2<redacted>')
    .replace(/("api[-_]key"\s*:\s*")[^"]*/gi, '$1<redacted>');
}
