import { describe, it, expect } from 'vitest';
import { parseCsv, parseCsvTable, toCsv, escapeCsvCell, CsvParseError } from './csv';

describe('parseCsv', () => {
  it('parses a simple grid', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles quoted fields containing commas', () => {
    expect(parseCsv('name,city\n"Doe, John",Chennai')).toEqual([
      ['name', 'city'],
      ['Doe, John', 'Chennai'],
    ]);
  });

  it('handles escaped quotes', () => {
    expect(parseCsv('a\n"He said ""hi"""')).toEqual([['a'], ['He said "hi"']]);
  });

  it('handles newlines inside quoted fields', () => {
    expect(parseCsv('a,b\n"line1\nline2",x')).toEqual([
      ['a', 'b'],
      ['line1\nline2', 'x'],
    ]);
  });

  it('strips a UTF-8 BOM so the first header is not corrupted', () => {
    expect(parseCsv('﻿Name,Email\nA,a@b.c')[0][0]).toBe('Name');
  });

  it('skips blank lines between records', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('preserves empty trailing cells', () => {
    expect(parseCsv('a,b,c\n1,,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });

  it('rejects an unclosed quote', () => {
    expect(() => parseCsv('a\n"unterminated')).toThrow(CsvParseError);
  });

  it('rejects a stray quote inside an unquoted field', () => {
    expect(() => parseCsv('a\nab"cd')).toThrow(CsvParseError);
  });
});

describe('parseCsvTable', () => {
  const headers = ['Name', 'Email', 'NIAT ID'];

  it('maps rows onto normalised header keys', () => {
    const table = parseCsvTable('Name,Email,NIAT ID\nRavi,r@x.com,N1', headers);
    expect(table.rows).toEqual([{ name: 'Ravi', email: 'r@x.com', niatid: 'N1' }]);
  });

  it('reports the source line number for each row', () => {
    const table = parseCsvTable('Name,Email,NIAT ID\nA,a@x.com,N1\nB,b@x.com,N2', headers);
    expect(table.rowNumbers).toEqual([2, 3]);
  });

  it('accepts headers in any case, spacing or underscore style', () => {
    const table = parseCsvTable('name,  EMAIL ,niat_id\nRavi,r@x.com,N1', headers);
    expect(table.rows[0]).toEqual({ name: 'Ravi', email: 'r@x.com', niatid: 'N1' });
  });

  it('ignores extra columns rather than rejecting the file', () => {
    const table = parseCsvTable('Name,Email,NIAT ID,Notes\nRavi,r@x.com,N1,hello', headers);
    expect(table.rows[0].name).toBe('Ravi');
  });

  it('names the missing columns when the header row is wrong', () => {
    expect(() => parseCsvTable('Name,Email\nA,a@x.com', headers)).toThrow(/NIAT ID/);
  });

  it('rejects a header-only file', () => {
    expect(() => parseCsvTable('Name,Email,NIAT ID', headers)).toThrow(/no data rows/);
  });

  it('rejects an empty file', () => {
    expect(() => parseCsvTable('', headers)).toThrow(CsvParseError);
  });
});

describe('escapeCsvCell', () => {
  it('quotes cells containing a comma, quote or newline', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('a\nb')).toBe('"a\nb"');
  });

  it('neutralises spreadsheet formula injection', () => {
    expect(escapeCsvCell('=cmd|calc')).toBe("'=cmd|calc");
    expect(escapeCsvCell('+1')).toBe("'+1");
    expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('leaves ordinary values untouched', () => {
    expect(escapeCsvCell('Ravi Kumar')).toBe('Ravi Kumar');
    expect(escapeCsvCell(null)).toBe('');
  });
});

describe('toCsv round-trip', () => {
  it('survives a parse of its own output', () => {
    const csv = toCsv(['Name', 'Email'], [['Doe, John', 'a@b.c']]);
    const parsed = parseCsv(csv);
    expect(parsed).toEqual([
      ['Name', 'Email'],
      ['Doe, John', 'a@b.c'],
    ]);
  });
});
