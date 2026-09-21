/**
 * Unit tests for the pubmed CLI: argument parsing, batching, output, and exit
 * status. The NCBI client is mocked — no real network requests are made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NcbiApiError, type NcbiClient } from '../../src/pubmed/client.js';
import { IMPORTANT_LEGAL_NOTICE } from '../../src/pubmed/types.js';
import { runCli, type CliIo } from '../../src/cli/run.js';
import { searchArticles } from '../../src/tools/searchArticles.js';

const mockClient = {
  esearch: vi.fn(),
  efetch: vi.fn(),
  elink: vi.fn(),
  ecitmatch: vi.fn(),
  idConvert: vi.fn(),
};
const client = mockClient as unknown as NcbiClient;

interface FakeIo extends CliIo {
  out: string;
  err: string;
  files: Map<string, string>;
}

function fakeIo(stdin = '', files: Record<string, string> = {}): FakeIo {
  const io: FakeIo = {
    out: '',
    err: '',
    files: new Map(Object.entries(files)),
    stdout: (text) => {
      io.out += text;
    },
    stderr: (text) => {
      io.err += text;
    },
    readText: async (path) => {
      if (path === '-') return stdin;
      const text = io.files.get(path);
      if (text === undefined) throw new Error(`ENOENT: no such file ${path}`);
      return text;
    },
    writeText: async (path, text) => {
      io.files.set(path, text);
    },
  };
  return io;
}

async function run(argv: string[], io: FakeIo = fakeIo()) {
  const code = await runCli(argv, io, client);
  return { code, io };
}

const BOM = String.fromCharCode(0xfeff);

const range = (count: number, start = 1): string[] =>
  Array.from({ length: count }, (_, i) => String(start + i));

/** Minimal PubMed EFetch XML with one article per PMID. */
function pubmedXml(ids: string[]): string {
  const articles = ids
    .map(
      (id) =>
        `<PubmedArticle><MedlineCitation><PMID>${id}</PMID>` +
        `<Article><ArticleTitle>Title ${id}</ArticleTitle></Article>` +
        `</MedlineCitation></PubmedArticle>`
    )
    .join('');
  return `<?xml version="1.0"?><PubmedArticleSet>${articles}</PubmedArticleSet>`;
}

/** Minimal PMC EFetch XML; even-numbered IDs have no body (no full text). */
function pmcXml(ids: string[]): string {
  const articles = ids
    .map((id) => {
      const body = Number(id) % 2 === 0 ? '' : `<body><sec><p>Text ${id}</p></sec></body>`;
      return (
        `<article><front><article-meta><article-id pub-id-type="pmc">${id}</article-id>` +
        `<title-group><article-title>Title ${id}</article-title></title-group>` +
        `</article-meta></front>${body}</article>`
      );
    })
    .join('');
  return `<?xml version="1.0"?><pmc-articleset>${articles}</pmc-articleset>`;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.efetch.mockImplementation(async ({ db, id }: { db: string; id: string[] }) =>
    db === 'pmc' ? pmcXml(id) : pubmedXml(id)
  );
});

// ─── Help and usage ──────────────────────────────────────────────────────────

describe('help and usage', () => {
  it('lists every command with its MCP tool on --help', async () => {
    const { code, io } = await run(['--help']);

    expect(code).toBe(0);
    for (const [command, tool] of [
      ['search', 'search_articles'],
      ['metadata', 'get_article_metadata'],
      ['related', 'find_related_articles'],
      ['citation', 'lookup_article_by_citation'],
      ['convert', 'convert_article_ids'],
      ['fulltext', 'get_full_text_article'],
      ['copyright', 'get_copyright_status'],
    ]) {
      expect(io.out).toMatch(new RegExp(`\\n  ${command} .*\\(${tool}\\)`));
    }
  });

  it('prints help to stderr and exits 2 without arguments', async () => {
    const { code, io } = await run([]);

    expect(code).toBe(2);
    expect(io.out).toBe('');
    expect(io.err).toContain('Usage: pubmed <command>');
  });

  it('shows the same command help for "help <command>" and "<command> --help"', async () => {
    const viaHelp = await run(['help', 'search']);
    const viaFlag = await run(['search', '-h']);

    expect(viaHelp.code).toBe(0);
    expect(viaFlag.code).toBe(0);
    expect(viaHelp.io.out).toBe(viaFlag.io.out);
    expect(viaFlag.io.out).toContain('--max-results <n>');
    expect(viaFlag.io.out).toContain('Common options:');
  });

  it('rejects an unknown command', async () => {
    const { code, io } = await run(['nope']);

    expect(code).toBe(2);
    expect(io.err).toContain('unknown command "nope"');
  });

  it('explains that options go after the command', async () => {
    const { code, io } = await run(['-o', 'out.json', 'search', 'x']);

    expect(code).toBe(2);
    expect(io.err).toContain('options go after the command');
  });

  it('rejects an unknown option without the parser\'s "--" advice', async () => {
    const { code, io } = await run(['search', 'x', '--max_results', '5']);

    expect(code).toBe(2);
    expect(io.err).toContain("pubmed search: Unknown option '--max_results'");
    expect(io.err).not.toContain('To specify');
    expect(io.err).toContain('Run "pubmed search --help" for usage.');
  });
});

// ─── search ──────────────────────────────────────────────────────────────────

describe('search', () => {
  beforeEach(() => {
    mockClient.esearch.mockResolvedValue({
      count: '117',
      retmax: '2',
      retstart: '4',
      idlist: ['41372162', '41161891'],
      translationset: [],
      querytranslation: '"gamma delta"[tiab]',
    });
  });

  it('maps options to the ESearch request and prints the search_articles JSON', async () => {
    const { code, io } = await run([
      'search',
      'gamma',
      'delta',
      '--max-results',
      '2',
      '--retstart',
      '4',
      '--sort',
      'pub_date',
      '--field',
      'tiab',
      '--date-from',
      '2020',
      '--datetype',
      'edat',
    ]);

    expect(code).toBe(0);
    expect(mockClient.esearch).toHaveBeenCalledWith({
      term: 'gamma delta',
      retmax: 2,
      retstart: 4,
      sort: 'pub_date',
      field: 'tiab',
      datetype: 'edat',
      mindate: '2020',
      maxdate: '3000',
    });

    const expected = await searchArticles(
      {
        query: 'gamma delta',
        max_results: 2,
        retstart: 4,
        sort: 'pub_date',
        field: 'tiab',
        date_from: '2020',
        datetype: 'edat',
      },
      client
    );
    expect(io.out).toBe(`${JSON.stringify(expected)}\n`);
    expect(io.err).toBe('');
  });

  it('reads a multi-line query from stdin with "-"', async () => {
    const { code } = await run(['search', '-'], fakeIo('TP53[tiab]\n  AND myelodysplastic syndromes[mh]\n'));

    expect(code).toBe(0);
    expect(mockClient.esearch).toHaveBeenCalledWith(
      expect.objectContaining({ term: 'TP53[tiab] AND myelodysplastic syndromes[mh]' })
    );
  });

  it.each([
    [['--max-results', '0'], 'invalid --max-results: Number must be greater than or equal to 1'],
    [['--max-results', 'ten'], '--max-results must be a whole number, got "ten"'],
    [['--sort', 'newest'], 'invalid --sort: Invalid enum value'],
    [['--datetype', 'dp'], 'invalid --datetype'],
  ])('rejects %j before calling NCBI', async (options, message) => {
    const { code, io } = await run(['search', 'cancer', ...options]);

    expect(code).toBe(2);
    expect(io.err).toContain(message);
    expect(mockClient.esearch).not.toHaveBeenCalled();
  });

  it('requires a query', async () => {
    const { code, io } = await run(['search']);

    expect(code).toBe(2);
    expect(io.err).toContain('missing <query>');
  });
});

// ─── metadata and batching ───────────────────────────────────────────────────

describe('metadata', () => {
  it('fetches more than 200 PMIDs in batches and merges them in order', async () => {
    const pmids = range(450, 30000000);
    const { code, io } = await run(['metadata', '-'], fakeIo(pmids.join('\n')));

    expect(code).toBe(0);
    expect(mockClient.efetch.mock.calls.map(([params]) => params.id.length)).toEqual([
      200, 200, 50,
    ]);
    const output = JSON.parse(io.out);
    expect(output.count).toBe(450);
    expect(output.articles.map((a: { identifiers: { pmid: string } }) => a.identifiers.pmid)).toEqual(pmids);
    expect(output.important_legal_notice).toBe(IMPORTANT_LEGAL_NOTICE);
  });

  it('accepts PMIDs separated by spaces and commas', async () => {
    const { code } = await run(['metadata', '1,2', '3']);

    expect(code).toBe(0);
    expect(mockClient.efetch).toHaveBeenCalledTimes(1);
    expect(mockClient.efetch).toHaveBeenCalledWith(expect.objectContaining({ id: ['1', '2', '3'] }));
  });

  it('rejects JSON on stdin and says how to extract the IDs', async () => {
    const { code, io } = await run(['metadata', '-'], fakeIo('{"pmids":["1","2"]}\n'));

    expect(code).toBe(2);
    expect(io.err).toContain('not a PMID: "{\\"pmids\\":[\\"1\\""');
    expect(io.err).toContain("jq -r '.pmids[]'");
    expect(mockClient.efetch).not.toHaveBeenCalled();
  });

  it('requires at least one PMID', async () => {
    const { code, io } = await run(['metadata', '-'], fakeIo('\n'));

    expect(code).toBe(2);
    expect(io.err).toContain('no PMIDs given');
  });

  it('exits 1 on an NCBI error and names the batch that failed', async () => {
    mockClient.efetch
      .mockImplementationOnce(async ({ id }: { id: string[] }) => pubmedXml(id))
      .mockRejectedValueOnce(new NcbiApiError('NCBI efetch returned HTTP 500: boom', 500));

    const { code, io } = await run(['metadata', ...range(250)]);

    expect(code).toBe(1);
    expect(io.out).toBe('');
    expect(io.err).toBe('pubmed metadata: batch 2 of 2: NCBI efetch returned HTTP 500: boom\n');
  });

  it('reports a single-request error without a batch number', async () => {
    mockClient.efetch.mockRejectedValueOnce(new NcbiApiError('NCBI efetch returned HTTP 500: boom', 500));

    const { code, io } = await run(['metadata', '1']);

    expect(code).toBe(1);
    expect(io.err).toBe('pubmed metadata: NCBI efetch returned HTTP 500: boom\n');
  });
});

// ─── -o / --output ───────────────────────────────────────────────────────────

describe('--output', () => {
  it('writes the JSON to the file and a summary with its size to stderr', async () => {
    const { code, io } = await run(['metadata', '1', '2', '-o', 'meta.json']);

    expect(code).toBe(0);
    expect(io.out).toBe('');
    const written = io.files.get('meta.json') ?? '';
    expect(JSON.parse(written).count).toBe(2);
    expect(io.err).toBe(
      `pubmed metadata: 2 articles; wrote ${Buffer.byteLength(written)} bytes to meta.json\n`
    );
  });

  it('treats "-o -" as stdout', async () => {
    const { code, io } = await run(['metadata', '1', '-o', '-']);

    expect(code).toBe(0);
    expect(JSON.parse(io.out).count).toBe(1);
    expect(io.files.size).toBe(0);
    expect(io.err).toBe('');
  });

  it('exits 1 when the file cannot be written', async () => {
    const io = fakeIo();
    io.writeText = async () => {
      throw new Error('EACCES: permission denied');
    };

    const { code } = await run(['metadata', '1', '--output', 'meta.json'], io);

    expect(code).toBe(1);
    expect(io.err).toContain('EACCES: permission denied');
  });
});

// ─── Other commands ──────────────────────────────────────────────────────────

describe('fulltext', () => {
  it('fetches 20 PMCIDs per request and merges articles and errors', async () => {
    const pmcids = range(25).map((n) => `PMC${n}`);
    const { code, io } = await run(['fulltext', ...pmcids]);

    expect(code).toBe(0);
    expect(mockClient.efetch.mock.calls.map(([params]) => params.id.length)).toEqual([20, 5]);
    const output = JSON.parse(io.out);
    expect(output.count).toBe(13);
    expect(output.articles).toHaveLength(13);
    expect(output.errors).toHaveLength(12);
    expect(output.errors[0].pmcid).toBe('PMC2');
    expect(Object.keys(output)).toEqual(['important_legal_notice', 'articles', 'errors', 'count']);
  });

  it('rejects IDs that are not PMCIDs', async () => {
    const { code, io } = await run(['fulltext', 'PMCX1']);

    expect(code).toBe(2);
    expect(io.err).toContain('not a PMCID: "PMCX1"');
  });
});

describe('copyright', () => {
  it('checks 50 PMIDs per request', async () => {
    mockClient.idConvert.mockImplementation(async ({ ids }: { ids: string[] }) => ({
      records: ids.map((id) => ({ pmid: id, 'requested-id': id })),
    }));

    const { code, io } = await run(['copyright', ...range(120)]);

    expect(code).toBe(0);
    expect(mockClient.idConvert.mock.calls.map(([params]) => params.ids.length)).toEqual([
      50, 50, 20,
    ]);
    expect(JSON.parse(io.out).count).toBe(120);
  });
});

describe('convert', () => {
  beforeEach(() => {
    mockClient.idConvert.mockImplementation(async ({ ids }: { ids: string[] }) => ({
      status: 'ok',
      'response-date': '2026-09-22 00:00:00',
      request: { idtype: 'pmid', ids, echo: 'ids=...' },
      records: ids.map((id) => ({ pmid: id, 'requested-id': id })),
    }));
  });

  it('merges records and requested IDs across batches', async () => {
    const pmids = range(250);
    const { code, io } = await run(['convert', ...pmids]);

    expect(code).toBe(0);
    expect(mockClient.idConvert).toHaveBeenCalledTimes(2);
    const output = JSON.parse(io.out);
    expect(output.status).toBe('ok');
    expect(output.request.ids).toEqual(pmids);
    expect(output.records.map((r: { pmid: string }) => r.pmid)).toEqual(pmids);
  });

  it('checks IDs against --id-type', async () => {
    const badType = await run(['convert', '1', '--id-type', 'isbn']);
    const badDoi = await run(['convert', 'abc', '--id-type', 'doi']);

    expect(badType.code).toBe(2);
    expect(badType.io.err).toContain('invalid --id-type: expected pmid, pmcid, or doi');
    expect(badDoi.code).toBe(2);
    expect(badDoi.io.err).toContain('not a DOI: "abc"');
    expect(mockClient.idConvert).not.toHaveBeenCalled();
  });
});

describe('related', () => {
  it('passes the link type and caps the links per PMID', async () => {
    mockClient.elink.mockImplementation(async ({ id }: { id: string[] }) => ({
      linksets: id.map((pmid) => ({
        dbfrom: 'pubmed',
        ids: [pmid],
        linksetdbs: [{ dbto: 'pmc', linkname: 'pubmed_pmc_refs', links: ['7', '8', '9'] }],
      })),
    }));

    const { code, io } = await run([
      'related',
      '1',
      '2',
      '--link-type',
      'citing_pmc_articles',
      '--max-results',
      '2',
      '-o',
      'related.json',
    ]);

    expect(code).toBe(0);
    expect(mockClient.elink).toHaveBeenCalledWith(
      expect.objectContaining({ id: ['1', '2'], linkname: 'pubmed_pmc_refs' })
    );
    const output = JSON.parse(io.files.get('related.json') ?? '');
    expect(output.linksets.map((ls: { linksetdbs: { links: string[] }[] }) => ls.linksetdbs[0].links)).toEqual([
      ['7', '8'],
      ['7', '8'],
    ]);
    expect(io.err).toContain('pubmed related: 4 links for 2 PMIDs;');
  });

  it('rejects an unknown link type', async () => {
    const { code, io } = await run(['related', '1', '--link-type', 'cited_by']);

    expect(code).toBe(2);
    expect(io.err).toContain('invalid --link-type');
  });
});

describe('citation', () => {
  beforeEach(() => {
    // Matches every journal except "Unknown"; the PMID is 9000 + position in the request.
    mockClient.ecitmatch.mockImplementation(
      async (citations: Array<Record<string, string | number>>) =>
        citations
          .map(
            (c, i) =>
              `${c.journal}|${c.year}|${c.volume}|${c.first_page}|${c.author}|${c.key}|` +
              (c.journal === 'Unknown' ? 'NOT_FOUND' : String(9000 + i))
          )
          .join('\n')
    );
  });

  it('looks up one citation given as options', async () => {
    const { code, io } = await run([
      'citation',
      '--journal',
      'Nature',
      '--year',
      '2021',
      '--volume',
      '596',
      '--first-page',
      '583',
      '--author',
      'Jumper',
    ]);

    expect(code).toBe(0);
    expect(mockClient.ecitmatch).toHaveBeenCalledWith([
      { journal: 'Nature', year: 2021, volume: '596', first_page: '583', author: 'Jumper', key: '1' },
    ]);
    expect(JSON.parse(io.out).citations[0]).toMatchObject({ key: '1', pmid: '9000' });
  });

  it('reads JSON Lines from stdin, filling keys and accepting loose types', async () => {
    const stdin =
      '{"journal":"Nature","year":"2021","volume":596,"first_page":583}\n' +
      '{"journal":"Unknown","year":2020}\n';
    const { code, io } = await run(['citation', '--input', '-', '-o', 'out.json'], fakeIo(stdin));

    expect(code).toBe(0);
    expect(mockClient.ecitmatch).toHaveBeenCalledWith([
      { journal: 'Nature', year: 2021, volume: '596', first_page: '583', author: '', key: '1' },
      { journal: 'Unknown', year: 2020, volume: '', first_page: '', author: '', key: '2' },
    ]);
    expect(io.err).toContain('pubmed citation: 1 of 2 citations matched;');
  });

  it('reads a JSON array file that starts with a byte order mark', async () => {
    const io = fakeIo('', { 'refs.json': BOM + '[{"journal":"Cell","year":2019,"key":"ref-a"}]' });
    const { code } = await run(['citation', '--input', 'refs.json'], io);

    expect(code).toBe(0);
    expect(JSON.parse(io.out).citations[0]).toMatchObject({ key: 'ref-a', pmid: '9000' });
  });

  it('sends more than 100 citations in batches', async () => {
    const stdin = JSON.stringify(range(150).map(() => ({ journal: 'Cell', year: 2019 })));
    const { code, io } = await run(['citation', '--input', '-'], fakeIo(stdin));

    expect(code).toBe(0);
    expect(mockClient.ecitmatch.mock.calls.map(([citations]) => citations.length)).toEqual([100, 50]);
    expect(JSON.parse(io.out).citations.at(-1).key).toBe('150');
  });

  it.each([
    [['--journal', 'Nature'], 'give --journal and --year'],
    [['--input', '-', '--year', '2020'], 'use either --input or the single-citation options'],
  ])('rejects %j', async (options, message) => {
    const { code, io } = await run(['citation', ...options]);

    expect(code).toBe(2);
    expect(io.err).toContain(message);
  });

  it('names the citation that fails validation', async () => {
    const stdin = '[{"journal":"A","year":2020},{"journal":"B","year":1700}]';
    const { code, io } = await run(['citation', '--input', '-'], fakeIo(stdin));

    expect(code).toBe(2);
    expect(io.err).toContain('citation 2: invalid year: Number must be greater than or equal to 1800');
    expect(mockClient.ecitmatch).not.toHaveBeenCalled();
  });
});
