---
name: pubmed-cli
description: Search PubMed and PubMed Central from the shell with the `pubmed` CLI, saving results as JSON files and extracting only the fields you need with jq. Use for literature searches, article metadata and abstracts, full text, citing or similar articles, PMID/PMCID/DOI conversion, citation lookup, and open-access checks when a shell is available and the `pubmed` command is installed. Prefer it over the PubMed MCP tools when results are large (metadata for more than a few articles, any full text) or will be reused.
---

# PubMed CLI

`pubmed` runs the same code as the PubMed MCP tools and prints the same JSON, to stdout or to a file. Save results to files and read them with `jq` so that large records never enter the context: metadata is about 5 KB per article, and one full text is 50–100 KB.

If `pubmed --help` fails, the CLI is not installed; use the PubMed MCP tools instead.

## Rules

1. Save anything larger than a PMID list with `-o <file>`, then read it with `jq`. Do not `cat` metadata or full-text files. With `-o`, the CLI prints a summary and the file size to stderr.
2. Pass all IDs to one invocation, as arguments or one per line on stdin with `-`. The CLI splits long lists into batches and paces requests under NCBI's rate limit. Do not run several `pubmed` processes in parallel; together they can exceed the limit.
3. Before concluding that a low or zero `total_count` means no literature exists, check `query_translation`, `warnings`, and `errors` in the search output.
4. Exit status is 0 on success, 1 when NCBI or a file operation fails, and 2 for invalid usage; the reason is on stderr. Use `set -o pipefail` in pipelines.
5. On Windows, run pipelines in Git Bash or PowerShell 7. In Windows PowerShell 5.1, write files with `-o` rather than `>`, which would save them as UTF-16.

## Commands

| Command | MCP tool | Input | IDs per request |
|---|---|---|---|
| `pubmed search <query>` | `search_articles` | query, or `-` for stdin | — |
| `pubmed metadata <pmid>...` | `get_article_metadata` | PMIDs | 200 |
| `pubmed related <pmid>...` | `find_related_articles` | PMIDs | 200 |
| `pubmed citation --journal J --year Y ...` | `lookup_article_by_citation` | options, or `--input <file\|->` with a JSON array or JSON Lines | 100 |
| `pubmed convert <id>... [--id-type pmid\|pmcid\|doi]` | `convert_article_ids` | IDs of one type | 200 |
| `pubmed fulltext <pmcid>...` | `get_full_text_article` | PMCIDs | 20 |
| `pubmed copyright <pmid>...` | `get_copyright_status` | PMIDs | 50 |

Options are the MCP parameters in kebab-case: `--max-results`, `--retstart`, `--sort`, `--field`, `--date-from`, `--date-to`, `--datetype`, `--link-type`, `--id-type`. Run `pubmed <command> --help` for details.

## Output fields

- search: `.pmids[]`, `.total_count`, `.has_more`, `.query_translation`, `.warnings`, `.errors`
- metadata: `.articles[]` with `.identifiers.pmid`, `.identifiers.doi`, `.identifiers.pmcid`, `.title`, `.abstract`, `.authors[]` (`.last_name`, `.fore_name`, `.initials`, `.affiliations[]`), `.journal.title`, `.journal.iso_abbreviation`, `.publication_date.year`, `.mesh_terms[]`, `.keywords[]`, `.article_types[]`, `.citation` (`.volume`, `.issue`, `.pages`)
- related: `.linksets[].linksetdbs[].links[]`; `citing_pmc_articles` gives PMC IDs without the `PMC` prefix
- citation: `.citations[]` with `.key` and `.pmid` (`""` when not found)
- convert: `.records[]` with `.pmid`, `.pmcid`, `.doi`, `."requested-id"`, `.errmsg`
- fulltext: `.articles[]` with `.identifiers.pmcid`, `.title`, `.full_text`; unavailable IDs in `.errors[]`
- copyright: `.statuses[]` with `.pmid`, `.pmcid`, `.has_full_text`, `.license`, `.is_open_access`

## Recipes

```bash
# Search, then check how PubMed interpreted the query
pubmed search 'TP53[tiab] AND myelodysplastic syndromes[mh]' --max-results 200 -o search.json
jq '{total_count, query_translation, warnings, errors}' search.json

# Metadata for every hit, listed one line per article
jq -r '.pmids[]' search.json | pubmed metadata - -o meta.json
jq -r '.articles[] | [.identifiers.pmid, .publication_date.year, .journal.iso_abbreviation, .title] | @tsv' meta.json

# One abstract
jq -r --arg p 34265844 '.articles[] | select(.identifiers.pmid == $p) | .abstract' meta.json

# Filter by a term in the title or abstract, or by article type
jq -c '.articles[] | select((.title + " " + .abstract) | test("venetoclax"; "i")) | {pmid: .identifiers.pmid, title}' meta.json
jq -r '.articles[] | select(.article_types | index("Review")) | .identifiers.pmid' meta.json

# Full text only where it is available; search it instead of reading it whole
jq -r '.pmids[]' search.json | pubmed copyright - -o rights.json
jq -r '.statuses[] | select(.has_full_text) | .pmcid' rights.json | pubmed fulltext - -o full.json
jq -r '.articles[] | select(.identifiers.pmcid == "PMC8371605") | .full_text' full.json | grep -n -i -C1 'resistance'

# Articles citing a paper, as metadata
pubmed related 34265844 --link-type citing_pmc_articles -o citing.json
jq -r '.linksets[].linksetdbs[].links[]' citing.json | pubmed convert - --id-type pmcid -o citing_ids.json
jq -r '.records[].pmid // empty' citing_ids.json | pubmed metadata - -o citing_meta.json

# Resolve references from a JSON Lines file of {journal, year, volume, first_page, author}
pubmed citation --input refs.jsonl -o matched.json
jq -r '.citations[] | [.key, .pmid] | @tsv' matched.json
```
