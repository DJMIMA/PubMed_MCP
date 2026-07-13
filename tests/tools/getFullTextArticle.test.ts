import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NcbiClient } from '../../src/pubmed/client.js';
import { getFullTextArticle } from '../../src/tools/getFullTextArticle.js';

const mockEfetch = vi.fn();
const mockClient = { efetch: mockEfetch } as unknown as NcbiClient;

const PMC_XML = `<?xml version="1.0"?><pmc-articleset><article><front><article-meta><article-id pub-id-type="pmc">123</article-id><title-group><article-title>Available article</article-title></title-group></article-meta></front><body><sec><title>Results</title><p>Full text is available.</p></sec></body></article><article><front><article-meta><article-id pub-id-type="pmc">456</article-id><title-group><article-title>Unavailable article</article-title></title-group></article-meta></front></article></pmc-articleset>`;

describe('getFullTextArticle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEfetch.mockResolvedValue(PMC_XML);
  });

  it('returns only articles with body text and reports unavailable IDs', async () => {
    const result = await getFullTextArticle(
      { pmc_ids: ['PMC123', 'PMC456', 'PMC999'] },
      mockClient
    );

    expect(mockEfetch).toHaveBeenCalledWith(
      expect.objectContaining({ id: ['123', '456', '999'] })
    );
    expect(result.count).toBe(1);
    expect(result.articles[0].identifiers.pmcid).toBe('PMC123');
    expect(result.errors).toEqual([
      {
        pmcid: 'PMC456',
        error: 'Full text is not available from PMC EFetch for this article.',
      },
      {
        pmcid: 'PMC999',
        error: 'PMC EFetch did not return this article.',
      },
    ]);
  });
});
