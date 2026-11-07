# Changelog

**English** · [日本語](CHANGELOG_ja.md)

All notable changes to this project are recorded in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added an English changelog. `CHANGELOG.md` is now in English and `CHANGELOG_ja.md` in Japanese; both are included in the npm package.

### Fixed

- The npm package now includes the Japanese README (`README_ja.md`), which was missing.

## [1.2.2] - 2026-11-06

### Changed

- The npm package description now mentions the CLI.

## [1.2.1] - 2026-11-05

### Fixed

- `search_articles` (`pubmed search` in the CLI) failed with `Cannot read properties of undefined (reading 'length')` when NCBI's search servers had an outage. It now returns the error message NCBI sent (for example, `Search is temporarily unavailable`). During outages NCBI can answer with HTTP 200 and no list of IDs, and this response was treated as a search result.

## [1.2.0] - 2026-11-04

### Added

- Added `-v` / `--version` to the CLI. It prints the version of the installed `pubmed`.

### Fixed

- The MCP server always reported its version as `1.0.0` in the `initialize` response (`serverInfo.version`). It now reports the version in `package.json`.

## [1.1.0] - 2026-11-04

### Changed

- **`ALLOWED_SUBJECTS` is now required in HTTP mode.** The server exits at startup if it is unset or empty. Previously, when it was empty, anyone who could get a valid token from the authorization server (WorkOS AuthKit) could use `/mcp`.
- In HTTP mode, GET and DELETE requests to `/mcp` now return 405. A stateless server has nothing to send on an SSE stream opened by GET, and open streams tied up server instances and Cloud Run requests.

### Security

- The MCP server no longer loads `.env` from the current directory at startup. It loads it only from the package's own root (the repository root when built from source), as the CLI already did. MCP clients start the server in the directory of the open project, so a `PORT` in that project's `.env` started the server in HTTP mode, and `HTTPS_PROXY` with `NODE_TLS_REJECT_UNAUTHORIZED=0` let a third-party proxy read and modify traffic to NCBI, including the API key.
- Tools that take IDs (`get_article_metadata`, `find_related_articles`, `get_copyright_status`, `get_full_text_article`, `convert_article_ids`) now accept only one ID per value. NCBI treats commas as ID separators, so a value such as `"1,2,3"` could fetch more records than the per-call limit allows. `pmids` in `find_related_articles`, which had no limit, is now capped at 200.
- `lookup_article_by_citation` now replaces `|` and line breaks in each citation field with spaces. Both are ECitMatch delimiters, so they could shift fields or split a citation in two, and results could be matched to a different citation.
- Requests to NCBI now time out after 60 seconds, so a connection that never answers no longer leaves a tool call (in HTTP mode, the client's request) hanging.
- When a request to NCBI is redirected, only redirects over HTTPS to `*.ncbi.nlm.nih.gov` are followed. The API key is in the query string and is carried over to the redirect target.
- The API key is now masked in error messages wherever it appears in the body NCBI returned. Network errors no longer carry the axios error object, which contains the API key.
- In HTTP mode, access tokens without `exp` or `sub` are rejected.
- In HTTP mode, the JSON request body is parsed after the token is verified. Errors such as malformed or oversized bodies return JSON instead of HTML with a stack trace, and the `X-Powered-By` header is no longer sent. The Docker image sets `NODE_ENV=production` and does not run install scripts of dependencies.
- Raised the minimum versions of `@modelcontextprotocol/sdk`, `axios`, and `express` to releases that fix known vulnerabilities.
- Pinned GitHub Actions to commit SHAs, and `actions/checkout` no longer leaves credentials in `.git`.

## [1.0.2] - 2026-11-03

### Changed

- The README is now in English. The Japanese version moved to `README_ja.md`. Both start with badges for the npm version, package size, license, Node.js version, and CI, plus links to switch languages.

## [1.0.1] - 2026-11-01

### Changed

- Changed the contact address sent to NCBI (the `email` parameter) from the placeholder `pubmed-mcp@example.com` to the developer's forwarding address. NCBI's E-utilities usage guidelines ask for the developer's address in `email`, not the end user's.
- The "License" section of the README now links clearly to NCBI's disclaimer and copyright notice.

## [1.0.0] - 2026-10-29

The first release, published to npm as [`@djmima/pubmed-mcp`](https://www.npmjs.com/package/@djmima/pubmed-mcp).

### Added

- Seven MCP tools: `search_articles`, `get_article_metadata`, `find_related_articles`, `lookup_article_by_citation`, `convert_article_ids`, `get_full_text_article`, `get_copyright_status`
- Two transports: stdio, and Streamable HTTP protected by OAuth (HTTP mode when `PORT` is set)
- The `pubmed` CLI, which runs the same tools from the shell, and an agent skill (`skills/pubmed-cli`)
- MIT License

[Unreleased]: https://github.com/DJMIMA/PubMed_MCP/compare/v1.2.2...HEAD
[1.2.2]: https://github.com/DJMIMA/PubMed_MCP/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/DJMIMA/PubMed_MCP/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/DJMIMA/PubMed_MCP/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/DJMIMA/PubMed_MCP/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/DJMIMA/PubMed_MCP/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/DJMIMA/PubMed_MCP/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/DJMIMA/PubMed_MCP/releases/tag/v1.0.0
