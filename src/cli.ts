#!/usr/bin/env node
/**
 * PubMed CLI — entrypoint.
 *
 * Runs the same tool functions as the MCP server and prints their JSON to
 * stdout, or to a file with -o, so large results can be saved and filtered
 * with jq instead of being loaded into an LLM's context. See `pubmed --help`.
 *
 * Environment variables:
 *   NCBI_API_KEY — NCBI API key; raises rate limit from 3 → 8 req/s.
 *                  Falls back to the .env file in the package root, so in a
 *                  source checkout the key is found whichever directory the
 *                  command runs in.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { runCli } from './cli/run.js';

// quiet: dotenv >=17 logs to stdout by default, which would corrupt the JSON
// output. Variables already set in the environment take precedence.
loadDotenv({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'),
  quiet: true,
});

// A reader that stops early (e.g. `pubmed ... | head`) is not an error.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EPIPE') process.stderr.write(`pubmed: ${err.message}\n`);
  process.exit(err.code === 'EPIPE' ? 0 : 1);
});

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readText: (file) => (file === '-' ? readStdin() : readFile(file, 'utf8')),
  writeText: (file, text) => writeFile(file, text, 'utf8'),
}).then(
  // Set exitCode rather than calling process.exit() so stdout can drain.
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`pubmed: ${String(err)}\n`);
    process.exitCode = 1;
  }
);
