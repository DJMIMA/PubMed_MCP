/**
 * Package version, read from package.json at runtime.
 *
 * package.json sits one directory above this module both in src/ (tsx) and in
 * dist/ (build, npm package, Docker image), so a single relative path works
 * everywhere. Reading it keeps the version in one place: `npm version` updates
 * package.json only.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_JSON_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'package.json'
);

let cachedVersion: string | undefined;

/** The version field of the package's package.json, e.g. "1.1.0". */
export function packageVersion(): string {
  if (cachedVersion === undefined) {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as { version?: unknown };
    if (typeof pkg.version !== 'string') {
      throw new Error(`no version field in ${PACKAGE_JSON_PATH}`);
    }
    cachedVersion = pkg.version;
  }
  return cachedVersion;
}
