/**
 * Unit tests for XML parsing utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  extractText,
  parsePubmedEfetchXml,
  parsePmcEfetchXml,
  parsePmcAccessXml,
} from '../../src/utils/xml.js';

describe('extractText', () => {
  it('returns a string as-is', () => {
    expect(extractText('hello world')).toBe('hello world');
  });

  it('converts a number to string', () => {
    expect(extractText(42)).toBe('42');
  });

  it('returns empty string for null/undefined', () => {
    expect(extractText(null)).toBe('');
    expect(extractText(undefined)).toBe('');
  });

  it('extracts #text from an object node', () => {
    const node = { '#text': 'article title', _someAttr: 'ignored' };
    expect(extractText(node)).toBe('article title');
  });

  it('concatenates text from nested objects', () => {
    const node = { italic: 'important', '#text': 'some ' };
    const result = extractText(node);
    expect(result).toContain('some');
    expect(result).toContain('important');
  });

  it('handles arrays by joining', () => {
    expect(extractText(['foo', 'bar'])).toBe('foo bar');
  });
});

describe('parsePubmedEfetchXml', () => {
  const MINIMAL_XML = `<?xml version="1.0"?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation Status="MEDLINE" Owner="NLM">
      <PMID Version="1">99999</PMID>
      <Article PubModel="Print">
        <Journal>
          <JournalIssue CitedMedium="Print">
            <Volume>10</Volume>
            <PubDate><Year>2023</Year></PubDate>
          </JournalIssue>
          <Title>Test Journal</Title>
          <ISOAbbreviation>Test J</ISOAbbreviation>
        </Journal>
        <ArticleTitle>A test article title</ArticleTitle>
        <Abstract>
          <AbstractText>This is the abstract.</AbstractText>
        </Abstract>
        <AuthorList CompleteYN="Y">
          <Author ValidYN="Y">
            <LastName>Doe</LastName>
            <ForeName>Jane</ForeName>
            <Initials>J</Initials>
          </Author>
        </AuthorList>
        <Language>eng</Language>
        <PublicationTypeList>
          <PublicationType UI="D016428">Journal Article</PublicationType>
        </PublicationTypeList>
      </Article>
    </MedlineCitation>
    <PubmedData>
      <ArticleIdList>
        <ArticleId IdType="pubmed">99999</ArticleId>
        <ArticleId IdType="doi">10.1234/test.99999</ArticleId>
      </ArticleIdList>
    </PubmedData>
  </PubmedArticle>
</PubmedArticleSet>`;

  it('parses PMID from article', () => {
    const articles = parsePubmedEfetchXml(MINIMAL_XML);
    expect(articles).toHaveLength(1);
    expect(articles[0].identifiers.pmid).toBe('99999');
  });

  it('parses DOI from ArticleIdList', () => {
    const articles = parsePubmedEfetchXml(MINIMAL_XML);
    expect(articles[0].identifiers.doi).toBe('10.1234/test.99999');
  });

  it('parses article title', () => {
    const articles = parsePubmedEfetchXml(MINIMAL_XML);
    expect(articles[0].title).toBe('A test article title');
  });

  it('parses abstract text', () => {
    const articles = parsePubmedEfetchXml(MINIMAL_XML);
    expect(articles[0].abstract).toContain('This is the abstract.');
  });

  it('preserves inline formatting text in title and abstract order', () => {
    const xml = MINIMAL_XML
      .replace(
        '<ArticleTitle>A test article title</ArticleTitle>',
        '<ArticleTitle>Effect of <i>TP53</i> on cancer</ArticleTitle>'
      )
      .replace(
        '<AbstractText>This is the abstract.</AbstractText>',
        '<AbstractText>We found <b>strong</b> evidence for H<sub>2</sub>O.</AbstractText>'
      );

    const articles = parsePubmedEfetchXml(xml);

    expect(articles[0].title).toBe('Effect of TP53 on cancer');
    expect(articles[0].abstract).toBe('We found strong evidence for H2O.');
  });

  it('parses author information', () => {
    const articles = parsePubmedEfetchXml(MINIMAL_XML);
    const author = articles[0].authors[0];
    expect(author.last_name).toBe('Doe');
    expect(author.fore_name).toBe('Jane');
    expect(author.initials).toBe('J');
  });

  it('parses journal information', () => {
    const articles = parsePubmedEfetchXml(MINIMAL_XML);
    expect(articles[0].journal.title).toBe('Test Journal');
    expect(articles[0].journal.iso_abbreviation).toBe('Test J');
  });

  it('parses publication year', () => {
    const articles = parsePubmedEfetchXml(MINIMAL_XML);
    expect(articles[0].publication_date.year).toBe('2023');
  });

  it('returns empty array for empty article set', () => {
    const xml = '<?xml version="1.0"?><PubmedArticleSet></PubmedArticleSet>';
    const articles = parsePubmedEfetchXml(xml);
    expect(articles).toHaveLength(0);
  });

  it('handles structured abstract with labels', () => {
    const xml = `<?xml version="1.0"?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation Status="MEDLINE" Owner="NLM">
      <PMID Version="1">11111</PMID>
      <Article PubModel="Print">
        <Journal>
          <JournalIssue CitedMedium="Print">
            <PubDate><Year>2022</Year></PubDate>
          </JournalIssue>
          <Title>J</Title>
          <ISOAbbreviation>J</ISOAbbreviation>
        </Journal>
        <ArticleTitle>Structured abstract test</ArticleTitle>
        <Abstract>
          <AbstractText Label="BACKGROUND" NlmCategory="BACKGROUND">Background text here.</AbstractText>
          <AbstractText Label="METHODS" NlmCategory="METHODS">Methods text here.</AbstractText>
        </Abstract>
        <AuthorList CompleteYN="Y"/>
        <Language>eng</Language>
        <PublicationTypeList>
          <PublicationType UI="D016428">Journal Article</PublicationType>
        </PublicationTypeList>
      </Article>
    </MedlineCitation>
    <PubmedData>
      <ArticleIdList>
        <ArticleId IdType="pubmed">11111</ArticleId>
      </ArticleIdList>
    </PubmedData>
  </PubmedArticle>
</PubmedArticleSet>`;

    const articles = parsePubmedEfetchXml(xml);
    expect(articles[0].abstract).toContain('BACKGROUND: Background text here.');
    expect(articles[0].abstract).toContain('METHODS: Methods text here.');
  });
});

describe('parsePmcEfetchXml', () => {
  const MINIMAL_PMC_XML = `<?xml version="1.0"?>
<!DOCTYPE pmc-articleset PUBLIC "-//NLM//DTD NCBI Article Set//EN" "">
<pmc-articleset>
  <article article-type="research-article">
    <front>
      <article-meta>
        <article-id pub-id-type="pmcid">9583675</article-id>
        <article-id pub-id-type="pmid">36275749</article-id>
        <article-id pub-id-type="doi">10.3389/fimmu.2022.960920</article-id>
        <title-group>
          <article-title>A PMC test article</article-title>
        </title-group>
        <abstract>
          <p>This is a simple abstract.</p>
        </abstract>
      </article-meta>
    </front>
    <body>
      <sec id="s1">
        <title>Introduction</title>
        <p>The introduction paragraph goes here.</p>
      </sec>
      <sec id="s2">
        <title>Methods</title>
        <p>Methods are described here.</p>
      </sec>
    </body>
  </article>
</pmc-articleset>`;

  it('parses PMCID with PMC prefix', () => {
    const articles = parsePmcEfetchXml(MINIMAL_PMC_XML);
    expect(articles).toHaveLength(1);
    expect(articles[0].identifiers.pmcid).toBe('PMC9583675');
  });

  it('parses PMID', () => {
    const articles = parsePmcEfetchXml(MINIMAL_PMC_XML);
    expect(articles[0].identifiers.pmid).toBe('36275749');
  });

  it('parses DOI', () => {
    const articles = parsePmcEfetchXml(MINIMAL_PMC_XML);
    expect(articles[0].doi).toBe('10.3389/fimmu.2022.960920');
  });

  it('parses article title', () => {
    const articles = parsePmcEfetchXml(MINIMAL_PMC_XML);
    expect(articles[0].title).toBe('A PMC test article');
  });

  it('parses abstract', () => {
    const articles = parsePmcEfetchXml(MINIMAL_PMC_XML);
    expect(articles[0].abstract).toContain('simple abstract');
  });

  it('includes section titles in full_text', () => {
    const articles = parsePmcEfetchXml(MINIMAL_PMC_XML);
    expect(articles[0].full_text).toContain('Introduction');
    expect(articles[0].full_text).toContain('Methods');
  });

  it('includes paragraph text in full_text', () => {
    const articles = parsePmcEfetchXml(MINIMAL_PMC_XML);
    expect(articles[0].full_text).toContain('introduction paragraph');
    expect(articles[0].full_text).toContain('Methods are described');
  });

  it('keeps inline xref text in citation markers', () => {
    const xml = `<?xml version="1.0"?>
<pmc-articleset>
  <article>
    <front>
      <article-meta>
        <article-id pub-id-type="pmcid">123</article-id>
        <title-group>
          <article-title>Inline citation test</article-title>
        </title-group>
      </article-meta>
    </front>
    <body>
      <sec>
        <title>Introduction</title>
        <p>Cells persist into adulthood (<xref ref-type="bibr" rid="B3">3</xref>-<xref ref-type="bibr" rid="B7">7</xref>).</p>
      </sec>
    </body>
  </article>
</pmc-articleset>`;

    const articles = parsePmcEfetchXml(xml);
    expect(articles[0].full_text).toContain('(3-7)');
  });

  it('keeps inline plus markers in place and removes repeated stray plus tokens', () => {
    const xml = `<?xml version="1.0"?>
<pmc-articleset>
  <article>
    <front>
      <article-meta>
        <article-id pub-id-type="pmcid">456</article-id>
        <title-group>
          <article-title>Public Vd2<sup>+</sup>gd clones <sup>+</sup> <sup>+</sup></article-title>
        </title-group>
        <abstract>
          <p>Background: Vd2<sup>+</sup> cells expand. <sup>+</sup> <sup>+</sup> Methods: We tested clones.</p>
        </abstract>
      </article-meta>
    </front>
    <body>
      <sec>
        <title>Results</title>
        <p>Vd2<sup>+</sup> cells remained detectable.</p>
      </sec>
    </body>
  </article>
</pmc-articleset>`;

    const articles = parsePmcEfetchXml(xml);
    expect(articles[0].title).toBe('Public Vd2+gd clones');
    expect(articles[0].abstract).toContain('Vd2+ cells expand.');
    expect(articles[0].abstract).not.toContain('+ +');
    expect(articles[0].full_text).toContain('Vd2+ cells remained detectable.');
  });

  it('does not corrupt Frontiers-style XML with self-closing uri tags', () => {
    const xml = `<?xml version="1.0"?>
<pmc-articleset>
  <article>
    <front>
      <article-meta>
        <article-id pub-id-type="pmcid">10808317</article-id>
        <article-id pub-id-type="pmid">38274800</article-id>
        <article-id pub-id-type="doi">10.3389/fimmu.2023.1282758</article-id>
        <title-group>
          <article-title>Gamma/delta T cells as cellular vehicles for anti-tumor immunity</article-title>
        </title-group>
        <contrib-group>
          <contrib contrib-type="author">
            <name><surname>Wang</surname></name>
            <uri xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://loop.frontiersin.org/people/1710879"/>
          </contrib>
        </contrib-group>
        <author-notes>
          <fn><p>ORCID: <uri xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://orcid.org/0000-0003-2471-4641">orcid.org/0000-0003-2471-4641</uri></p></fn>
        </author-notes>
        <abstract>
          <p>Adoptive cellular immunotherapy can use gamma/delta T cells <italic toggle="yes">in vivo</italic>.</p>
        </abstract>
      </article-meta>
    </front>
    <body>
      <sec>
        <title>Introduction</title>
        <p>Recent advances in genomic editing of cells (<xref rid="B1" ref-type="bibr">1</xref>-<xref rid="B3" ref-type="bibr">3</xref>) have propelled cellular immunotherapy.</p>
      </sec>
    </body>
    <back>
      <ref-list>
        <title>References</title>
        <ref id="B1"><label>1</label><mixed-citation><article-title>Genome editing study</article-title>. doi: <pub-id pub-id-type="doi">10.1000/test</pub-id></mixed-citation></ref>
      </ref-list>
    </back>
  </article>
</pmc-articleset>`;

    const articles = parsePmcEfetchXml(xml);
    expect(articles[0].abstract).toContain('Adoptive cellular immunotherapy');
    expect(articles[0].full_text).toContain('Introduction');
    expect(articles[0].full_text).toContain('(1-3)');
    expect(articles[0].full_text).toContain('References');
    expect(articles[0].full_text).toContain('10.1000/test');
  });

  it('finds ref-list nodes nested under back sections', () => {
    const xml = `<?xml version="1.0"?>
<pmc-articleset>
  <article>
    <front>
      <article-meta>
        <article-id pub-id-type="pmcid">999</article-id>
        <title-group>
          <article-title>Nested references test</article-title>
        </title-group>
      </article-meta>
    </front>
    <body>
      <sec>
        <title>Data availability statement</title>
        <p>Code is available from the project repository.</p>
      </sec>
    </body>
    <back>
      <sec sec-type="supplementary-material">
        <title>Supplementary material</title>
        <p>Supplementary material is available online.</p>
      </sec>
      <sec>
        <ref-list>
          <title>References</title>
          <ref id="B1"><label>1</label><mixed-citation><article-title>Nested reference</article-title>. doi: <pub-id pub-id-type="doi">10.1000/nested</pub-id></mixed-citation></ref>
        </ref-list>
      </sec>
    </back>
  </article>
</pmc-articleset>`;

    const articles = parsePmcEfetchXml(xml);
    expect(articles[0].full_text).toContain('Data availability statement');
    expect(articles[0].full_text).toContain('References');
    expect(articles[0].full_text).toContain('10.1000/nested');
  });
});

describe('parsePmcAccessXml', () => {
  it('reads open-access flag, license code, and copyright from PMC custom-meta', () => {
    const xml = `<pmc-articleset><article>
      <front><article-meta>
        <article-id pub-id-type="pmcid">PMC10873872</article-id>
        <permissions>
          <copyright-statement>© 2023 The Authors</copyright-statement>
          <license><ali:license_ref>https://creativecommons.org/licenses/by-nc-nd/4.0/</ali:license_ref></license>
        </permissions>
        <custom-meta-group>
          <custom-meta><meta-name>pmc-status-qastatus</meta-name><meta-value>0</meta-value></custom-meta>
          <custom-meta><meta-name>pmc-prop-open-access</meta-name><meta-value>yes</meta-value></custom-meta>
          <custom-meta><meta-name>pmc-license-ref</meta-name><meta-value>CC BY-NC-ND</meta-value></custom-meta>
        </custom-meta-group>
      </article-meta></front>
      <body><sec><p>Results were <italic>significant</italic>.</p></sec></body>
    </article></pmc-articleset>`;

    expect(parsePmcAccessXml(xml)).toEqual([
      {
        pmcid: 'PMC10873872',
        isOpenAccess: true,
        hasFullText: true,
        license: 'CC BY-NC-ND',
        copyrightStatement: '© 2023 The Authors',
      },
    ]);
  });

  it('reports no full text and not open access for publisher-restricted records', () => {
    const xml = `<pmc-articleset><article>
      <!--The publisher of this article does not allow downloading of the full text in XML form.-->
      <front><article-meta>
        <article-id pub-id-type="pmcid">PMC13580969</article-id>
        <custom-meta-group>
          <custom-meta><meta-name>pmc-prop-open-access</meta-name><meta-value>no</meta-value></custom-meta>
        </custom-meta-group>
      </article-meta></front>
    </article></pmc-articleset>`;

    expect(parsePmcAccessXml(xml)).toEqual([
      { pmcid: 'PMC13580969', isOpenAccess: false, hasFullText: false },
    ]);
  });
});
