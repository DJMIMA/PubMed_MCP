# CLAUDE.md — PubMed MCP Server

This file provides guidance for AI assistants (Claude and others) working in this repository.

---

## Project Overview

**PubMed_MCP** is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that provides structured access to PubMed, the biomedical literature database maintained by the National Center for Biotechnology Information (NCBI). It enables AI assistants and LLM-based tools to search, retrieve, and reason over scientific publications via the NCBI E-utilities API.

**Status:** Seven MCP tools over stdio and OAuth-protected Streamable HTTP, plus a `pubmed` CLI that runs the same tool functions. Published to npm as `@djmima/pubmed-mcp` (MIT).

---

## Repository Structure

```
PubMed_MCP/
├── CLAUDE.md              # This file (AGENTS.md holds the same guidance for other agents)
├── .github/workflows/     # ci.yml (typecheck, lint, test, build), audit.yml (npm audit), release.yml (npm stage publish)
├── skills/pubmed-cli/SKILL.md  # Agent skill for the pubmed CLI
├── CHANGELOG.md           # Release notes (Japanese, Keep a Changelog)
├── Dockerfile             # Cloud Run image (HTTP mode)
├── src/
│   ├── index.ts           # Entrypoint: stdio, or HTTP when PORT is set
│   ├── server.ts          # Tool registration (names and descriptions)
│   ├── auth.ts            # OAuth bearer-token checks for HTTP mode
│   ├── cli.ts, cli/       # pubmed CLI (commands.ts, run.ts)
│   ├── tools/             # One file per tool: Zod schema + handler
│   ├── pubmed/            # NCBI E-utilities client and response types
│   └── utils/xml.ts       # PubMed/PMC XML parsing
└── tests/                 # cli/, pubmed/, tools/, utils/, server.test.ts
```

---

## Technology Stack

- **Runtime:** Node.js (>=22)
- **Language:** TypeScript (strict mode)
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **Validation:** `zod` (tool argument schemas)
- **HTTP Client:** `axios`
- **XML Parsing:** `fast-xml-parser`
- **HTTP server / auth:** `express`, `jose`
- **Testing:** `vitest`
- **Linting:** `eslint` with TypeScript rules

---

## Development Conventions

### TypeScript

- Use **strict mode** (`"strict": true` in tsconfig.json)
- Prefer `interface` for object shapes, `type` for unions/aliases
- Export types explicitly; avoid implicit `any`
- All async functions must handle errors explicitly (no unhandled promise rejections)
- Use `zod` for runtime input validation on MCP tool arguments

### MCP Server Patterns

MCP tools must be registered with:
- A unique `name` (snake_case, e.g., `search_articles`)
- A `description` in plain English that explains what the tool does
- An input schema written as a Zod raw shape (an object of Zod types, not `z.object(...)`)
- A handler function that returns `{ content: [{ type: "text", text: "..." }] }`

Follow the existing registrations in `src/server.ts`; each tool's schema and handler live in `src/tools/<toolName>.ts`.

The SDK validates arguments against the Zod shape and generates the JSON Schema that `tools/list` returns. After changing a schema or upgrading `zod` or the SDK, compare the `tools/list` output before and after.

### PubMed / NCBI E-utilities

- Base URL: `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/`
- Endpoints used by `src/pubmed/client.ts`:
  - `esearch.fcgi` — search PubMed for PMIDs (`retmode=json`)
  - `efetch.fcgi` — full records as XML: `db=pubmed` for metadata, `db=pmc` for full text and license information
  - `elink.fcgi` — similar articles, citing PMC articles, and links to Gene, Protein, and Nucleotide records
  - `ecitmatch.cgi` — PMIDs from citation data (plain-text response)
- The PMC ID Converter (`https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/`) converts between PMID, PMCID, and DOI
- Set `db` and `retmode` explicitly on every request
- `NcbiClient` reads the API key from `process.env.NCBI_API_KEY` and adds `api_key` to requests when it is set
- `NcbiClient` paces every request: 8 req/sec with an API key (NCBI allows 10; the margin absorbs arrival jitter) and 3 req/sec without. It retries HTTP 429 responses
- Rate limiting is per client, so send all NCBI requests through one `NcbiClient` (HTTP mode shares one client across its per-request servers)

### Environment Variables

| Variable         | Required | Description                             |
|------------------|----------|-----------------------------------------|
| `NCBI_API_KEY`   | No       | NCBI API key for higher rate limits     |
| `PORT`           | No       | Port to run the MCP server (default: stdio transport) |
| `OAUTH_ISSUER`, `OAUTH_JWKS_URL`, `MCP_RESOURCE_URL` | HTTP mode | OAuth settings; the server exits at startup in HTTP mode if any is empty |
| `ALLOWED_SUBJECTS` | No     | Comma-separated token `sub` values allowed to use `/mcp` (HTTP mode) |

### Error Handling

- Wrap all NCBI API calls in try/catch; return descriptive error messages as MCP tool content rather than throwing
- Use typed error classes; distinguish between network errors, API errors, and parse errors
- Log errors to `stderr` (MCP uses `stdout` for the protocol, `stderr` for logs)

### Naming Conventions

| Element           | Convention     | Example                    |
|-------------------|----------------|----------------------------|
| Files             | camelCase      | `pubmedClient.ts`          |
| Classes           | PascalCase     | `PubMedClient`             |
| Functions/methods | camelCase      | `searchArticles()`         |
| Constants         | UPPER_SNAKE    | `NCBI_BASE_URL`            |
| MCP tool names    | snake_case     | `search_articles`            |
| Types/Interfaces  | PascalCase     | `ArticleSummary`           |

---

## Common Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm run dev          # Run the server from source with tsx
npm run cli -- <command> [args]  # Run the pubmed CLI from source
npm test             # Run the vitest suite in tests/
npm run lint         # Run ESLint on src/ only
npm run typecheck    # Run tsc --noEmit on src/ only (tsconfig excludes tests/)
```

`npm run lint` and `npm run typecheck` do not cover `tests/`. Lint new test files explicitly, for example `npx eslint tests/tools/newTool.test.ts`.

To run the MCP server locally with Claude Desktop or another MCP client, configure stdio transport.

---

## Git Workflow

- **Main branch:** `main`
- **Feature branches:** `claude/<description>-<id>` for AI-assisted work
- Write clear, imperative commit messages: `Add search_pubmed tool`, `Fix XML parsing for missing abstracts`
- Do not commit `.env` files or API keys
- Always push to the designated branch; never force-push to `main`
- Merging to `main` deploys the server to Cloud Run automatically (the trigger is configured in GCP, not in this repository). Verify HTTP mode before merging changes that affect it.

---

## Continuous Integration

- `.github/workflows/ci.yml` runs `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` on every pull request and on pushes to `main`.
- `.github/workflows/audit.yml` runs `npm audit --omit=dev --audit-level=high` on pull requests, on pushes to `main`, and weekly. A newly published advisory can fail it without any code change; fix the dependencies rather than changing the threshold.
- `.github/workflows/release.yml` stages a publish to npm when a GitHub Release is published, using npm trusted publishing (OIDC; no token in the repository). The version goes live only after a maintainer approves it on npmjs.com with 2FA; the trusted publisher allows `npm stage publish` only. The release tag must be `v` plus the `package.json` version, and the workflow skips publishing when that version is already on npm. The workflow runs typecheck, lint, tests, and build itself before staging (`prepublishOnly` also runs them for a manual `npm publish`). Only `dist/` and `skills/` (plus README and LICENSE) go into the package, as set by `files` in `package.json`.

---

## Testing Guidelines

- Write unit tests for all MCP tool handlers and API client methods
- Mock NCBI HTTP responses in tests; do not make real network calls in CI
- Test both success paths and error paths (API errors, malformed XML, missing fields)
- Aim for coverage on all tool argument validation logic
- `vitest.config.ts` excludes `.claude/worktrees/`, so `npm test` runs only this checkout's tests, not those of agent worktrees nested inside it

---

## Key References

- [MCP Documentation](https://modelcontextprotocol.io/docs)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [NCBI E-utilities Documentation](https://www.ncbi.nlm.nih.gov/books/NBK25499/)
- [PubMed API Key Registration](https://www.ncbi.nlm.nih.gov/account/)

---

## Notes for AI Assistants

- Do not commit environment files or credentials.
- Prefer simple, readable implementations over clever abstractions — this is a focused tool server.
- When adding a new MCP tool, register it in `src/server.ts` and add a corresponding test file under `tests/tools/`.
- The `pubmed` CLI (`src/cli.ts`, `src/cli/`) runs the same tool functions and prints the same JSON as the MCP server. When adding or changing a tool, update its command in `src/cli/commands.ts`, the tests in `tests/cli/`, and the command table in `skills/pubmed-cli/SKILL.md`.
- Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` (the same checks as CI) before committing any changes.
- `CLAUDE.md` and `AGENTS.md` hold the same guidance; when you change one, make the same change in the other.
- Add user-visible changes to the `[Unreleased]` section of `CHANGELOG.md` (in Japanese, Keep a Changelog format) in the same PR. Releases follow the steps in the README section "npm へのリリース".
- When in doubt about PubMed API behavior, cite the NCBI E-utilities documentation.
