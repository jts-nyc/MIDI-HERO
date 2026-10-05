import { afterEach, describe, expect, it, vi } from 'vitest';
import { Renderer, theme, type RenderState } from '../src/render/renderer.ts';
import { PerspectiveRenderer, depthY, projectX } from '../src/render/highway3d.ts';
import { createFx } from '../src/render/fx.ts';
import { layoutKeys } from '../src/render/layout.ts';
import { NO_PRACTICE, type PracticeView } from '../src/render/practice.ts';

const width = 1024;
const hitY = 492;
const cyan = '#54e4e8';
const cool = '#8ab6d6';
interface Mark { kind: string; color: unknown; alpha: number; args: unknown[] }
function fixture(perspective: boolean) {
  const marks: Mark[] = [];
  let path: number[][] = [];
  const ctx = {
    fillStyle: '' as unknown, strokeStyle: '' as unknown, globalAlpha: 1, globalCompositeOperation: 'source-over',
    setTransform: vi.fn(), transform: vi.fn(), strokeRect: vi.fn(), closePath: vi.fn(),
    beginPath: () => { path = []; },
    moveTo: (x: number, y: number) => { path.push([x, y]); },
    lineTo: (x: number, y: number) => { path.push([x, y]); },
    fill: () => { marks.push({ kind: 'fill', color: ctx.fillStyle, alpha: ctx.globalAlpha, args: path }); },
    stroke: () => { marks.push({ kind: 'stroke', color: ctx.strokeStyle, alpha: ctx.globalAlpha, args: path }); },
    fillRect: (...args: number[]) => { marks.push({ kind: 'rect', color: ctx.fillStyle, alpha: ctx.globalAlpha, args }); },
    fillText: (...args: unknown[]) => { marks.push({ kind: 'text', color: ctx.fillStyle, alpha: ctx.globalAlpha, args }); },
    quadraticCurveTo: vi.fn(), rect: vi.fn(), clip: vi.fn(), arc: vi.fn(), roundRect: vi.fn(),
    translate: vi.fn(), scale: vi.fn(), rotate: vi.fn(), strokeText: vi.fn(), drawImage: vi.fn(),
    save: vi.fn(), restore: vi.fn(), createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  };
  const motion = { matches: false };
  vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: () => motion });
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ctx }) });
  const canvas = { clientWidth: width, clientHeight: 600, width: 0, height: 0, getContext: () => ctx };
  const state: RenderState = {
    chart: { notes: [], minPitch: 60, maxPitch: 84, window: null, foldedRatio: 0, droppedCount: 0,
      backing: [], duration: 20, firstNoteTime: 0, maxDuration: 1, phrases: [], beats: [] },
    fx: createFx(), low: 60, high: 84, time: 2, pixelsPerSecond: 100,
    beatLines: [], noteVisuals: [], keyVisuals: new Map(), popups: [],
    hud: { score: 0, combo: 0, accuracy: 0, progress: 0, hint: '' },
    showNames: true, showNoteNames: true, physical: null,
  };
  const practice: PracticeView = { sections: [{ start: 3, end: 5, label: 'Bars 9–16' }], current: 0,
    loop: { start: 3, end: 5 }, passes: 2, waiting: false, waitingFor: [] };
  const renderer = perspective ? new PerspectiveRenderer(canvas as unknown as HTMLCanvasElement) : new Renderer(canvas as unknown as HTMLCanvasElement);
  const draw = () => { marks.length = 0; renderer.draw(state); return marks; };
  return { ctx, state, practice, motion, draw, marks };
}
afterEach(() => vi.unstubAllGlobals());

for (const perspective of [false, true]) {
  describe(`${perspective ? 'perspective' : 'flat'} practice and venue`, () => {
    it('leaves practice absent and NO_PRACTICE visually identical', () => {
      const f = fixture(perspective);
      f.draw(); // warm geometry
      const absent = JSON.stringify(f.draw());
      f.state.practice = NO_PRACTICE;
      expect(JSON.stringify(f.draw())).toBe(absent);
      expect(f.marks.some(m => m.color === cyan)).toBe(false);
    });

    it('draws section/pass labels and scrolls projected A/B boundaries with song time', () => {
      const f = fixture(perspective);
      f.state.practice = f.practice;
      const before = JSON.stringify(f.practice);
      f.draw();
      expect(f.marks.some(m => m.kind === 'text' && m.args[0] === 'Bars 9–16')).toBe(true);
      expect(f.marks.some(m => m.kind === 'text' && m.args[0] === '2 passes completed')).toBe(true);
      for (const time of [2, 2.5, 1.5]) {
        f.state.time = time;
        f.draw();
        const lines = f.marks.filter(m => m.kind === 'stroke' && m.color === cyan);
        expect(lines).toHaveLength(2);
        for (let i = 0; i < 2; i++) {
          const y = perspective ? depthY((i === 0 ? 3 : 5) - time, hitY, 100) : hitY - ((i === 0 ? 3 : 5) - time) * 100;
          const x = perspective ? projectX(0, y, width, hitY) : 0;
          expect(lines[i]!.args[0]).toEqual([x, y]);
          expect(lines[i]!.args[1]).toEqual([width - x, y]);
        }
      }
      expect(JSON.stringify(f.practice)).toBe(before);
      f.practice.passes = 3;
      f.state.time = -10;
      f.draw();
      expect(f.marks.some(m => m.kind === 'text' && m.args[0] === '3 passes completed')).toBe(true);
      expect(f.marks.some(m => m.kind === 'stroke' && m.color === cyan)).toBe(false);
      f.practice.current = -1;
      f.practice.loop = null;
      expect(f.draw().some(m => m.color === cyan)).toBe(false);
    });

    it('keeps an A badge visible when a note lands on the loop boundary', () => {
      const f = fixture(perspective);
      f.state.practice = f.practice;
      f.state.chart.notes = [{ id: 0, time: 3, duration: 0.2, tick: 0, pitch: 60,
        origPitch: 60, folded: false, hand: 'R', partKey: '0:0', velocity: 100 }];
      f.draw();
      const gem = f.marks.findIndex(m => m.kind === 'fill' && m.color === theme.noteR);
      const badge = f.marks.findIndex(m => m.kind === 'text' && m.args[0] === 'A');
      expect(gem).toBeGreaterThanOrEqual(0);
      expect(badge).toBeGreaterThan(gem);
      expect(f.marks[badge]!.args[2]).toBeGreaterThan(hitY - 100);
    });

    it('pulses only owed white/black keys on the effects clock and clears them on exit', () => {
      const f = fixture(perspective);
      f.state.practice = f.practice;
      f.practice.waiting = true;
      f.practice.waitingFor = [60, 61, -1, 128];
      const keys = () => f.draw().filter(m => m.kind === 'rect' && m.color === cyan && m.args[1] === hitY);
      const initial = keys();
      expect(initial).toHaveLength(2);
      const layout = layoutKeys(60, 84, width);
      for (const pitch of [60, 61]) {
        const col = layout.columns.get(pitch)!;
        expect(initial.some(m => m.args[0] === col.x + 0.5 && m.args[2] === col.w - 1)).toBe(true);
      }
      expect(f.marks.some(m => m.kind === 'rect' && m.color === cyan && m.args[1] === hitY - 2)).toBe(true);
      f.state.fx.clock = Math.PI / 10;
      expect(keys()[0]!.alpha).toBeGreaterThan(initial[0]!.alpha);
      f.practice.waitingFor = [61];
      expect(keys()).toHaveLength(1);
      f.practice.waiting = false;
      expect(keys()).toHaveLength(0);
      expect(f.marks.some(m => m.kind === 'rect' && m.color === theme.hitLine && m.args[1] === hitY - 2)).toBe(true);
      f.practice.waiting = true;
      f.state.practice = undefined;
      expect(keys()).toHaveLength(0);
    });

    it('warms stage light by health, flares only for milestones, and gives gold priority', () => {
      const f = fixture(perspective);
      const light = () => f.draw().find(m => m.kind === 'fill' && [cool, '#ffa95c', '#ff665b', theme.star].includes(m.color as string))!;
      f.state.fx.meters.zone = 'green';
      expect(light().color).toBe(cool);
      f.state.fx.meters.zone = 'yellow';
      expect(light().color).toBe('#ffa95c');
      f.state.fx.meters.zone = 'red';
      const baseline = light();
      expect(baseline.color).toBe('#ff665b');
      Object.assign(f.state.fx.callouts[0]!, { active: true, kind: 'milestone', age: 0, life: 1, text: '25 NOTE STREAK!' });
      expect(light().alpha).toBeGreaterThan(baseline.alpha);
      f.state.fx.callouts[0]!.age = 0.7;
      expect(light().alpha).toBe(baseline.alpha);
      f.state.fx.callouts[0]!.age = 0;
      f.state.fx.callouts[0]!.kind = 'fail';
      expect(light().alpha).toBe(baseline.alpha);
      f.state.fx.meters.starActive = true;
      expect(light().color).toBe(theme.star);
    });

    it('keeps wait cues and venue static with reduced motion and reuses gradients', () => {
      const f = fixture(perspective);
      f.motion.matches = true;
      f.state.practice = f.practice;
      f.practice.waiting = true;
      f.practice.waitingFor = [61];
      f.state.fx.meters.zone = 'green';
      f.draw();
      const count = f.ctx.createLinearGradient.mock.calls.length;
      const staticMarks = () => f.draw().filter(m => m.color === cyan || m.color === cool);
      const before = JSON.stringify(staticMarks());
      f.state.fx.clock = 0.4;
      Object.assign(f.state.fx.callouts[0]!, { active: true, kind: 'milestone', age: 0, life: 1, text: '25 NOTE STREAK!' });
      expect(JSON.stringify(staticMarks())).toBe(before);
      expect(f.ctx.createLinearGradient).toHaveBeenCalledTimes(count);
      expect(f.ctx.scale.mock.calls.every(([x, y]) => x === 1 && y === 1)).toBe(true);
      expect(f.ctx.globalAlpha).toBe(1);
      expect(f.ctx.globalCompositeOperation).toBe('source-over');
    });
  });
}
