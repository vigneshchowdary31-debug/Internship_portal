/**
 * RFC 4180 CSV parsing and serialisation.
 *
 * Hand-written rather than pulled from npm because the requirement is narrow
 * (two known column sets, small files, no streaming) and a dependency-free
 * implementation keeps the supply chain of a credential-provisioning path as
 * small as possible.
 *
 * Handles: quoted fields, embedded commas, embedded newlines, escaped quotes
 * (""), CRLF and LF line endings, and a UTF-8 BOM.
 */

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvParseError';
  }
}

/** Parses CSV text into a matrix of raw string cells. */
export function parseCsv(input: string): string[][] {
  // Excel writes a UTF-8 BOM; left in place it becomes part of the first header
  // name and every header match silently fails.
  const text = input.replace(/^﻿/, '');

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // consume the escape pair
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (field.length > 0) {
        throw new CsvParseError(
          `Malformed CSV: unexpected quote in the middle of an unquoted field (row ${rows.length + 1})`
        );
      }
      inQuotes = true;
      fieldWasQuoted = true;
      continue;
    }

    if (char === ',') {
      row.push(field);
      field = '';
      fieldWasQuoted = false;
      continue;
    }

    if (char === '\r' && text[i + 1] === '\n') continue; // CRLF handled on the \n
    if (char === '\n' || char === '\r') {
      row.push(field);
      field = '';
      fieldWasQuoted = false;
      rows.push(row);
      row = [];
      continue;
    }

    field += char;
  }

  if (inQuotes) {
    throw new CsvParseError('Malformed CSV: file ends inside a quoted field (unclosed quote)');
  }

  // Flush the trailing record unless the file simply ended with a newline.
  if (field.length > 0 || fieldWasQuoted || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop rows that are entirely empty — a blank line between records is common
  // in hand-edited files and is not a data error.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

export interface CsvTable {
  headers: string[];
  /** One record per row, keyed by normalised header. */
  rows: Record<string, string>[];
  /** 1-based line number in the source file for each row, for error reporting. */
  rowNumbers: number[];
}

/** Header comparison is case-, space- and underscore-insensitive. */
export function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * Parses CSV text into records and validates the header row against
 * `expectedHeaders`.
 *
 * Missing required headers are an error. Extra columns are ignored rather than
 * rejected, so a file exported from a spreadsheet with an extra notes column
 * still imports.
 */
export function parseCsvTable(input: string, expectedHeaders: string[]): CsvTable {
  const matrix = parseCsv(input);

  if (matrix.length === 0) {
    throw new CsvParseError('The CSV file is empty.');
  }

  const rawHeaders = matrix[0].map((h) => h.trim());
  const normalised = rawHeaders.map(normaliseHeader);

  const missing = expectedHeaders.filter((expected) => !normalised.includes(normaliseHeader(expected)));
  if (missing.length > 0) {
    throw new CsvParseError(
      `The CSV header row is missing required column(s): ${missing.join(', ')}. ` +
        `Found: ${rawHeaders.join(', ') || '(none)'}. Download the template to see the expected format.`
    );
  }

  if (matrix.length === 1) {
    throw new CsvParseError('The CSV file contains a header row but no data rows.');
  }

  const rows: Record<string, string>[] = [];
  const rowNumbers: number[] = [];

  for (let i = 1; i < matrix.length; i++) {
    const cells = matrix[i];
    const record: Record<string, string> = {};
    normalised.forEach((key, index) => {
      record[key] = (cells[index] ?? '').trim();
    });
    rows.push(record);
    rowNumbers.push(i + 1); // +1 because line 1 is the header
  }

  return { headers: rawHeaders, rows, rowNumbers };
}

/**
 * Escapes one cell for CSV output.
 *
 * The leading-character guard is a CSV-injection ("formula injection") defence:
 * a cell beginning = + - @ or a control character is executed as a formula when
 * the file is opened in Excel or Sheets. Since names and university names come
 * from user input and land in an admin's spreadsheet, prefixing a single quote
 * neutralises that without corrupting the visible value.
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let str = String(value);

  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Serialises rows to CSV text with a UTF-8 BOM so Excel detects the encoding. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
  ];
  return `﻿${lines.join('\r\n')}\r\n`;
}
