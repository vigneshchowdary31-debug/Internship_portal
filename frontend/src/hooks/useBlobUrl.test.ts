import { describe, it, expect } from 'vitest';
import { looksLikePdf, MAX_BLOB_BYTES, FETCH_TIMEOUT_MS } from './useBlobUrl';

/**
 * The magic-number check is the last gate before bytes become a same-origin
 * blob, so both directions matter: letting non-PDF content through wastes the
 * forced-MIME protection, and rejecting a valid PDF makes a working document
 * unreadable.
 *
 * The hook's async behaviour (HEAD probe, streaming, abort, revoke) needs a DOM
 * and a fetch to exercise — this suite runs in `environment: 'node'` with no
 * jsdom, so what is pinned here is the pure logic and the tuning constants.
 */

const bytes = (text: string, prefix: number[] = []) =>
  new Uint8Array([...prefix, ...Array.from(text, (c) => c.charCodeAt(0))]);

describe('looksLikePdf — accepts real files', () => {
  it.each([['%PDF-1.4'], ['%PDF-1.7'], ['%PDF-2.0']])('accepts a %s header', (header) => {
    // The exact headers this app's own Cloudinary assets carry.
    expect(looksLikePdf(bytes(`${header}\n%âãÏÓ\n1 0 obj`))).toBe(true);
  });

  it('tolerates a UTF-8 BOM before the header', () => {
    // Real files sometimes carry one, and every browser renders them.
    expect(looksLikePdf(bytes('%PDF-1.4', [0xef, 0xbb, 0xbf]))).toBe(true);
  });

  it('tolerates a few bytes of junk before the header', () => {
    // Being stricter than the renderer would reject documents that display
    // perfectly — the failure mode worth avoiding here.
    expect(looksLikePdf(bytes('%PDF-1.5', [0x0d, 0x0a, 0x20, 0x20]))).toBe(true);
  });

  it('finds a header late in the first kilobyte', () => {
    const padding = Array.from({ length: 900 }, () => 0x20);
    expect(looksLikePdf(bytes('%PDF-1.4', padding))).toBe(true);
  });
});

describe('looksLikePdf — rejects everything else', () => {
  it('rejects an HTML login wall served from a .pdf URL', () => {
    // The common real case: an expired signed link, or an auth redirect.
    expect(looksLikePdf(bytes('<!DOCTYPE html><html><body>Sign in'))).toBe(false);
  });

  it('rejects a JSON error body', () => {
    expect(looksLikePdf(bytes('{"error":"Not found"}'))).toBe(false);
  });

  it('rejects an empty response', () => {
    expect(looksLikePdf(new Uint8Array(0))).toBe(false);
  });

  it('rejects a PNG', () => {
    expect(looksLikePdf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(false);
  });

  it('rejects a header that appears only AFTER the first kilobyte', () => {
    // Beyond this it is not a PDF header, it is a PDF mentioned inside
    // something else — an HTML page linking to one, for instance.
    const padding = Array.from({ length: 1100 }, () => 0x20);
    expect(looksLikePdf(bytes('%PDF-1.4', padding))).toBe(false);
  });

  it('rejects a truncated signature', () => {
    // "%PDF" without the trailing hyphen is not the header.
    expect(looksLikePdf(bytes('%PDF'))).toBe(false);
  });

  it('does not match the signature split across the boundary it scans', () => {
    const padding = Array.from({ length: 1022 }, () => 0x20);
    expect(looksLikePdf(bytes('%PDF-1.4', padding))).toBe(false);
  });
});

describe('tuning constants', () => {
  it('caps blob buffering below the 50 MB content upload limit', () => {
    // The largest permitted lecture deck must take the streaming path rather
    // than being buffered whole.
    expect(MAX_BLOB_BYTES).toBe(25 * 1024 * 1024);
    expect(MAX_BLOB_BYTES).toBeLessThan(50 * 1024 * 1024);
  });

  it('gives the download a bounded budget', () => {
    expect(FETCH_TIMEOUT_MS).toBe(10_000);
  });
});
