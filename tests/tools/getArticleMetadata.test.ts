/**
 * Unit tests for the get_article_metadata tool handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NcbiClient } from '../../src/pubmed/client.js';
import { getArticleMetadata } from '../../src/tools/getArticleMetadata.js';
import { IMPORTANT_LEGAL_NOTICE } from '../../src/pubmed/types.js';

const mockEfetch = vi.fn();
const mockClient = { efetch: mockEfetch } as unknown as NcbiClient;

// Minimal PubMed XML with one article
const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation Status="MEDLINE" Owner="NLM">
      <PMID Version="1">33526711</PMID>
      <Article PubModel="Print-Electronic">
        <Journal>
          <JournalIssue CitedMedium="Internet">
            <Volume>592</Volume>
            <Issue>7853</Issue>
            <PubDate>
              <Year>2021</Year>
              <Month>Apr</Month>
              <Day>01</Day>
            </PubDate>
          </JournalIssue>
          <Title>Nature</Title>
          <ISOAbbreviation>Nature</ISOAbbreviation>
        </Journal>
        <ArticleTitle>Highly accurate protein structure prediction with AlphaFold</ArticleTitle>
        <Pagination>
          <MedlinePgn>583-589</MedlinePgn>
        </Pagination>
        <Abstract>
          <AbstractText>Proteins are essential molecules of life.</AbstractText>
        </Abstract>
        <AuthorList CompleteYN="Y">
          <Author ValidYN="Y">
            <LastName>Jumper</LastName>
            <ForeName>John</ForeName>
            <Initials>J</Initials>
            <AffiliationInfo>
              <Affiliation>DeepMind, London, UK</Affiliation>
            </AffiliationInfo>
          </Author>
          <Author ValidYN="Y">
            <LastName>Evans</LastName>
            <ForeName>Richard</ForeName>
            <Initials>R</Initials>
          </Author>
        </AuthorList>
        <Language>eng</Language>
        <PublicationTypeList>
          <PublicationType UI="D016428">Journal Article</PublicationType>
          <PublicationType UI="D013485">Research Support, Non-U.S. Gov't</PublicationType>
        </PublicationTypeList>
      </Article>
      <KeywordList Owner="NOTNLM">
        <Keyword MajorTopicYN="N">Protein folding</Keyword>
        <Keyword MajorTopicYN="N">Deep learning</Keyword>
      </KeywordList>
    </MedlineCitation>
    <PubmedData>
      <ArticleIdList>
        <ArticleId IdType="pubmed">33526711</ArticleId>
        <ArticleId IdType="doi">10.1038/s41586-021-03819-2</ArticleId>
        <ArticleId IdType="pmc">PMC8371605</ArticleId>
      </ArticleIdList>
    </PubmedData>
  </PubmedArticle>
</PubmedArticleSet>`;

describe('getArticleMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEfetch.mockResolvedValue(SAMPLE_XML);
  });

  it('returns article count and legal notice', async () => {
    const result = await getArticleMetadata({ pmids: ['33526711'] }, mockClient);

    expect(result.count).toBe(1);
    expect(result.important_legal_notice).toBe(IMPORTANT_LEGAL_NOTICE);
    expect(result.articles).toHaveLength(1);
  });

  it('parses article title and abstract', async () => {
    const result = await getArticleMetadata({ pmids: ['33526711'] }, mockClient);
    const article = result.articles[0];

    expect(article.title).toContain('AlphaFold');
    expect(article.abstract).toContain('Proteins are essential');
  });

  it('parses identifiers including PMCID and DOI', async () => {
    const result = await getArticleMetadata({ pmids: ['33526711'] }, mockClient);
    const { identifiers } = result.articles[0];

    expect(identifiers.pmid).toBe('33526711');
    expect(identifiers.doi).toBe('10.1038/s41586-021-03819-2');
    expect(identifiers.pmcid).toBe('PMC8371605');
  });

  it('parses authors with affiliations', async () => {
    const result = await getArticleMetadata({ pmids: ['33526711'] }, mockClient);
    const { authors } = result.articles[0];

    expect(authors).toHaveLength(2);
    expect(authors[0].last_name).toBe('Jumper');
    expect(authors[0].fore_name).toBe('John');
    expect(authors[0].affiliations).toContain('DeepMind, London, UK');
    expect(authors[1].last_name).toBe('Evans');
    // Second author has no affiliation
    expect(authors[1].affiliations).toBeUndefined();
  });

  it('parses journal, volume, issue, and pages', async () => {
    const result = await getArticleMetadata({ pmids: ['33526711'] }, mockClient);
    const article = result.articles[0];

    expect(article.journal.title).toBe('Nature');
    expect(article.journal.iso_abbreviation).toBe('Nature');
    expect(article.citation.volume).toBe('592');
    expect(article.citation.issue).toBe('7853');
    expect(article.citation.pages).toBe('583-589');
  });

  it('parses publication date', async () => {
    const result = await getArticleMetadata({ pmids: ['33526711'] }, mockClient);
    const { publication_date } = result.articles[0];

    expect(publication_date.year).toBe('2021');
    expect(publication_date.month).toBe('Apr');
    expect(publication_date.day).toBe('1'); // parser converts leading-zero numeric "01" → 1 → "1"
  });

  it('parses keywords', async () => {
    const result = await getArticleMetadata({ pmids: ['33526711'] }, mockClient);
    expect(result.articles[0].keywords).toContain('Protein folding');
    expect(result.articles[0].keywords).toContain('Deep learning');
  });

  it('parses article types', async () => {
    const result = await getArticleMetadata({ pmids: ['33526711'] }, mockClient);
    expect(result.articles[0].article_types).toContain('Journal Article');
  });

  it('calls efetch with correct params', async () => {
    await getArticleMetadata({ pmids: ['111', '222'] }, mockClient);

    expect(mockEfetch).toHaveBeenCalledWith({
      db: 'pubmed',
      id: ['111', '222'],
      retmode: 'xml',
      rettype: 'abstract',
    });
  });
});
