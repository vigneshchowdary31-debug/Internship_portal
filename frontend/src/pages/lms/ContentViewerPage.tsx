import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  ShieldAlert,
  AlertTriangle,
  Download,
  Copy,
  Check,
  FileWarning,
  RefreshCw,
} from 'lucide-react';
import { resolveContent, type ViewerKind } from '@/lib/contentUrl';
import { useBlobUrl } from '@/hooks/useBlobUrl';
import { lmsApi } from '@/services/lms';

/**
 * Opens learning content inside the platform.
 *
 * ── WHY THERE IS NO HEADER PRE-CHECK ────────────────────────────────────────
 * The natural design is a HEAD request that reads `X-Frame-Options` and CSP
 * `frame-ancestors` before deciding. A browser cannot do it: those responses
 * carry no `Access-Control-Allow-Origin`, so the fetch fails CORS, and
 * `mode: 'no-cors'` yields an opaque response whose headers are empty by
 * specification. Verified against Medium and GitHub — both send the blocking
 * headers, neither exposes one byte of them to JS.
 *
 * The equivalent guarantee comes from `BLOCKED_EMBED_DOMAINS` instead: those
 * headers are stable per-domain, so a known refusal is settled before any frame
 * is created and the student gets a straight answer immediately.
 *
 * ── AND WHY NO "BLANK FRAME" HEURISTIC ──────────────────────────────────────
 * Guessing from load time and height cannot work either: a cross-origin frame's
 * document is unreadable, so there is no height to measure, and "loaded in
 * under 500ms" describes every cached YouTube embed as much as it does a
 * blocked page. Wiring that up would mark WORKING embeds as broken — the one
 * outcome worth avoiding most. What replaces it is honest: the escape hatch is
 * always on screen, and a timed prompt says plainly that some sites refuse.
 */

/** Copy that fits what is actually loading. A PDF and a blog post differ. */
const LOADING_COPY: Record<string, { label: string; hint: string }> = {
  video: { label: 'Loading video…', hint: 'Buffering the first few seconds.' },
  youtube: { label: 'Loading video…', hint: 'Connecting to YouTube.' },
  vimeo: { label: 'Loading video…', hint: 'Connecting to Vimeo.' },
  pdf: { label: 'Loading document…', hint: 'Large PDFs can take a moment.' },
  image: { label: 'Loading image…', hint: '' },
  page: { label: 'Loading content…', hint: '' },
};

/** Human-readable byte count for the download indicator. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Fire-and-forget telemetry. */
type ViewerEvent = 'content_opened' | 'embed_blocked' | 'fallback_used' | 'link_copied';

export const ContentViewerPage = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();

  const rawUrl = params.get('url') ?? '';
  const declaredType = params.get('type') ?? undefined;
  const title = params.get('title') ?? 'Content';
  const moduleId = params.get('moduleId') ?? undefined;
  const contentId = params.get('contentId') ?? undefined;

  const resolved = useMemo(() => resolveContent(rawUrl, declaredType), [rawUrl, declaredType]);

  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [copied, setCopied] = useState(false);

  /**
   * PDFs are fetched and re-served from a same-origin blob rather than framed
   * directly.
   *
   * Cloudinary sends `raw` assets with `Content-Disposition: attachment` and
   * framing restrictions, so an iframe pointed at the delivery URL is killed by
   * Chrome ("This page has been blocked"). Video and images are untouched —
   * they are served as `image`/`video` resource types and already render.
   */
  const isPdf = resolved.kind === 'pdf';
  const pdf = useBlobUrl(isPdf ? resolved.embedUrl : null, {
    mimeType: 'application/pdf',
    enabled: isPdf,
  });

  /**
   * Interaction tracking, reusing the existing endpoint.
   *
   * There is no frontend analytics sink in this project, and adding one would
   * be the backend dependency this work is not allowed to introduce. So the
   * named events go to the console as structured lines — greppable, and ready
   * to point at a real collector the day there is one — while the content view
   * itself still lands in `ContentProgress` where the LMS already counts it.
   */
  const track = useMutation({ mutationFn: (id: string) => lmsApi.recordOpen(id) });

  const emit = (event: ViewerEvent, detail: Record<string, unknown> = {}) => {
    console.info('[viewer]', JSON.stringify({ event, kind: resolved.kind, contentId, ...detail }));
  };

  useEffect(() => {
    if (contentId) track.mutate(contentId);
    // Once per content item, not once per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentId]);

  useEffect(() => {
    if (pdf.status === 'fallback') emit('embed_blocked', { reason: pdf.reason, via: 'blob-fetch' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf.status]);

  useEffect(() => {
    if (resolved.kind === 'blocked') emit('embed_blocked', { reason: resolved.reason });
    else if (resolved.kind !== 'unsafe') emit('content_opened');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved.kind]);

  // A prompt, not a verdict — see the note above about undetectable blocking.
  useEffect(() => {
    if (loaded || resolved.kind === 'unsafe' || resolved.kind === 'blocked') return;
    const timer = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(timer);
  }, [loaded, resolved.kind]);

  const goBack = () => {
    // Never window.location — this keeps SPA history intact so the module stays
    // expanded and scrolled where the student left it.
    if (window.history.length > 1) navigate(-1);
    else navigate(moduleId ? `/student/course#module-${moduleId}` : '/student/course');
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(resolved.externalUrl);
      setCopied(true);
      emit('link_copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is denied in some embedded/insecure contexts. The
      // address is already visible via "Open in new tab", so this is a nudge
      // rather than a failure.
      toast.error('Could not copy', 'Use “Open in new tab” instead.');
    }
  };

  /** The two actions that are always available whenever there IS a link. */
  const FallbackActions = ({ primary = false }: { primary?: boolean }) => (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant={primary ? 'default' : 'outline'}
        size="sm"
        asChild
        onClick={() => emit('fallback_used')}
      >
        <a href={resolved.externalUrl} target="_blank" rel="noopener noreferrer">
          {resolved.kind === 'pdf' ? (
            <Download className="mr-2 h-4 w-4" />
          ) : (
            <ExternalLink className="mr-2 h-4 w-4" />
          )}
          Open in new tab
        </a>
      </Button>

      <Button variant="outline" size="sm" onClick={copyLink}>
        {copied ? <Check className="mr-2 h-4 w-4 text-green-600" /> : <Copy className="mr-2 h-4 w-4" />}
        {copied ? 'Copied' : 'Copy link'}
      </Button>
    </div>
  );

  // --- Refused outright: no link offered ------------------------------------

  if (resolved.kind === 'unsafe') {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={goBack} className="-ml-2">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <ShieldAlert className="mb-3 h-8 w-8 text-red-300" />
            <p className="font-medium text-gray-700">This link cannot be opened</p>
            <p className="mt-1 max-w-sm text-sm text-gray-500">{resolved.reason}</p>
            <p className="mt-3 max-w-sm text-xs text-gray-400">
              If you believe this is a mistake, ask your instructor to check the link.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- Known to refuse embedding: link IS offered, prominently ---------------

  if (resolved.kind === 'blocked') {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={goBack} className="-ml-2">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        <Card>
          <CardContent className="flex flex-col items-center py-14 text-center">
            <AlertTriangle className="mb-3 h-8 w-8 text-amber-400" />
            <p className="font-medium text-gray-900">This content opens in a new tab</p>
            <p className="mt-1 max-w-md text-sm text-gray-600">{resolved.reason}</p>
            <p className="mt-2 max-w-md text-xs text-gray-400">
              Sites do this deliberately, to stop their pages being wrapped inside another
              website. It is not a problem with your course.
            </p>

            <div className="mt-5">
              <FallbackActions primary />
            </div>

            <p className="mt-4 max-w-md break-all text-xs text-gray-400">
              {resolved.externalUrl}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const copy = LOADING_COPY[resolved.kind as ViewerKind] ?? LOADING_COPY.page;
  const isVideo = resolved.kind === 'video';

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[420px] flex-col gap-3">
      {/* --- Top bar --- */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={goBack} className="-ml-2 flex-shrink-0">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <h1 className="truncate text-sm font-semibold text-gray-900 sm:text-base">{title}</h1>
        </div>

        {/* Always present, never hidden behind a failure state that may never
            fire. Not a redirect — the platform page stays open behind it. */}
        <FallbackActions />
      </div>

      {/* --- Viewer --- */}
      <div className="relative flex-1 overflow-hidden rounded-lg border bg-gray-900">
        {!loaded && !isVideo && !isPdf && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white px-6">
            {/* A skeleton for media, a spinner for a document: a video pane
                should look like a video pane while it buffers. */}
            {resolved.kind === 'youtube' || resolved.kind === 'vimeo' ? (
              <Skeleton className="h-32 w-56 rounded-md" />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            )}

            <div className="text-center">
              <p className="text-sm font-medium text-gray-700">{copy.label}</p>
              {copy.hint && <p className="mt-0.5 text-xs text-gray-400">{copy.hint}</p>}
            </div>

            {slow && (
              <div className="mt-2 max-w-sm text-center">
                <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                  This site may not allow embedding
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  Some websites prevent their pages being shown inside another site. If nothing
                  appears, open it in a new tab.
                </p>
                <div className="mt-3 flex justify-center">
                  <FallbackActions primary />
                </div>
              </div>
            )}
          </div>
        )}

        {isVideo ? (
          <div className="relative h-full w-full">
            {!loaded && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-gray-900">
                <Skeleton className="h-24 w-40 rounded-md bg-gray-800" />
                <p className="text-sm text-gray-300">Loading video…</p>
              </div>
            )}
            <video
              src={resolved.embedUrl}
              controls
              controlsList="nodownload"
              className="h-full w-full bg-black"
              onLoadedData={() => setLoaded(true)}
              onError={() => setLoaded(true)}
            >
              Your browser cannot play this video.
            </video>
          </div>
        ) : isPdf ? (
          /* --- PDF: same-origin blob, with a direct frame as the safety net --- */
          pdf.status === 'fallback' ? (
            /* Not an error state. Too large, too slow, no CORS or not a PDF all
               mean the blob route is the wrong tool — not that the document is
               unreadable. The direct frame streams and renders progressively,
               which is the better choice for exactly these cases. */
            <div className="flex h-full w-full flex-col">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-amber-50 px-3 py-2">
                <p className="flex items-start gap-1.5 text-xs text-amber-800">
                  <FileWarning className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  {pdf.reason} If nothing appears below, open it in a new tab.
                </p>
                <Button variant="ghost" size="sm" onClick={pdf.retry} className="h-7 flex-shrink-0">
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Retry
                </Button>
              </div>
              <iframe
                src={resolved.embedUrl}
                title={title}
                className="flex-1 border-0 bg-white"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          ) : pdf.status === 'ready' && pdf.blobUrl ? (
            /* No sandbox here, deliberately. A blob inherits OUR origin, so
               `allow-scripts allow-same-origin` would be a sandbox escape
               rather than a restriction — and Chrome's PDF viewer does not run
               under sandbox at all. Safety comes from the forced
               `application/pdf` type plus the %PDF- check before this point. */
            <iframe
              src={pdf.blobUrl}
              title={title}
              className="h-full w-full border-0 bg-white"
              onLoad={() => setLoaded(true)}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-white px-6">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              <div className="w-full max-w-xs text-center">
                <p className="text-sm font-medium text-gray-700">
                  {pdf.status === 'probing' ? 'Preparing document…' : 'Loading document…'}
                </p>

                {/* Determinate when the server told us the size, indeterminate
                    otherwise — a bar that pretends to know is worse than one
                    that admits it does not. */}
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                  {pdf.progress.percent !== null ? (
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${pdf.progress.percent}%` }}
                      role="progressbar"
                      aria-valuenow={pdf.progress.percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    />
                  ) : (
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
                  )}
                </div>

                <p className="mt-1.5 text-xs text-gray-400">
                  {pdf.progress.percent !== null
                    ? `${pdf.progress.percent}% · ${formatBytes(pdf.progress.loaded)} of ${formatBytes(pdf.progress.total!)}`
                    : pdf.progress.loaded > 0
                      ? `${formatBytes(pdf.progress.loaded)} downloaded`
                      : 'Downloading the file so it can be shown here.'}
                </p>
              </div>
            </div>
          )
        ) : resolved.kind === 'image' ? (
          <div className="flex h-full w-full items-center justify-center overflow-auto bg-gray-50 p-4">
            <img
              src={resolved.embedUrl}
              alt={title}
              className="max-h-full max-w-full object-contain"
              onLoad={() => setLoaded(true)}
              onError={() => setLoaded(true)}
            />
          </div>
        ) : (
          <iframe
            src={resolved.embedUrl}
            title={title}
            className="h-full w-full border-0 bg-white"
            onLoad={() => setLoaded(true)}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            // `allow-same-origin` is REQUIRED for YouTube and the built-in PDF
            // viewer. It is safe only because the frame is cross-origin — it
            // grants the embedded document its OWN origin, not ours — which is
            // exactly why sanitiseUrl refuses a same-origin src.
            sandbox="allow-scripts allow-same-origin allow-popups allow-presentation allow-forms"
            referrerPolicy="no-referrer-when-downgrade"
          />
        )}
      </div>

      <p className="text-center text-xs text-gray-400">
        {resolved.kind === 'youtube' || resolved.kind === 'vimeo'
          ? 'Playing inside the platform.'
          : resolved.kind === 'pdf'
            ? 'If the document does not appear, use “Open in new tab”.'
            : 'Some websites block being displayed inside another page.'}
      </p>
    </div>
  );
};
