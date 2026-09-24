# CLAUDE.md — PubMed MCP Server

This file provides guidance for AI assistants (Claude and others) working in this repository.

---

## Project Overview

**PubMed_MCP** is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that provides structured access to PubMed, the biomedical literature database maintained by the National Center for Biotechnology Information (NCBI). It enables AI assistants and LLM-based tools to search, retrieve, and reason over scientific publications via the NCBI E-utilities API.

**Status:** Seven MCP tools over stdio and OAuth-protected Streamable HTTP, plus a `pubmed` CLI that runs the same tool functions.

---

## Repository Structure

```
PubMed_MCP/
├── CLAUDE.md              # This file
├── skills/pubmed-cli/SKILL.md  # Agent skill for the pubmed CLI
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

- **Runtime:** Node.js (>=18)
- **Language:** TypeScript (strict mode)
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **HTTP Client:** `axios`
- **XML Parsing:** `fast-xml-parser`
- **HTTP server / auth:** `express`, `jose`
- **Testing:** `vitest`
- **Linting:** `eslint` with TypeScript rules
- **Formatting:** `prettier`

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
- An `inputSchema` defined using JSON Schema (validated with Zod at runtime)
- A handler function that returns `{ content: [{ type: "text", text: "..." }] }`

Follow the existing registrations in `src/server.ts`; each tool's schema and handler live in `src/tools/<toolName>.ts`.

### PubMed / NCBI E-utilities

- Base URL: `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/`
- Key endpoints:
  - `esearch.fcgi` — search for article IDs
  - `efetch.fcgi` — retrieve full records by ID
  - `esummary.fcgi` — retrieve document summaries by ID
- Always include `&db=pubmed&retmode=json` (or `xml` where needed)
- Include `&api_key=<NCBI_API_KEY>` to increase rate limits (10 req/sec vs 3/sec)
- Respect NCBI rate limits; add delays between bulk requests if not using an API key
- The NCBI API key should be read from `process.env.NCBI_API_KEY`

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
npm test             # Run test suite
npm run lint         # Run ESLint
npm run typecheck    # Run tsc --noEmit
```

To run the MCP server locally with Claude Desktop or another MCP client, configure stdio transport.

---

## Git Workflow

- **Main branch:** `main` (or `master`)
- **Feature branches:** `claude/<description>-<id>` for AI-assisted work
- Write clear, imperative commit messages: `Add search_pubmed tool`, `Fix XML parsing for missing abstracts`
- Do not commit `.env` files or API keys
- Always push to the designated branch; never force-push to `main`

---

## Testing Guidelines

- Write unit tests for all MCP tool handlers and API client methods
- Mock NCBI HTTP responses in tests; do not make real network calls in CI
- Test both success paths and error paths (API errors, malformed XML, missing fields)
- Aim for coverage on all tool argument validation logic

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
- Run `npm run typecheck` and `npm test` before committing any changes.
- When in doubt about PubMed API behavior, cite the NCBI E-utilities documentation.
