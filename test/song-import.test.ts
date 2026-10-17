import { describe, expect, it } from 'vitest';
import { DOWNLOAD_INSTEAD, fetchSongLink, looksLikeMidi, nameFromUrl, planLink } from '../src/midi/songImport.ts';
import { parseSong } from '../src/midi/parse.ts';
import { end, off, on, smf } from './helpers/smf.ts';

const midi = smf([[on(0, 60), off(480, 60), end(480)]]);

/** A fetch that answers every request with `body` and records what it was asked. */
function fakeFetch(body: BodyInit | null, init: ResponseInit = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, req?: RequestInit) => {
    calls.push({ url: String(url), init: req });
    return new Response(body, init);
  }) as typeof fetch;
  return { impl, calls };
}

describe('planLink', () => {
  it('fetches a direct .mid link as it is, named after the file', () => {
    expect(planLink(' https://example.org/songs/Ode_to_Joy.mid ')).toEqual({ ok: true, url: 'https://example.org/songs/Ode_to_Joy.mid', name: 'Ode to Joy' });
  });

  it('turns a GitHub file page into its raw file', () => {
    const p = planLink('https://github.com/someone/midis/blob/main/folk/Scarborough%20Fair.mid');
    expect(p).toEqual({ ok: true, url: 'https://raw.githubusercontent.com/someone/midis/main/folk/Scarborough%20Fair.mid', name: 'Scarborough Fair' });
  });

  it('tries https from an https page, which cannot fetch http', () => {
    const p = planLink('http://example.org/a.mid');
    expect(p.ok && p.url).toBe('https://example.org/a.mid');
    const local = planLink('http://localhost:5181/a.mid', 'http:');
    expect(local.ok && local.url).toBe('http://localhost:5181/a.mid');
  });

  it('accepts a link pasted without its scheme', () => {
    const p = planLink('example.org/a.midi');
    expect(p.ok && p.url).toBe('https://example.org/a.midi');
  });

  it('says how to get the file from Online Sequencer instead of fetching its editor page', () => {
    const p = planLink('https://onlinesequencer.net/1234567');
    expect(p.ok).toBe(false);
    expect(!p.ok && p.message).toMatch(/Export MIDI/);
  });

  it('says MuseScore needs a sign-in', () => {
    const p = planLink('https://musescore.com/user/1/scores/2');
    expect(!p.ok && p.message).toMatch(/sign-in/);
  });

  it('refuses empty input, non-links and non-web schemes', () => {
    expect(planLink('').ok).toBe(false);
    expect(planLink('not a link at all').ok).toBe(false);
    expect(planLink('twinkle').ok).toBe(false);
    expect(planLink('javascript:alert(1)').ok).toBe(false);
    expect(planLink('file:///C:/song.mid').ok).toBe(false);
  });
});

describe('nameFromUrl', () => {
  it('falls back when the path has no file name', () => {
    expect(nameFromUrl('https://example.org/')).toBe('Song from a link');
  });
});

describe('looksLikeMidi', () => {
  it('knows a MIDI file from a web page', () => {
    expect(looksLikeMidi(midi)).toBe(true);
    expect(looksLikeMidi(new TextEncoder().encode('<!doctype html><html>'))).toBe(false);
    expect(looksLikeMidi(new Uint8Array())).toBe(false);
  });
});

describe('fetchSongLink', () => {
  it('brings in the bytes of a .mid file, without cookies, and they parse', async () => {
    const f = fakeFetch(midi.slice(), { status: 200 });
    const got = await fetchSongLink('https://example.org/twinkle.mid', f.impl);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.name).toBe('twinkle');
    expect(got.bytes).toEqual(midi);
    expect(parseSong(got.bytes).notes.length).toBe(1);
    expect(f.calls[0]!.init).toMatchObject({ mode: 'cors', credentials: 'omit' });
  });

  it('fetches nothing for a link it already knows will not work', async () => {
    const f = fakeFetch(midi.slice());
    const got = await fetchSongLink('https://onlinesequencer.net/1234567', f.impl);
    expect(got.ok).toBe(false);
    expect(f.calls).toHaveLength(0);
  });

  it('a host that refuses cross-site fetches gets the one-line download-it-instead message', async () => {
    const refusing = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    expect(await fetchSongLink('https://example.org/a.mid', refusing)).toEqual({ ok: false, message: DOWNLOAD_INSTEAD });
    expect(DOWNLOAD_INSTEAD).not.toMatch(/\n/);
  });

  it('a web page instead of a file is turned away', async () => {
    const got = await fetchSongLink('https://example.org/song', fakeFetch('<html>hi</html>', { status: 200 }).impl);
    expect(!got.ok && got.message).toMatch(/web page/);
  });

  it('a missing file and a server error each say what happened', async () => {
    const missing = await fetchSongLink('https://example.org/a.mid', fakeFetch('', { status: 404 }).impl);
    expect(!missing.ok && missing.message).toMatch(/Nothing found/);
    const err = await fetchSongLink('https://example.org/a.mid', fakeFetch('', { status: 503 }).impl);
    expect(!err.ok && err.message).toMatch(/503/);
  });

  it('stops reading a file bigger than the cap', async () => {
    const big = new Uint8Array(5000);
    big.set(midi);
    const got = await fetchSongLink('https://example.org/a.mid', fakeFetch(big, { status: 200 }).impl, 1000);
    expect(!got.ok && got.message).toMatch(/too big/);
  });

  it('refuses up front when the declared size is over the cap', async () => {
    const got = await fetchSongLink('https://example.org/a.mid', fakeFetch(midi.slice(), { status: 200, headers: { 'content-length': '999999' } }).impl, 1000);
    expect(!got.ok && got.message).toMatch(/too big/);
  });
});
