/**
 * Unit tests for the get_copyright_status tool handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NcbiClient } from '../../src/pubmed/client.js';
import { getCopyrightStatus } from '../../src/tools/getCopyrightStatus.js';

const mockIdConvert = vi.fn();
const mockOaFetch = vi.fn();
const mockClient = {
  idConvert: mockIdConvert,
  oaFetch: mockOaFetch,
} as unknown as NcbiClient;

function oaXml(pmcid: string, license: string): string {
  return `
    <OA>
      <records>
        <record id="${pmcid}" license="${license}">
          <links>
            <link format="tgz" href="ftp://example.test/${pmcid}.tar.gz"/>
          </links>
        </record>
      </records>
    </OA>
  `;
}

describe('getCopyrightStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns copyright status for multiple PMIDs in input order', async () => {
    mockIdConvert.mockResolvedValue({
      status: 'ok',
      records: [
        { pmid: 111, pmcid: 'PMC111', 'requested-id': '111' },
        { pmid: '222', pmcid: 'PMC222', 'requested-id': '222' },
        { 'requested-id': '333', errmsg: 'Record not found' },
      ],
    });
    mockOaFetch.mockResolvedValueOnce(oaXml('PMC111', 'CC BY'));
    mockOaFetch.mockResolvedValueOnce(oaXml('PMC222', 'CC BY-NC'));

    const result = await getCopyrightStatus({ pmids: ['111', '222', '333'] }, mockClient);

    expect(mockIdConvert).toHaveBeenCalledWith({
      ids: ['111', '222', '333'],
      idtype: 'pmid',
    });
    expect(mockOaFetch).toHaveBeenCalledTimes(2);
    expect(mockOaFetch).toHaveBeenNthCalledWith(1, 'PMC111');
    expect(mockOaFetch).toHaveBeenNthCalledWith(2, 'PMC222');
    expect(result).toEqual({
      statuses: [
        {
          pmid: '111',
          pmcid: 'PMC111',
          has_full_text: true,
          license: 'CC BY',
          is_open_access: true,
        },
        {
          pmid: '222',
          pmcid: 'PMC222',
          has_full_text: true,
          license: 'CC BY-NC',
          is_open_access: true,
        },
        {
          pmid: '333',
          has_full_text: false,
        },
      ],
      count: 3,
    });
  });

  it('fetches OA records sequentially for batched PMIDs', async () => {
    const inFlight: string[] = [];
    const maxConcurrent: number[] = [];

    mockIdConvert.mockResolvedValue({
      status: 'ok',
      records: [
        { pmid: '111', pmcid: 'PMC111', 'requested-id': '111' },
        { pmid: '222', pmcid: 'PMC222', 'requested-id': '222' },
      ],
    });
    mockOaFetch.mockImplementation(async (pmcid: string) => {
      inFlight.push(pmcid);
      maxConcurrent.push(inFlight.length);
      await Promise.resolve();
      inFlight.pop();
      return oaXml(pmcid, 'CC BY');
    });

    await getCopyrightStatus({ pmids: ['111', '222'] }, mockClient);

    expect(Math.max(...maxConcurrent)).toBe(1);
  });
});
