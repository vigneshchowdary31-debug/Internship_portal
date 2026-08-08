import { describe, it, expect, vi } from 'vitest';
import {
  resolveContent,
  sanitiseUrl,
  opensInBrowser,
  viewerPath,
  isEmbeddingBlocked,
  isSuspiciousHostname,
} from './contentUrl';

/**
 * The scheme allow-list is a real security control, not hygiene: an iframe
 * `src` of `javascript:…` executes in OUR origin rather than being isolated
 * the way a cross-origin page is. Since the viewer takes its URL from a query
 * string anyone can craft, these rejections are the boundary.
 */
describe('sanitiseUrl — what must never reach an iframe', () => {
  it.each([
    ['javascript:alert(document.cookie)'],
    ['JavaScript:alert(1)'],
    ['  javascript:alert(1)  '],
    ['data:text/html,<script>alert(1)</script>'],
    ['file:///etc/passwd'],
    ['vbscript:msgbox(1)'],
    ['blob:https://example.com/abc'],
  ])('refuses %s', (raw) => {
    const result = sanitiseUrl(raw);
    expect(result).toHaveProperty('reason');
  });

  it('refuses plain http, which the browser would block as mixed content anyway', () => {
    const result = sanitiseUrl('http://example.com/notes.pdf');
    expect(result).toMatchObject({ reason: expect.stringContaining('secure') });
  });

  it('refuses an empty or malformed address', () => {
    expect(sanitiseUrl('')).toHaveProperty('reason');
    expect(sanitiseUrl('not a url')).toHaveProperty('reason');
    expect(sanitiseUrl('example.com/no-scheme')).toHaveProperty('reason');
  });

  it('accepts https', () => {
    const result = sanitiseUrl('https://example.com/a.pdf');
    expect(result).toHaveProperty('url');
  });
});

describe('resolveContent — refusal surfaces as a kind, never a throw', () => {
  it('returns unsafe with a reason and no URL to click', () => {
    const resolved = resolveContent('javascript:alert(1)');

    expect(resolved.kind).toBe('unsafe');
    expect(resolved.embedUrl).toBe('');
    // Nothing to open in a new tab either — that would just move the attack.
    expect(resolved.externalUrl).toBe('');
    expect(resolved.reason).toBeTruthy();
  });
});

describe('YouTube', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?t=42', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('extracts the id from %s', (url, id) => {
    const resolved = resolveContent(url);

    expect(resolved.kind).toBe('youtube');
    expect(resolved.embedUrl).toContain(`/embed/${id}`);
  });

  it('uses the no-cookie host and suppresses unrelated end-screen suggestions', () => {
    const resolved = resolveContent('https://youtu.be/abc123');

    // Without rel=0 a lesson finishes by advertising other channels inside the
    // course.
    expect(resolved.embedUrl).toContain('youtube-nocookie.com');
    expect(resolved.embedUrl).toContain('rel=0');
  });

  it('keeps the original for the new-tab fallback', () => {
    const resolved = resolveContent('https://youtu.be/abc123');
    expect(resolved.externalUrl).toBe('https://youtu.be/abc123');
  });

  it('does not treat a lookalike host as YouTube', () => {
    // youtube.com.evil.test must not be embedded as a video.
    const resolved = resolveContent('https://youtube.com.evil.test/watch?v=abc');
    expect(resolved.kind).not.toBe('youtube');
  });
});

describe('Vimeo', () => {
  it.each([
    ['https://vimeo.com/123456789'],
    ['https://www.vimeo.com/123456789'],
    ['https://player.vimeo.com/video/123456789'],
  ])('builds a player URL for %s', (url) => {
    const resolved = resolveContent(url);

    expect(resolved.kind).toBe('vimeo');
    expect(resolved.embedUrl).toBe('https://player.vimeo.com/video/123456789');
  });
});

describe('direct files', () => {
  it.each([['.mp4'], ['.webm'], ['.mov']])('treats %s as a playable video', (ext) => {
    expect(resolveContent(`https://cdn.test/lecture${ext}`).kind).toBe('video');
  });

  it('treats .pdf as a document', () => {
    expect(resolveContent('https://cdn.test/notes.pdf').kind).toBe('pdf');
  });

  it.each([['.png'], ['.jpg'], ['.webp']])('treats %s as an image', (ext) => {
    expect(resolveContent(`https://cdn.test/diagram${ext}`).kind).toBe('image');
  });

  it('matches the PATH, not the query string', () => {
    // A signed download link routinely carries ?filename=notes.pdf; matching
    // the whole href would render an HTML page inside a PDF viewer.
    const resolved = resolveContent('https://cdn.test/download?filename=notes.pdf');
    expect(resolved.kind).toBe('page');
  });

  it('is case-insensitive about extensions', () => {
    expect(resolveContent('https://cdn.test/NOTES.PDF').kind).toBe('pdf');
  });
});

describe('the declared type is a hint, not the answer', () => {
  it('trusts the URL over the label', () => {
    // A REFERENCE item holding a YouTube link is a video, whatever it is filed
    // under. Trusting the label alone puts a PDF in a <video> element.
    const resolved = resolveContent('https://youtu.be/abc123', 'REFERENCE');
    expect(resolved.kind).toBe('youtube');
  });

  it('falls back to the label when the URL says nothing', () => {
    // Cloudinary serves PDFs under /image/upload/ with no extension, so the
    // declared type is the only signal left.
    const resolved = resolveContent(
      'https://res.cloudinary.com/demo/image/upload/v1/lms/content/notes-ab12',
      'PDF'
    );
    expect(resolved.kind).toBe('pdf');
  });

  it('treats an extensionless RECORDING as video', () => {
    expect(resolveContent('https://cdn.test/stream/abc', 'RECORDING').kind).toBe('video');
  });

  it('defaults to an embedded page when nothing identifies it', () => {
    expect(resolveContent('https://example.com/blog/post', 'LINK').kind).toBe('page');
  });
});

describe('opensInBrowser', () => {
  it.each([['DOCX'], ['PPT']])('reports %s as not renderable', (type) => {
    // No browser displays Office documents, and handing the URL to a
    // third-party converter would send it off-platform.
    expect(opensInBrowser(type)).toBe(false);
  });

  it.each([['PDF'], ['VIDEO'], ['LINK'], ['REFERENCE'], [undefined]])(
    'reports %s as renderable',
    (type) => {
      expect(opensInBrowser(type)).toBe(true);
    }
  );
});

describe('viewerPath', () => {
  it('encodes the URL so query strings survive the round trip', () => {
    const path = viewerPath({ url: 'https://youtu.be/a?t=1&x=2', type: 'VIDEO' });
    const search = new URLSearchParams(path.split('?')[1]);

    // A bare interpolation would truncate at the first & and open the wrong
    // thing — or nothing.
    expect(search.get('url')).toBe('https://youtu.be/a?t=1&x=2');
    expect(search.get('type')).toBe('VIDEO');
  });

  it('carries module context so Back returns where the student came from', () => {
    const path = viewerPath({ url: 'https://x.test/a.pdf', moduleId: 'm1', contentId: 'c1' });
    const search = new URLSearchParams(path.split('?')[1]);

    expect(search.get('moduleId')).toBe('m1');
    expect(search.get('contentId')).toBe('c1');
  });

  it('omits absent optional parameters rather than sending empty ones', () => {
    const path = viewerPath({ url: 'https://x.test/a.pdf' });
    expect(path).not.toContain('moduleId');
    expect(path).not.toContain('title=');
  });

  it('points at the viewer route', () => {
    expect(viewerPath({ url: 'https://x.test/a' }).startsWith('/learn/content?')).toBe(true);
  });
});

describe('the viewer never frames the app itself', () => {
  const origin = 'https://portal.test';

  it('refuses a URL on this origin', () => {
    // sandbox="allow-scripts allow-same-origin" is safe only because the frame
    // is CROSS-origin. Point it at ourselves and the sandbox grants nothing.
    vi.stubGlobal('window', { location: { origin } });

    expect(sanitiseUrl(`${origin}/admin/students`)).toMatchObject({
      reason: expect.stringContaining('part of this application'),
    });

    vi.unstubAllGlobals();
  });

  it('still accepts a different https origin', () => {
    vi.stubGlobal('window', { location: { origin } });

    expect(sanitiseUrl('https://cdn.test/notes.pdf')).toHaveProperty('url');

    vi.unstubAllGlobals();
  });
});

// --- Hardening pass ----------------------------------------------------------

describe('domain denylist — settled before any frame is created', () => {
  it.each([
    ['https://drive.google.com/file/d/abc/view'],
    ['https://docs.google.com/document/d/abc/edit'],
    ['https://www.notion.so/some-page'],
    ['https://medium.com/@author/post-123'],
    ['https://stackoverflow.com/questions/1'],
    ['https://www.linkedin.com/in/someone'],
  ])('marks %s as blocked, not unsafe', (url) => {
    const resolved = resolveContent(url);

    expect(resolved.kind).toBe('blocked');
    // The distinction that matters: this is good content the site refuses to
    // have framed, so the link must still be offered.
    expect(resolved.externalUrl).toBe(url);
    expect(resolved.reason).toBeTruthy();
  });

  it('blocks github.com — verified to send X-Frame-Options: deny', () => {
    // GITHUB_REPO is one of this LMS's own content types, so these links were
    // previously guaranteed to render an empty frame.
    expect(resolveContent('https://github.com/facebook/react', 'GITHUB_REPO').kind).toBe('blocked');
  });

  it('matches subdomains', () => {
    expect(isEmbeddingBlocked('gist.github.com')).toBe(true);
    expect(isEmbeddingBlocked('www.medium.com')).toBe(true);
    expect(isEmbeddingBlocked('sub.notion.site')).toBe(true);
  });

  it('does not match a lookalike that merely ends with the name', () => {
    // notmedium.com and medium.com.evil.test are different sites.
    expect(isEmbeddingBlocked('notmedium.com')).toBe(false);
    expect(isEmbeddingBlocked('medium.com.evil.test')).toBe(false);
  });

  it('blocks regardless of what the file looks like', () => {
    // A Drive link to an mp4 is still a Drive link; the file type does not
    // change whether the site permits framing.
    expect(resolveContent('https://drive.google.com/x/lecture.mp4').kind).toBe('blocked');
  });

  it('leaves embeddable sites alone', () => {
    expect(resolveContent('https://youtu.be/abc123').kind).toBe('youtube');
    expect(resolveContent('https://cdn.test/notes.pdf').kind).toBe('pdf');
    expect(resolveContent('https://example.com/article').kind).toBe('page');
  });
});

describe('punycode hostnames', () => {
  it('refuses to EMBED an internationalised domain', () => {
    // xn-- is the homograph mechanism (аpple.com with a Cyrillic а).
    const resolved = resolveContent('https://xn--pple-43d.com/page');
    expect(resolved.kind).toBe('blocked');
  });

  it('still offers the link, so the address bar can be checked', () => {
    // Refusing outright would make a legitimate internationalised site
    // unreachable; a real tab shows the student whose page they are on.
    const resolved = resolveContent('https://xn--pple-43d.com/page');
    expect(resolved.externalUrl).toContain('xn--pple-43d.com');
    expect(resolved.reason).toMatch(/internationalised/i);
  });

  it('leaves ordinary hostnames untouched', () => {
    expect(isSuspiciousHostname('example.com')).toBe(false);
    expect(isSuspiciousHostname('cdn.jsdelivr.net')).toBe(false);
  });
});

describe('fragments are stripped', () => {
  it('drops the hash, which no iframe or video element uses anyway', () => {
    const resolved = resolveContent('https://cdn.test/notes.pdf#page=4');
    expect(resolved.externalUrl).toBe('https://cdn.test/notes.pdf');
  });

  it('keeps the query string, which does carry meaning', () => {
    const resolved = resolveContent('https://example.com/a?ref=course#top');
    expect(resolved.externalUrl).toBe('https://example.com/a?ref=course');
  });
});

describe('unsafe still outranks blocked', () => {
  it('refuses a javascript: URL without offering it as a link', () => {
    const resolved = resolveContent('javascript:alert(1)');

    expect(resolved.kind).toBe('unsafe');
    expect(resolved.externalUrl).toBe('');
  });
});
