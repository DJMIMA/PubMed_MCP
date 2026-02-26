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
 * Environment variables (set in .env, shell, systemd EnvironmentFile, Docker -e, etc.):
 *   NCBI_API_KEY — NCBI API key; raises rate limit from 3 → 9 req/s
 *                  Register free at https://www.ncbi.nlm.nih.gov/account/
 */

// Load .env file if present. Silently skipped when the file doesn't exist
// (e.g. production servers where env vars are injected by the runtime).
import { config as loadDotenv } from 'dotenv';
loadDotenv();

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
