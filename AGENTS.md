# AGENTS.md — PubMed MCP Server

This file provides guidance for AI assistants (Codex and others) working in this repository.

---

## Project Overview

**PubMed_MCP** is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that provides structured access to PubMed, the biomedical literature database maintained by the National Center for Biotechnology Information (NCBI). It enables AI assistants and LLM-based tools to search, retrieve, and reason over scientific publications via the NCBI E-utilities API.

**Current status:** Project initialized. No implementation exists yet. This branch (`Codex/add-Codex-documentation-T7kFG`) adds foundational documentation before development begins.

---

## Repository Structure (Anticipated)

Once implemented, the project is expected to follow this structure:

```
PubMed_MCP/
├── AGENTS.md              # This file
├── README.md              # User-facing documentation
├── package.json           # Node.js project manifest
├── tsconfig.json          # TypeScript compiler configuration
├── .env.example           # Template for environment variables
├── .gitignore             # Git ignore rules
├── src/
│   ├── index.ts           # MCP server entrypoint
│   ├── server.ts          # Server initialization and tool registration
│   ├── tools/             # Individual MCP tool definitions
│   │   ├── search.ts      # PubMed search tool
│   │   ├── fetch.ts       # Article fetching/details tool
│   │   └── summary.ts     # Abstract/summary retrieval tool
│   ├── pubmed/            # NCBI E-utilities API client
│   │   ├── client.ts      # HTTP client wrapper
│   │   └── types.ts       # PubMed API response types
│   └── utils/
│       └── xml.ts         # XML/JSON parsing utilities
├── tests/
│   ├── tools/             # Unit tests for MCP tools
│   └── pubmed/            # Unit tests for API client
└── dist/                  # Compiled output (gitignored)
```

---

## Technology Stack

- **Runtime:** Node.js (>=18)
- **Language:** TypeScript (strict mode)
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **HTTP Client:** `axios` or Node.js native `fetch`
- **XML Parsing:** `fast-xml-parser` or `xml2js` (PubMed returns XML by default)
- **Testing:** `vitest` or `jest`
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
- A unique `name` (snake_case, e.g., `search_pubmed`)
- A `description` in plain English that explains what the tool does
- An `inputSchema` defined using JSON Schema (validated with Zod at runtime)
- A handler function that returns `{ content: [{ type: "text", text: "..." }] }`

Example tool registration pattern:
```typescript
server.tool(
  "search_pubmed",
  "Search PubMed for articles matching a query",
  {
    query: z.string().describe("Search terms or boolean query"),
    max_results: z.number().int().min(1).max(100).default(10).optional(),
  },
  async ({ query, max_results = 10 }) => {
    // implementation
    return { content: [{ type: "text", text: results }] };
  }
);
```

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
| MCP tool names    | snake_case     | `search_pubmed`            |
| Types/Interfaces  | PascalCase     | `ArticleSummary`           |

---

## Common Commands

Once the project is set up, expect these commands:

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm run dev          # Run with ts-node/nodemon for development
npm test             # Run test suite
npm run lint         # Run ESLint
npm run typecheck    # Run tsc --noEmit
```

To run the MCP server locally with Codex Desktop or another MCP client, configure stdio transport.

---

## Git Workflow

- **Main branch:** `main` (or `master`)
- **Feature branches:** `Codex/<description>-<id>` for AI-assisted work
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

- This repo is in early-stage development. When implementing features, start with `src/index.ts` and `src/server.ts`.
- Do not commit environment files or credentials.
- Prefer simple, readable implementations over clever abstractions — this is a focused tool server.
- When adding a new MCP tool, register it in `src/server.ts` and add a corresponding test file under `tests/tools/`.
- Run `npm run typecheck` and `npm test` before committing any changes.
- When in doubt about PubMed API behavior, cite the NCBI E-utilities documentation.
