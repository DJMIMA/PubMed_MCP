/**
 * Command table for the pubmed CLI.
 *
 * Each command runs one MCP tool: it turns command-line input into the tool's
 * parameters, validates them with the tool's zod schema (as the MCP server
 * does), and calls the same tool function, so the JSON output is the same.
 * Lists longer than a tool's per-request limit are split into batches that
 * run one after another through the shared client and its rate limiter; the
 * batch results are merged into one response of the same shape.
 */

import { z } from 'zod';
import type { NcbiClient } from '../pubmed/client.js';
import { searchArticles, searchArticlesSchema } from '../tools/searchArticles.js';
import {
  getArticleMetadata,
  getArticleMetadataSchema,
  MAX_METADATA_PMIDS,
} from '../tools/getArticleMetadata.js';
import {
  findRelatedArticles,
  findRelatedArticlesSchema,
} from '../tools/findRelatedArticles.js';
import {
  lookupArticleByCitation,
  lookupArticleByCitationSchema,
  MAX_CITATIONS,
} from '../tools/lookupArticleByCitation.js';
import {
  convertArticleIds,
  convertArticleIdsSchema,
  MAX_CONVERT_IDS,
} from '../tools/convertArticleIds.js';
import {
  getFullTextArticle,
  getFullTextArticleSchema,
  MAX_FULL_TEXT_IDS,
} from '../tools/getFullTextArticle.js';
import {
  getCopyrightStatus,
  getCopyrightStatusSchema,
  MAX_COPYRIGHT_PMIDS,
} from '../tools/getCopyrightStatus.js';

/** Invalid command-line input. The CLI exits with status 2 instead of 1. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export interface CommandInput {
  /** Option values by long name (e.g. "max-results"); unset options are undefined. */
  values: Record<string, string | undefined>;
  positionals: string[];
  /** Read a file, or stdin when path is "-". */
  readText(path: string): Promise<string>;
}

export interface CommandResult {
  output: unknown;
  /** Short description of the output, e.g. "20 articles". */
  summary: string;
}

export interface Command {
  name: string;
  /** The MCP tool this command runs. */
  tool: string;
  /** One line for the command list in `pubmed --help`. */
  description: string;
  help: string;
  options: Record<string, { type: 'string' }>;
  execute(input: CommandInput, client: NcbiClient): Promise<CommandResult>;
}

// ─── search ─────────────────────────────────────────────────────────────────

const search: Command = {
  name: 'search',
  tool: 'search_articles',
  description: 'Search PubMed and return matching PMIDs',
  options: {
    'max-results': { type: 'string' },
    retstart: { type: 'string' },
    sort: { type: 'string' },
    field: { type: 'string' },
    'date-from': { type: 'string' },
    'date-to': { type: 'string' },
    datetype: { type: 'string' },
  },
  help: `Usage: pubmed search <query> [options]
       pubmed search - [options]      (read the query from stdin)

Search PubMed. Prints PMIDs with total_count, query_translation, warnings,
and errors (same JSON as the search_articles MCP tool).

Options:
  --max-results <n>   PMIDs to return, 1-10000 (default 20)
  --retstart <n>      Offset of the first PMID, for paging (default 0)
  --sort <order>      relevance | pub_date | author | journal_name
  --field <field>     Restrict untagged terms to one field:
                      title | tiab | mesh | author | journal | affiliation
  --date-from <date>  Start date: YYYY, YYYY/MM, or YYYY/MM/DD
  --date-to <date>    End date, same formats (either bound may be omitted)
  --datetype <type>   pdat = publication date (default) | edat = Entrez date |
                      mdat = modification date

PubMed maps untagged terms through Automatic Term Mapping (ATM). Before
concluding that a low or zero total_count means no literature exists, check
query_translation, warnings, and errors. To search several words in one
field, tag each term; when a quoted phrase is not indexed, use a proximity
search such as "drug resistance"[tiab:~0].

Example:
  pubmed search "TP53[tiab] AND myelodysplastic syndromes[mh]" --max-results 200 -o search.json
  jq '{total_count, query_translation, warnings, errors}' search.json
`,
  async execute(input, client) {
    // A query read from stdin may span several lines.
    const query = (
      input.positionals.length === 1 && input.positionals[0] === '-'
        ? (await input.readText('-')).replace(/\s+/g, ' ')
        : input.positionals.join(' ')
    ).trim();
    if (!query) throw new UsageError('missing <query>');

    const params = validate(searchArticlesSchema, {
      query,
      max_results: intOption(input, 'max-results'),
      retstart: intOption(input, 'retstart'),
      sort: input.values.sort,
      field: input.values.field,
      date_from: input.values['date-from'],
      date_to: input.values['date-to'],
      datetype: input.values.datetype,
    });
    const output = await searchArticles(params, client);
    return { output, summary: `${output.returned_count} of ${output.total_count} PMIDs` };
  },
};

// ─── metadata ───────────────────────────────────────────────────────────────

const metadata: Command = {
  name: 'metadata',
  tool: 'get_article_metadata',
  description: 'Get title, abstract, authors, MeSH terms, etc.',
  options: {},
  help: `Usage: pubmed metadata <pmid>... | -

Get title, abstract, authors with affiliations, journal, publication date,
MeSH terms, keywords, and article types (same JSON as get_article_metadata).
Lists longer than ${MAX_METADATA_PMIDS} PMIDs are fetched in batches and merged.

Records are large (about 5 KB each, mostly abstracts and affiliations): save
them with -o and extract the fields you need with jq.

Example:
  jq -r '.pmids[]' search.json | pubmed metadata - -o meta.json
  jq -r '.articles[] | [.identifiers.pmid, .publication_date.year, .title] | @tsv' meta.json
`,
  async execute(input, client) {
    const pmids = await readIds(input, PMID);
    const batches = chunk(pmids, MAX_METADATA_PMIDS).map((batch) =>
      validate(getArticleMetadataSchema, { pmids: batch })
    );
    const results = await runBatches(batches, (params) => getArticleMetadata(params, client));

    const articles = results.flatMap((r) => r.articles);
    const output = {
      articles,
      count: articles.length,
      important_legal_notice: results[0].important_legal_notice,
    };
    return { output, summary: plural(output.count, 'article') };
  },
};

// ─── related ────────────────────────────────────────────────────────────────

/** ELink takes the IDs in the URL, so keep each request's list short. */
const RELATED_BATCH_SIZE = 200;

const related: Command = {
  name: 'related',
  tool: 'find_related_articles',
  description: 'Find similar or citing articles and linked records',
  options: {
    'link-type': { type: 'string' },
    'max-results': { type: 'string' },
  },
  help: `Usage: pubmed related <pmid>... | - [options]

Find linked records for each PMID with NCBI ELink (same JSON as
find_related_articles). Lists longer than ${RELATED_BATCH_SIZE} PMIDs are split into batches.

Options:
  --link-type <type>  similar_articles (default)  similar PubMed articles
                      citing_pmc_articles         PMC articles citing the PMID
                      linked_gene_records         NCBI Gene records
                      linked_refseq_proteins      RefSeq protein records
                      linked_refseq_nucleotides   RefSeq nucleotide records
  --max-results <n>   Cap on links per source PMID, 1-1000

citing_pmc_articles returns PMC IDs without the "PMC" prefix; pubmed fulltext
and pubmed convert --id-type pmcid accept them as they are.

Example:
  pubmed related 34265844 --link-type citing_pmc_articles -o citing.json
  jq -r '.linksets[].linksetdbs[].links[]' citing.json
`,
  async execute(input, client) {
    const pmids = await readIds(input, PMID);
    const linkType = input.values['link-type'];
    const maxResults = intOption(input, 'max-results');
    const batches = chunk(pmids, RELATED_BATCH_SIZE).map((batch) =>
      validate(findRelatedArticlesSchema, {
        pmids: batch,
        link_type: linkType,
        max_results: maxResults,
      })
    );
    const results = await runBatches(batches, (params) => findRelatedArticles(params, client));

    const output = { linksets: results.flatMap((r) => r.linksets) };
    const links = output.linksets
      .flatMap((linkset) => linkset.linksetdbs)
      .reduce((total, linksetdb) => total + linksetdb.links.length, 0);
    return { output, summary: `${plural(links, 'link')} for ${plural(pmids.length, 'PMID')}` };
  },
};

// ─── citation ───────────────────────────────────────────────────────────────

const CITATION_SCHEMA = lookupArticleByCitationSchema.citations.element;

const citation: Command = {
  name: 'citation',
  tool: 'lookup_article_by_citation',
  description: 'Find PMIDs from journal, year, volume, page, author',
  options: {
    journal: { type: 'string' },
    year: { type: 'string' },
    volume: { type: 'string' },
    'first-page': { type: 'string' },
    author: { type: 'string' },
    key: { type: 'string' },
    input: { type: 'string' },
  },
  help: `Usage: pubmed citation --journal <name> --year <yyyy> [options]
       pubmed citation --input <file|->

Find PMIDs from citation details with NCBI ECitMatch (same JSON as
lookup_article_by_citation). Unmatched citations have an empty pmid.

Options:
  --journal <name>    Journal title or abbreviation, e.g. "N Engl J Med"
  --year <yyyy>       Publication year
  --volume <v>        Volume
  --first-page <p>    First page
  --author <name>     First author's last name
  --key <key>         Label echoed back in the result (default 1)
  --input <file|->    Many citations: a JSON array or JSON Lines of objects
                      {journal, year, volume, first_page, author, key};
                      missing keys default to 1, 2, 3, ... Lists longer than
                      ${MAX_CITATIONS} are split into batches.

Example:
  pubmed citation --journal Nature --year 2021 --volume 596 --first-page 583 --author Jumper
`,
  async execute(input, client) {
    const citations = (
      input.values.input !== undefined
        ? await readCitationList(input, input.values.input)
        : [citationFromOptions(input)]
    ).map(validateCitation);

    const results = await runBatches(chunk(citations, MAX_CITATIONS), (batch) =>
      lookupArticleByCitation({ citations: batch }, client)
    );

    const output = { citations: results.flatMap((r) => r.citations) };
    const matched = output.citations.filter((c) => c.pmid !== '').length;
    return {
      output,
      summary: `${matched} of ${plural(output.citations.length, 'citation')} matched`,
    };
  },
};

const CITATION_OPTIONS = ['journal', 'year', 'volume', 'first-page', 'author', 'key'];

function citationFromOptions(input: CommandInput): Record<string, unknown> {
  const { journal } = input.values;
  const year = intOption(input, 'year');
  if (journal === undefined || year === undefined) {
    throw new UsageError('give --journal and --year, or a list of citations with --input');
  }
  return {
    journal,
    year,
    volume: input.values.volume,
    first_page: input.values['first-page'],
    author: input.values.author,
    key: input.values.key ?? '1',
  };
}

/** Read --input: one JSON document (an array or a single object), or JSON Lines. */
async function readCitationList(input: CommandInput, path: string): Promise<unknown[]> {
  if (CITATION_OPTIONS.some((name) => input.values[name] !== undefined)) {
    throw new UsageError('use either --input or the single-citation options, not both');
  }
  const text = stripBom(await input.readText(path)).trim();
  if (!text) throw new UsageError('--input is empty');

  let items: unknown[];
  try {
    items = parseJsonList(text);
  } catch (err) {
    throw new UsageError(`--input is not JSON or JSON Lines: ${errorMessage(err)}`);
  }
  return items.map(normalizeCitation);
}

/** Drop a leading byte order mark, which some Windows editors write. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseJsonList(text: string): unknown[] {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value : [value];
  } catch {
    // Not a single JSON document: read it as JSON Lines.
    return text
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as unknown);
  }
}

/**
 * Fill in a missing key and accept the loose types that CSV-derived JSON often
 * has: numbers for volume, first_page, and key, and a numeric string for year.
 */
function normalizeCitation(item: unknown, index: number): unknown {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    throw new UsageError(`citation ${index + 1} in --input is not a JSON object`);
  }
  const c = item as Record<string, unknown>;
  return {
    ...c,
    year: typeof c.year === 'string' && /^\d+$/.test(c.year.trim()) ? Number(c.year) : c.year,
    volume: numberToString(c.volume),
    first_page: numberToString(c.first_page),
    key: c.key === undefined ? String(index + 1) : numberToString(c.key),
  };
}

function numberToString(value: unknown): unknown {
  return typeof value === 'number' ? String(value) : value;
}

function validateCitation(item: unknown, index: number): z.output<typeof CITATION_SCHEMA> {
  const result = CITATION_SCHEMA.safeParse(item);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new UsageError(
      `citation ${index + 1}: invalid ${issue.path.join('.') || 'value'}: ${issue.message}`
    );
  }
  return result.data;
}

// ─── convert ────────────────────────────────────────────────────────────────

const convert: Command = {
  name: 'convert',
  tool: 'convert_article_ids',
  description: 'Convert between PMID, PMCID, and DOI',
  options: {
    'id-type': { type: 'string' },
  },
  help: `Usage: pubmed convert <id>... | - [--id-type pmid|pmcid|doi]

Convert between PMID, PMCID, and DOI with the NCBI PMC ID Converter (same
JSON as convert_article_ids). All IDs must be of the --id-type given
(default pmid). Lists longer than ${MAX_CONVERT_IDS} IDs are split into batches.

Example:
  pubmed convert 34265844 | jq -r '.records[] | [.pmid, .pmcid // "", .doi // ""] | @tsv'
`,
  async execute(input, client) {
    const idType = input.values['id-type'] ?? 'pmid';
    const kind = CONVERT_ID_KINDS.get(idType);
    if (!kind) {
      throw new UsageError(
        `invalid --id-type: expected pmid, pmcid, or doi, got ${JSON.stringify(idType)}`
      );
    }
    const ids = await readIds(input, kind);
    const batches = chunk(ids, MAX_CONVERT_IDS).map((batch) =>
      validate(convertArticleIdsSchema, { ids: batch, id_type: idType })
    );
    const results = await runBatches(batches, (params) => convertArticleIds(params, client));

    // Batches share one response envelope; only the ID lists grow.
    const [first] = results;
    const output = {
      ...first,
      request: { ...first.request, ids: results.flatMap((r) => r.request.ids) },
      records: results.flatMap((r) => r.records),
    };
    return { output, summary: plural(output.records.length, 'record') };
  },
};

// ─── fulltext ───────────────────────────────────────────────────────────────

const fulltext: Command = {
  name: 'fulltext',
  tool: 'get_full_text_article',
  description: 'Get the full text of PMC open-access articles',
  options: {},
  help: `Usage: pubmed fulltext <pmcid>... | -

Get the full text of PMC articles as plain text: all sections, figure and
table captions, and references (same JSON as get_full_text_article). Only the
PMC Open Access subset is available; other IDs are listed in errors. Lists
longer than ${MAX_FULL_TEXT_IDS} PMCIDs are fetched in batches and merged.

Each article is typically tens of thousands of characters. Save them with -o
and pull out only the passages you need. Get PMCIDs from PMIDs with pubmed
convert, or check which PMIDs have full text with pubmed copyright.

Example:
  pubmed fulltext PMC8371605 -o full.json
  jq -r '.articles[0].full_text' full.json | grep -n -i 'confidence'
`,
  async execute(input, client) {
    const pmcids = await readIds(input, PMCID);
    const batches = chunk(pmcids, MAX_FULL_TEXT_IDS).map((batch) =>
      validate(getFullTextArticleSchema, { pmc_ids: batch })
    );
    const results = await runBatches(batches, (params) => getFullTextArticle(params, client));

    const articles = results.flatMap((r) => r.articles);
    const output = {
      important_legal_notice: results[0].important_legal_notice,
      articles,
      errors: results.flatMap((r) => r.errors),
      count: articles.length,
    };
    return {
      output,
      summary: `${plural(output.count, 'article')}, ${output.errors.length} unavailable`,
    };
  },
};

// ─── copyright ──────────────────────────────────────────────────────────────

const copyright: Command = {
  name: 'copyright',
  tool: 'get_copyright_status',
  description: 'Check full-text availability and license',
  options: {},
  help: `Usage: pubmed copyright <pmid>... | -

Check whether full text can be retrieved (has_full_text), plus the license,
copyright statement, and PMC open-access status (same JSON as
get_copyright_status). Lists longer than ${MAX_COPYRIGHT_PMIDS} PMIDs are split into batches.

Example:
  pubmed copyright - < pmids.txt -o rights.json
  jq -r '.statuses[] | select(.has_full_text) | .pmcid' rights.json | pubmed fulltext - -o full.json
`,
  async execute(input, client) {
    const pmids = await readIds(input, PMID);
    const batches = chunk(pmids, MAX_COPYRIGHT_PMIDS).map((batch) =>
      validate(getCopyrightStatusSchema, { pmids: batch })
    );
    const results = await runBatches(batches, (params) => getCopyrightStatus(params, client));

    const statuses = results.flatMap((r) => r.statuses);
    const output = { statuses, count: statuses.length };
    const withFullText = statuses.filter((s) => s.has_full_text).length;
    return { output, summary: `${plural(output.count, 'PMID')}, ${withFullText} with full text` };
  },
};

export const COMMANDS: Command[] = [
  search,
  metadata,
  related,
  citation,
  convert,
  fulltext,
  copyright,
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface IdKind {
  label: string;
  pattern: RegExp;
}

const PMID: IdKind = { label: 'PMID', pattern: /^\d+$/ };
const PMCID: IdKind = { label: 'PMCID', pattern: /^(PMC)?\d+$/i };
const DOI: IdKind = { label: 'DOI', pattern: /^10\.\S+\/\S+$/ };

const CONVERT_ID_KINDS = new Map([
  ['pmid', PMID],
  ['pmcid', PMCID],
  ['doi', DOI],
]);

/**
 * Collect IDs from the arguments, separated by whitespace or commas.
 * "-" reads them from stdin, e.g. the output of jq -r '.pmids[]'.
 */
async function readIds(input: CommandInput, kind: IdKind): Promise<string[]> {
  const ids: string[] = [];
  for (const arg of input.positionals) {
    const text = arg === '-' ? await input.readText('-') : arg;
    ids.push(...text.split(/[\s,]+/).filter(Boolean));
  }
  if (ids.length === 0) {
    throw new UsageError(`no ${kind.label}s given; pass them as arguments or use - to read stdin`);
  }

  const invalid = ids.find((id) => !kind.pattern.test(id));
  if (invalid !== undefined) {
    const hint = /^[[{"]/.test(invalid)
      ? ` (IDs must be plain text; extract them from JSON first, e.g. jq -r '.pmids[]')`
      : '';
    throw new UsageError(`not a ${kind.label}: ${JSON.stringify(invalid)}${hint}`);
  }
  return ids;
}

/** Parse a whole-number option; the tool's schema checks the range. */
function intOption(input: CommandInput, name: string): number | undefined {
  const value = input.values[name];
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value.trim())) {
    throw new UsageError(`--${name} must be a whole number, got ${JSON.stringify(value)}`);
  }
  return Number(value);
}

/** Validate params with a tool's zod schema, as the MCP server does before calling it. */
function validate<S extends z.ZodRawShape>(
  schema: S,
  params: Record<string, unknown>
): z.output<z.ZodObject<S>> {
  const result = z.object(schema).safeParse(params);
  if (!result.success) {
    const issue = result.error.issues[0];
    // Every schema key that can fail here comes from an option of the same name.
    const option = `--${String(issue.path[0]).replace(/_/g, '-')}`;
    throw new UsageError(`invalid ${option}: ${issue.message}`);
  }
  return result.data;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/** Run batches one at a time; an error names the batch that failed. */
async function runBatches<P, R>(batches: P[], run: (params: P) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (const [index, params] of batches.entries()) {
    try {
      results.push(await run(params));
    } catch (err) {
      if (batches.length === 1) throw err;
      throw new Error(`batch ${index + 1} of ${batches.length}: ${errorMessage(err)}`);
    }
  }
  return results;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
