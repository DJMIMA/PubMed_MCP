/**
 * Express app for HTTP mode (Cloud Run / remote deployment).
 *
 * Kept apart from the entrypoint (src/index.ts) so tests can run it with a
 * mocked NCBI client. Importing this module loads auth.ts, which reads the
 * OAuth environment variables and throws if any of them is missing.
 *
 * Routes:
 *   POST /mcp                                — MCP Streamable HTTP (Bearer token required)
 *   GET  /.well-known/oauth-protected-resource — RFC 9728 metadata (public)
 *   GET  /health                             — Cloud Run probes (public)
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { protectedResourceMetadata, requireAuth } from './auth.js';
import { createServer } from './server.js';
import type { NcbiClient } from './pubmed/client.js';

/**
 * @param ncbiClient Shared by every per-request MCP server, so that its rate
 *   limiter spans concurrent requests.
 */
export function createHttpApp(ncbiClient: NcbiClient): express.Express {
  const app = express();
  app.disable('x-powered-by');

  // OAuth 2.0 Protected Resource Metadata (RFC 9728) — public so the client can
  // discover the authorization server. No token required.
  app.get('/.well-known/oauth-protected-resource', protectedResourceMetadata);

  // Health check endpoint — used by Cloud Run readiness/liveness probes.
  // No auth required so Cloud Run can always reach it.
  app.get('/health', (_req, res) => {
    res.send('ok');
  });

  // MCP Streamable HTTP. The body is parsed only after the token is verified.
  // SDK v1.x: stateless transports cannot be reused across requests.
  // A new transport and server instance must be created for every request.
  app.post('/mcp', requireAuth, express.json(), (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
    });
    const mcpServer = createServer(ncbiClient);
    res.on('close', () => {
      // Also closes the transport.
      mcpServer.close().catch((err: unknown) => {
        process.stderr.write(`[http] close error: ${String(err)}\n`);
      });
    });
    mcpServer
      .connect(transport)
      .then(() => transport.handleRequest(req, res, req.body as unknown))
      .catch((err) => {
        process.stderr.write(`[http] handleRequest error: ${String(err)}\n`);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal server error' });
        }
      });
  });

  // A stateless server sends no server-initiated messages and has no session,
  // so there is no SSE stream to open with GET and nothing to end with DELETE.
  // Answering 405, as the MCP spec allows, keeps clients from holding idle
  // streams open (each one would keep a server instance and a Cloud Run
  // request alive).
  app.all('/mcp', requireAuth, (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
  });

  // Errors such as malformed or oversized request bodies get JSON, not
  // Express's default HTML page, which includes the stack trace unless
  // NODE_ENV is "production".
  app.use(
    (
      err: Error & { type?: string; status?: number; expose?: boolean },
      _req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      if (res.headersSent) {
        next(err);
        return;
      }
      if (err.type === 'entity.parse.failed') {
        res.status(400).json({ error: 'Invalid JSON body' });
        return;
      }
      if (err.status !== undefined && err.status >= 400 && err.status < 500) {
        res.status(err.status).json({ error: err.expose ? err.message : 'Bad request' });
        return;
      }
      process.stderr.write(`[http] unhandled error: ${String(err)}\n`);
      res.status(500).json({ error: 'Internal server error' });
    },
  );

  return app;
}
