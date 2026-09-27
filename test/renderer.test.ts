import { afterEach, describe, expect, it, vi } from 'vitest';
import { Renderer, type RenderState } from '../src/render/renderer.ts';
import { createFx } from '../src/render/fx.ts';

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const ctx = {
    fillStyle: '', globalAlpha: 1, globalCompositeOperation: 'source-over',
    setTransform: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(), beginPath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), fill: vi.fn(), stroke: vi.fn(), arc: vi.fn(),
    roundRect: vi.fn(), translate: vi.fn(), scale: vi.fn(), rotate: vi.fn(),
    strokeText: vi.fn(), fillText: vi.fn(), save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  };
  vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) });
  const canvas = { clientWidth: 1024, clientHeight: 600, width: 0, height: 0, getContext: () => ctx };
  const state: RenderState = {
    chart: { notes: [{ id: 0, time: 0, duration: 0.2, tick: 0, pitch: 60, origPitch: 60,
      folded: false, hand: 'R', partKey: '0:0', velocity: 100 }], minPitch: 60, maxPitch: 60,
      window: null, foldedRatio: 0, droppedCount: 0, backing: [], duration: 2,
      firstNoteTime: 0, maxDuration: 0.2, phrases: [], beats: [] },
    fx: createFx(), low: 60, high: 84, time: 0, pixelsPerSecond: 300,
    beatLines: [{ time: 0, isBar: true }], noteVisuals: [], keyVisuals: new Map(), popups: [],
    hud: { score: 0, combo: 0, accuracy: 0, progress: 0, hint: '' },
    showNames: true, showNoteNames: true, physical: null,
  };
  return { renderer: new Renderer(canvas as unknown as HTMLCanvasElement), ctx, canvas, state };
}

describe('flat renderer caches and cursors', () => {
  it('reuses gradients and labels until the canvas size, DPR or pitch range changes', () => {
    const { renderer, ctx, canvas, state } = fixture();
    renderer.draw(state);
    const count = ctx.createLinearGradient.mock.calls.length;
    state.fx.meters.starActive = true;
    state.fx.glow.life = 1;
    renderer.draw(state);
    expect(ctx.createLinearGradient).toHaveBeenCalledTimes(count);
    expect(ctx.fillText.mock.calls.some(c => c[0] === 'C4')).toBe(true);
    canvas.clientWidth = 800;
    renderer.draw(state);
    expect(canvas.width).toBe(800);
    expect(ctx.createLinearGradient).toHaveBeenCalledTimes(count * 2);
    window.devicePixelRatio = 3;
    renderer.draw(state);
    expect(canvas.width).toBe(1600);
    state.low = 48;
    renderer.draw(state);
    expect(ctx.fillText.mock.calls.some(c => c[0] === 'C3')).toBe(true);
  });

  it('restores notes and beat lines after rewinding or replacing their source', () => {
    const { renderer, ctx, state } = fixture();
    state.time = 10;
    renderer.draw(state);
    ctx.roundRect.mockClear();
    ctx.moveTo.mockClear();
    state.time = 0;
    renderer.draw(state);
    expect(ctx.roundRect).toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 492.5);
    state.time = 10;
    renderer.draw(state);
    state.chart = { ...state.chart, notes: [{ ...state.chart.notes[0]!, time: 10 }] };
    state.beatLines = [{ time: 10, isBar: true }];
    ctx.roundRect.mockClear();
    ctx.moveTo.mockClear();
    renderer.draw(state);
    expect(ctx.roundRect).toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 492.5);
  });
});
