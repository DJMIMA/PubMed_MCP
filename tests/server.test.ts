/**
 * Unit tests for createServer.
 * Tools are called through an in-memory MCP client, and the NCBI client is a
 * mock, so no network requests are made.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { NcbiClient } from '../src/pubmed/client.js';
import { createServer } from '../src/server.js';

describe('createServer', () => {
  it('reports the package.json version in serverInfo', async () => {
    const { version } = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as { version: string };

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer({} as NcbiClient).connect(serverTransport);
    const mcpClient = new Client({ name: 'test-client', version: '1.0.0' });
    await mcpClient.connect(clientTransport);
    const serverInfo = mcpClient.getServerVersion();
    await mcpClient.close();

    expect(serverInfo).toEqual({ name: 'pubmed', version });
  });

  // HTTP mode relies on this: every per-request server shares one client.
  it('sends NCBI requests through the injected client', async () => {
    const mockEsearch = vi.fn().mockResolvedValue({
      count: '1',
      retmax: '20',
      retstart: '0',
      idlist: ['12345'],
      translationset: [],
      querytranslation: 'CRISPR[All Fields]',
    });
    const ncbiClient = { esearch: mockEsearch } as unknown as NcbiClient;

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer(ncbiClient).connect(serverTransport);
    const mcpClient = new Client({ name: 'test-client', version: '1.0.0' });
    await mcpClient.connect(clientTransport);

    const result = await mcpClient.callTool({
      name: 'search_articles',
      arguments: { query: 'CRISPR' },
    });
    await mcpClient.close();

    expect(mockEsearch).toHaveBeenCalledWith(expect.objectContaining({ term: 'CRISPR' }));
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringContaining('"pmids":["12345"]') },
    ]);
  });

  // NCBI splits IDs on commas, so a value such as "1,2" would carry extra IDs
  // past each tool's per-request limit.
  it.each([
    ['get_article_metadata', { pmids: ['1,2'] }],
    ['find_related_articles', { pmids: ['1,2'] }],
    ['find_related_articles', { pmids: Array.from({ length: 201 }, (_, i) => String(i + 1)) }],
    ['get_copyright_status', { pmids: ['1 2'] }],
    ['get_full_text_article', { pmc_ids: ['PMC1,PMC2'] }],
    ['convert_article_ids', { ids: ['10.1000/a,10.1000/b'] }],
  ])('rejects %s arguments that exceed the ID limit, without calling NCBI', async (name, args) => {
    const ncbiClient = { efetch: vi.fn(), elink: vi.fn(), idConvert: vi.fn() };

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer(ncbiClient as unknown as NcbiClient).connect(serverTransport);
    const mcpClient = new Client({ name: 'test-client', version: '1.0.0' });
    await mcpClient.connect(clientTransport);

    const result = await mcpClient.callTool({ name, arguments: args });
    await mcpClient.close();

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/validation/i);
    for (const method of Object.values(ncbiClient)) expect(method).not.toHaveBeenCalled();
  });

  it.each([
    ['get_article_metadata', { pmids: ['33526711'] }],
    ['get_full_text_article', { pmc_ids: ['PMC7984072', '7984072'] }],
    ['convert_article_ids', { ids: ['10.1038/s41586-021-03819-2'], id_type: 'doi' }],
  ])('accepts well-formed IDs for %s', async (name, args) => {
    const ncbiClient = {
      efetch: vi.fn().mockResolvedValue('<PubmedArticleSet/>'),
      idConvert: vi.fn().mockResolvedValue({ request: {}, records: [] }),
    };

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer(ncbiClient as unknown as NcbiClient).connect(serverTransport);
    const mcpClient = new Client({ name: 'test-client', version: '1.0.0' });
    await mcpClient.connect(clientTransport);

    const result = await mcpClient.callTool({ name, arguments: args });
    await mcpClient.close();

    expect(result.isError).toBeFalsy();
  });
});
