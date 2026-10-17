import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameClock } from '../src/audio/clock.ts';
import { DEFAULT_JUDGE_CONFIG, Judge } from '../src/game/judge.ts';
import { PlaySession, tierWord } from '../src/game/session.ts';
import { buildChart } from '../src/midi/chart.ts';
import { parseSong } from '../src/midi/parse.ts';
import { createFx } from '../src/render/fx.ts';
import { approach, GUIDES, landedRow, meterPosition, pushMark, timingSide, type GuideState, type TimingMark } from '../src/render/guides.ts';
import { PerspectiveRenderer } from '../src/render/highway3d.ts';
import { Renderer, type RenderState } from '../src/render/renderer.ts';
import { FULL_FEEDBACK } from '../src/game/feedback.ts';
import { DEFAULT_SETTINGS, sanitize, urlOverrides } from '../src/ui/settings.ts';
import { end, off, on, smf, tempo } from './helpers/smf.ts';

afterEach(() => vi.unstubAllGlobals());

describe('timing guide helpers', () => {
  it('lights a pad from the lead time, brightest exactly when the note is due, then dark', () => {
    expect(approach(GUIDES.lead + 0.01)).toBe(0);
    expect(approach(0)).toBe(1);
    expect(approach(-GUIDES.fall - 0.01)).toBe(0);
    let previous = -1;
    for (let dt = GUIDES.lead; dt >= 0; dt -= 0.02) {
      const a = approach(dt);
      expect(a).toBeGreaterThanOrEqual(previous);
      previous = a;
    }
    expect(approach(-GUIDES.fall / 2)).toBeCloseTo(0.5);
  });

  it('says early or late only outside the Perfect window', () => {
    expect(timingSide(0.02, 0.035)).toBeNull();
    expect(timingSide(-0.035, 0.035)).toBeNull();
    expect(timingSide(-0.05, 0.035)).toBe('early');
    expect(timingSide(0.09, 0.035)).toBe('late');
  });

  it('places hits on the meter between the edges of the miss window', () => {
    expect(meterPosition(0, 0.15)).toBe(0);
    expect(meterPosition(-0.075, 0.15)).toBeCloseTo(-0.5);
    expect(meterPosition(0.4, 0.15)).toBe(1);
    expect(meterPosition(0.1, 0)).toBe(0);
  });

  it('holds a due note on the hit line, and only a pending one', () => {
    expect(landedRow(520, 492, true)).toBe(492);
    expect(landedRow(450, 492, true)).toBe(450);
    expect(landedRow(520, 492, false)).toBe(520);
  });

  it('keeps only the last hits for the meter', () => {
    const marks: TimingMark[] = [];
    for (let i = 0; i < GUIDES.marks + 5; i++) pushMark(marks, { pitch: 60, delta: i, time: i });
    expect(marks).toHaveLength(GUIDES.marks);
    expect(marks[0]!.delta).toBe(5);
  });
});

describe('early is not called late', () => {
  it('a press just outside the Good window before the note says Early', () => {
    expect(tierWord('late', 'perfect', -0.13)).toBe('Early');
    expect(tierWord('late', 'all', -0.13)).toBe('Early');
    expect(tierWord('late', 'perfect', 0.13)).toBe('Late');
    expect(tierWord('late', 'perfect')).toBe('Late');
    expect(tierWord('good', 'all', -0.1)).toBe('Good');
  });
});

describe('the judge reports its windows', () => {
  it('in song seconds, after the preset and the rate', () => {
    const chart = makeChart([[1, 60]]);
    const j = new Judge(chart, { ...DEFAULT_JUDGE_CONFIG, preset: 'relaxed' }, 0.5);
    expect(j.timingWindows.perfect).toBeCloseTo(0.035 * 1.5 * 0.5);
    expect(j.timingWindows.good).toBeCloseTo(0.12 * 1.5 * 0.5);
    expect(j.timingWindows.miss).toBeCloseTo(0.15 * 1.5 * 0.5);
  });
});

describe('the session feeds the guides', () => {
  it('is off unless asked for', () => {
    expect(session().session.guides).toBeUndefined();
  });

  it('records each hit with its timing and carries the judge windows', () => {
    const { session: s, goTo, t } = session({ timingGuides: true });
    expect(s.guides!.perfect).toBeCloseTo(0.035);
    expect(s.guides!.good).toBeCloseTo(0.12);
    goTo(0.94);
    s.handleInput({ type: 'on', pitch: 60, velocity: 90, channel: 0, perfMs: t.perfMs, source: 'midi' });
    const mark = s.guides!.marks.at(-1)!;
    expect(mark.pitch).toBe(60);
    expect(mark.delta).toBeCloseTo(-0.06, 3);
    expect(timingSide(mark.delta, s.guides!.perfect)).toBe('early');
  });
});

describe('renderers with the guides on', () => {
  const hitY = 600 - Math.round(600 * 0.18);
  const guides = (): GuideState => ({ perfect: 0.035, great: 0.07, good: 0.12, miss: 0.15, marks: [] });

  it('flat: a due note sits on the hit line instead of sliding under the keys', () => {
    const { ctx, state, renderer } = flat();
    state.time = 0.1; // the note was due 0.1 s ago and is still pending
    renderer.draw(state);
    const without = ctx.roundRect.mock.calls[0]!;
    expect(without[1] + without[3]).toBeCloseTo(hitY + 30);
    ctx.roundRect.mockClear();
    state.guides = guides();
    renderer.draw(state);
    const landed = ctx.roundRect.mock.calls[0]!;
    expect(landed[1] + landed[3]).toBeCloseTo(hitY);
  });

  it('flat: lights the pad of the lane whose note is due, and draws stronger bar lines', () => {
    const { ctx, state, renderer, rects } = flat();
    state.guides = guides();
    state.time = -0.01;
    renderer.draw(state);
    // a pad sits on the hit line over key 60's lane
    expect(rects.some((r) => r.y < hitY && r.y + r.h === hitY && r.h > 6 && r.color === 'rgb(79,140,255)')).toBe(true);
    expect(ctx.lineWidthsSeen).toContain(GUIDES.barWidth);
  });

  it('perspective: no sway with the guides on, even where the level asks for it', () => {
    const { ctx, state, renderer } = perspective();
    state.feedback = FULL_FEEDBACK;
    renderer.draw(state);
    expect(ctx.transform.mock.lastCall![4]).not.toBe(0);
    state.guides = guides();
    renderer.draw(state);
    expect(ctx.transform).toHaveBeenLastCalledWith(1, 0, -0, 1, 0, 0);
  });

  it('perspective: early and late tags and the meter draw from the marks', () => {
    const { ctx, state, renderer } = perspective();
    state.guides = guides();
    state.guides.marks.push({ pitch: 60, delta: -0.06, time: 0 }, { pitch: 62, delta: 0.08, time: 0.01 });
    state.time = 0.03;
    renderer.draw(state);
    const texts = ctx.fillText.mock.calls.map((c) => c[0]);
    expect(texts).toContain('◂ EARLY');
    expect(texts).toContain('LATE ▸');
    expect(texts).toContain('early');
    expect(texts).toContain('late');
  });
});

describe('the setting', () => {
  it('is off by default, saved when set, and can be switched from the URL', () => {
    expect(DEFAULT_SETTINGS.guides).toBe(false);
    expect(sanitize({ guides: true }).guides).toBe(true);
    expect(sanitize({ guides: 'yes' }).guides).toBe(false);
    expect(urlOverrides('?guides=1').guides).toBe(true);
    expect(urlOverrides('?guides=0').guides).toBe(false);
    expect(urlOverrides('').guides).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

const PPQ = 480;
const secs = (s: number) => Math.round(s * 2 * PPQ);

function makeChart(notes: [number, number][]) {
  const evs = notes.flatMap(([t, p]) => [on(secs(t), p), off(secs(t) + PPQ / 4, p)]);
  const song = parseSong(smf([[tempo(0, 120), ...evs, end(secs(notes.at(-1)![0]) + PPQ)]]));
  return buildChart(song, { parts: [{ track: 0, channel: 0 }], window: null });
}

function session(over: { timingGuides?: boolean } = {}) {
  const t = { perfMs: 10_000 };
  const clock = new GameClock(() => t.perfMs);
  const s = new PlaySession({
    chart: makeChart([[1, 60], [2, 62]]), clock, judgeConfig: DEFAULT_JUDGE_CONFIG, rate: 1, inputOffsetMs: 0, synth: null,
    relative: false, visibleSeconds: 1, barSeconds: 1, autoplay: null, hint: '', ...over,
  });
  const goTo = (songTime: number) => {
    t.perfMs += (songTime - s.now()) * 1000;
    s.update();
  };
  return { session: s, goTo, t };
}

function mockCtx() {
  const rects: { x: number; y: number; w: number; h: number; color: string }[] = [];
  const lineWidthsSeen: number[] = [];
  const ctx = {
    fillStyle: '', strokeStyle: '', globalAlpha: 1, globalCompositeOperation: 'source-over', font: '', textAlign: '', textBaseline: '',
    get lineWidth() { return lineWidthsSeen.at(-1) ?? 1; },
    set lineWidth(v: number) { lineWidthsSeen.push(v); },
    lineWidthsSeen,
    setTransform: vi.fn(), transform: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), beginPath: vi.fn(), closePath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(), fill: vi.fn(), stroke: vi.fn(), arc: vi.fn(),
    roundRect: vi.fn(), translate: vi.fn(), scale: vi.fn(), rotate: vi.fn(), drawImage: vi.fn(),
    strokeText: vi.fn(), fillText: vi.fn(), save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  };
  ctx.fillRect.mockImplementation((x: number, y: number, w: number, h: number) => { rects.push({ x, y, w, h, color: ctx.fillStyle }); });
  return { ctx, rects };
}

function baseState(): RenderState {
  return {
    chart: { notes: [{ id: 0, time: 0, duration: 0.2, tick: 0, pitch: 60, origPitch: 60,
      folded: false, hand: 'R', partKey: '0:0', velocity: 100 }], minPitch: 60, maxPitch: 60,
      window: null, foldedRatio: 0, droppedCount: 0, backing: [], duration: 2,
      firstNoteTime: 0, maxDuration: 0.2, phrases: [], beats: [] },
    fx: createFx(), low: 60, high: 84, time: 0, pixelsPerSecond: 300,
    beatLines: [{ time: 0, isBar: true }, { time: 0.5, isBar: true }], noteVisuals: [{ state: 'pending', hitTime: 0, judgment: '' }],
    keyVisuals: new Map(), popups: [], hud: { score: 0, combo: 0, accuracy: 0, progress: 0, hint: '' },
    showNames: true, showNoteNames: false, physical: null,
  };
}

function flat() {
  const { ctx, rects } = mockCtx();
  vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) });
  const canvas = { clientWidth: 1024, clientHeight: 600, width: 0, height: 0, getContext: () => ctx };
  return { renderer: new Renderer(canvas as unknown as HTMLCanvasElement), ctx, rects, state: baseState() };
}

function perspective() {
  const { ctx, rects } = mockCtx();
  vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: vi.fn(() => ({ matches: false })) });
  vi.stubGlobal('document', { createElement: vi.fn(() => ({ getContext: () => ctx })) });
  const canvas = { clientWidth: 1024, clientHeight: 600, width: 0, height: 0, getContext: () => ctx };
  const state = baseState();
  state.time = 0.03;
  state.beatLines = [{ time: 0, isBar: true }];
  return { renderer: new PerspectiveRenderer(canvas as unknown as HTMLCanvasElement), ctx, rects, state };
}
