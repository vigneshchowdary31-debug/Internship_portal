import type { ContentType } from '@/services/lms';

/**
 * Deciding how a piece of learning content should be shown in-app.
 *
 * Pure and dependency-free so every branch — and especially every rejection —
 * can be tested without a browser. The viewer page is a thin renderer over
 * these decisions.
 */

/**
 * How the viewer will render it.
 *
 * Two distinct refusals, and the difference matters to the student:
 *   'unsafe'  — dangerous. Not rendered, and NOT offered as a link either.
 *   'blocked' — perfectly good content the site refuses to have embedded. Not
 *               rendered, but the link IS offered, because opening it in a new
 *               tab is the correct and only way to read it.
 */
export type ViewerKind =
  | 'youtube'
  | 'vimeo'
  | 'video'
  | 'pdf'
  | 'image'
  | 'page'
  | 'blocked'
  | 'unsafe';

export interface ResolvedContent {
  kind: ViewerKind;
  /** What goes in the iframe/video src. Empty when refused. */
  embedUrl: string;
  /** The original, for "open in new tab". Empty ONLY when 'unsafe'. */
  externalUrl: string;
  /** Why it was refused. Set for 'unsafe' and 'blocked'. */
  reason?: string;
}

/**
 * Sites known to refuse embedding, checked BEFORE an iframe is attempted.
 *
 * ── WHY A LIST RATHER THAN A HEADER CHECK ───────────────────────────────────
 * The obvious implementation is a HEAD request that reads `X-Frame-Options` and
 * CSP `frame-ancestors`. That cannot work from a browser: those responses carry
 * no `Access-Control-Allow-Origin`, so the fetch fails CORS outright, and
 * `mode: 'no-cors'` returns an opaque response whose headers are empty by
 * specification. Verified against these very domains — Medium answers
 * `X-Frame-Options: SAMEORIGIN` and GitHub `deny` + `frame-ancestors 'none'`,
 * and neither exposes a single header to JS.
 *
 * Reading them would need a server-side proxy, which is a backend dependency.
 * So the practical control is this list: those headers are stable per-domain,
 * and knowing up front means the student gets a straight answer instead of
 * four seconds of spinner followed by a blank rectangle.
 *
 * Subdomains are matched, so `drive.google.com` covers `docs.google.com` only
 * because both are listed — matching is on the registrable suffix of each
 * entry, not a blanket `google.com`.
 */
export const BLOCKED_EMBED_DOMAINS = [
  'drive.google.com',
  'docs.google.com',
  'sheets.google.com',
  'slides.google.com',
  'notion.so',
  'notion.site',
  'medium.com',
  // Verified: sends X-Frame-Options: deny AND frame-ancestors 'none'. Worth
  // noting because GITHUB_REPO is one of this LMS's own content types, so
  // these links were previously guaranteed to render an empty frame.
  'github.com',
  'gist.github.com',
  'stackoverflow.com',
  'linkedin.com',
  'x.com',
  'twitter.com',
  'facebook.com',
  'instagram.com',
];

/** True when the host is, or is a subdomain of, a listed domain. */
export function isEmbeddingBlocked(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return BLOCKED_EMBED_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`)
  );
}

/**
 * The security boundary.
 *
 * An iframe `src` of `javascript:…` executes IN OUR ORIGIN — it is not
 * sandboxed by the same-origin policy the way a cross-origin page is. Same for
 * `data:` documents, which inherit the embedder's origin in some browsers. So
 * the scheme allow-list is not defence in depth; it is the actual control, and
 * it lives HERE rather than upstream because the viewer takes its URL from a
 * query string that anyone can hand-craft.
 *
 * `http:` is refused as well as the obvious dangers: the app is served over
 * HTTPS, so an http iframe is blocked as mixed content anyway — refusing it
 * with an explanation beats a silently blank frame.
 */
export function sanitiseUrl(raw: string): { url: URL } | { reason: string } {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { reason: 'No address was provided.' };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { reason: 'That is not a valid web address.' };
  }

  if (url.protocol !== 'https:') {
    return {
      reason:
        url.protocol === 'http:'
          ? 'Only secure (https) addresses can be opened here.'
          : `Addresses beginning "${url.protocol}" cannot be opened.`,
    };
  }

  /**
   * Never frame ourselves.
   *
   * `sandbox="allow-scripts allow-same-origin"` is required for YouTube and the
   * built-in PDF viewer, and it is safe only because the framed document is
   * CROSS-origin — it gets its own origin, not ours. Point the same attributes
   * at our own app and that reasoning collapses: the frame would run scripts
   * with our origin and the sandbox would grant nothing.
   *
   * No legitimate learning content lives on this origin, so refusing is free.
   */
  if (typeof window !== 'undefined' && url.origin === window.location.origin) {
    return { reason: 'That address is part of this application and cannot be embedded.' };
  }

  /**
   * A fragment is meaningless to an iframe or a `<video>` — the browser strips
   * it before the request anyway — and carrying it through only makes two
   * links to the same document look different in logs and cache keys.
   */
  url.hash = '';

  return { url };
}

/**
 * Hostnames that could be a homograph attack.
 *
 * `xn--` is the punycode prefix for an internationalised domain, and it is the
 * mechanism behind lookalikes such as `аpple.com` (Cyrillic а). This does NOT
 * reject them outright: a genuine internationalised domain is legitimate
 * content, and refusing to link it would be worse than the risk. It refuses to
 * EMBED them, so the student opens the site in a real tab where the address bar
 * shows them exactly whose page they are on.
 */
export function isSuspiciousHostname(hostname: string): boolean {
  return hostname.toLowerCase().split('.').some((label) => label.startsWith('xn--'));
}

/** `youtu.be/ID`, `youtube.com/watch?v=ID`, `/embed/ID`, `/shorts/ID`. */
function youtubeId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return id || null;
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const v = url.searchParams.get('v');
    if (v) return v;

    const match = url.pathname.match(/^\/(embed|shorts|v)\/([^/?]+)/);
    if (match) return match[2];
  }

  return null;
}

/** `vimeo.com/123456789` and `player.vimeo.com/video/123456789`. */
function vimeoId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, '');
  if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null;

  const match = url.pathname.match(/(?:\/video)?\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Extension check against the PATH only.
 *
 * A query string routinely carries things like `?filename=notes.pdf` on a
 * signed download link, so matching the whole href would classify an HTML
 * download page as a PDF and render an error document in the frame.
 */
function hasExtension(url: URL, extensions: string[]): boolean {
  const path = url.pathname.toLowerCase();
  return extensions.some((ext) => path.endsWith(ext));
}

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogg', '.mov', '.m4v'];
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif'];

/**
 * Works out how to display one URL.
 *
 * `declaredType` is the ContentType the author chose. It is a HINT, not the
 * answer: a REFERENCE item can hold a YouTube link and a VIDEO item can hold an
 * mp4, so the URL itself is inspected first and the declared type only breaks
 * ties. Trusting the label alone is how a PDF ends up in a `<video>` element.
 */
export function resolveContent(rawUrl: string, declaredType?: ContentType | string): ResolvedContent {
  const checked = sanitiseUrl(rawUrl);
  if ('reason' in checked) {
    return { kind: 'unsafe', embedUrl: '', externalUrl: '', reason: checked.reason };
  }

  const { url } = checked;
  const externalUrl = url.toString();

  /**
   * Known refusals are settled BEFORE any embed is attempted.
   *
   * Checked after sanitising (so the URL is trustworthy) but before type
   * detection, because a Google Drive link to an mp4 is still a Google Drive
   * link — the file type does not change whether the site permits framing.
   */
  if (isEmbeddingBlocked(url.hostname)) {
    return {
      kind: 'blocked',
      embedUrl: '',
      externalUrl,
      reason: `${url.hostname.replace(/^www\./, '')} does not allow its pages to be shown inside another site.`,
    };
  }

  if (isSuspiciousHostname(url.hostname)) {
    return {
      kind: 'blocked',
      embedUrl: '',
      externalUrl,
      reason:
        'This address uses an internationalised domain name, which can be made to look like a different site. Open it in a new tab so you can check the address bar.',
    };
  }

  const yt = youtubeId(url);
  if (yt) {
    // `rel=0` keeps the end-screen suggestions to the same channel; without it
    // a lesson finishes by advertising unrelated videos inside the course.
    return {
      kind: 'youtube',
      embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt)}?rel=0`,
      externalUrl,
    };
  }

  const vimeo = vimeoId(url);
  if (vimeo) {
    return {
      kind: 'vimeo',
      embedUrl: `https://player.vimeo.com/video/${encodeURIComponent(vimeo)}`,
      externalUrl,
    };
  }

  if (hasExtension(url, VIDEO_EXTENSIONS)) {
    return { kind: 'video', embedUrl: externalUrl, externalUrl };
  }

  if (hasExtension(url, ['.pdf'])) {
    return { kind: 'pdf', embedUrl: externalUrl, externalUrl };
  }

  if (hasExtension(url, IMAGE_EXTENSIONS)) {
    return { kind: 'image', embedUrl: externalUrl, externalUrl };
  }

  // Cloudinary serves PDFs under /image/upload/ with no extension in the path,
  // so the declared type is the only signal left for an uploaded file.
  if (declaredType === 'PDF') {
    return { kind: 'pdf', embedUrl: externalUrl, externalUrl };
  }
  if (declaredType === 'VIDEO' || declaredType === 'RECORDING') {
    return { kind: 'video', embedUrl: externalUrl, externalUrl };
  }

  return { kind: 'page', embedUrl: externalUrl, externalUrl };
}

/**
 * File types no browser renders inline.
 *
 * Office documents cannot be displayed without handing the URL to a third-party
 * converter (Google Docs or Office Online), which would send the file's address
 * off-platform — the opposite of the point. These are offered as a download
 * instead, honestly labelled, rather than dropped into a frame that shows a
 * blank page or silently starts a download anyway.
 */
export function opensInBrowser(declaredType?: ContentType | string): boolean {
  return declaredType !== 'DOCX' && declaredType !== 'PPT';
}

/** The in-app viewer route for one item. */
export function viewerPath(params: {
  url: string;
  type?: ContentType | string;
  title?: string;
  moduleId?: string;
  contentId?: string;
}): string {
  const search = new URLSearchParams({ url: params.url });
  if (params.type) search.set('type', String(params.type));
  if (params.title) search.set('title', params.title);
  // Carried so the viewer's back button returns to the module the student came
  // from, rather than to a generic course page.
  if (params.moduleId) search.set('moduleId', params.moduleId);
  if (params.contentId) search.set('contentId', params.contentId);

  return `/learn/content?${search.toString()}`;
}
