/**
 * Unit tests for the get_copyright_status tool handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NcbiClient } from '../../src/pubmed/client.js';
import { getCopyrightStatus } from '../../src/tools/getCopyrightStatus.js';

const mockIdConvert = vi.fn();
const mockEfetch = vi.fn();
const mockClient = {
  idConvert: mockIdConvert,
  efetch: mockEfetch,
} as unknown as NcbiClient;

function customMeta(openAccess: 'yes' | 'no', license?: string): string {
  return `
    <custom-meta-group>
      <custom-meta><meta-name>pmc-prop-open-access</meta-name><meta-value>${openAccess}</meta-value></custom-meta>
      ${license ? `<custom-meta><meta-name>pmc-license-ref</meta-name><meta-value>${license}</meta-value></custom-meta>` : ''}
    </custom-meta-group>`;
}

/** Shape of an EFetch (db=pmc) record the publisher allows in full. */
function openArticle(pmcid: string, license: string): string {
  return `
    <article>
      <front><article-meta>
        <article-id pub-id-type="pmcid">${pmcid}</article-id>
        <permissions><copyright-statement>© 2023 The Authors</copyright-statement></permissions>
        ${customMeta('yes', license)}
      </article-meta></front>
      <body><sec><title>Introduction</title><p>Body text.</p></sec></body>
    </article>`;
}

/** Shape of an EFetch (db=pmc) record whose publisher blocks XML full text. */
function restrictedArticle(pmcid: string): string {
  return `
    <article>
      <!--The publisher of this article does not allow downloading of the full text in XML form.-->
      <front><article-meta>
        <article-id pub-id-type="pmcid">${pmcid}</article-id>
        ${customMeta('no')}
      </article-meta></front>
    </article>`;
}

function articleSet(...articles: string[]): string {
  return `<?xml version="1.0"?><pmc-articleset>${articles.join('')}</pmc-articleset>`;
}

describe('getCopyrightStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports access status from one PMC EFetch, in input order', async () => {
    mockIdConvert.mockResolvedValue({
      status: 'ok',
      records: [
        { pmid: 111, pmcid: 'PMC111', 'requested-id': '111' },
        { pmid: '222', pmcid: 'PMC222', 'requested-id': '222' },
        { 'requested-id': '333', errmsg: 'Record not found' },
      ],
    });
    mockEfetch.mockResolvedValue(
      articleSet(restrictedArticle('PMC222'), openArticle('PMC111', 'CC BY-NC-ND'))
    );

    const result = await getCopyrightStatus({ pmids: ['111', '222', '333'] }, mockClient);

    expect(mockIdConvert).toHaveBeenCalledWith({
      ids: ['111', '222', '333'],
      idtype: 'pmid',
    });
    expect(mockEfetch).toHaveBeenCalledTimes(1);
    expect(mockEfetch).toHaveBeenCalledWith({ db: 'pmc', id: ['111', '222'], retmode: 'xml' });
    expect(result).toEqual({
      statuses: [
        {
          pmid: '111',
          pmcid: 'PMC111',
          has_full_text: true,
          license: 'CC BY-NC-ND',
          copyright_statement: '© 2023 The Authors',
          is_open_access: true,
        },
        {
          pmid: '222',
          pmcid: 'PMC222',
          has_full_text: false,
          is_open_access: false,
        },
        {
          pmid: '333',
          has_full_text: false,
        },
      ],
      count: 3,
    });
  });

  it('marks a PMC article missing from the EFetch response as having no full text', async () => {
    mockIdConvert.mockResolvedValue({
      status: 'ok',
      records: [{ pmid: '111', pmcid: 'PMC111', 'requested-id': '111' }],
    });
    mockEfetch.mockResolvedValue(articleSet());

    const result = await getCopyrightStatus({ pmids: ['111'] }, mockClient);

    expect(result.statuses).toEqual([{ pmid: '111', pmcid: 'PMC111', has_full_text: false }]);
  });

  it('skips EFetch entirely when no PMID is in PMC', async () => {
    mockIdConvert.mockResolvedValue({
      status: 'ok',
      records: [{ 'requested-id': '111', errmsg: 'Record not found' }],
    });

    const result = await getCopyrightStatus({ pmids: ['111'] }, mockClient);

    expect(mockEfetch).not.toHaveBeenCalled();
    expect(result.statuses).toEqual([{ pmid: '111', has_full_text: false }]);
  });

  it('fetches in sequential batches of 20 PMCIDs', async () => {
    const pmids = Array.from({ length: 25 }, (_, i) => String(i + 1));
    mockIdConvert.mockResolvedValue({
      status: 'ok',
      records: pmids.map((p) => ({ pmid: p, pmcid: `PMC${p}`, 'requested-id': p })),
    });
    let inFlight = 0;
    let maxInFlight = 0;
    mockEfetch.mockImplementation(async ({ id }: { id: string[] }) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return articleSet(...id.map((n) => openArticle(`PMC${n}`, 'CC BY')));
    });

    const result = await getCopyrightStatus({ pmids }, mockClient);

    expect(mockEfetch.mock.calls.map(([arg]) => arg.id.length)).toEqual([20, 5]);
    expect(maxInFlight).toBe(1);
    expect(result.statuses.every((s) => s.has_full_text && s.is_open_access)).toBe(true);
  });

  it('propagates EFetch failures instead of guessing a status', async () => {
    mockIdConvert.mockResolvedValue({
      status: 'ok',
      records: [{ pmid: '111', pmcid: 'PMC111', 'requested-id': '111' }],
    });
    mockEfetch.mockRejectedValue(new Error('NCBI efetch returned HTTP 500'));

    await expect(getCopyrightStatus({ pmids: ['111'] }, mockClient)).rejects.toThrow(
      'HTTP 500'
    );
  });
});
