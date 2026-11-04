/**
 * Hill: the 17 Oct 2026 classroom findings as scripted cases. The score is how many pass.
 *
 *   npm run hill:cases -- [--only through-default,hot-plug,octave-recovery,skipped-setup]
 *
 * Each case is a first load (fresh profile) with the fake MIDI device from fake-midi.js.
 * Each one holds everything but its finding fixed, as far as the game allows:
 *
 *   through-default  The classroom's four ports (Midi Through first). On both the full game and
 *                    the simple site, Midi Through is left closed and the Oxygen keys are heard;
 *                    on the full game, a C on the Oxygen moves setup on.
 *   hot-plug         Only Midi Through at load; the Oxygen is plugged in two seconds later. Setup
 *                    must notice it and take its C. The fake fires statechange as the spec says;
 *                    a Chrome that never fires it (his reading of 17 Oct) is outside what this
 *                    can show.
 *   octave-recovery  Setup already done; a song with the gate passed. The student plays six notes
 *                    right, presses the keyboard's octave-down button (every key now sends 12
 *                    lower) and keeps playing the same keys. Passes if four hits in a row land
 *                    within the next 16 notes.
 *   skipped-setup    A student who clicks past every screen ("I don't have a keyboard", skip, play)
 *                    then plays the song on the MIDI keyboard. Passes if four hits in a row land
 *                    within the first 16 notes.
 *
 * JSON goes to stdout, one line per case to stderr. A failing case is a finding, not a broken
 * build: the exit code is 0 unless the harness itself fails.
 */
import { parseArgs } from 'node:util';
import { startServer, launchBrowser, newContext, sleep, CLASSROOM_PORTS, KEYBOARD_PORT } from './common.mjs';

const { values } = parseArgs({ options: { only: { type: 'string' } } });

const PRESS_C = /Press the C at the far left/;

async function heading(page) {
  return page.evaluate(() => (document.querySelector('h1')?.textContent ?? '').trim()).catch(() => '');
}

async function waitHeading(page, re, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (re.test(await heading(page))) return true;
    await sleep(100);
  }
  return false;
}

async function midiKey(page, pitch, port = KEYBOARD_PORT) {
  await page.evaluate(([port, pitch]) => {
    window.__fakeMidi.send(port, [0x90, pitch, 90]);
    setTimeout(() => window.__fakeMidi.send(port, [0x80, pitch, 0]), 100);
  }, [port, pitch]);
}

/** The first visible, enabled button whose text matches one of `patterns`, in pattern order. */
async function clickFirst(page, patterns) {
  const buttons = await page.evaluate(() => [...document.querySelectorAll('button')].map((b, i) => {
    b.dataset.caseIdx = String(i);
    const r = b.getBoundingClientRect();
    return { i, text: b.textContent.trim(), ok: r.width > 0 && r.height > 0 && !b.disabled && !b.closest('[hidden]') };
  }).filter((b) => b.ok));
  for (const re of patterns) {
    const b = buttons.find((x) => re.test(x.text));
    if (b) {
      await page.locator(`[data-case-idx="${b.i}"]`).click({ timeout: 2000 }).catch(() => {});
      return b.text;
    }
  }
  return null;
}

async function livePlaying(page) {
  return page.evaluate(() => {
    const s = window.midihero?.session;
    return !!s && s.status === 'playing' && !s.opts?.autoplay;
  }).catch(() => false);
}

/**
 * Play `count` notes from the next one due, on the fake keyboard, as a student who reads the
 * highway: the key under each falling note, on a 25-key keyboard whose lowest C sends 48.
 * From note `shiftAt` on, every key sends 12 lower (the octave-down button). Returns, per note,
 * whether the game counted it a hit.
 */
async function playAlong(page, { count, shiftAt = Infinity }) {
  return page.evaluate(({ port, count, shiftAt }) => new Promise((resolve) => {
    const api = window.midihero;
    const s = api.session;
    // Where the student's keys sit against the song: the game draws the song's window from
    // renderState.low, starting at the keyboard's lowest C.
    const trueOffset = s.opts.relative ? api.renderState.low - 48 : 0;
    const t0 = s.now();
    const notes = s.chart.notes.map((n, i) => ({ ...n, i })).filter((n) => n.time > t0 + 0.25).slice(0, count);
    const hits = [];
    let k = 0;
    const tick = () => {
      if (api.session !== s || s.status === 'finished') return resolve({ hits, trueOffset, ended: true });
      while (k < notes.length && s.now() >= notes[k].time - 0.004) {
        const n = notes[k];
        const pitch = n.pitch - trueOffset - (k >= shiftAt ? 12 : 0);
        window.__fakeMidi.send(port, [0x90, pitch, 90]);
        setTimeout(() => window.__fakeMidi.send(port, [0x80, pitch, 0]), Math.max(80, (n.duration ?? 0) * 900 / (s.rate || 1)));
        const idx = k;
        setTimeout(() => { hits[idx] = s.noteVisuals?.[n.i]?.state === 'hit'; }, 60);
        k++;
      }
      if (k >= notes.length) return setTimeout(() => resolve({ hits, trueOffset, ended: false }), 120);
      requestAnimationFrame(tick);
    };
    tick();
  }), { port: KEYBOARD_PORT, count, shiftAt });
}

function runOfHits(hits, from, need) {
  let run = 0;
  for (let i = from; i < hits.length; i++) {
    run = hits[i] ? run + 1 : 0;
    if (run >= need) return i;
  }
  return -1;
}

const SETTINGS_DONE = { firstRunDone: true, tutorialDone: true, kb: 25, synth: true, feedbackSound: 'chart' };

const CASES = {
  async 'through-default'(browser, origin) {
    const detail = {};
    for (const [name, path] of [['full', '/'], ['simple', '/simple/']]) {
      const context = await newContext(browser, origin, { ports: CLASSROOM_PORTS });
      try {
        const page = await context.newPage();
        await page.goto(origin + path);
        await sleep(2500);
        const listening = await page.evaluate(() => window.__fakeMidi.listening());
        const r = { listening, throughClosed: !listening.includes('through'), keyboardOpen: listening.includes(KEYBOARD_PORT) };
        if (name === 'full') {
          r.before = await heading(page);
          if (PRESS_C.test(r.before)) {
            await midiKey(page, 48);
            r.movedOn = await waitHeading(page, /How many keys/, 4000);
          } else r.movedOn = false;
        }
        detail[name] = r;
      } finally { await context.close(); }
    }
    const pass = detail.full.throughClosed && detail.full.keyboardOpen && detail.full.movedOn
      && detail.simple.throughClosed && detail.simple.keyboardOpen;
    return { pass, detail };
  },

  async 'hot-plug'(browser, origin) {
    const context = await newContext(browser, origin, { ports: [CLASSROOM_PORTS[0]] });
    try {
      const page = await context.newPage();
      await page.goto(origin + '/');
      await sleep(2000);
      const before = await heading(page);
      await page.evaluate((ports) => { for (const p of ports) window.__fakeMidi.plug(p.id, p.name); }, CLASSROOM_PORTS.slice(1));
      const noticed = await waitHeading(page, PRESS_C, 5000);
      let tookC = false;
      if (noticed) {
        await midiKey(page, 48);
        tookC = await waitHeading(page, /How many keys/, 4000);
      }
      return { pass: noticed && tookC, detail: { before, noticed, tookC, after: await heading(page) } };
    } finally { await context.close(); }
  },

  async 'octave-recovery'(browser, origin) {
    const context = await newContext(browser, origin, { ports: CLASSROOM_PORTS, settings: SETTINGS_DONE });
    try {
      const page = await context.newPage();
      await page.goto(origin + '/?song=twinkle&mode=score');
      const steps = [];
      const until = Date.now() + 20000;
      while (Date.now() < until && !(await livePlaying(page))) {
        if (PRESS_C.test(await heading(page))) { await midiKey(page, 48); steps.push('C3'); await sleep(1500); continue; }
        const clicked = await clickFirst(page, [/^Skip, just play/, /^Play\b/, /^Start\b/, /^Continue\b/]);
        if (clicked) steps.push(clicked);
        await sleep(400);
      }
      if (!(await livePlaying(page))) return { pass: false, detail: { steps, why: 'never reached a live song', screen: await heading(page) } };
      const offsetBefore = await page.evaluate(() => window.midihero.session.octaveOffset);
      const { hits, trueOffset, ended } = await playAlong(page, { count: 22, shiftAt: 6 });
      const offsetAfter = await page.evaluate(() => window.midihero.session?.octaveOffset);
      const warmedUp = hits.slice(0, 6).every(Boolean);
      const recoveredAt = runOfHits(hits, 6, 4);
      return {
        pass: warmedUp && recoveredAt >= 0 && recoveredAt < 6 + 16,
        detail: { steps, trueOffset, offsetBefore, offsetAfter, warmedUp, notesToRecover: recoveredAt >= 0 ? recoveredAt - 6 - 3 : null, hits: hits.map(Number).join(''), ended },
      };
    } finally { await context.close(); }
  },

  async 'skipped-setup'(browser, origin) {
    const context = await newContext(browser, origin, { ports: CLASSROOM_PORTS });
    try {
      const page = await context.newPage();
      await page.goto(origin + '/');
      const steps = [];
      const until = Date.now() + 25000;
      let key = 0;
      while (Date.now() < until && !(await livePlaying(page))) {
        const clicked = await clickFirst(page, [/I don't have a keyboard/, /^Skip/, /^Go to the song list/, /^Play\b/, /^Next/, /^Try it/, /^Continue/, /^Start/]);
        if (clicked) steps.push(clicked);
        else {
          // No button to click: a screen waiting for keys. This student uses the computer's.
          await page.keyboard.press('asdfghj'[key++ % 7]);
          steps.push('computer key');
        }
        await sleep(400);
      }
      if (!(await livePlaying(page))) return { pass: false, detail: { steps: steps.slice(-12), why: 'never reached a live song', screen: await heading(page) } };
      const { hits, trueOffset, ended } = await playAlong(page, { count: 16 });
      const at = runOfHits(hits, 0, 4);
      return { pass: at >= 0, detail: { steps: steps.slice(-12), song: await page.title(), trueOffset, hits: hits.map(Number).join(''), ended } };
    } finally { await context.close(); }
  },
};

const names = values.only ? values.only.split(',') : Object.keys(CASES);
const { server, origin } = await startServer();
let browser;
try {
  browser = await launchBrowser();
  const results = [];
  for (const name of names) {
    if (!CASES[name]) throw new Error(`unknown case ${name}`);
    let r;
    try { r = await CASES[name](browser, origin); } catch (e) { r = { pass: false, detail: { error: e.message.split('\n')[0] } }; }
    results.push({ name, ...r });
    console.error(`${r.pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(r.detail)}`);
  }
  console.log(JSON.stringify({ hill: 'classroom-cases-1017', score: `${results.filter((r) => r.pass).length}/${results.length}`, browser: browser.version(), results }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
