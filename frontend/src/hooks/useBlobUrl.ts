import { useEffect, useRef, useState } from 'react';

/**
 * Fetches a remote file and republishes it as a same-origin `blob:` URL.
 *
 * ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────────
 * A PDF framed straight from its delivery URL can be killed by Chrome — by a
 * `Content-Disposition: attachment`, by frame-blocking headers, or simply by
 * the `sandbox` attribute on the frame, since the built-in PDF viewer is a
 * plugin-like component that does not render reliably inside one. Fetching the
 * bytes and re-serving them from a blob sidesteps all of it: the document the
 * browser ends up framing originates from OUR origin.
 *
 * ── WHY THE MIME TYPE IS FORCED ─────────────────────────────────────────────
 * `response.blob()` inherits the server's Content-Type, and Cloudinary labels
 * genuine `raw` assets `application/octet-stream`. A blob of that type triggers
 * a download rather than the viewer — the original symptom, moved one step
 * later. Rebuilding from raw bytes with an explicit type is what makes it
 * render.
 *
 * That forcing is also the security control. A blob inherits the embedder's
 * origin, so HTML from a hostile URL could otherwise script against us.
 * Declared `application/pdf`, the bytes reach the PDF parser, which rejects
 * non-PDF input rather than executing it — and the magic-number check below
 * refuses it before that even happens.
 *
 * ── FAILING TO A FRAME, NOT TO AN ERROR ─────────────────────────────────────
 * Most things that go wrong here — too large, too slow, no CORS, not actually a
 * PDF — do NOT mean the document is unreadable. They mean the blob route is the
 * wrong tool for it. Those resolve to `fallback`, which the caller renders as a
 * direct iframe. `error` is reserved for the cases where nothing is left to try.
 */

/**
 * There is deliberately no 'error' state.
 *
 * Every way this can fail — too large, too slow, no CORS, a 404, not a PDF —
 * still has a better answer than an error card: hand the URL to a direct frame
 * and let the browser show whatever the server actually returns. A dead status
 * in this union would only invite a caller to render a dead branch.
 */
export type BlobStatus = 'idle' | 'probing' | 'loading' | 'ready' | 'fallback';

export interface BlobProgress {
  loaded: number;
  /** Null when the server sent no Content-Length — show an indeterminate bar. */
  total: number | null;
  percent: number | null;
}

export interface BlobUrlState {
  blobUrl: string | null;
  status: BlobStatus;
  /** Why the blob route was abandoned. Set when `status` is 'fallback'. */
  reason: string | null;
  progress: BlobProgress;
  retry: () => void;
}

/**
 * Above this, buffering the whole file in memory costs more than it buys.
 *
 * The direct frame streams and renders progressively; a blob must be complete
 * before the first page appears. Deliberately below the 50 MB content upload
 * limit, so the largest permitted lecture deck takes the streaming path.
 */
export const MAX_BLOB_BYTES = 25 * 1024 * 1024;

/** Whole-download budget. A file that has not arrived by now will not feel instant. */
export const FETCH_TIMEOUT_MS = 10_000;

/** The size probe must not itself become the delay it exists to prevent. */
const HEAD_TIMEOUT_MS = 3_000;

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * `%PDF-` at the start of the file.
 *
 * Scanned over the first kilobyte rather than asserted at offset 0: the spec
 * puts the header first, but real files sometimes carry a byte-order mark or a
 * few bytes of junk ahead of it, and every browser tolerates that. Being
 * stricter than the renderer would reject documents that display perfectly.
 */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const window = bytes.subarray(0, 1024);
  const signature = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

  outer: for (let i = 0; i + signature.length <= window.length; i++) {
    for (let j = 0; j < signature.length; j++) {
      if (window[i + j] !== signature[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** Turns a failure into something a person can act on. */
function describeFailure(error: unknown): string {
  // A CORS rejection and an offline browser are indistinguishable to fetch:
  // both surface as an opaque TypeError with no detail.
  if (error instanceof TypeError) {
    return 'The file could not be downloaded directly.';
  }
  return error instanceof Error ? error.message : 'The file could not be loaded.';
}

const NO_PROGRESS: BlobProgress = { loaded: 0, total: null, percent: null };

export function useBlobUrl(
  url: string | null,
  options: { mimeType?: string; enabled?: boolean; maxBytes?: number } = {}
): BlobUrlState {
  const { mimeType = 'application/pdf', enabled = true, maxBytes = MAX_BLOB_BYTES } = options;

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<BlobStatus>('idle');
  const [reason, setReason] = useState<string | null>(null);
  const [progress, setProgress] = useState<BlobProgress>(NO_PROGRESS);
  const [attempt, setAttempt] = useState(0);

  /**
   * The URL currently handed to the DOM.
   *
   * A ref, not state, so cleanup revokes the exact string ITS effect created.
   * Reading it from state during cleanup would race on a URL change: the old
   * effect's teardown would see the new value, leaking the old blob and killing
   * the live one.
   */
  const objectUrlRef = useRef<string | null>(null);

  /** Revokes whatever is outstanding. One live blob per hook, always. */
  const releaseCurrent = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  useEffect(() => {
    if (!url || !enabled) {
      setStatus('idle');
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const settleFallback = (why: string) => {
      if (cancelled) return;
      setReason(why);
      setStatus('fallback');
    };

    setStatus('probing');
    setReason(null);
    setProgress(NO_PROGRESS);

    (async () => {
      // --- 1. Size probe -----------------------------------------------------
      // Content-Length is a CORS-safelisted response header, so it IS readable
      // cross-origin wherever the fetch itself is allowed. Verified against the
      // Cloudinary assets this app serves.
      let declaredSize: number | null = null;
      try {
        const headController = new AbortController();
        const headTimer = setTimeout(() => headController.abort(), HEAD_TIMEOUT_MS);
        const head = await fetch(url, { method: 'HEAD', signal: headController.signal });
        clearTimeout(headTimer);

        const length = head.headers.get('content-length');
        if (head.ok && length) declaredSize = Number(length);
      } catch {
        // A server that refuses HEAD is not a failure — the download below
        // enforces the same ceiling as the bytes arrive.
      }

      if (cancelled) return;

      if (declaredSize !== null && declaredSize > maxBytes) {
        return settleFallback(
          `This document is ${formatMb(declaredSize)}. Opening it in the optimised viewer instead.`
        );
      }

      // --- 2. Download, with progress and a whole-request budget -------------
      const timeoutTimer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let timedOut = false;
      const markTimeout = () => {
        timedOut = true;
      };
      controller.signal.addEventListener('abort', markTimeout, { once: true });

      try {
        setStatus('loading');
        const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });

        if (!response.ok) {
          clearTimeout(timeoutTimer);
          if (response.status === 404) {
            return settleFallback('This file no longer exists on the server.');
          }
          if (response.status === 401 || response.status === 403) {
            return settleFallback('This file is access-restricted.');
          }
          return settleFallback(`The server returned ${response.status} for this file.`);
        }

        const headerLength = Number(response.headers.get('content-length'));
        const total = declaredSize ?? (headerLength > 0 ? headerLength : null);
        let bytes: Uint8Array<ArrayBuffer>;

        if (response.body) {
          // Streamed so the bar moves and so the size ceiling can be enforced
          // DURING the download — a server that lied about Content-Length, or
          // sent none, cannot make us buffer a gigabyte.
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let loaded = 0;

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (cancelled) return;

            chunks.push(value);
            loaded += value.length;
            setProgress({
              loaded,
              total,
              percent: total ? Math.min(100, Math.round((loaded / total) * 100)) : null,
            });

            if (loaded > maxBytes) {
              await reader.cancel();
              clearTimeout(timeoutTimer);
              return settleFallback(
                `This document is larger than ${formatMb(maxBytes)}. Opening it in the optimised viewer instead.`
              );
            }
          }

          bytes = new Uint8Array(new ArrayBuffer(loaded));
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
        } else {
          // No streaming support: still correct, just without a progress bar.
          const buffer = await response.arrayBuffer();
          bytes = new Uint8Array(buffer);
          if (bytes.length > maxBytes) {
            clearTimeout(timeoutTimer);
            return settleFallback(
              `This document is ${formatMb(bytes.length)}. Opening it in the optimised viewer instead.`
            );
          }
        }

        clearTimeout(timeoutTimer);
        if (cancelled) return;

        // --- 3. Is it actually a PDF? ---------------------------------------
        if (mimeType === 'application/pdf' && !looksLikePdf(bytes)) {
          // An HTML error page served with a .pdf URL is the common case — a
          // login wall, or an expired signed link. Framing it directly at least
          // shows the student what the server actually said.
          return settleFallback('That file does not look like a PDF.');
        }

        // --- 4. Publish, one blob at a time ---------------------------------
        releaseCurrent();
        const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
        objectUrlRef.current = objectUrl;
        setBlobUrl(objectUrl);
        setStatus('ready');
      } catch (caught) {
        clearTimeout(timeoutTimer);
        if (cancelled) return;

        if ((caught as Error)?.name === 'AbortError') {
          // Distinguishes "we gave up on it" from "the component went away".
          if (timedOut) {
            return settleFallback('This document is taking a long time. Opening it directly.');
          }
          return;
        }

        settleFallback(describeFailure(caught));
      } finally {
        controller.signal.removeEventListener('abort', markTimeout);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      // Revoked on unmount and on every URL change. Without this, working
      // through a module of PDFs holds every one of them in memory for the life
      // of the tab.
      releaseCurrent();
    };
  }, [url, enabled, mimeType, maxBytes, attempt]);

  return {
    blobUrl,
    status,
    reason,
    progress,
    retry: () => setAttempt((n) => n + 1),
  };
}
