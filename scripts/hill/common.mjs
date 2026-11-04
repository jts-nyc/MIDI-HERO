/**
 * Shared pieces of the hill harnesses: the dev server, the browser, the fake MIDI device,
 * and the probe that decides whether a song is playable.
 *
 * "Playable" means: a song session is playing (not paused, not behind the "press your lowest C"
 * gate, not autoplay), and a key pressed on the fake keyboard reaches that session. A song that
 * plays while the game listens to Midi Through does not count; that was the 17 Oct failure.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { installFakeMidi, CLASSROOM_PORTS, KEYBOARD_PORT } from './fake-midi.js';

export { CLASSROOM_PORTS, KEYBOARD_PORT };

export const PAGES = { full: '/', simple: '/simple/' };

export async function startServer() {
  const server = await createServer({
    server: { host: '127.0.0.1', port: 5189, strictPort: false, watch: null },
    logLevel: 'error',
  });
  await server.listen();
  return { server, origin: server.resolvedUrls.local[0].replace(/\/$/, '') };
}

export async function launchBrowser() {
  // No autoplay flag: like a student's Chrome, sound needs a click first.
  return chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: process.env.HEADED !== '1',
    args: ['--mute-audio'],
  });
}

/**
 * A fresh context is a first load: empty localStorage and IndexedDB.
 * `settings` seeds midihero.settings.v1 for the cases that hold one variable fixed.
 */
export async function newContext(browser, origin, { ports = CLASSROOM_PORTS, settings = null, simpleSettings = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 650 }, deviceScaleFactor: 1 });
  await context.addInitScript(installFakeMidi, { ports });
  if (settings) {
    await context.addInitScript((s) => localStorage.setItem('midihero.settings.v1', JSON.stringify(s)), settings);
  }
  if (simpleSettings) {
    await context.addInitScript(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), simpleSettings);
  }
  // Stay on the game: no other origins, no popups. The gitignored local-songs/ folder is
  // hidden, so every machine sees the same bundled song list and no private file names leak.
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (!url.startsWith(origin)) return route.abort();
    if (url.startsWith(`${origin}/local-songs/`)) {
      return url.includes('index.json') ? route.fulfill({ json: [] }) : route.fulfill({ status: 404, body: '' });
    }
    return route.continue();
  });
  context.on('page', async (p) => { if (await p.opener()) await p.close().catch(() => {}); });
  return context;
}

/** Is the song playable from the fake keyboard right now? Sends one note only when a live session is up. */
export async function probePlayable(page, keyboardPort = KEYBOARD_PORT) {
  return page.evaluate((port) => {
    const s = window.midihero?.session;
    const screen = (document.querySelector('h1, h2')?.textContent ?? '').trim().slice(0, 50);
    if (!s) return { playable: false, why: `no session (screen: ${screen || 'none'})` };
    if (s.status !== 'playing') return { playable: false, why: `session ${s.status}` };
    if (s.opts?.autoplay) return { playable: false, why: 'autoplay' };
    let reached = false;
    const original = s.handleInput;
    s.handleInput = function (ev) {
      if (ev.source === 'midi') reached = true;
      return original.call(this, ev);
    };
    try {
      // C#: never completes a "press a C" gate, and a single wrong key costs nothing.
      window.__fakeMidi.send(port, [0x90, 61, 90]);
      window.__fakeMidi.send(port, [0x80, 61, 0]);
    } finally {
      s.handleInput = original;
    }
    return { playable: reached, song: document.title, why: reached ? 'ok' : `keyboard not heard (listening: ${window.__fakeMidi.listening().join(',') || 'none'})` };
  }, keyboardPort);
}

/** Deterministic PRNG so a run can be replayed by its seed. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
