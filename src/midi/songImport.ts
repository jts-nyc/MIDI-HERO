/**
 * Songs from outside the app: a pasted link, fetched straight from the browser. There is no
 * server, so a link only works when its host allows other sites to fetch its files (CORS);
 * otherwise the student is told to download the file and drop it in. Nothing is uploaded.
 * See docs/research/song-import.md for which hosts work.
 */

/** Largest file a link may bring in. Song MIDI files are tens of KB; this only stops runaway downloads. */
export const MAX_LINK_BYTES = 2 * 1024 * 1024;

/** The one line shown when a host won't let the page fetch its file. */
export const DOWNLOAD_INSTEAD = "This site won't let other pages fetch its files. Download the .mid file, then drop it on the song list.";

export type LinkPlan =
  | { ok: true; url: string; name: string }
  | { ok: false; message: string };

export type LinkResult =
  | { ok: true; bytes: Uint8Array; name: string }
  | { ok: false; message: string };

/** Hosts whose share links are pages, not files: say how to get the file instead of trying. */
const PAGE_HOSTS: { test: RegExp; message: string }[] = [
  {
    test: /(^|\.)onlinesequencer\.net$/,
    message: 'Online Sequencer links open the editor, not a file. Open the song, choose Export MIDI, then drop the file on the song list.',
  },
  {
    test: /(^|\.)musescore\.com$/,
    message: 'MuseScore downloads need a MuseScore sign-in. Download the MIDI there, then drop the file on the song list.',
  },
];

/** The song name a URL suggests: its file name without the extension. */
export function nameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    const name = decodeURIComponent(last).replace(/\.(mid|midi|kar)$/i, '').replace(/[_-]+/g, ' ').trim();
    return name || 'Song from a link';
  } catch {
    return 'Song from a link';
  }
}

/**
 * What to fetch for a pasted link. GitHub file pages become their raw file (raw.githubusercontent.com
 * allows any site to fetch); hosts known to share pages rather than files get their own message.
 */
export function planLink(input: string, pageProtocol = 'https:'): LinkPlan {
  const text = input.trim();
  if (!text) return { ok: false, message: 'Paste a link to a .mid file.' };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, message: "That doesn't look like a link." };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, message: 'Paste a web link (https://…).' };
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') && host !== 'localhost') return { ok: false, message: "That doesn't look like a link." };
  const page = PAGE_HOSTS.find((p) => p.test.test(host));
  if (page) return { ok: false, message: page.message };
  // github.com/<owner>/<repo>/blob/<ref>/<path> → raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
  if (host === 'github.com' || host === 'www.github.com') {
    const m = /^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/.exec(url.pathname);
    if (m) {
      const raw = `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
      return { ok: true, url: raw, name: nameFromUrl(raw) };
    }
  }
  // An https page fetching http is blocked as mixed content, so try the https link.
  if (url.protocol === 'http:' && pageProtocol === 'https:') url.protocol = 'https:';
  url.hash = '';
  return { ok: true, url: url.href, name: nameFromUrl(url.href) };
}

/** True when the bytes start like a Standard MIDI File. */
export function looksLikeMidi(bytes: Uint8Array): boolean {
  return bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64; // MThd
}

/** Read a response body, stopping once it passes the size cap. */
async function readCapped(res: Response, cap: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get('content-length'));
  if (declared > cap) return null;
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length > cap ? null : buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * Fetch a pasted link as MIDI bytes, from the browser, without cookies. A network error here is
 * almost always the host refusing cross-site fetches (CORS), which the page cannot tell apart
 * from being offline, so both get the download-it-instead line.
 */
export async function fetchSongLink(input: string, fetchImpl: typeof fetch = fetch, cap = MAX_LINK_BYTES, pageProtocol = globalThis.location?.protocol ?? 'https:'): Promise<LinkResult> {
  const plan = planLink(input, pageProtocol);
  if (!plan.ok) return plan;
  let res: Response;
  try {
    res = await fetchImpl(plan.url, { mode: 'cors', credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer' });
  } catch {
    return { ok: false, message: DOWNLOAD_INSTEAD };
  }
  if (res.status === 404) return { ok: false, message: 'Nothing found at that link. Check it, or download the file and drop it on the song list.' };
  if (!res.ok) return { ok: false, message: `That site answered ${res.status}. Download the .mid file, then drop it on the song list.` };
  let bytes: Uint8Array | null;
  try {
    bytes = await readCapped(res, cap);
  } catch {
    return { ok: false, message: DOWNLOAD_INSTEAD };
  }
  if (!bytes) return { ok: false, message: 'That file is too big to be a song.' };
  if (!looksLikeMidi(bytes)) {
    return { ok: false, message: "That link is a web page, not a .mid file. Download the file from it, then drop it on the song list." };
  }
  return { ok: true, bytes, name: plan.name };
}
