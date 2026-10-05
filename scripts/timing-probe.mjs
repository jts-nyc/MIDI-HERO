/**
 * Render-clock smoothness probe. Plays a bundled song with autoplay in headless Chrome and, on
 * every animation frame, records the song time the renderer drew at. A smooth highway advances
 * by exactly rate × the frame interval each frame; anything else is visible jitter (a note at
 * 600 px/s moves 0.6 px per ms of error).
 *
 *   node scripts/timing-probe.mjs [--seconds 5] [--throttle 4] [--song minuet-in-g]
 *
 * Reports, in ms: the spread (SD and p95 of |error|) of the per-frame step of the drawn time
 * against the step of the frame's own timestamp, and the residual of the drawn time against a
 * straight line through the whole sample. Uses the dev-only window.midihero handle.
 */
import { parseArgs } from 'node:util';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const { values } = parseArgs({ options: {
  seconds: { type: 'string', default: '5' }, throttle: { type: 'string', default: '1' }, song: { type: 'string', default: 'minuet-in-g' },
} });
const seconds = Number(values.seconds);
const throttle = Number(values.throttle);
const server = await createServer({ server: { host: '127.0.0.1', port: 5188, strictPort: false, watch: null }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  const context = await browser.newContext({ viewport: { width: 1024, height: 600 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => localStorage.setItem('midihero.settings.v1', JSON.stringify({ firstRunDone: true, highway: 'perspective' })));
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await page.goto(`${server.resolvedUrls.local[0]}?song=${values.song}&autoplay=1&effects=1`);
  await page.waitForFunction(() => window.midihero?.session?.status === 'playing', null, { timeout: 30000 });
  await page.waitForFunction(() => window.midihero.session.now() > 1, null, { timeout: 60000 });
  const r = await page.evaluate((seconds) => new Promise((resolve) => {
    const api = window.midihero;
    const ts = [];
    const drawn = [];
    const mapping = [];
    const ctx = api.session.opts.clock.ctx;
    const until = performance.now() + seconds * 1000;
    const tick = (t) => {
      // read after the app's own frame callback (registered earlier) has drawn
      ts.push(t);
      drawn.push(api.renderState.time);
      const o = ctx?.getOutputTimestamp?.();
      if (o && o.performanceTime > 0) mapping.push(o.contextTime * 1000 - o.performanceTime);
      if (performance.now() < until) requestAnimationFrame(tick);
      else resolve({ ts, drawn, mapping, rate: api.session.rate, audio: api.session.opts.clock.hasAudio });
    };
    requestAnimationFrame(tick);
  }), seconds);
  const { ts, drawn, rate } = r;
  const stepErr = [];
  for (let i = 1; i < ts.length; i++) {
    const dTs = ts[i] - ts[i - 1];
    const dSong = (drawn[i] - drawn[i - 1]) * 1000 / rate;
    if (dTs > 100) continue; // a hitch of the host, not jitter
    stepErr.push(dSong - dTs);
  }
  const n = ts.length;
  const mx = ts.reduce((a, b) => a + b, 0) / n;
  const my = drawn.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (ts[i] - mx) * (drawn[i] - my); sxx += (ts[i] - mx) ** 2; }
  const slope = sxy / sxx;
  const resid = ts.map((t, i) => (drawn[i] - (my + slope * (t - mx))) * 1000 / rate);
  const sd = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length - (a.reduce((s, v) => s + v, 0) / a.length) ** 2);
  const p95 = (a) => [...a].map(Math.abs).sort((x, y) => x - y)[Math.floor(a.length * 0.95)];
  const intervals = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
  const mapping = r.mapping;
  console.log(JSON.stringify({
    // audio-to-performance clock mapping as the browser reports it: its spread is jitter the game inherits
    outputTimestampMs: mapping.length ? { sd: +sd(mapping).toFixed(3), p95: +p95(mapping.map((v) => v - mapping.reduce((a, b) => a + b, 0) / mapping.length)).toFixed(3) } : null,
    browser: browser.version(), throttle, frames: n, audioClock: r.audio,
    frameIntervalMs: { median: +intervals[intervals.length >> 1].toFixed(2), p95: +intervals[Math.floor(intervals.length * 0.95)].toFixed(2) },
    stepErrorMs: { sd: +sd(stepErr).toFixed(3), p95: +p95(stepErr).toFixed(3) },
    lineResidualMs: { sd: +sd(resid).toFixed(3), p95: +p95(resid).toFixed(3) },
    songSecondsPerSecond: +(slope * 1000).toFixed(5),
  }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
