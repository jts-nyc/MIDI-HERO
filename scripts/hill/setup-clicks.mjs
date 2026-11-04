/**
 * Hill: setup survives "just kinda clicking stuff" (17 Oct 2026 classroom finding).
 *
 *   npm run hill:setup -- [--runs 50] [--seconds 20] [--page full|simple] [--keys 0] [--workers 4] [--seed 1]
 *
 * Each run is a first load (fresh profile) with the classroom's fake MIDI ports attached:
 * Midi Through plus three Oxygen 25 entries, keys on the first Oxygen port. A seeded clicker
 * clicks at random: mostly on visible controls, sometimes anywhere on the page; on a <select>
 * it picks a random option. With the default --keys 0 nothing presses a MIDI key except the
 * probe, which sends one note once a live session is up (see common.mjs for what "playable"
 * means). --keys P makes each action, with probability P, a random key on the fake keyboard
 * instead of a click: a student who clicks stuff and also hits keys.
 *
 * The score is the share of runs that reach a playable song within --seconds of page load.
 * JSON goes to stdout; one line per run goes to stderr. Run N uses seed (--seed + N), so a
 * failing run can be replayed with --runs 1 --seed <its seed> HEADED=1.
 */
import { parseArgs } from 'node:util';
import { platform } from 'node:os';
import { startServer, launchBrowser, newContext, probePlayable, rng, sleep, PAGES, KEYBOARD_PORT } from './common.mjs';

const { values } = parseArgs({ options: {
  runs: { type: 'string', default: '50' },
  seconds: { type: 'string', default: '20' },
  page: { type: 'string', default: 'full' },
  workers: { type: 'string', default: '4' },
  seed: { type: 'string', default: '1' },
  keys: { type: 'string', default: '0' },
} });
const keysP = Number(values.keys);
if (!(keysP >= 0 && keysP <= 1)) throw new Error('--keys must be 0..1');
const runs = Number(values.runs);
const budgetMs = Number(values.seconds) * 1000;
const workers = Math.max(1, Number(values.workers));
const firstSeed = Number(values.seed);
const path = PAGES[values.page];
if (!path) throw new Error(`--page must be one of ${Object.keys(PAGES).join(', ')}`);

/** One random key on a 25-key keyboard at its default octave (C3 to C5). */
async function randomKey(page, next) {
  const pitch = 48 + Math.floor(next() * 25);
  await page.evaluate(([port, pitch]) => {
    window.__fakeMidi.send(port, [0x90, pitch, 80]);
    setTimeout(() => window.__fakeMidi.send(port, [0x80, pitch, 0]), 90);
  }, [KEYBOARD_PORT, pitch]).catch(() => {});
  return `key ${pitch}`;
}

/** One random click. Returns a short description for the trace. */
async function randomClick(page, next) {
  const targets = await page.evaluate(() => {
    const sel = 'button, a[href], input, select, label, summary, [role=button], [role=radio], [role=option], [role=tab], canvas';
    return [...document.querySelectorAll(sel)].map((el, i) => {
      el.dataset.hillIdx = String(i);
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      const visible = r.width > 2 && r.height > 2 && st.visibility !== 'hidden' && st.display !== 'none' && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
      return { i, tag: el.tagName, type: el.getAttribute('type'), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30),
        x: r.left + r.width / 2, y: r.top + r.height / 2, visible, disabled: !!el.disabled, options: el.tagName === 'SELECT' ? el.options.length : 0 };
    }).filter((t) => t.visible && !t.disabled && t.type !== 'file');
  }).catch(() => []);
  const vw = page.viewportSize();
  if (!targets.length || next() < 0.2) {
    const x = Math.floor(next() * vw.width), y = Math.floor(next() * vw.height);
    await page.mouse.click(x, y).catch(() => {});
    return `point ${x},${y}`;
  }
  const t = targets[Math.floor(next() * targets.length)];
  if (t.tag === 'SELECT' && t.options > 0) {
    const index = Math.floor(next() * t.options);
    await page.locator(`[data-hill-idx="${t.i}"]`).selectOption({ index }, { timeout: 1000 }).catch(() => {});
    return `select ${t.text || '?'} #${index}`;
  }
  await page.mouse.click(t.x, t.y).catch(() => {});
  return `${t.tag.toLowerCase()} "${t.text}"`;
}

async function oneRun(browser, origin, seed) {
  const next = rng(seed);
  const context = await newContext(browser, origin);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('filechooser', () => {}); // an import button opens a chooser; nobody picks a file
  const trace = [];
  const t0 = Date.now();
  let last = { playable: false, why: 'not loaded' };
  try {
    await page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded', timeout: budgetMs });
    while (Date.now() - t0 < budgetMs) {
      last = await probePlayable(page).catch((e) => ({ playable: false, why: e.message.split('\n')[0] }));
      if (last.playable) break;
      trace.push(keysP > 0 && next() < keysP ? await randomKey(page, next) : await randomClick(page, next));
      await sleep(120 + Math.floor(next() * 280));
    }
  } finally {
    await context.close();
  }
  const ms = Date.now() - t0;
  const ok = last.playable && ms <= budgetMs;
  return { seed, ok, ms, actions: trace.length, why: last.why, song: last.song ?? null, errors: errors.slice(0, 3), lastClicks: trace.slice(-5) };
}

const { server, origin } = await startServer();
let browser;
try {
  browser = await launchBrowser();
  const seeds = Array.from({ length: runs }, (_, i) => firstSeed + i);
  const results = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(workers, runs) }, async () => {
    while (cursor < seeds.length) {
      const seed = seeds[cursor++];
      const r = await oneRun(browser, origin, seed);
      results.push(r);
      console.error(`seed ${r.seed}: ${r.ok ? 'PLAYABLE' : 'no'} ${(r.ms / 1000).toFixed(1)}s, ${r.actions} actions — ${r.why}`);
    }
  }));
  results.sort((a, b) => a.seed - b.seed);
  const passed = results.filter((r) => r.ok);
  const reasons = {};
  for (const r of results.filter((x) => !x.ok)) reasons[r.why] = (reasons[r.why] ?? 0) + 1;
  const median = (xs) => (xs.length ? xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
  console.log(JSON.stringify({
    hill: 'setup-survives-clicking', page: values.page, keys: keysP, runs, seconds: budgetMs / 1000, workers, firstSeed,
    score: +(passed.length / runs).toFixed(3), playable: passed.length,
    medianSecondsToPlayable: passed.length ? +(median(passed.map((r) => r.ms)) / 1000).toFixed(1) : null,
    failureReasons: reasons, browser: browser.version(), platform: platform(), results,
  }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
