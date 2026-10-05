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

// Code points above U+FFFF. String.fromCharCode, which fast-xml-parser's
// htmlEntities option uses, would turn each into an unrelated BMP character.
const MATH_ITALIC_ALPHA = String.fromCodePoint(0x1d6fc);
const MATH_ITALIC_BETA = String.fromCodePoint(0x1d6fd);

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

  it('decodes decimal, hexadecimal, and non-BMP numeric character references', () => {
    const xml = MINIMAL_XML
      .replace(
        '<ArticleTitle>A test article title</ArticleTitle>',
        '<ArticleTitle>Outcomes in patients aged &#x2265;70&#xa0;years with <i>TP53</i>-mutated MDS</ArticleTitle>'
      )
      .replace(
        '<AbstractText>This is the abstract.</AbstractText>',
        '<AbstractText>Hemoglobin was &#8805;10&#x2009;g/dL; Cox &#x1d6fd; was 0.42 and Cronbach &#120572; was 0.91.</AbstractText>'
      )
      .replace('<LastName>Doe</LastName>', '<LastName>M&#xfc;ller</LastName>')
      .replace('<ForeName>Jane</ForeName>', '<ForeName>Jos&#233;</ForeName>')
      .replace(
        '<Initials>J</Initials>',
        '<Initials>J</Initials><AffiliationInfo><Affiliation>H&#xf4;pital Saint-Louis, Universit&#xe9; Paris Cit&#xe9;, Paris, France.</Affiliation></AffiliationInfo>'
      );

    const [article] = parsePubmedEfetchXml(xml);

    expect(article.title).toBe('Outcomes in patients aged ≥70 years with TP53-mutated MDS');
    expect(article.abstract).toBe(
      `Hemoglobin was ≥10 g/dL; Cox ${MATH_ITALIC_BETA} was 0.42 and Cronbach ${MATH_ITALIC_ALPHA} was 0.91.`
    );
    expect(article.authors[0]).toEqual({
      last_name: 'Müller',
      fore_name: 'José',
      initials: 'J',
      affiliations: ['Hôpital Saint-Louis, Université Paris Cité, Paris, France.'],
    });
  });

  it('decodes XML entities once and keeps escaped references literal', () => {
    const xml = MINIMAL_XML
      .replace(
        '<ArticleTitle>A test article title</ArticleTitle>',
        '<ArticleTitle>Clonal hematopoiesis &amp; MDS: VAF &lt;2% vs &gt;10%</ArticleTitle>'
      )
      .replace(
        '<AbstractText>This is the abstract.</AbstractText>',
        '<AbstractText Label="PATIENTS &amp; METHODS">Escaped text stays escaped: &amp;amp;, &amp;lt;i&amp;gt;, &amp;#x2265;, &#38;amp; and &#38;#x2265;.</AbstractText>'
      )
      .replace(
        '<ArticleId IdType="doi">10.1234/test.99999</ArticleId>',
        '<ArticleId IdType="doi">10.1002/(SICI)1097-0142(19990101)85:1&lt;1::AID-CNCR1&gt;3.0.CO;2-Q</ArticleId>'
      );

    const [article] = parsePubmedEfetchXml(xml);

    expect(article.title).toBe('Clonal hematopoiesis & MDS: VAF <2% vs >10%');
    expect(article.abstract).toBe(
      'PATIENTS & METHODS: Escaped text stays escaped: &amp;, &lt;i&gt;, &#x2265;, &amp; and &#x2265;.'
    );
    expect(article.doi).toBe('10.1002/(SICI)1097-0142(19990101)85:1<1::AID-CNCR1>3.0.CO;2-Q');
  });

  it('parses a collective (group) author', () => {
    const xml = MINIMAL_XML.replace(
      '</AuthorList>',
      '<Author><CollectiveName>MDS Study Group</CollectiveName></Author></AuthorList>'
    );

    const [article] = parsePubmedEfetchXml(xml);

    expect(article.author_count).toBe(2);
    expect(article.authors[1]).toEqual({
      last_name: '',
      fore_name: '',
      initials: '',
      collective_name: 'MDS Study Group',
    });
    expect(article.authors[0].collective_name).toBeUndefined();
  });

  it('turns NBSP and thin spaces into plain spaces and trims them at the edges', () => {
    const xml = MINIMAL_XML.replace(
      '<Initials>J</Initials>',
      '<Initials>J</Initials><AffiliationInfo><Affiliation>&#xa0;Department of Hematology,&#x2009;Kyoto&#x202f;University&#xa0;</Affiliation></AffiliationInfo>'
    );

    const [article] = parsePubmedEfetchXml(xml);

    expect(article.authors[0].affiliations).toEqual(['Department of Hematology, Kyoto University']);
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

  it('decodes character references and XML entities once, like literal UTF-8 text', () => {
    // PMC EFetch mostly sends literal UTF-8 characters; they must come out the
    // same as the equivalent references.
    const nbsp = String.fromCodePoint(0xa0);
    const thinSpace = String.fromCodePoint(0x2009);
    const xml = `<?xml version="1.0"?>
<pmc-articleset>
  <article>
    <front>
      <article-meta>
        <article-id pub-id-type="pmcid">12345</article-id>
        <title-group>
          <article-title>Venetoclax &amp; azacitidine in patients aged &#x2265;70&#xa0;years with <italic>TP53</italic>-mutated AML</article-title>
        </title-group>
        <abstract>
          <p>Median age was 74&#x2009;years; Cox &#x1d6fd; was 0.42 (P &#x3c; 0.001) and Cronbach &#120572; was 0.91.</p>
        </abstract>
      </article-meta>
    </front>
    <body>
      <sec>
        <title>Methods</title>
        <p>Samples were analyzed at H&#xf4;pital Saint-Louis and Universit&#233; Paris Cit&#xe9;; hemoglobin was &lt;10 g/dL.</p>
        <p>Patients received 400${thinSpace}mg${nbsp}daily.</p>
        <p>Escaped text stays escaped: &amp;lt;, &amp;#x2265;, &#38;amp; and &#38;#x2265;.</p>
      </sec>
    </body>
  </article>
</pmc-articleset>`;

    const [article] = parsePmcEfetchXml(xml);

    expect(article.title).toBe(
      'Venetoclax & azacitidine in patients aged ≥70 years with TP53-mutated AML'
    );
    expect(article.abstract).toBe(
      `Median age was 74 years; Cox ${MATH_ITALIC_BETA} was 0.42 (P < 0.001) and Cronbach ${MATH_ITALIC_ALPHA} was 0.91.`
    );
    expect(article.full_text).toBe(
      [
        'Methods',
        'Samples were analyzed at Hôpital Saint-Louis and Université Paris Cité; hemoglobin was <10 g/dL.',
        'Patients received 400 mg daily.',
        'Escaped text stays escaped: &lt;, &#x2265;, &amp; and &#x2265;.',
      ].join('\n')
    );
  });

  it('leaves character references inside CDATA sections undecoded', () => {
    const xml = `<pmc-articleset><article>
      <front><article-meta><article-id pub-id-type="pmcid">12345</article-id></article-meta></front>
      <body><sec><p><![CDATA[Written as &#x2265; in the source]]></p></sec></body>
    </article></pmc-articleset>`;

    expect(parsePmcEfetchXml(xml)[0].full_text).toBe('Written as &#x2265; in the source');
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

  it('decodes character references in license and copyright strings', () => {
    const xml = `<pmc-articleset><article>
      <front><article-meta>
        <article-id pub-id-type="pmcid">PMC11111111</article-id>
        <permissions>
          <copyright-statement>&#xa9; 2025 Fran&#231;ois M&#xfc;ller &amp; Siobh&#xe1;n O&#x27;Neil</copyright-statement>
        </permissions>
        <custom-meta-group>
          <custom-meta><meta-name>pmc-prop-open-access</meta-name><meta-value>yes</meta-value></custom-meta>
          <custom-meta><meta-name>pmc-license-ref</meta-name><meta-value>CC&#xa0;BY-NC-ND</meta-value></custom-meta>
        </custom-meta-group>
      </article-meta></front>
      <body><sec><p>Results were significant.</p></sec></body>
    </article></pmc-articleset>`;

    expect(parsePmcAccessXml(xml)).toEqual([
      {
        pmcid: 'PMC11111111',
        isOpenAccess: true,
        hasFullText: true,
        license: 'CC BY-NC-ND',
        copyrightStatement: "© 2025 François Müller & Siobhán O'Neil",
      },
    ]);
  });
});
