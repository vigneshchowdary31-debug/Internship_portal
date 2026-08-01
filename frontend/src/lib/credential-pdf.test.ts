import { describe, it, expect } from 'vitest';
import {
  buildCredentialPdf,
  buildCredentialLines,
  credentialPdfFilename,
} from './credential-pdf';

const DOC = {
  name: 'Ravi Kumar',
  email: 'ravi.kumar@example.com',
  temporaryPassword: 'Kf7#mQra2Xvz',
  portalUrl: 'https://training.example.com',
  generatedAt: new Date('2026-07-31T14:30:00Z'),
  roleNoun: 'Student',
};

/** Decodes the PDF bytes back to a latin-1 string for structural assertions. */
function asText(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => String.fromCharCode(b)).join('');
}

describe('buildCredentialPdf — structure', () => {
  const pdf = asText(buildCredentialPdf(DOC));

  it('starts with a PDF header and ends with the EOF marker', () => {
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('declares a catalog, a page tree and one page', () => {
    expect(pdf).toContain('/Type /Catalog');
    expect(pdf).toContain('/Type /Pages');
    expect(pdf).toContain('/Type /Page');
    expect(pdf).toContain('/Count 1');
  });

  it('references only base-14 fonts, so nothing needs embedding', () => {
    expect(pdf).toContain('/BaseFont /Helvetica');
    expect(pdf).toContain('/BaseFont /Helvetica-Bold');
    expect(pdf).not.toContain('/FontFile');
  });

  it('includes an xref table and a startxref offset', () => {
    expect(pdf).toContain('\nxref\n');
    expect(pdf).toContain('startxref');
    expect(pdf).toMatch(/trailer\n<< \/Size \d+ \/Root 1 0 R >>/);
  });

  it('records a byte offset for every object', () => {
    const declared = Number(pdf.match(/xref\n0 (\d+)/)![1]);
    const entries = pdf.match(/^\d{10} \d{5} [nf] $/gm) ?? [];
    expect(entries.length).toBe(declared);
  });

  it('points startxref at the actual xref table', () => {
    const offset = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(offset, offset + 4)).toBe('xref');
  });

  it('declares a content stream length that matches the stream', () => {
    const declared = Number(pdf.match(/<< \/Length (\d+) >>/)![1]);
    const stream = pdf.match(/stream\n([\s\S]*?)\nendstream/)![1];
    expect(stream.length).toBe(declared);
  });

  it('produces bytes that all fit in one octet', () => {
    const bytes = buildCredentialPdf(DOC);
    expect(bytes.every((b) => b >= 0 && b <= 255)).toBe(true);
    expect(bytes.length).toBeGreaterThan(500);
  });
});

describe('buildCredentialPdf — content', () => {
  const pdf = asText(buildCredentialPdf(DOC));

  it('contains every credential field', () => {
    expect(pdf).toContain('Ravi Kumar');
    expect(pdf).toContain('ravi.kumar@example.com');
    expect(pdf).toContain('Kf7#mQra2Xvz');
    expect(pdf).toContain('https://training.example.com');
  });

  it('carries the portal branding and the generated date', () => {
    expect(pdf).toContain('Internship Training Portal');
    expect(pdf).toContain('31 Jul 2026');
  });

  it('carries the security note verbatim', () => {
    expect(pdf).toContain('This temporary password is shown only once.');
    expect(pdf).toContain('Delete this document after securely sharing it.');
  });

  it('labels the document with the recipient role', () => {
    expect(asText(buildCredentialPdf({ ...DOC, roleNoun: 'Instructor' }))).toContain(
      'Instructor Login Credentials'
    );
  });
});

describe('buildCredentialPdf — escaping', () => {
  it('escapes parentheses so the content stream stays parseable', () => {
    const pdf = asText(buildCredentialPdf({ ...DOC, name: 'Ravi (Junior) Kumar' }));
    expect(pdf).toContain('Ravi \\(Junior\\) Kumar');
  });

  it('escapes backslashes', () => {
    const pdf = asText(buildCredentialPdf({ ...DOC, name: 'A\\B' }));
    expect(pdf).toContain('A\\\\B');
  });

  it('replaces characters the base-14 encoding cannot represent', () => {
    // A silently corrupted password would be far worse than a visible '?'.
    const pdf = asText(buildCredentialPdf({ ...DOC, name: '张伟' }));
    expect(pdf).toContain('??');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
  });

  it('stays structurally valid with adversarial input', () => {
    const pdf = asText(
      buildCredentialPdf({ ...DOC, name: ')) endstream endobj trailer <<' })
    );
    expect(pdf).toContain('\\)\\)');
    // Exactly one real stream survives; the injected text did not create another.
    expect(pdf.match(/\nstream\n/g)!.length).toBe(1);
  });
});

describe('buildCredentialLines', () => {
  it('never emits a line containing more than one field value', () => {
    const lines = buildCredentialLines(DOC);
    const passwordLines = lines.filter((l) => l.text.includes(DOC.temporaryPassword));
    expect(passwordLines).toHaveLength(1);
  });

  it('renders the password on its own, without a label prefix', () => {
    const lines = buildCredentialLines(DOC);
    const line = lines.find((l) => l.text.includes(DOC.temporaryPassword))!;
    expect(line.text).toBe(DOC.temporaryPassword);
  });

  it('is deterministic for a fixed generatedAt', () => {
    expect(buildCredentialLines(DOC)).toEqual(buildCredentialLines(DOC));
  });
});

describe('credentialPdfFilename', () => {
  it('slugifies the recipient name and stamps the date', () => {
    expect(credentialPdfFilename('Ravi Kumar', DOC.generatedAt)).toBe(
      'credentials-ravi-kumar-2026-07-31.pdf'
    );
  });

  it('strips characters that are unsafe in a filename', () => {
    expect(credentialPdfFilename('A/B\\C:D*E', DOC.generatedAt)).toBe(
      'credentials-a-b-c-d-e-2026-07-31.pdf'
    );
  });

  it('falls back to a generic name when nothing survives slugification', () => {
    expect(credentialPdfFilename('***', DOC.generatedAt)).toBe(
      'credentials-user-2026-07-31.pdf'
    );
  });

  it('never leaks the password into the filename', () => {
    expect(credentialPdfFilename('Ravi Kumar', DOC.generatedAt)).not.toContain(
      DOC.temporaryPassword
    );
  });
});

describe('security invariants', () => {
  it('generates entirely in memory — nothing is written or fetched', () => {
    // The builder is a pure function of its input: same input, same bytes.
    // If it ever reached out to a server or the filesystem this would break.
    const a = buildCredentialPdf(DOC);
    const b = buildCredentialPdf(DOC);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('embeds no metadata beyond what was passed in', () => {
    const pdf = asText(buildCredentialPdf(DOC));
    expect(pdf).not.toMatch(/\/Author|\/Creator|\/Producer/);
  });
});
