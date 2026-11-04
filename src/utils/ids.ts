/**
 * Zod schemas for article IDs in tool arguments.
 *
 * Each value must be a single ID. NCBI reads commas as separators, so a value
 * such as "1,2,3" would otherwise carry any number of IDs past a tool's
 * per-request limit.
 */

import { z } from 'zod';

export const pmidSchema = z.string().regex(/^\d+$/, 'must be a PMID (digits only)');

/**
 * With or without the "PMC" prefix, in any case. Spelled without the i flag,
 * which the JSON Schema in tools/list cannot carry.
 */
export const pmcidSchema = z
  .string()
  .regex(/^([Pp][Mm][Cc])?\d+$/, 'must be a PMCID, e.g. PMC7984072');

/** A PMID, PMCID, or DOI. */
export const articleIdSchema = z
  .string()
  .regex(/^[^\s,]+$/, 'must be a single ID, without commas or spaces');
