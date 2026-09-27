import { describe, expect, it, vi, afterEach } from 'vitest';
import { PerspectiveRenderer, projectX, scaleAt } from '../src/render/highway3d.ts';
import { layoutKeys } from '../src/render/layout.ts';
import type { RenderState } from '../src/render/renderer.ts';
import { DEFAULT_SETTINGS, sanitize } from '../src/ui/settings.ts';

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
    expect(projectX(width, 0, width, hitY) - projectX(0, 0, width, hitY)).toBeCloseTo(width * 0.35);
  });

  it('scales linearly, clamps outside the highway, and handles a zero-height canvas', () => {
    expect(scaleAt(0, hitY)).toBe(0.35);
    expect(scaleAt(hitY / 2, hitY)).toBeCloseTo(0.675);
    expect(scaleAt(hitY, hitY)).toBe(1);
    expect(scaleAt(-20, hitY)).toBe(0.35);
    expect(scaleAt(hitY + 20, hitY)).toBe(1);
    expect(Number.isFinite(scaleAt(0, 0))).toBe(true);
  });
});

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const ctx = {
    setTransform: vi.fn(), transform: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
    beginPath: vi.fn(), closePath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(), rect: vi.fn(), clip: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(), fillText: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  };
  const motion = { matches: false };
  vi.stubGlobal('window', { devicePixelRatio: 3, matchMedia: vi.fn(() => motion) });
  vi.stubGlobal('document', { createElement: vi.fn(() => ({ getContext: () => ctx })) });
  const canvas = { clientWidth: width, clientHeight: 600, width: 0, height: 0, getContext: () => ctx };
  const note = { id: 0, time: 0, duration: 0.2, tick: 0, pitch: 60, origPitch: 72, folded: true,
    hand: 'R' as const, partKey: '0:0', velocity: 100 };
  const state: RenderState = {
    chart: { notes: [note], minPitch: 60, maxPitch: 60, window: null, foldedRatio: 1,
      droppedCount: 0, backing: [], duration: 2, firstNoteTime: 0, maxDuration: 0.2 },
    low: 60, high: 84, time: 0.03, pixelsPerSecond: 300,
    beatLines: [{ time: 0, isBar: true }], noteVisuals: [{ state: 'pending', hitTime: 0, judgment: '' }],
    keyVisuals: new Map(), popups: [], hud: { score: 0, combo: 0, accuracy: 0, progress: 0, hint: 'Your keys' },
    showNames: true, showNoteNames: true, physical: { low: 60, high: 84 },
  };
  return { renderer: new PerspectiveRenderer(canvas as unknown as HTMLCanvasElement), canvas, ctx, motion, state };
}

describe('perspective renderer lifecycle', () => {
  it('caps DPR, reuses the background on stable frames, and rebuilds on resize or range change', () => {
    const { renderer, canvas, ctx, state } = fixture();
    renderer.draw(state);
    expect(canvas.width).toBe(2048);
    expect(canvas.height).toBe(1200);
    expect(ctx.createLinearGradient).toHaveBeenCalledTimes(1);
    renderer.draw(state);
    expect(ctx.createLinearGradient).toHaveBeenCalledTimes(1);
    canvas.clientWidth = 800;
    renderer.draw(state);
    expect(canvas.width).toBe(1600);
    state.low = 48;
    renderer.draw(state);
    expect(ctx.createLinearGradient).toHaveBeenCalledTimes(3);
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
  it('keeps Flat as the default and accepts only the two supported renderers', () => {
    expect(DEFAULT_SETTINGS.highway).toBe('flat');
    expect(sanitize({ highway: 'perspective' }).highway).toBe('perspective');
    expect(sanitize({ highway: 'unknown' }).highway).toBe('flat');
    expect(sanitize({}, { ...DEFAULT_SETTINGS, highway: 'perspective' }).highway).toBe('perspective');
  });
});
