/**
 * Minimal PDF writer for the one-time credential handout.
 *
 * ── Why this is not reportlab ───────────────────────────────────────────────
 * The brief specified reportlab. reportlab is a **Python** library and this is a
 * Node/TypeScript + React codebase, so it cannot run here at all. The nearest
 * equivalents would be `pdfkit` (Node) or `jspdf` (browser).
 *
 * Neither is used, for a reason that matters more than convenience: the PDF must
 * be generated **in the browser**. The plaintext password already exists in the
 * page — it arrived in the enrollment response — and generating the document
 * locally means it is never transmitted a second time. A server-side generator
 * would require POSTing the password back, which is strictly worse for a value
 * whose entire security model is "it exists in exactly one place, briefly".
 *
 * Given that, a text-only PDF is ~150 lines of well-specified format (PDF 1.4,
 * §7 of the spec) and avoids adding a dependency to a credential-handling path.
 * That trade — no supply chain, no bundle cost, full control — is the right one
 * at this size. If the document ever needs images, tables or custom fonts,
 * switch to jspdf; do not grow this file.
 *
 * The output uses the Helvetica base-14 font, which every conforming reader
 * supplies, so nothing needs embedding.
 */

export interface CredentialDocument {
  name: string;
  email: string;
  temporaryPassword: string;
  portalUrl: string;
  /** Injected rather than read from the clock, so output is deterministic in tests. */
  generatedAt?: Date;
  /** "Student" | "Instructor" — used in the heading only. */
  roleNoun?: string;
}

/** Page geometry, A4 in PostScript points. */
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;

/**
 * Escapes a string for a PDF literal string object.
 *
 * Backslash and both parens are the delimiters of the `(...)` literal form and
 * must be escaped or the content stream becomes unparseable. Non-Latin-1
 * characters are replaced rather than mangled: the base-14 fonts use
 * WinAnsiEncoding and cannot represent them, and a silently corrupted password
 * would be far worse than a visible placeholder. Generated passwords are ASCII
 * by construction, so this only ever affects names.
 */
function escapePdfText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\xFF]/g, '?');
}

interface TextOp {
  text: string;
  size: number;
  bold?: boolean;
  /** Vertical gap applied *before* this line. */
  gapBefore?: number;
  grey?: boolean;
}

/** Builds the content stream: one text block, absolute-positioned lines. */
function buildContentStream(ops: TextOp[]): string {
  let y = PAGE_HEIGHT - MARGIN;
  const parts: string[] = [];

  for (const op of ops) {
    y -= (op.gapBefore ?? 0) + op.size + 4;
    const font = op.bold ? '/F2' : '/F1';
    const colour = op.grey ? '0.42 0.45 0.5 rg' : '0.06 0.09 0.16 rg';
    parts.push(
      `BT ${colour} ${font} ${op.size} Tf 1 0 0 1 ${MARGIN.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdfText(op.text)}) Tj ET`
    );
  }

  // Accent rule under the title.
  parts.unshift(
    `0.31 0.275 0.898 rg ${MARGIN} ${(PAGE_HEIGHT - MARGIN - 30).toFixed(2)} ${(PAGE_WIDTH - MARGIN * 2).toFixed(2)} 3 re f`
  );

  return parts.join('\n');
}

function formatDate(date: Date): string {
  // Locale-independent so the document reads the same everywhere.
  const pad = (n: number) => String(n).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (
    `${pad(date.getDate())} ${months[date.getMonth()]} ${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** The document's text content, in order. Exported for assertion in tests. */
export function buildCredentialLines(doc: CredentialDocument): TextOp[] {
  const generatedAt = doc.generatedAt ?? new Date();
  const noun = doc.roleNoun ?? 'User';

  return [
    { text: 'Internship Training Portal', size: 18, bold: true },
    { text: `${noun} Login Credentials`, size: 11, grey: true, gapBefore: 12 },

    { text: 'Name', size: 9, grey: true, gapBefore: 26 },
    { text: doc.name, size: 13, bold: true },

    { text: 'Email', size: 9, grey: true, gapBefore: 14 },
    { text: doc.email, size: 13, bold: true },

    { text: 'Temporary Password', size: 9, grey: true, gapBefore: 14 },
    { text: doc.temporaryPassword, size: 15, bold: true },

    { text: 'Portal URL', size: 9, grey: true, gapBefore: 14 },
    { text: doc.portalUrl, size: 11, bold: true },

    { text: 'Generated', size: 9, grey: true, gapBefore: 14 },
    { text: formatDate(generatedAt), size: 11, bold: true },

    { text: 'Security Note', size: 10, bold: true, gapBefore: 30 },
    { text: 'This temporary password is shown only once.', size: 10, grey: true, gapBefore: 4 },
    { text: 'Delete this document after securely sharing it.', size: 10, grey: true, gapBefore: 2 },
    {
      text: 'The recipient must change this password at first login.',
      size: 10,
      grey: true,
      gapBefore: 2,
    },
  ];
}

/**
 * Assembles a complete single-page PDF.
 *
 * Object layout: 1 catalog, 2 pages tree, 3 page, 4 content stream, 5/6 fonts.
 * The xref table records the byte offset of each object, which is why the
 * document is assembled as a byte-counted string rather than concatenated
 * blindly.
 */
export function buildCredentialPdf(doc: CredentialDocument): Uint8Array {
  const content = buildContentStream(buildCredentialLines(doc));

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  // Latin-1: every byte in `pdf` is already < 256 because escapePdfText
  // guarantees it, so charCodeAt maps 1:1 onto bytes and offsets stay valid.
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}

/** Filename derived from the recipient, safe for every filesystem. */
export function credentialPdfFilename(name: string, generatedAt = new Date()): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'user';
  return `credentials-${slug}-${generatedAt.toISOString().slice(0, 10)}.pdf`;
}

/**
 * Triggers a browser download.
 *
 * The object URL is revoked immediately after the click, so the blob is
 * released as soon as the download starts — nothing is cached, stored, or
 * reproducible afterwards.
 */
export function downloadCredentialPdf(doc: CredentialDocument): void {
  const bytes = buildCredentialPdf(doc);
  // `.buffer` is asserted to ArrayBuffer: the array is always freshly allocated
  // here and never backed by a SharedArrayBuffer, which is the only case the
  // wider `ArrayBufferLike` type is guarding against.
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = credentialPdfFilename(doc.name, doc.generatedAt);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
