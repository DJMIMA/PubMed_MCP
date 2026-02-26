#!/usr/bin/env node
/**
 * PubMed MCP Server — entrypoint.
 *
 * Transport is selected at startup based on environment:
 *
 *   STDIO mode (default):
 *     Used for Claude Desktop and Anthropic API MCP connector.
 *     Start with:  node dist/index.js
 *
 *   HTTP mode (Cloud Run / remote deployment):
 *     Activated when the PORT environment variable is set.
 *     Starts an Express server that handles Streamable HTTP transport at /mcp.
 *     Cloud Run injects PORT=8080 automatically.
 *     Start with:  PORT=8080 node dist/index.js
 *
 * Environment variables:
 *   NCBI_API_KEY — NCBI API key; raises rate limit from 3 → 9 req/s
 *                  Register free at https://www.ncbi.nlm.nih.gov/account/
 *   PORT         — When set, enables HTTP mode on the specified port.
 *   MCP_API_KEY  — Static bearer token for HTTP mode authentication.
 *                  When set, all /mcp requests must include:
 *                    Authorization: Bearer <MCP_API_KEY>
 *                  When unset, authentication is skipped (local dev only).
 */

// Load .env file if present. Silently skipped in production where env vars
// are injected by the runtime (Cloud Run, Docker --env, etc.).
import { config as loadDotenv } from 'dotenv';
loadDotenv();

import { createServer } from './server.js';

async function main(): Promise<void> {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;

  if (port !== undefined) {
    await startHttpServer(port);
  } else {
    await startStdioServer();
  }
}

// ── HTTP mode (Cloud Run) ──────────────────────────────────────────────────

async function startHttpServer(port: number): Promise<void> {
  const { default: express } = await import('express');
  const { timingSafeEqual } = await import('node:crypto');
  const { StreamableHTTPServerTransport } = await import(
    '@modelcontextprotocol/sdk/server/streamableHttp.js'
  );

  const app = express();
  app.use(express.json());

  // ── API key authentication middleware ──────────────────────────────────
  // Protects /mcp with a static bearer token stored in MCP_API_KEY.
  // /health is intentionally left open for Cloud Run readiness probes.
  const MCP_API_KEY = process.env.MCP_API_KEY;

  if (!MCP_API_KEY) {
    process.stderr.write(
      '[warn] MCP_API_KEY is not set — /mcp endpoint is unprotected\n',
    );
  }

  app.use('/mcp', (req, res, next) => {
    if (!MCP_API_KEY) {
      // No key configured: allow all (local dev without auth)
      next();
      return;
    }

    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="PubMed MCP"');
      res.status(401).json({ error: 'Authorization required' });
      return;
    }

    const provided = authHeader.slice(7); // strip "Bearer "

    // Constant-time comparison to prevent timing attacks
    let valid = false;
    try {
      const a = Buffer.from(provided);
      const b = Buffer.from(MCP_API_KEY);
      valid = a.byteLength === b.byteLength && timingSafeEqual(a, b);
    } catch {
      valid = false;
    }

    if (!valid) {
      res.setHeader(
        'WWW-Authenticate',
        'Bearer realm="PubMed MCP", error="invalid_token"',
      );
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }

    next();
  });

  // ── MCP transport ──────────────────────────────────────────────────────
  // One transport instance per server process (stateless — Cloud Run can
  // spin up multiple instances; sessions are not shared across them).
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
  });

  const server = createServer();
  await server.connect(transport);

  // MCP Streamable HTTP — handles both POST (client→server) and GET (SSE stream).
  app.all('/mcp', (req, res) => {
    transport.handleRequest(req, res, req.body as unknown).catch((err) => {
      process.stderr.write(`[http] handleRequest error: ${String(err)}\n`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  });

  // Health check endpoint — used by Cloud Run readiness/liveness probes.
  // No auth required so Cloud Run can always reach it.
  app.get('/health', (_req, res) => {
    res.send('ok');
  });

  const httpServer = app.listen(port, () => {
    process.stderr.write(`PubMed MCP server running on HTTP port ${port}\n`);
    process.stderr.write(`  MCP endpoint : http://localhost:${port}/mcp\n`);
    process.stderr.write(`  Health check : http://localhost:${port}/health\n`);
    process.stderr.write(
      MCP_API_KEY
        ? '  Auth         : API key required\n'
        : '  Auth         : disabled (MCP_API_KEY not set)\n',
    );
  });

  const shutdown = (): void => {
    process.stderr.write('Shutting down PubMed MCP server\n');
    httpServer.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ── Stdio mode (local / Claude Desktop) ───────────────────────────────────

async function startStdioServer(): Promise<void> {
  const { StdioServerTransport } = await import(
    '@modelcontextprotocol/sdk/server/stdio.js'
  );

  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  process.stderr.write('PubMed MCP server running on stdio\n');

  const shutdown = (): void => {
    process.stderr.write('Shutting down PubMed MCP server\n');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ──────────────────────────────────────────────────────────────────────────

main().catch((err) => {
  process.stderr.write(`Fatal error: ${String(err)}\n`);
  process.exit(1);
});
