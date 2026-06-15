/**
 * OAuth 2.0 resource-server enforcement for HTTP mode.
 *
 * The MCP server acts as an OAuth 2.0 *resource server* (RFC 9728 /
 * MCP authorization spec 2025-06-18). Stytch is the *authorization server*:
 * it runs Dynamic Client Registration (so claude.ai can register itself) and
 * issues signed JWT access tokens. This module:
 *
 *   1. Advertises the authorization server via Protected Resource Metadata at
 *      /.well-known/oauth-protected-resource
 *   2. Validates the Bearer JWT on every /mcp request against Stytch's JWKS
 *      (signature, issuer, audience, expiry).
 *   3. Restricts access to an allowlist of token subjects — since DCR lets
 *      anyone register a client, this is what makes the server *yours only*.
 *
 * Required environment variables (copy issuer/jwks from Stytch's
 *   https://<your-stytch-domain>/.well-known/oauth-authorization-server ):
 *   STYTCH_ISSUER     — `issuer` from that document
 *   STYTCH_JWKS_URL   — `jwks_uri` from that document
 *   MCP_RESOURCE_URL  — public URL of this server's MCP endpoint
 *                       (e.g. https://pubmed-mcp-xxxx.run.app/mcp); used as the
 *                       expected token `aud` and as the resource identifier
 *   ALLOWED_SUBJECTS  — comma-separated Stytch user IDs permitted to connect.
 *                       Leave empty on first deploy to discover your own id
 *                       from the logs, then set it and redeploy.
 */

import type { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const ISSUER = requireEnv('STYTCH_ISSUER');
const JWKS_URL = requireEnv('STYTCH_JWKS_URL');
const RESOURCE = requireEnv('MCP_RESOURCE_URL');

const ALLOWED_SUBJECTS = (process.env.ALLOWED_SUBJECTS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Metadata lives at the well-known path on the same origin as the resource.
const RESOURCE_METADATA_URL = `${originOf(RESOURCE)}/.well-known/oauth-protected-resource`;

const jwks = createRemoteJWKSet(new URL(JWKS_URL));

// ── Protected Resource Metadata (RFC 9728) ──────────────────────────────────

/** Tells the client which authorization server to use for this resource. */
export function protectedResourceMetadata(_req: Request, res: Response): void {
  res.json({
    resource: RESOURCE,
    authorization_servers: [ISSUER],
    bearer_methods_supported: ['header'],
  });
}

// ── Bearer token enforcement ────────────────────────────────────────────────

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    unauthorized(res, 'missing_token');
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: ISSUER,
      audience: RESOURCE,
    });

    if (ALLOWED_SUBJECTS.length > 0 && !ALLOWED_SUBJECTS.includes(payload.sub ?? '')) {
      // Valid token, but not you. Log the subject so you can allowlist yourself.
      process.stderr.write(`[auth] forbidden subject: ${payload.sub ?? '(none)'}\n`);
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    next();
  } catch (err) {
    process.stderr.write(`[auth] token rejected: ${String(err)}\n`);
    unauthorized(res, 'invalid_token');
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** 401 with the RFC 9728 pointer so the client can discover how to authorize. */
function unauthorized(res: Response, error: string): void {
  res.setHeader(
    'WWW-Authenticate',
    `Bearer resource_metadata="${RESOURCE_METADATA_URL}", error="${error}"`,
  );
  res.status(401).json({ error });
}

function originOf(url: string): string {
  return new URL(url).origin;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
