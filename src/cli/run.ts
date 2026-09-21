/**
 * Argument parsing, dispatch, and output for the pubmed CLI.
 *
 * Kept apart from the entrypoint (src/cli.ts) so tests can run commands with
 * in-memory I/O and a mocked NCBI client.
 *
 * Output contract: the command's JSON goes to stdout (or to the -o file) and
 * nothing else does; messages go to stderr. Exit status is 0 on success, 1
 * when NCBI or a file operation fails, and 2 for invalid usage.
 */

import { parseArgs } from 'node:util';
import { NcbiClient } from '../pubmed/client.js';
import {
  COMMANDS,
  UsageError,
  errorMessage,
  type Command,
  type CommandInput,
} from './commands.js';

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  /** Read a file, or stdin when path is "-". */
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
}

const COMMON_OPTIONS = {
  output: { type: 'string', short: 'o' },
  help: { type: 'boolean', short: 'h' },
} as const;

/** Run one CLI invocation and return its exit status. */
export async function runCli(
  argv: string[],
  io: CliIo,
  client?: NcbiClient
): Promise<number> {
  const [name, ...args] = argv;

  if (name === undefined) {
    io.stderr(globalHelp());
    return 2;
  }
  if (name === '-h' || name === '--help') {
    io.stdout(globalHelp());
    return 0;
  }
  if (name === 'help') {
    if (args[0] === undefined) {
      io.stdout(globalHelp());
      return 0;
    }
    const target = findCommand(args[0]);
    if (!target) return unknownCommand(io, args[0]);
    io.stdout(commandHelp(target));
    return 0;
  }

  if (name.startsWith('-')) {
    io.stderr(
      `pubmed: options go after the command, e.g. pubmed search <query> ${name} ...\n` +
        'Run "pubmed --help" to list the commands.\n'
    );
    return 2;
  }

  const command = findCommand(name);
  if (!command) return unknownCommand(io, name);

  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args,
      options: { ...COMMON_OPTIONS, ...command.options },
      allowPositionals: true,
      strict: true,
    }));
  } catch (err) {
    // parseArgs appends advice about "--" that does not apply here.
    return usageFailure(io, command, errorMessage(err).split(/\.\s|\n/)[0]);
  }

  if (values.help) {
    io.stdout(commandHelp(command));
    return 0;
  }

  const { output: outFile, help: _help, ...options } = values;
  let stdin: Promise<string> | undefined;
  const input: CommandInput = {
    values: options as Record<string, string | undefined>,
    positionals,
    // Several "-" arguments share one read of stdin.
    readText: (path) => (path === '-' ? (stdin ??= io.readText('-')) : io.readText(path)),
  };

  try {
    const { output, summary } = await command.execute(input, client ?? new NcbiClient());
    const json = `${JSON.stringify(output)}\n`;
    if (typeof outFile === 'string' && outFile !== '-') {
      await io.writeText(outFile, json);
      // The size tells an agent whether the file is safe to read whole.
      io.stderr(
        `pubmed ${command.name}: ${summary}; wrote ${formatBytes(Buffer.byteLength(json))} to ${outFile}\n`
      );
    } else {
      io.stdout(json);
    }
    return 0;
  } catch (err) {
    if (err instanceof UsageError) return usageFailure(io, command, err.message);
    io.stderr(`pubmed ${command.name}: ${errorMessage(err)}\n`);
    return 1;
  }
}

// ─── Help and messages ───────────────────────────────────────────────────────

function findCommand(name: string): Command | undefined {
  return COMMANDS.find((c) => c.name === name);
}

function unknownCommand(io: CliIo, name: string): number {
  io.stderr(
    `pubmed: unknown command ${JSON.stringify(name)}\nRun "pubmed --help" to list the commands.\n`
  );
  return 2;
}

function usageFailure(io: CliIo, command: Command, message: string): number {
  io.stderr(
    `pubmed ${command.name}: ${message}\nRun "pubmed ${command.name} --help" for usage.\n`
  );
  return 2;
}

const COMMON_OPTIONS_HELP = `
Common options:
  -o, --output <file>  Write the JSON to <file> instead of stdout ("-" = stdout)
  -h, --help           Show this help
`;

function commandHelp(command: Command): string {
  return command.help + COMMON_OPTIONS_HELP;
}

function globalHelp(): string {
  const nameWidth = Math.max(...COMMANDS.map((c) => c.name.length));
  const descriptionWidth = Math.max(...COMMANDS.map((c) => c.description.length));
  const commandList = COMMANDS.map(
    (c) =>
      `  ${c.name.padEnd(nameWidth)}  ${c.description.padEnd(descriptionWidth)}  (${c.tool})`
  ).join('\n');

  return `Usage: pubmed <command> [options] [arguments]

Query PubMed and PubMed Central through NCBI E-utilities. Each command runs
the matching PubMed MCP tool and prints the same JSON, so results can be
saved to a file and filtered with jq instead of being read in full.

Commands:
${commandList}

Options:
  -o, --output <file>  Write the JSON to <file> instead of stdout
  -h, --help           Show help; "pubmed <command> --help" for a command

IDs are given as arguments separated by spaces or commas, or read from stdin
with "-". Long lists are split into batches and sent one at a time.

Environment:
  NCBI_API_KEY  NCBI API key; raises the rate limit from 3 to 8 requests/s.
                Also read from the .env file in the PubMed_MCP directory.

Exit status: 0 on success, 1 when NCBI or a file operation fails, 2 on
invalid usage.

Example:
  pubmed search "TP53 AND myelodysplastic syndromes[mh]" --max-results 100 -o search.json
  jq -r '.pmids[]' search.json | pubmed metadata - -o meta.json
  jq -c '.articles[] | {pmid: .identifiers.pmid, title}' meta.json
`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
