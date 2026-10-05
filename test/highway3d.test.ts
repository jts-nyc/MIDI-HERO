import { describe, expect, it, vi, afterEach } from 'vitest';
import { depthY, horizonSeconds, PerspectiveRenderer, projectX, scaleAt } from '../src/render/highway3d.ts';
import { layoutKeys } from '../src/render/layout.ts';
import { theme, type RenderState } from '../src/render/renderer.ts';
import { createFx, Tint } from '../src/render/fx.ts';
import { DEFAULT_SETTINGS, sanitize } from '../src/ui/settings.ts';
import { FULL_FEEDBACK } from '../src/game/feedback.ts';

const width = 1024;
const hitY = 600 - Math.round(600 * 0.18);

describe('perspective projection', () => {
  it('lands every column exactly on its key, including black keys', () => {
    for (const col of layoutKeys(60, 84, width).columns.values()) {
      expect(projectX(col.x, hitY, width, hitY)).toBeCloseTo(col.x, 12);
      expect(projectX(col.x + col.w, hitY, width, hitY)).toBeCloseTo(col.x + col.w, 12);
      expect(projectX(col.x + col.w, hitY, width, hitY) - projectX(col.x, hitY, width, hitY)).toBeCloseTo(col.w, 12);
    }
  });

  it('projects monotonically across the horizon and keeps top-row gems readable', () => {
    const layout = layoutKeys(60, 84, width);
    let previous = -Infinity;
    for (let pitch = 60; pitch <= 84; pitch++) {
      const col = layout.columns.get(pitch)!;
      const center = projectX(col.x + col.w / 2, 0, width, hitY);
      expect(center).toBeGreaterThan(previous);
      previous = center;
      const gemWidth = projectX(col.x + col.w - 1, 0, width, hitY) - projectX(col.x + 1, 0, width, hitY);
      expect(gemWidth).toBeGreaterThanOrEqual(6);
    }
    expect(projectX(width, 0, width, hitY) - projectX(0, 0, width, hitY)).toBeCloseTo(width * 0.5);
  });

  it('scales linearly, clamps outside the highway, and handles a zero-height canvas', () => {
    expect(scaleAt(0, hitY)).toBe(0.5);
    expect(scaleAt(hitY / 2, hitY)).toBeCloseTo(0.75);
    expect(scaleAt(hitY, hitY)).toBe(1);
    expect(scaleAt(-20, hitY)).toBe(0.5);
    expect(scaleAt(hitY + 20, hitY)).toBe(1);
    expect(Number.isFinite(scaleAt(0, 0))).toBe(true);
  });
});

describe('perspective depth', () => {
  const pps = 300;

  it('puts now on the hit line and the horizon at horizonSeconds; further out is off screen', () => {
    expect(depthY(0, hitY, pps)).toBe(hitY);
    expect(depthY(horizonSeconds(hitY, pps), hitY, pps)).toBeCloseTo(0, 9);
    expect(depthY(100, hitY, pps)).toBeLessThan(0);
    expect(horizonSeconds(hitY, pps)).toBeCloseTo(hitY / (0.5 * pps));
  });

  it('moves at the Speed setting at the keys and slows toward the horizon, like a road', () => {
    const eps = 1e-4;
    const atKeys = (depthY(0, hitY, pps) - depthY(eps, hitY, pps)) / eps;
    expect(atKeys).toBeCloseTo(pps, 1);
    const far = horizonSeconds(hitY, pps) * 0.9;
    const atHorizon = (depthY(far, hitY, pps) - depthY(far + eps, hitY, pps)) / eps;
    expect(atHorizon).toBeLessThan(pps * 0.4);
    let previous = Infinity;
    for (let t = 0; t <= horizonSeconds(hitY, pps); t += 0.05) {
      const y = depthY(t, hitY, pps);
      expect(y).toBeLessThan(previous);
      previous = y;
    }
  });

  it('agrees with the lane width: a note looks as far away as it is drawn', () => {
    // At any row, the width scale of the lanes equals the distance scale that placed the note there.
    for (const t of [0.2, 0.7, 1.5, 3]) {
      const d = t / horizonSeconds(hitY, pps);
      const distanceScale = 1 / (1 + d * (1 / 0.5 - 1));
      expect(scaleAt(depthY(t, hitY, pps), hitY)).toBeCloseTo(distanceScale, 9);
    }
  });

  it('keeps missed notes falling at the Speed setting below the keys', () => {
    expect(depthY(-0.1, hitY, pps)).toBeCloseTo(hitY + 30);
  });
});

describe('feedback profile on the highway', () => {
  it('skips the bar sway when the profile asks for a still highway', () => {
    const { renderer, ctx, state } = fixture();
    state.feedback = { ...FULL_FEEDBACK, sway: false };
    renderer.draw(state);
    expect(ctx.transform).toHaveBeenLastCalledWith(1, 0, -0, 1, 0, 0);
    state.feedback = FULL_FEEDBACK;
    renderer.draw(state);
    expect(ctx.transform.mock.lastCall![4]).not.toBe(0);
  });
});

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const rects: { x: number; y: number; w: number; h: number; color: string; alpha: number; blend: string }[] = [];
  const fills: string[] = [];
  const ctx = {
    fillStyle: '', globalAlpha: 1, globalCompositeOperation: 'source-over',
    setTransform: vi.fn(), transform: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
    beginPath: vi.fn(), closePath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(), rect: vi.fn(), clip: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    arc: vi.fn(), roundRect: vi.fn(), translate: vi.fn(), scale: vi.fn(), rotate: vi.fn(), strokeText: vi.fn(),
    drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(), fillText: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  };
  ctx.fill.mockImplementation(() => { fills.push(ctx.fillStyle); });
  ctx.fillRect.mockImplementation((x: number, y: number, w: number, h: number) => {
    rects.push({ x, y, w, h, color: ctx.fillStyle, alpha: ctx.globalAlpha, blend: ctx.globalCompositeOperation });
  });
  const motion = { matches: false };
  vi.stubGlobal('window', { devicePixelRatio: 3, matchMedia: vi.fn(() => motion) });
  vi.stubGlobal('document', { createElement: vi.fn(() => ({ getContext: () => ctx })) });
  const canvas = { clientWidth: width, clientHeight: 600, width: 0, height: 0, getContext: () => ctx };
  const note = { id: 0, time: 0, duration: 0.2, tick: 0, pitch: 60, origPitch: 72, folded: true,
    hand: 'R' as const, partKey: '0:0', velocity: 100 };
  const state: RenderState = {
    chart: { notes: [note], minPitch: 60, maxPitch: 60, window: null, foldedRatio: 1,
      droppedCount: 0, backing: [], duration: 2, firstNoteTime: 0, maxDuration: 0.2, phrases: [], beats: [] },
    fx: createFx(),
    low: 60, high: 84, time: 0.03, pixelsPerSecond: 300,
    beatLines: [{ time: 0, isBar: true }], noteVisuals: [{ state: 'pending', hitTime: 0, judgment: '' }],
    keyVisuals: new Map(), popups: [], hud: { score: 0, combo: 0, accuracy: 0, progress: 0, hint: 'Your keys' },
    showNames: true, showNoteNames: true, physical: { low: 60, high: 84 },
  };
  return { renderer: new PerspectiveRenderer(canvas as unknown as HTMLCanvasElement), canvas, ctx, motion, state, rects, fills };
}

describe('perspective renderer lifecycle', () => {
  it('caps DPR, reuses the background on stable frames, and rebuilds on resize or range change', () => {
    const { renderer, canvas, ctx, state } = fixture();
    renderer.draw(state);
    expect(canvas.width).toBe(2048);
    expect(canvas.height).toBe(1200);
    expect(ctx.createLinearGradient).toHaveBeenCalledTimes(14);
    renderer.draw(state);
    expect(ctx.createLinearGradient).toHaveBeenCalledTimes(14);
    canvas.clientWidth = 800;
    renderer.draw(state);
    expect(canvas.width).toBe(1600);
    state.low = 48;
    renderer.draw(state);
    expect(ctx.createLinearGradient).toHaveBeenCalledTimes(42);
  });

  it('anchors sway at the hit line and responds to reduced motion independently of the hint', () => {
    const { renderer, ctx, state, motion } = fixture();
    renderer.draw(state);
    const transform = ctx.transform.mock.lastCall!;
    expect(transform[4]).not.toBe(0);
    expect(Math.abs(transform[4])).toBeLessThanOrEqual(4);
    expect(transform[2] * hitY + transform[4]).toBeCloseTo(0);
    motion.matches = true;
    renderer.draw(state);
    expect(ctx.transform).toHaveBeenLastCalledWith(1, 0, -0, 1, 0, 0);
    state.time = 0.121;
    renderer.draw(state);
    expect(ctx.transform).toHaveBeenLastCalledWith(1, 0, -0, 1, 0, 0);
  });

  it('restores notes after rewinding or replacing a chart on the same renderer', () => {
    const { renderer, ctx, state } = fixture();
    state.time = 10;
    renderer.draw(state);
    ctx.quadraticCurveTo.mockClear();
    state.time = 0;
    renderer.draw(state);
    expect(ctx.quadraticCurveTo).toHaveBeenCalledTimes(4);
    state.time = 10;
    renderer.draw(state);
    state.chart = { ...state.chart, notes: [{ ...state.chart.notes[0]!, time: 10 }] };
    ctx.quadraticCurveTo.mockClear();
    renderer.draw(state);
    expect(ctx.quadraticCurveTo).toHaveBeenCalledTimes(4);
  });

  it('keeps the passed bar pulse above the keyboard for 120 ms', () => {
    const { renderer, ctx, state } = fixture();
    state.time = 0;
    renderer.draw(state);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, hitY - 6, width, 4);
    ctx.fillRect.mockClear();
    state.time = 0.06;
    renderer.draw(state);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, hitY - 5, width, 3);
    ctx.fillRect.mockClear();
    state.time = 0.121;
    renderer.draw(state);
    expect(ctx.fillRect.mock.calls.some(([x, y, w]) => x === 0 && w === width && y < hitY - 2 && y > hitY - 7)).toBe(false);
  });
});

describe('highway setting', () => {
  it('defaults to Perspective and accepts only the two supported renderers', () => {
    expect(DEFAULT_SETTINGS.highway).toBe('perspective');
    expect(sanitize({ highway: 'flat', highwayPicked: true }).highway).toBe('flat');
    expect(sanitize({ highway: 'unknown' }).highway).toBe('perspective');
    expect(sanitize({}, { ...DEFAULT_SETTINGS, highway: 'perspective' }).highway).toBe('perspective');
  });

  it('moves old saves that only stored the former Flat default onto Perspective', () => {
    expect(sanitize({ highway: 'flat' }).highway).toBe('perspective');
  });
});


describe('perspective gameplay contract', () => {
  it('anchors pooled effects on flat keys and uses effect age independently of song time', () => {
    const { renderer, state, ctx, rects } = fixture();
    state.chart.notes = [];
    state.time = -10;
    Object.assign(state.fx.particles[0]!, { active: true, pitch: 61, x: 10, y: -20, size: 4, age: 0.25, life: 1, tint: Tint.gold });
    Object.assign(state.fx.rings[0]!, { active: true, pitch: 61, radius: 1.5, age: 0.25, life: 1, tint: Tint.perfect });
    Object.assign(state.fx.shocks[0]!, { active: true, pitch: 61, age: 0.25, life: 1, tint: Tint.perfect });
    const before = JSON.stringify(state.fx);
    renderer.draw(state);
    const key = layoutKeys(60, 84, width).columns.get(61)!;
    const center = key.x + key.w / 2;
    expect(rects).toContainEqual({ x: center + 8, y: hitY - 22, w: 4, h: 4, color: theme.star, alpha: 0.75, blend: 'lighter' });
    expect(ctx.arc).toHaveBeenCalledWith(center, hitY, (0.3 + 0.7 * 0.25) * 1.5 * (width / 15), 0, Math.PI * 2);
    expect(rects.some(r => r.y === hitY - 4 && r.h === 7 && r.color === theme.perfect)).toBe(true);
    expect(ctx.globalCompositeOperation).toBe('source-over');
    expect(ctx.globalAlpha).toBe(1);
    expect(JSON.stringify(state.fx)).toBe(before);
  });

  it('draws star notes, doubled multiplier, meters, streak, callouts, and countdown', () => {
    const { renderer, state, ctx, fills } = fixture();
    state.chart.notes[0]!.star = true;
    state.fx.meters.multiplier = 4;
    state.fx.meters.starActive = true;
    state.fx.meters.starGauge = 0.75;
    state.fx.streak.value = 25;
    state.fx.countdown.value = 3;
    Object.assign(state.fx.callouts[0]!, { active: true, text: 'STAR POWER!', kind: 'star', age: 0.3, life: 1 });
    renderer.draw(state);
    expect(fills).toContain(theme.star);
    for (const label of ['8x', '25', 'NOTE STREAK', 'STAR POWER!', '3']) {
      expect(ctx.fillText.mock.calls.some(call => call[0] === label)).toBe(true);
    }
    const count = ctx.createLinearGradient.mock.calls.length;
    state.fx.glow.life = 1;
    state.fx.glow.tint = Tint.gold;
    renderer.draw(state);
    expect(ctx.createLinearGradient).toHaveBeenCalledTimes(count);
  });

  it('keeps holds visible after hit fade, fills their progress, and greys early releases', () => {
    const { renderer, state, rects, fills } = fixture();
    state.chart.notes[0]!.duration = 2;
    state.chart.maxDuration = 2;
    state.time = 0.5;
    state.noteVisuals[0] = { state: 'hit', hitTime: 0, judgment: 'perfect', hold: 'holding' };
    renderer.draw(state);
    expect(rects.some(r => r.x === 0 && r.y === hitY - 7 && r.w === (width / 15) * 0.25 && r.color === theme.perfect)).toBe(true);
    state.noteVisuals[0]!.hold = 'released';
    rects.length = 0;
    fills.length = 0;
    renderer.draw(state);
    expect(fills).toContain(theme.noteMissed);
    expect(rects.some(r => r.y === hitY - 7)).toBe(false);
  });

  it('starts the completed sustain pop at holdEnd, then expires it', () => {
    const { renderer, state, ctx, fills } = fixture();
    state.chart.notes[0]!.duration = 2;
    state.chart.maxDuration = 2;
    state.noteVisuals[0] = { state: 'hit', hitTime: 0, judgment: 'perfect', hold: 'held', holdEnd: 2 };
    state.time = 2.05;
    renderer.draw(state);
    expect(fills).toContain('#ffffff');
    expect(ctx.roundRect).toHaveBeenCalledTimes(1);
    state.time = 2.16;
    ctx.roundRect.mockClear();
    renderer.draw(state);
    expect(ctx.roundRect).not.toHaveBeenCalled();
  });

  it('never passes the canvas a negative size when laid out almost zero wide (hidden or tiny window)', () => {
    const { renderer, state, ctx, canvas } = fixture();
    canvas.clientWidth = 20; // 25 keys in 20px: every column is under 2px
    state.noteVisuals[0] = { state: 'hit', hitTime: 0, judgment: 'perfect' };
    state.time = 0.05;
    renderer.draw(state);
    expect(ctx.roundRect).toHaveBeenCalled();
    for (const [, , w, h, r] of ctx.roundRect.mock.calls) {
      expect(w).toBeGreaterThan(0);
      expect(h).toBeGreaterThan(0);
      expect(r).toBeGreaterThanOrEqual(0);
    }
  });

  it('draws missed notes over the keyboard and fades them out, with red key flashes', () => {
    const { renderer, state, rects } = fixture();
    state.noteVisuals[0]!.state = 'missed';
    state.time = 0.25;
    Object.assign(state.fx.flashes[0]!, { active: true, pitch: 60, age: 0.2, life: 1, tint: Tint.wrong });
    renderer.draw(state);
    const passing = rects.find(r => r.color === theme.noteMissed && r.y >= hitY);
    expect(passing).toBeDefined();
    expect(passing!.alpha).toBeGreaterThan(0);
    expect(passing!.alpha).toBeLessThan(0.75);
    expect(rects.some(r => r.color === theme.wrong && r.y === hitY)).toBe(true);
    state.time = 0.6;
    rects.length = 0;
    renderer.draw(state);
    expect(rects.some(r => r.color === theme.noteMissed && r.y >= hitY)).toBe(false);
  });

  it('honours reduced motion while preserving meters, alerts, and sustain feedback', () => {
    const { renderer, state, motion, ctx, rects } = fixture();
    motion.matches = true;
    state.fx.streak.value = 10;
    state.fx.streak.pulse = 1;
    state.fx.countdown.value = 3;
    Object.assign(state.fx.particles[0]!, { active: true, pitch: 60, size: 4, life: 1 });
    Object.assign(state.fx.callouts[0]!, { active: true, text: 'SONG FAILED', kind: 'fail', age: 0.1, life: 1 });
    renderer.draw(state);
    expect(rects.some(r => r.blend === 'lighter')).toBe(false);
    expect(ctx.scale.mock.calls.every(([x, y]) => x === 1 && y === 1)).toBe(true);
    expect(ctx.fillText.mock.calls.some(call => call[0] === 'SONG FAILED')).toBe(true);
    expect(ctx.fillText.mock.calls.some(call => call[0] === '1x')).toBe(true);
  });
});
