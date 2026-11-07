<h1 align="center">PubMed MCP/CLI</h1>

<p align="center"><strong>Search and read the biomedical literature from your AI assistant.</strong></p>

<p align="center">PubMed and PubMed Central for Claude, Codex, and the shell.</p>

<p align="center">
  <a href="#tools">Tools</a> ·
  <a href="#installation"><strong>Install</strong></a> ·
  <a href="#usage">Usage</a> ·
  <a href="#cli">CLI</a> ·
  <a href="#deploying-to-google-cloud-run">Deploy</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@djmima/pubmed-mcp"><img alt="npm version" src="https://img.shields.io/npm/v/@djmima/pubmed-mcp?label=npm&color=cb3837"></a>
  <a href="https://packagephobia.com/result?p=@djmima/pubmed-mcp"><img alt="npm unpacked size" src="https://img.shields.io/npm/unpacked-size/@djmima/pubmed-mcp"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <a href="https://nodejs.org/"><img alt="Node.js version" src="https://img.shields.io/node/v/@djmima/pubmed-mcp"></a>
  <a href="https://github.com/DJMIMA/PubMed_MCP/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/DJMIMA/PubMed_MCP/actions/workflows/ci.yml/badge.svg"></a>
</p>

<p align="center"><strong>English</strong> · <a href="README_ja.md">日本語</a></p>

**Free, open source, and runs on your own machine.** An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server and command-line tool that give Claude, Codex, and other LLM clients structured access to [PubMed](https://pubmed.ncbi.nlm.nih.gov/) and [PubMed Central (PMC)](https://www.ncbi.nlm.nih.gov/pmc/) via the NCBI E-utilities API. No account needed; an NCBI API key is optional.

## Tools

| Tool | Description |
|------|-------------|
| `search_articles` | Search PubMed with PubMed syntax or keywords. Supports ATM diagnostics, field restriction, date filters, sorting, and pagination |
| `get_article_metadata` | Get the title, abstract, authors, MeSH terms, keywords, and more for given PMIDs |
| `find_related_articles` | Find similar articles and links to other NCBI databases with ELink |
| `lookup_article_by_citation` | Look up PMIDs from citation data such as journal, year, volume, and first author |
| `convert_article_ids` | Convert between PMID, PMCID, and DOI |
| `get_full_text_article` | Get the full body text of PMC Open Access articles as plain text |
| `get_copyright_status` | Check whether full text is available (`has_full_text`), the license, the copyright statement, and the OA status. Uses PMC EFetch metadata (the old PMC OA Web Service was retired on 2026-08-25) |

The same tools are also available from the shell as the `pubmed` command (see [CLI](#cli)).

---

## ATM diagnostics and field restriction in `search_articles`

PubMed applies Automatic Term Mapping (ATM) to untagged search terms. ATM expands terms to MeSH,
journal names, author names, and so on, which can cause unintended translations, or a fallback
search when a quoted phrase is not in the phrase index.

`search_articles` accepts an optional `field` value and restricts every untagged term in the query
to that field:

- `title`
- `tiab` (Title/Abstract)
- `mesh`
- `author`
- `journal`
- `affiliation`

Terms with an explicit field tag in the query keep their tag, which takes precedence over `field`.
Without `field`, search behaves as before. `all` is not offered as a value, because it does not
turn off ATM.

The response always includes the following fields, normalized from the NCBI ESearch diagnostics:

```json
{
  "warnings": {
    "phrases_ignored": [],
    "quoted_phrases_not_found": [],
    "output_messages": []
  },
  "errors": {
    "phrases_not_found": [],
    "fields_not_found": []
  }
}
```

These `errors` are NCBI ESearch diagnostics about search terms and fields, not network errors or
errors from the MCP tool itself.
The keys are present as empty arrays even when there are no diagnostics. Before concluding from a
low or zero count that no literature exists, check `query_translation`, `warnings`, and `errors`.
To search several terms reliably in the same field, tag each term. For proximity searching when a
quoted phrase is not in the phrase index, use `[ti:~0]` or `[tiab:~0]`.

---

## Requirements

- **Node.js** 22 or later (`npx` and `npm` come with Node.js)
- **NCBI API key** (optional; without one the server works, but is limited to 3 req/s)
- **jq** (optional; used to extract the fields you need from [CLI](#cli) output)

---

## Installation

The server is published on npm as [`@djmima/pubmed-mcp`](https://www.npmjs.com/package/@djmima/pubmed-mcp).

- **To use it as an MCP server**, you don't need to install anything. Put `npx -y @djmima/pubmed-mcp@latest` in your MCP client's configuration,
  and the latest version is downloaded automatically at startup (see [Usage](#usage) below).
- **To use the [CLI](#cli)**, install it globally:

```bash
npm install -g @djmima/pubmed-mcp
```

This registers two commands, `pubmed` and `pubmed-mcp`. Update with `npm update -g @djmima/pubmed-mcp`
and uninstall with `npm rm -g @djmima/pubmed-mcp`.

If you want to modify the source code, see [Building from source](#building-from-source).

### Setting up an NCBI API key (recommended)

With an API key, the rate limit goes from 3 to 8 req/s.

1. Create an [NCBI account](https://www.ncbi.nlm.nih.gov/account/) and generate an API key
2. Set it in the `NCBI_API_KEY` environment variable (see the client-specific settings below)

When an MCP client starts the server locally, pass the key in the `env` section of the client configuration.
The server reads `.env` only from its own package root (the repository root if you [built from source](#building-from-source)),
never from the directory it is started in, so a `.env` in a project open in your MCP client cannot change its settings.

Use an API key owned and managed by the person or organization running this server.
The repository does not ship an API key. When a response includes the `echo` from the NCBI API,
the `api_key` value is masked as `<redacted>`.

The client applies a simple per-process rate limiter. It sends at most 3 req/s without an API key,
and 8 req/s with one, leaving a margin below NCBI's limit of 10 req/s (NCBI counts by arrival time, so the margin absorbs network jitter). On HTTP 429 it waits and retries up to twice.
Parallel calls within one process are spaced out automatically, but if you run multiple instances
on Cloud Run or elsewhere, keep the total across all instances within NCBI's limit. As a guideline,
keep a single instance to about 8 concurrent requests with an API key and about 2 without.

---

## Usage

### Claude Desktop (local, stdio)

Add the server to `mcpServers` in `claude_desktop_config.json`.

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "pubmed-local": {
      "command": "npx",
      "args": ["-y", "@djmima/pubmed-mcp@latest"],
      "env": {
        "NCBI_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

- If other servers are already registered, add `"pubmed-local": { ... }` alongside them inside `mcpServers` (don't forget the comma after the previous entry).
- If it doesn't start on Windows, change it to `"command": "cmd"` and `"args": ["/c", "npx", "-y", "@djmima/pubmed-mcp@latest"]`.
- With `@latest`, the client checks npm for a newer version at every startup. To pin a version, write it as `@djmima/pubmed-mcp@1.0.0`.
- Naming the server `pubmed-local` makes it easy to tell apart from the remote server (`pubmed-remote`) and from other PubMed connectors with the same tool names.

After configuring, quit Claude Desktop completely and restart it. Closing the window may leave the app running in the background (on Windows, quit from the system tray icon).
Servers in this file are also loaded into sessions opened in the Code tab of Claude Desktop.

If the server doesn't start, check the log (Windows: `%APPDATA%\Claude\logs\mcp-server-pubmed-local.log`, macOS: `~/Library/Logs/Claude/mcp-server-pubmed-local.log`).

---

### Claude Code (local, stdio)

Register the server with `claude mcp add`. With `--scope user`, it is available in every project.

```bash
claude mcp add --env NCBI_API_KEY=your_api_key_here --transport stdio --scope user pubmed-local -- npx -y @djmima/pubmed-mcp@latest
```

- Everything after `--` is passed as-is as the command that starts the server.
- On Windows (not WSL), use `cmd /c npx -y @djmima/pubmed-mcp@latest` after `--`.
- If the server name comes right after `--env`, it is parsed as a continuation of `KEY=value` and fails, so put another option (here, `--transport stdio`) in between.
- The registration is saved in `~/.claude.json` (user / local scope) or in `.mcp.json` in the project root (project scope). `mcpServers` written in `~/.claude/settings.json` is not read.
- If you only use the Code tab of Claude Desktop, the `claude_desktop_config.json` registration above is enough, and you can skip this step.

After registering, check the connection with `claude mcp list` or `/mcp` inside Claude Code.

---

### Codex (local, stdio)

The Codex desktop app, CLI, and IDE extension share one configuration file, `~/.codex/config.toml` (Windows: `%USERPROFILE%\.codex\config.toml`). Add the following block:

```toml
[mcp_servers.pubmed-local]
command = "npx"
args = ["-y", "@djmima/pubmed-mcp@latest"]

[mcp_servers.pubmed-local.env]
NCBI_API_KEY = "your_api_key_here"
```

- If it doesn't start on Windows, change it to `command = "cmd"` and `args = ["/c", "npx", "-y", "@djmima/pubmed-mcp@latest"]`.
- Codex does not pass OS environment variables through to MCP servers. Either write the API key in `env` as above, or add `env_vars = ["NCBI_API_KEY"]` under `[mcp_servers.pubmed-local]` to forward it from Codex's environment.

You can also register it from the CLI with `codex mcp add`:

```bash
codex mcp add pubmed-local --env NCBI_API_KEY=your_api_key_here -- npx -y @djmima/pubmed-mcp@latest
```

After configuring, restart Codex (in the desktop app, **Restart** under **Settings → MCP servers**). You can also register the server from **Add server** on the same screen. In the CLI and IDE extension, `/mcp` shows the connected servers.

---

### Anthropic API (programmatic use)

```python
import os

import anthropic

client = anthropic.Anthropic()
response = client.beta.messages.create(
    model="claude-opus-5",
    max_tokens=16000,
    messages=[{
        "role": "user",
        "content": "Find recent papers on CRISPR gene editing in cancer treatment"
    }],
    mcp_servers=[{
        "type": "url",
        "url": "https://pubmed-mcp-PROJECT_NUMBER.asia-northeast1.run.app/mcp",
        "name": "pubmed",
        # /mcp is protected by OAuth, so an access token is required
        "authorization_token": os.environ["PUBMED_MCP_TOKEN"],
    }],
    tools=[{"type": "mcp_toolset", "mcp_server_name": "pubmed"}],
    betas=["mcp-client-2025-11-20"]
)
```

The MCP connector in the Anthropic API can only connect to remote servers exposed over HTTP, so you need to deploy to Cloud Run first.
See [Deploying to Google Cloud Run](#deploying-to-google-cloud-run) for deployment, and [Client connection settings](#client-connection-settings) for getting an access token.

---

### Building from source

To modify the source code, clone the repository and build it.

```bash
git clone https://github.com/DJMIMA/PubMed_MCP.git
cd PubMed_MCP
npm install
npm run build
```

In your MCP client configuration, use `node /absolute/path/to/PubMed_MCP/dist/index.js` instead of `npx -y @djmima/pubmed-mcp@latest`
(on Windows, write the path with forward slashes, like `C:/path/to/PubMed_MCP/dist/index.js`).
To use the CLI, run `npm link` next; it registers the `pubmed` and `pubmed-mcp` commands (undo with `npm rm -g @djmima/pubmed-mcp`).

`dist/` is not in the repository. After updating the source with `git pull`, run `npm run build` again
and restart your MCP client. A running server keeps using the old build until it restarts.

### Local development

```bash
# Create a .env file and set your API key
cp .env.example .env
# Edit .env and fill in NCBI_API_KEY

# Start in stdio mode (default)
npm run dev

# Start in HTTP mode (enabled by setting PORT; the OAuth variables are also required)
PORT=8080 npm run dev
# → http://localhost:8080/mcp   MCP endpoint (Bearer token required)
# → http://localhost:8080/health Health check
```

HTTP mode reads `OAUTH_ISSUER`, `OAUTH_JWKS_URL`, `MCP_RESOURCE_URL`, and `ALLOWED_SUBJECTS` at startup, and exits with the following error if any of them is missing:

```
Fatal error: Error: Missing required environment variable: OAUTH_ISSUER
```

Set these values in `.env` before starting (see [Environment variables](#environment-variables) for what each one means).
To check `/health` or the 401 response, placeholder values (in URL form for the URLs) are enough to start the server, but to actually call `/mcp`
you need an access token issued with `MCP_RESOURCE_URL` as its `aud`. To try the tools without authentication, use stdio mode.

---

## CLI

The `pubmed` command runs the same tools as the MCP server from the shell. Its output is the same JSON as the MCP tools,
written to standard output or to a file (`-o`). By saving results to a file and extracting only the fields you need with `jq`,
agents such as Claude Code and Codex avoid loading large amounts of metadata into their context.

For example, the metadata for the top 20 results for `TP53 AND myelodysplastic syndromes[mh]` is about 108 KB,
but extracting only the PMID, year, and title brings it down to 3.2 KB (about 1/34). A single full text runs to tens of thousands of characters.

### Installation

```bash
npm install -g @djmima/pubmed-mcp
```

You're done when `pubmed --help` prints the help. `pubmed --version` (or `-v`) prints the installed version.

The NCBI API key is read from the `NCBI_API_KEY` environment variable. Add
`export NCBI_API_KEY=your_api_key_here` to your shell configuration file (`~/.bashrc`, `~/.zshrc`, etc.), or on Windows run
`setx NCBI_API_KEY your_api_key_here` once and then reopen your terminal.

If you [built from source](#building-from-source) and registered the commands with `npm link`, the CLI also reads `.env` in the repository root
(create it with `cp .env.example .env`) when the environment variable is not set, so the key is used whichever directory you run it from.

### Commands

| Command | MCP tool | Input | Items per request |
|---|---|---|---|
| `pubmed search <query>` | `search_articles` | Search query (`-` reads from stdin) | — |
| `pubmed metadata <pmid>...` | `get_article_metadata` | PMIDs | 200 |
| `pubmed related <pmid>...` | `find_related_articles` | PMIDs | 200 |
| `pubmed citation --journal <journal> --year <year> ...` | `lookup_article_by_citation` | Options, or a JSON array or JSON Lines with `--input` | 100 |
| `pubmed convert <id>...` | `convert_article_ids` | PMIDs, PMCIDs, or DOIs (set with `--id-type`) | 200 |
| `pubmed fulltext <pmcid>...` | `get_full_text_article` | PMCIDs | 20 |
| `pubmed copyright <pmid>...` | `get_copyright_status` | PMIDs | 50 |

- Option names are the MCP parameter names in kebab case (`max_results` → `--max-results`, `date_from` → `--date-from`, and so on). See `pubmed <command> --help` for details.
- Pass IDs as arguments (separated by spaces or commas), or pass `-` to read them from stdin, one per line.
- IDs beyond the per-request limit are split automatically, sent in order, and merged into one JSON. The MCP tools' limits (200 for metadata, for example) do not apply.
- With `-o <file>`, the JSON is written to a file, and the item count and file size are printed to stderr.
- The exit code is 0 on success, 1 on NCBI or file errors, and 2 on usage errors. Error details go to stderr.

### Examples

```bash
# Search, and check how PubMed interpreted the query
pubmed search "TP53[tiab] AND myelodysplastic syndromes[mh]" --max-results 200 -o search.json
jq '{total_count, query_translation, warnings, errors}' search.json

# Get metadata for every hit and list PMID, year, journal, and title
jq -r '.pmids[]' search.json | pubmed metadata - -o meta.json
jq -r '.articles[] | [.identifiers.pmid, .publication_date.year, .journal.iso_abbreviation, .title] | @tsv' meta.json

# Get full text only for articles that have it, and search just the parts you need
jq -r '.pmids[]' search.json | pubmed copyright - -o rights.json
jq -r '.statuses[] | select(.has_full_text) | .pmcid' rights.json | pubmed fulltext - -o full.json
jq -r '.articles[].full_text' full.json | grep -n -i 'venetoclax'
```

### Using with agents

[`skills/pubmed-cli/SKILL.md`](skills/pubmed-cli/SKILL.md) is a Skill that teaches agents how to use the CLI (save results to files and read them with jq, pass IDs together in one call, and so on)
along with jq recipes. Copy it into your user-level skills folder and it is used in every project.
Claude Code (including the Code tab of Claude Desktop) reads skills from `~/.claude/skills/`, and Codex from `~/.agents/skills/`
(on Windows, `~` is `%USERPROFILE%`).

The Skill is included in the npm package, so if you installed with `npm install -g`, you can copy it with the following commands
(on Windows, run them in Git Bash):

```bash
SKILL_DIR="$(npm root -g)/@djmima/pubmed-mcp/skills/pubmed-cli"
mkdir -p ~/.claude/skills ~/.agents/skills
cp -r "$SKILL_DIR" ~/.claude/skills/
cp -r "$SKILL_DIR" ~/.agents/skills/
```

If you built from source, set `SKILL_DIR=skills/pubmed-cli` in the repository root and run the same commands.
Copy it again whenever you update the package or the Skill.

To stop Claude Code from asking for permission every time it runs a command, add `pubmed` and `jq` to `permissions.allow`
in `~/.claude/settings.json` (if you already have settings, append to the array):

```json
{
  "permissions": {
    "allow": ["Bash(pubmed:*)", "Bash(jq:*)"]
  }
}
```

Notes:

- The CLI works only where a shell is available (Claude Code, Codex, and so on). From claude.ai chats or from a custom connector deployed on Cloud Run, keep using the MCP server.
- NCBI rate limits apply per process. Running several `pubmed` processes in parallel can exceed the limit in total, so pass IDs together in a single run.
- On Windows, run pipelines in Git Bash or PowerShell 7. In Windows PowerShell 5.1, `>` saves files as UTF-16, so use `-o` instead.

---

## Deploying to Google Cloud Run

The server can be deployed to Google Cloud Run as a Docker container.
When the `PORT` environment variable is set, it starts in HTTP mode automatically and talks to MCP clients over the Streamable HTTP transport.

In HTTP mode, `/mcp` is **protected by OAuth 2.0**. The server acts as an OAuth resource server and,
for every request, verifies the Bearer token's (JWT's) signature, issuer (`iss`), audience (`aud`), and expiry against the authorization server's public keys (JWKS).
The login screen and token issuance are handled by an external authorization server (here, WorkOS AuthKit).

Cloud Run itself is exposed with `--allow-unauthenticated`. Cloud Run's IAM authentication (including IAP) is incompatible with connections from claude.ai,
so access control is done by OAuth in the app rather than by Cloud Run.

| Path | Authentication | Description |
|------|----------------|-------------|
| `/mcp` | Bearer token required | MCP endpoint |
| `/.well-known/oauth-protected-resource` | None | Metadata pointing to the authorization server (RFC 9728) |
| `/health` | None | Health check |

```
Claude (Web / Desktop / mobile), Claude Code, Anthropic API
        │  Authorization: Bearer <access token issued by WorkOS AuthKit>
        ▼
  Cloud Run (--allow-unauthenticated)
        │  /mcp verifies the JWT and limits users with ALLOWED_SUBJECTS
        ▼
  MCP handler
```

The Claude apps and Claude Code follow the metadata from the 401 response (`WWW-Authenticate` header) returned to requests without a token
to find the authorization server, and get a token after a login in the browser.
When using the Anthropic API, the caller prepares the token and passes it in.

### Prerequisites

- A Google Cloud project (with billing enabled)
- [gcloud CLI](https://cloud.google.com/sdk/docs/install) installed and logged in
- A [WorkOS](https://workos.com/) account (AuthKit is used as the OAuth authorization server)

### Step 1 — Set up the project and APIs

```bash
# Set the project to deploy to
gcloud config set project MY_PROJECT_ID

# Enable the required APIs (first time only)
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com  # only if you manage NCBI_API_KEY there
```

### Step 2 — Create an Artifact Registry repository (first time only)

```bash
gcloud artifacts repositories create pubmed-mcp \
  --repository-format=docker \
  --location=asia-northeast1 \
  --description="PubMed MCP Server"
```

### Step 3 — Store secrets in Secret Manager

Use Secret Manager so the NCBI API key doesn't end up in your command history or logs.

```bash
# Store the NCBI API key
echo -n "your_ncbi_api_key" | \
  gcloud secrets create ncbi-api-key \
    --data-file=- \
    --replication-policy=automatic
```

### Step 4 — Build and push the container image

With Cloud Build, you can build without installing Docker locally.
`gcloud builds submit` sends the files in the current directory to Cloud Build, so
**clone the repository first.**

```bash
# Clone the repository and move into it
git clone https://github.com/DJMIMA/PubMed_MCP.git
cd PubMed_MCP

# Build with Cloud Build (no local Docker needed)
gcloud builds submit \
  --region=asia-northeast1 \
  --tag asia-northeast1-docker.pkg.dev/MY_PROJECT_ID/pubmed-mcp/server:latest
```

To build with local Docker:

```bash
gcloud auth configure-docker asia-northeast1-docker.pkg.dev

docker build -t asia-northeast1-docker.pkg.dev/MY_PROJECT_ID/pubmed-mcp/server:latest .
docker push asia-northeast1-docker.pkg.dev/MY_PROJECT_ID/pubmed-mcp/server:latest
```

### Step 5 — Set up the OAuth authorization server (WorkOS AuthKit)

First, decide the public URL of the MCP endpoint. Cloud Run services are assigned a URL of the form
`https://SERVICE_NAME-PROJECT_NUMBER.REGION.run.app`, so you can determine it before deploying.

```bash
PROJECT_NUMBER=$(gcloud projects describe MY_PROJECT_ID --format='value(projectNumber)')
MCP_RESOURCE_URL="https://pubmed-mcp-${PROJECT_NUMBER}.asia-northeast1.run.app/mcp"
echo "$MCP_RESOURCE_URL"
```

This URL is `MCP_RESOURCE_URL`. Use **exactly the same string** for the WorkOS Resource Indicator and for the URL you register in each client
(clients check that the URL they connect to matches the `resource` in the metadata, and the server checks the token's `aud` against this value).
Cloud Run also assigns a URL of the form `https://pubmed-mcp-xxxx-an.a.run.app`, and both work, but use only one of them for OAuth.

Next, configure AuthKit in the WorkOS dashboard.

1. Under **Connect → Configuration**, enable **Dynamic Client Registration** (so MCP clients such as claude.ai can register themselves as OAuth clients)
2. Register `MCP_RESOURCE_URL` as a **Resource Indicator** (access tokens get this URL as their `aud`)
3. Open the authorization server metadata of your AuthKit domain and note the `issuer` and `jwks_uri` values

   ```bash
   curl https://YOUR_AUTHKIT_DOMAIN/.well-known/oauth-authorization-server
   # → {"issuer":"https://YOUR_AUTHKIT_DOMAIN", ..., "jwks_uri":"https://YOUR_AUTHKIT_DOMAIN/oauth2/jwks", ...}
   ```

WorkOS Staging and Production environments have separate settings and separate AuthKit domains. When you switch environments, redo the settings above
and replace `OAUTH_ISSUER` and `OAUTH_JWKS_URL`.

### Step 6 — Deploy to Cloud Run

Deploy with the values you noted in step 5. Set `ALLOWED_SUBJECTS` to a placeholder value (here, `placeholder`) for now (see step 8 for why).

```bash
# Replace with the issuer and jwks_uri values from step 5
OAUTH_ISSUER="https://YOUR_AUTHKIT_DOMAIN"
OAUTH_JWKS_URL="https://YOUR_AUTHKIT_DOMAIN/oauth2/jwks"

gcloud run deploy pubmed-mcp \
  --image asia-northeast1-docker.pkg.dev/MY_PROJECT_ID/pubmed-mcp/server:latest \
  --region asia-northeast1 \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --allow-unauthenticated \
  --set-secrets NCBI_API_KEY=ncbi-api-key:latest \
  --set-env-vars "OAUTH_ISSUER=${OAUTH_ISSUER},OAUTH_JWKS_URL=${OAUTH_JWKS_URL},MCP_RESOURCE_URL=${MCP_RESOURCE_URL},ALLOWED_SUBJECTS=placeholder"
```

| Variable | Value |
|----------|-------|
| `OAUTH_ISSUER` | The `issuer` from the authorization server metadata. It is compared with the token's `iss` exactly, so copy it as-is, including whether it has a trailing `/` |
| `OAUTH_JWKS_URL` | The `jwks_uri` from the same metadata: the URL of the public keys used to verify token signatures |
| `MCP_RESOURCE_URL` | The MCP endpoint URL you decided in step 5. It is compared with the token's `aud`, and published as `resource` in `/.well-known/oauth-protected-resource` |
| `ALLOWED_SUBJECTS` | A comma-separated list of user IDs (the token's `sub`) allowed to connect. Required: without it, every user who can get a valid token from AuthKit could connect |

If any of `OAUTH_ISSUER`, `OAUTH_JWKS_URL`, `MCP_RESOURCE_URL`, or `ALLOWED_SUBJECTS` is missing, the server exits at startup with
`Missing required environment variable: ...` and the deployment fails. If it fails, look for this message in the Cloud Run logs
(if you set the variables in Cloud Console, also check for spaces around the variable names).

> **`--set-env-vars` vs. `--update-env-vars`**: `--set-env-vars` removes all existing environment variables and then sets the ones you specify (variables you leave out are deleted).
> To add or change only some values after deploying, use `--update-env-vars`, which merges with the existing values (it also works with `gcloud run services update`).

### Step 7 — Verify the deployment

`/health` and `/.well-known/oauth-protected-resource` respond without authentication. Without a token, `/mcp` **should return 401**.

**Linux / macOS (bash)**

```bash
PROJECT_NUMBER=$(gcloud projects describe MY_PROJECT_ID --format='value(projectNumber)')
CLOUD_RUN_URL="https://pubmed-mcp-${PROJECT_NUMBER}.asia-northeast1.run.app"

# Health check
curl "$CLOUD_RUN_URL/health"
# → ok

# Protected Resource Metadata (check that resource is MCP_RESOURCE_URL and authorization_servers is OAUTH_ISSUER)
curl "$CLOUD_RUN_URL/.well-known/oauth-protected-resource"
# → {"resource":"https://pubmed-mcp-PROJECT_NUMBER.asia-northeast1.run.app/mcp","authorization_servers":["https://YOUR_AUTHKIT_DOMAIN"],"bearer_methods_supported":["header"]}

# MCP endpoint (401 because there is no token; -i shows headers; a heredoc avoids quoting problems)
curl -i "$CLOUD_RUN_URL/mcp" \
  -X POST \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.0.1"}}}
EOF
```

The `/mcp` response looks like this (excerpt; the HTTP version and header-name casing vary by environment):

```
HTTP/2 401
www-authenticate: Bearer resource_metadata="https://pubmed-mcp-PROJECT_NUMBER.asia-northeast1.run.app/.well-known/oauth-protected-resource", error="missing_token"
content-type: application/json; charset=utf-8

{"error":"missing_token"}
```

MCP clients follow `resource_metadata` in the `WWW-Authenticate` header to find the authorization server.
If token verification fails, the server returns 401 with `error="invalid_token"`; if the token is valid but its `sub` is not in `ALLOWED_SUBJECTS`, it returns 403 (`{"error":"forbidden"}`).

**Windows (Command Prompt)**

```cmd
:: Set %CLOUD_RUN_URL% before running (replace PROJECT_NUMBER with your project number)
set CLOUD_RUN_URL=https://pubmed-mcp-PROJECT_NUMBER.asia-northeast1.run.app

curl "%CLOUD_RUN_URL%/health"

curl "%CLOUD_RUN_URL%/.well-known/oauth-protected-resource"

curl -i "%CLOUD_RUN_URL%/mcp" -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"0.0.1\"}}}"
```

**Windows (PowerShell)**

```powershell
$CLOUD_RUN_URL = "https://pubmed-mcp-PROJECT_NUMBER.asia-northeast1.run.app"

curl.exe "$CLOUD_RUN_URL/health"

curl.exe "$CLOUD_RUN_URL/.well-known/oauth-protected-resource"

curl.exe -i "$CLOUD_RUN_URL/mcp" -X POST -H "Content-Type: application/json" `
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.0.1"}}}'
```

### Step 8 — Add your user ID to ALLOWED_SUBJECTS

With Dynamic Client Registration, anyone can register an OAuth client, so `ALLOWED_SUBJECTS` limits which users can connect
(without it, every user who can log in to AuthKit could use `/mcp`, including third parties if AuthKit allows sign-ups, so the server does not start without it).
The value is the access token's `sub` (the WorkOS user ID, starting with `user_`).

The server logs the `sub` of users it rejects. So connect once with the placeholder value in place, and find your `sub` in the log entry for the rejected request.

1. Connect from claude.ai or another client following [Client connection settings](#client-connection-settings) below, and log in with WorkOS AuthKit.
   Because your `sub` is not in `ALLOWED_SUBJECTS`, the connection fails with 403, and the server logs `[auth] forbidden subject: ...`.
2. Find your `sub` in the logs (it is the same as the user ID shown under **Users** in the WorkOS dashboard).

   ```bash
   gcloud run services logs read pubmed-mcp \
     --region asia-northeast1 \
     --log-filter='textPayload:"forbidden subject"' \
     --limit 5
   # → ... [auth] forbidden subject: user_01XXXXXXXXXXXXXXXXXXXXXXXX
   ```

3. Set that value. Because this uses `--update-env-vars`, the other environment variables stay as they are.

   ```bash
   gcloud run services update pubmed-mcp \
     --region asia-northeast1 \
     --update-env-vars ALLOWED_SUBJECTS=user_01XXXXXXXXXXXXXXXXXXXXXXXX
   ```

   To allow several users, the value contains commas, so change the delimiter with `^@^`
   (for example, `--update-env-vars '^@^ALLOWED_SUBJECTS=user_01AAAA,user_01BBBB'`; in Windows cmd / PowerShell, write `^` as `^^^^`. See `gcloud topic escaping` for details).
4. Reconnect from the client.

---

### Client connection settings

After deploying, register the MCP endpoint URL in each client. Use **exactly the same string** as `MCP_RESOURCE_URL`
(for example, `https://pubmed-mcp-PROJECT_NUMBER.asia-northeast1.run.app/mcp`).
The WorkOS AuthKit login screen opens on the first connection. You can connect if the `sub` of the account you log in with is in `ALLOWED_SUBJECTS`
(see step 8 for adding your own `sub`).

**Claude (Web and Claude Desktop) — custom connector**

Add the remote server as a "custom connector" ([Claude Help Center](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)).
The Free plan also allows one custom connector.

- Pro / Max plans
  1. Open **Customize > Connectors** in [claude.ai](https://claude.ai) or Claude Desktop
  2. Click **+** → **Add custom connector**
  3. Enter the URL (`MCP_RESOURCE_URL`) and click **Add**
  4. Authenticate from **Connect** on the added connector (the WorkOS AuthKit login screen opens)
- Team / Enterprise plans
  1. An owner opens **Organization settings > Connectors**, clicks **Add**, hovers over **Custom**, and chooses **Web**
  2. Enter the URL (`MCP_RESOURCE_URL`) and click **Add**
  3. Each member finds the connector under **Customize > Connectors** and authenticates from **Connect**

Leave OAuth Client ID / OAuth Client Secret under **Advanced settings** empty (the client registers itself with Dynamic Client Registration).
To use it in a chat, enable it per conversation from **+** → **Connectors** at the bottom left of the input box.

Claude Desktop's `claude_desktop_config.json` is for local (stdio) servers; writing `"type"` or `"url"` there does not connect to a remote server.
On Desktop too, add the remote server as a custom connector as above (connectors added on the Web are available on Desktop as well).

**Claude mobile apps (Android / iOS)**

Custom connectors added on the Web or in Claude Desktop work as-is in the mobile apps signed in to the same account.
Adding connectors from the mobile apps is a beta feature, so add them on the Web or in Desktop.

**Claude Code**

```bash
claude mcp add --transport http --scope user pubmed-remote https://pubmed-mcp-PROJECT_NUMBER.asia-northeast1.run.app/mcp
```

Claude Code does not read `mcpServers` in `~/.claude/settings.json`, so register the server with `claude mcp add`.
After registering, open `/mcp` in Claude Code, choose `pubmed-remote`, and log in to WorkOS AuthKit in the browser to authenticate.

**Anthropic API (Python)**

```python
import os

import anthropic

client = anthropic.Anthropic()
response = client.beta.messages.create(
    model="claude-opus-5",
    max_tokens=16000,
    messages=[{"role": "user", "content": "..."}],
    mcp_servers=[{
        "type": "url",
        "url": "https://pubmed-mcp-PROJECT_NUMBER.asia-northeast1.run.app/mcp",
        "name": "pubmed",
        "authorization_token": os.environ["PUBMED_MCP_TOKEN"],
    }],
    tools=[{"type": "mcp_toolset", "mcp_server_name": "pubmed"}],
    betas=["mcp-client-2025-11-20"]
)
```

The MCP connector neither performs the OAuth login nor refreshes tokens. The caller must get an access token that WorkOS AuthKit issued for this server
(with `aud` equal to `MCP_RESOURCE_URL` and a `sub` included in `ALLOWED_SUBJECTS`), pass it as `authorization_token`,
and get a new one when it expires.

You can get a token for testing with MCP Inspector ([MCP connector documentation](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector#authentication)):

1. Run `npx @modelcontextprotocol/inspector`
2. Choose **Streamable HTTP** as the **Transport type** and enter `MCP_RESOURCE_URL` as the URL
3. Click **Open Auth Settings** → **Quick OAuth Flow** and log in with WorkOS AuthKit
4. Continue until **Authentication complete**, then copy the displayed `access_token` value

---

### Updating the image (redeploying)

```bash
cd PubMed_MCP
git pull

gcloud builds submit \
  --region=asia-northeast1 \
  --tag asia-northeast1-docker.pkg.dev/MY_PROJECT_ID/pubmed-mcp/server:latest

gcloud run services update pubmed-mcp \
  --region asia-northeast1 \
  --image asia-northeast1-docker.pkg.dev/MY_PROJECT_ID/pubmed-mcp/server:latest
```

An update that specifies only `--image` keeps the existing environment variables and secrets.

---

## Development commands

```bash
npm run build      # Compile TypeScript → dist/
npm run dev        # Run directly with tsx (for development)
npm run cli -- search "CRISPR" --max-results 5   # Run the CLI directly with tsx (for development)
npm test           # Run the test suite
npm run typecheck  # Type-check only (no emit)
npm run lint       # Run ESLint
```

### Releasing to npm (for maintainers)

Publishing a Release on GitHub makes [`.github/workflows/release.yml`](.github/workflows/release.yml) stage a publish to npm ([staged publishing](https://docs.npmjs.com/staged-publishing/)).
The new version is not published until a maintainer approves it on npmjs.com with 2FA. This way, a compromised workflow or dependency cannot publish on its own.
Because the workflow uses npm [Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC), no npm token is stored in the repository.

PRs that make changes add the same entry to `[Unreleased]` in both [`CHANGELOG.md`](CHANGELOG.md) (English) and [`CHANGELOG_ja.md`](CHANGELOG_ja.md) (Japanese). To release:

1. On a release branch, run `npm version patch --no-git-tag-version` (or `minor` / `major`) to bump the version in `package.json`
   (GitHub adds the tag in step 3, so don't tag here)
2. In both `CHANGELOG.md` and `CHANGELOG_ja.md`, move the contents of `[Unreleased]` under a heading for the new version (for example, `## [1.0.1] - 2026-11-01`), update the comparison links at the end, then open a PR and merge it into main
3. On GitHub, publish a Release targeting main with the tag `v<version>` (for example, `v1.0.1`). Paste the corresponding part of `CHANGELOG.md` (English) into the release notes
4. The workflow checks that the tag matches the version in `package.json`, runs typecheck, lint, tests, and build, and then stages the publish
5. Review it on the **Staged Packages** tab of the package page on npmjs.com and click **Approve** (2FA required). You can also approve from the CLI with `npm stage approve <stage-id>`

As a rule of thumb, bug fixes and documentation changes are `patch`, new tools or options are `minor`,
and changes to tool names, arguments, or output shape that break existing usage are `major`.

The first release is published by hand, because Trusted Publishing can't be configured until the package exists on npm.

1. Run `npm login` with an npm account that has 2FA enabled, and publish the latest main with `npm publish` (if it is held for approval, approve it as in step 5 above)
2. In the package settings on npmjs.com → **Trusted Publisher**, choose GitHub Actions and register the repository `DJMIMA/PubMed_MCP` and the workflow `release.yml`.
   Under **Allowed actions**, allow only `npm stage publish` (always allowed); do not allow `npm publish` or `npm dist-tag`
3. On the same settings page, under **Publishing access**, choose **Require two-factor authentication and disallow tokens**

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NCBI_API_KEY` | No | NCBI API key. Raises the rate limit from 3 to 8 req/s |
| `PORT` | No | Starts the server in HTTP mode when set. Cloud Run injects this variable automatically |
| `OAUTH_ISSUER` | Required in HTTP mode | The authorization server's issuer (`issuer` in its metadata). Compared with the token's `iss` |
| `OAUTH_JWKS_URL` | Required in HTTP mode | The URL of the authorization server's JWKS (`jwks_uri` in the same metadata). Used to verify token signatures |
| `MCP_RESOURCE_URL` | Required in HTTP mode | The public URL of the MCP endpoint. Compared with the token's `aud`, and published as `resource` in the Protected Resource Metadata |
| `ALLOWED_SUBJECTS` | Required in HTTP mode | A comma-separated list of token `sub` values allowed to connect |

`OAUTH_ISSUER`, `OAUTH_JWKS_URL`, `MCP_RESOURCE_URL`, and `ALLOWED_SUBJECTS` are used only in HTTP mode and are not needed in stdio mode.
See steps 5–8 of [Deploying to Google Cloud Run](#deploying-to-google-cloud-run) for how to choose their values.

To use a `.env` file, copy `.env.example` and edit it.
In production, pass `NCBI_API_KEY` from Secret Manager with Cloud Run's `--set-secrets`, and set the OAuth values with `--set-env-vars` / `--update-env-vars`.

---

## References

- [MCP documentation](https://modelcontextprotocol.io/docs)
- [NCBI E-utilities documentation](https://www.ncbi.nlm.nih.gov/books/NBK25499/)
- [NCBI API key registration](https://www.ncbi.nlm.nih.gov/account/)
- [PubMed search help](https://pubmed.ncbi.nlm.nih.gov/help/)
- [Cloud Run documentation](https://cloud.google.com/run/docs)
- [Secret Manager documentation](https://cloud.google.com/secret-manager/docs)

---

## License

The source code in this repository is released under the [MIT License](LICENSE).

- This is an unofficial tool, not affiliated with NCBI or NLM (the U.S. National Library of Medicine).
- Access to PubMed / PMC goes through NCBI's E-utilities. When using it, follow [NCBI's website and data usage policies, including the Disclaimer and Copyright notice](https://www.ncbi.nlm.nih.gov/home/about/policies/), and the [E-utilities usage guidelines](https://www.ncbi.nlm.nih.gov/books/NBK25497/).
- As the guidelines require, requests to NCBI include this software's name (`tool=pubmed-mcp`) and the developer's contact address (`email`). If you modify this code and distribute it as different software, change `TOOL_NAME` and `TOOL_EMAIL` in `src/pubmed/client.ts` to your own values.
- The MIT License covers only this software's code. Copyright in retrieved abstracts and full texts belongs to their authors and publishers. Check each article's license with `get_copyright_status`.
