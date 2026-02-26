#!/usr/bin/env node
/**
 * PubMed MCP Server — entrypoint.
 *
 * Connects the MCP server to a stdio transport (the standard transport for
 * Claude Desktop and the Anthropic API MCP connector).
 *
 * Usage:
 *   node dist/index.js          # production
 *   npm run dev                  # development (tsx)
 *
 * Environment:
 *   NCBI_API_KEY — optional, increases rate limits from 3 to 10 req/sec
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  process.stderr.write('PubMed MCP server running on stdio\n');

  // Keep the process alive; the SDK handles cleanup on transport close.
  process.on('SIGINT', () => {
    process.stderr.write('Shutting down PubMed MCP server\n');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    process.stderr.write('Shutting down PubMed MCP server\n');
    process.exit(0);
  });
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${String(err)}\n`);
  process.exit(1);
});
