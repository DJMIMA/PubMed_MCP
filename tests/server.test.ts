/**
 * Unit tests for createServer.
 * Tools are called through an in-memory MCP client, and the NCBI client is a
 * mock, so no network requests are made.
 */

import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { NcbiClient } from '../src/pubmed/client.js';
import { createServer } from '../src/server.js';

describe('createServer', () => {
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
});
