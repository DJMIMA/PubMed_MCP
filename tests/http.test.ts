/**
 * Tests for the HTTP mode app (src/http.ts) and its OAuth checks (src/auth.ts).
 * Tokens are signed with a local key and verified against a JWKS served from
 * localhost; the NCBI client is a mock, so no external requests are made.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair, type JWTPayload, type KeyLike } from 'jose';
import type { NcbiClient } from '../src/pubmed/client.js';

const ISSUER = 'https://auth.example.test';
const RESOURCE = 'https://pubmed-mcp.example.test/mcp';
const ALLOWED_SUB = 'user_allowed';

let privateKey: KeyLike;
let jwksServer: http.Server;
let appServer: http.Server;
let baseUrl: string;
const mockEsearch = vi.fn();

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

function close(server: http.Server | undefined): Promise<void> {
  return new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
}

async function signToken(
  claims: JWTPayload = { sub: ALLOWED_SUB },
  { withExp = true }: { withExp?: boolean } = {}
): Promise<string> {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(ISSUER)
    .setAudience(RESOURCE)
    .setIssuedAt();
  if (withExp) jwt.setExpirationTime('5m');
  return jwt.sign(privateKey);
}

function postMcp(body: string, token?: string): Promise<Response> {
  return fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
  });
}

const TOOLS_CALL = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name: 'search_articles', arguments: { query: 'CRISPR' } },
});

beforeAll(async () => {
  const keys = await generateKeyPair('RS256');
  privateKey = keys.privateKey;
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  jwksServer = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  const jwksUrl = await listen(jwksServer);

  vi.stubEnv('OAUTH_ISSUER', ISSUER);
  vi.stubEnv('OAUTH_JWKS_URL', `${jwksUrl}/jwks`);
  vi.stubEnv('MCP_RESOURCE_URL', RESOURCE);
  vi.stubEnv('ALLOWED_SUBJECTS', ` ${ALLOWED_SUB} , user_other_allowed `);
  vi.resetModules();
  const { createHttpApp } = await import('../src/http.js');

  const ncbiClient = { esearch: mockEsearch } as unknown as NcbiClient;
  appServer = http.createServer(createHttpApp(ncbiClient));
  baseUrl = await listen(appServer);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await close(appServer);
  await close(jwksServer);
});

describe('HTTP mode', () => {
  it('serves /health and the protected resource metadata without a token', async () => {
    const health = await fetch(`${baseUrl}/health`);
    expect(await health.text()).toBe('ok');

    const metadata = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
    expect(await metadata.json()).toEqual({
      resource: RESOURCE,
      authorization_servers: [ISSUER],
      bearer_methods_supported: ['header'],
    });
  });

  it('does not send an X-Powered-By header', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('answers 401 with the resource metadata pointer when the token is missing', async () => {
    const res = await postMcp(TOOLS_CALL);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="https://pubmed-mcp.example.test/.well-known/oauth-protected-resource", error="missing_token"'
    );
  });

  it('runs tools for an allowlisted subject', async () => {
    mockEsearch.mockResolvedValueOnce({
      count: '1',
      retmax: '20',
      retstart: '0',
      idlist: ['12345'],
      translationset: [],
      querytranslation: 'CRISPR[All Fields]',
    });

    const res = await postMcp(TOOLS_CALL, await signToken());

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('\\"pmids\\":[\\"12345\\"]');
    expect(mockEsearch).toHaveBeenCalledWith(expect.objectContaining({ term: 'CRISPR' }));
  });

  it('accepts every subject in the comma-separated allowlist', async () => {
    mockEsearch.mockResolvedValueOnce({ count: '0', idlist: [], querytranslation: '' });
    const res = await postMcp(TOOLS_CALL, await signToken({ sub: 'user_other_allowed' }));
    expect(res.status).toBe(200);
  });

  it('answers 403 for a valid token whose subject is not allowlisted', async () => {
    const res = await postMcp(TOOLS_CALL, await signToken({ sub: 'user_stranger' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('rejects a token without exp, which would otherwise never expire', async () => {
    const res = await postMcp(TOOLS_CALL, await signToken({ sub: ALLOWED_SUB }, { withExp: false }));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });

  it('rejects a token without sub', async () => {
    const res = await postMcp(TOOLS_CALL, await signToken({}));
    expect(res.status).toBe(401);
  });

  it('rejects a token for another audience', async () => {
    const token = await new SignJWT({ sub: ALLOWED_SUB })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(ISSUER)
      .setAudience('https://other.example.test/mcp')
      .setExpirationTime('5m')
      .sign(privateKey);
    const res = await postMcp(TOOLS_CALL, token);
    expect(res.status).toBe(401);
  });

  it('answers 405 to GET and DELETE instead of opening an idle SSE stream', async () => {
    const token = await signToken();
    for (const method of ['GET', 'DELETE']) {
      const res = await fetch(`${baseUrl}/mcp`, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
    }
  });

  it('checks the token before answering 405', async () => {
    const res = await fetch(`${baseUrl}/mcp`, { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('does not parse the request body before the token is verified', async () => {
    const res = await postMcp('{not json');
    expect(res.status).toBe(401);
  });

  it('answers malformed JSON with a JSON 400', async () => {
    const res = await postMcp('{not json', await signToken());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
  });

  it('answers an oversized body with a JSON 413 and no stack trace', async () => {
    const body = JSON.stringify({ padding: 'x'.repeat(200 * 1024) });
    const res = await postMcp(body, await signToken());
    expect(res.status).toBe(413);
    expect(res.headers.get('content-type')).toContain('application/json');
    const text = await res.text();
    expect(text).not.toMatch(/\bat\s.+\.js:\d+/);
    expect(JSON.parse(text)).toEqual({ error: 'request entity too large' });
  });
});

describe('HTTP mode configuration', () => {
  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['only separators', ' , '],
  ])('refuses to start when ALLOWED_SUBJECTS is %s', async (_label, value) => {
    vi.stubEnv('OAUTH_ISSUER', ISSUER);
    vi.stubEnv('OAUTH_JWKS_URL', 'https://auth.example.test/jwks');
    vi.stubEnv('MCP_RESOURCE_URL', RESOURCE);
    vi.stubEnv('ALLOWED_SUBJECTS', value);
    vi.resetModules();

    await expect(import('../src/auth.js')).rejects.toThrow(/ALLOWED_SUBJECTS/);
  });
});
