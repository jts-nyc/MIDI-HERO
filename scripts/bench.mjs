/**
 * Reproducible update+draw benchmark using the app's dev-only window.midihero.bench.
 * npm run bench -- [--file /path/darude-sandstorm.mid --part 5:4] [--seconds 5] [--practice]
 * Without a fixture, selects the densest melodic part among the bundled songs.
 * CHROME_PATH overrides the installed Chrome executable. JSON goes to stdout;
 * progress goes to stderr. CPU throttling is a proxy, not a real Chromebook test.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cpus, platform } from 'node:os';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { parseSong } from '../src/midi/parse.ts';
import { buildParts } from '../src/midi/parts.ts';

const { values } = parseArgs({ options: {
  practice: { type: 'boolean', default: false },
  file: { type: 'string' }, part: { type: 'string' }, seconds: { type: 'string', default: '5' },
} });
const seconds = Number(values.seconds);
if (!Number.isFinite(seconds) || seconds < 1 || seconds > 15) throw new Error('--seconds must be 1..15');
const manifest = JSON.parse(readFileSync(new URL('../public/songs/manifest.json', import.meta.url)));
const candidates = values.file ? [{ id: 'fixture', file: resolve(values.file) }] :
  manifest.map(s => ({ id: s.id, file: new URL(`../public/songs/${s.file}`, import.meta.url) }));
let selected;
for (const candidate of candidates) {
  const bytes = readFileSync(candidate.file);
  const parts = buildParts(parseSong(bytes));
  for (const part of parts) {
    if (values.part ? part.key !== values.part : part.kind !== 'melodic') continue;
    if (!selected || part.notesPerSec > selected.part.notesPerSec) selected = { ...candidate, bytes, part };
  }
}
if (!selected) throw new Error('No matching melodic part');
const server = await createServer({ server: { host: '127.0.0.1', port: 5187, strictPort: false, watch: null }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  const results = [];
  for (const throttle of [1, 4, 6]) {
    for (const highway of ['flat', 'perspective']) {
      const context = await browser.newContext({ viewport: { width: 1024, height: 600 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
      try {
        await context.addInitScript(highway => {
          localStorage.setItem('midihero.settings.v1', JSON.stringify({ firstRunDone: true, highway }));
        }, highway);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        if (values.file) await page.route('**/bench-fixture.mid', route => route.fulfill({ body: selected.bytes, contentType: 'audio/midi' }));
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
        const query = new URLSearchParams({ autoplay: '1', kb: '25', difficulty: 'expert', effects: '1', part: selected.part.key });
        query.set(values.file ? 'file' : 'song', values.file ? 'bench-fixture.mid' : selected.id);
        await page.goto(`${server.resolvedUrls.local[0]}?${query}`);
        await page.waitForFunction(() => window.midihero?.session?.status === 'playing', null, { timeout: 30000 });
        // Natural playback: exclude count-in and warm the renderer, audio and JIT.
        // Every fresh session samples the same part starting one second after its first note.
        await page.waitForFunction(() => {
          const s = window.midihero.session;
          return s.now() >= s.chart.firstNoteTime + 1;
        }, null, { timeout: 120000 });
        console.error(`${highway} ${throttle}x: ${selected.id}, part ${selected.part.key}`);
        const result = await Promise.race([page.evaluate(async ({ seconds, practice }) => {
          const api = window.midihero;
          const start = api.session.now();
          const notes = api.session.chart.notes.length;
          if (practice) {
            // Synthetic render contract only; no practice/session gameplay is substituted.
            api.renderState.practice = {
              sections: [{ start, end: start + seconds, label: 'Benchmark section' }], current: 0,
              loop: { start: start + 0.5, end: start + seconds }, passes: 2, waiting: true,
              waitingFor: [api.renderState.low, api.renderState.low + 1, api.renderState.low + 4],
            };
          }
          const metrics = await api.bench(seconds);
          return { ...metrics, notes, start, end: api.session.now(), status: api.session.status };
        }, { seconds, practice: values.practice }), new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error('Benchmark timed out')), (seconds + 30) * 1000);
          timer.unref();
        })]);
        if (errors.length || result.frames < 100 || result.status !== 'playing' || result.end - result.start < seconds * 0.8) {
          throw new Error(`Invalid measurement: ${JSON.stringify({ result, errors })}`);
        }
        results.push({ highway, throttle, ...result });
        console.error(JSON.stringify(results.at(-1)));
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      } finally { await context.close(); }
    }
  }
  console.log(JSON.stringify({ browser: browser.version(), platform: platform(), cpu: cpus()[0]?.model,
    viewport: '1024x600', dpr: 1, seconds, syntheticPractice: values.practice, song: selected.id, part: selected.part.key,
    sourceNotes: selected.part.noteCount, sourceNotesPerSecond: selected.part.notesPerSec, results,
  }, null, 2));
  if (results.some(r => r.highway === 'perspective' && r.throttle === 4 && r.p95Ms > 2)) process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
