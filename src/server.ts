/**
 * MCP server setup and tool registration.
 *
 * All seven PubMed tools are registered here. Each tool handler calls
 * the appropriate function from src/tools/, catches errors, and returns
 * a text content block (never throws — MCP protocol requires graceful errors).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NcbiClient } from './pubmed/client.js';

import {
  searchArticlesSchema,
  searchArticles,
} from './tools/searchArticles.js';
import {
  getArticleMetadataSchema,
  getArticleMetadata,
} from './tools/getArticleMetadata.js';
import {
  findRelatedArticlesSchema,
  findRelatedArticles,
} from './tools/findRelatedArticles.js';
import {
  lookupArticleByCitationSchema,
  lookupArticleByCitation,
} from './tools/lookupArticleByCitation.js';
import {
  convertArticleIdsSchema,
  convertArticleIds,
} from './tools/convertArticleIds.js';
import {
  getFullTextArticleSchema,
  getFullTextArticle,
} from './tools/getFullTextArticle.js';
import {
  getCopyrightStatusSchema,
  getCopyrightStatus,
} from './tools/getCopyrightStatus.js';

/** Create and return a configured MCP server instance. */
export function createServer(): McpServer {
  const server = new McpServer({
    name: 'pubmed',
    version: '1.0.0',
  });

  const client = new NcbiClient();

  // ── search_articles ──────────────────────────────────────────────────────

  server.tool(
    'search_articles',
    'Search PubMed for biomedical articles. Returns PMIDs and result set metadata. ' +
      'Untagged terms undergo automatic term mapping (ATM); use field to restrict all ' +
      'untagged terms to one PubMed field. Explicit field tags in the query take ' +
      'precedence for tagged terms. Before concluding that a low or zero count means ' +
      'no literature exists, inspect query_translation, warnings, and errors. To search ' +
      'multiple words reliably in one field, tag each term; when a quoted phrase is not ' +
      'indexed, use a proximity search such as [ti:~0] or [tiab:~0]. ' +
      'Use get_article_metadata to retrieve full details for the returned PMIDs.',
    searchArticlesSchema,
    async (params) => {
      try {
        const result = await searchArticles(params, client);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: formatError(err, 'search_articles') }] };
      }
    }
  );

  // ── get_article_metadata ─────────────────────────────────────────────────

  server.tool(
    'get_article_metadata',
    'Retrieve complete metadata for one or more PubMed articles by PMID. ' +
      'Returns title, abstract, authors, affiliations, journal info, ' +
      'publication date, MeSH terms, keywords, and article type for each article.',
    getArticleMetadataSchema,
    async (params) => {
      try {
        const result = await getArticleMetadata(params, client);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: formatError(err, 'get_article_metadata') }],
        };
      }
    }
  );

  // ── find_related_articles ────────────────────────────────────────────────

  server.tool(
    'find_related_articles',
    'Find articles related to one or more PubMed articles using NCBI ELink. ' +
      'Supports similar articles, PMC articles that cite the source, ' +
      'and cross-database links to NCBI Gene, Protein, or Nucleotide databases.',
    findRelatedArticlesSchema,
    async (params) => {
      try {
        const result = await findRelatedArticles(params, client);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: formatError(err, 'find_related_articles') }],
        };
      }
    }
  );

  // ── lookup_article_by_citation ────────────────────────────────────────────

  server.tool(
    'lookup_article_by_citation',
    'Look up PubMed IDs for articles given structured citation information ' +
      '(journal, year, volume, first page, first author). ' +
      'Useful for verifying references or resolving citations found in manuscripts.',
    lookupArticleByCitationSchema,
    async (params) => {
      try {
        const result = await lookupArticleByCitation(params, client);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        return {
          content: [
            { type: 'text', text: formatError(err, 'lookup_article_by_citation') },
          ],
        };
      }
    }
  );

  // ── convert_article_ids ──────────────────────────────────────────────────

  server.tool(
    'convert_article_ids',
    'Convert article identifiers between PMID, PMCID, and DOI formats. ' +
      'For example, convert a list of PMIDs to DOIs, or find the PMCID for a DOI. ' +
      'Uses the NCBI PMC ID Converter service.',
    convertArticleIdsSchema,
    async (params) => {
      try {
        const result = await convertArticleIds(params, client);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: formatError(err, 'convert_article_ids') }],
        };
      }
    }
  );

  // ── get_full_text_article ────────────────────────────────────────────────

  server.tool(
    'get_full_text_article',
    'Retrieve the full text of articles from PubMed Central (PMC). ' +
      'Returns the complete article body including all sections, figure captions, ' +
      'table captions, and references as plain text. ' +
      'Only articles in the PMC Open Access Subset have full text available. ' +
      'Unavailable articles are reported in the errors array. ' +
      'Use convert_article_ids to find PMCIDs from PMIDs first.',
    getFullTextArticleSchema,
    async (params) => {
      try {
        const result = await getFullTextArticle(params, client);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: formatError(err, 'get_full_text_article') }],
        };
      }
    }
  );

  // ── get_copyright_status ─────────────────────────────────────────────────

  server.tool(
    'get_copyright_status',
    'Check the copyright and open-access status for PubMed articles. ' +
      'has_full_text: true means get_full_text_article can return the article text; ' +
      'it is false for articles not in PMC and for PMC articles whose publisher ' +
      'does not allow full-text download. Also reports the license (e.g., CC BY, ' +
      'CC BY-NC-ND), copyright statement, and whether PMC marks the article open access.',
    getCopyrightStatusSchema,
    async (params) => {
      try {
        const result = await getCopyrightStatus(params, client);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: formatError(err, 'get_copyright_status') }],
        };
      }
    }
  );

  return server;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatError(err: unknown, tool: string): string {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[${tool}] Error: ${message}\n`);
  return JSON.stringify({ error: `Error occurred during tool execution: ${message}` });
}
