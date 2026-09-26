import type { Chart, ChartNote } from '../midi/chart.ts';
import type { BeatLine } from '../midi/parse.ts';
import { fitCanvas } from './canvas.ts';
import { isBlackKey, layoutKeys, noteName, type KeyboardLayout } from './layout.ts';

export type NoteState = 'pending' | 'hit' | 'missed';

export interface NoteVisual {
  state: NoteState;
  /** song time of the hit, for the fade */
  hitTime: number;
  judgment: string;
}

export interface KeyVisual {
  /** 'good' | 'great' | 'perfect' | 'wrong' | 'held' */
  kind: string;
  since: number;
}

export interface Popup {
  text: string;
  x: number;
  time: number;
  color: string;
}

export interface Hud {
  score: number;
  combo: number;
  accuracy: number;
  progress: number;
  hint: string;
}

export interface RenderState {
  chart: Chart;
  /** display range */
  low: number;
  high: number;
  /** song time to draw at (audible time + visual offset) */
  time: number;
  pixelsPerSecond: number;
  beatLines: BeatLine[];
  noteVisuals: NoteVisual[];
  keyVisuals: Map<number, KeyVisual>;
  popups: Popup[];
  hud: Hud;
  showNames: boolean;
  showNoteNames: boolean;
  /** physical keyboard edges to highlight, if any */
  physical: { low: number; high: number } | null;
}

export const theme = {
  bg: '#0f1117',
  highway: '#141722',
  octaveStripe: 'rgba(255,255,255,0.025)',
  beat: 'rgba(255,255,255,0.06)',
  bar: 'rgba(255,255,255,0.16)',
  hitLine: '#4f8cff',
  noteR: '#4f8cff',
  noteL: '#ff9f43',
  noteBlackDim: 0.75,
  noteMissed: '#4a4f63',
  whiteKey: '#e8eaf0',
  blackKey: '#1b1e2a',
  keyBorder: '#0f1117',
  text: '#e8eaf0',
  muted: '#9aa0b4',
  perfect: '#3ddc84',
  great: '#4f8cff',
  good: '#ffd166',
  wrong: '#ff5c5c',
  folded: '#ffffff',
};

const KEYBOARD_FRACTION = 0.18;
const MIN_NOTE_HEIGHT = 6;
const HIT_FADE = 0.15;
const POPUP_LIFE = 0.45;

function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `rgb(${r},${g},${b})`;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private layout: KeyboardLayout | null = null;
  private layoutKey = '';
  private width = 0;
  private height = 0;
  private cursor = 0;
  private cursorTime = -Infinity;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  private ensureLayout(low: number, high: number): KeyboardLayout {
    const key = `${low}:${high}:${this.width}`;
    if (!this.layout || key !== this.layoutKey) {
      this.layout = layoutKeys(low, high, this.width);
      this.layoutKey = key;
    }
    return this.layout;
  }

  draw(s: RenderState): void {
    const { width, height } = fitCanvas(this.canvas);
    this.width = width;
    this.height = height;
    const ctx = this.ctx;
    const layout = this.ensureLayout(s.low, s.high);
    const keyboardH = Math.round(height * KEYBOARD_FRACTION);
    const hitY = height - keyboardH;
    const pps = s.pixelsPerSecond;
    const yOf = (t: number) => hitY - (t - s.time) * pps;

    ctx.fillStyle = theme.highway;
    ctx.fillRect(0, 0, width, hitY);

    // Octave stripes: tint every C..B alternately for orientation
    for (const col of layout.columns.values()) {
      if (col.isBlack) continue;
      const octave = Math.floor(col.pitch / 12);
      if (octave % 2 === 0) {
        ctx.fillStyle = theme.octaveStripe;
        ctx.fillRect(col.x, 0, col.w, hitY);
      }
    }
    // Physical keyboard edges
    if (s.physical) {
      const l = layout.columns.get(s.physical.low);
      const h = layout.columns.get(s.physical.high);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      if (l && l.x > 0) ctx.fillRect(0, 0, l.x, hitY);
      if (h && h.x + h.w < width) ctx.fillRect(h.x + h.w, 0, width - (h.x + h.w), hitY);
    }

    // Beat and bar lines
    const visibleSec = hitY / pps;
    ctx.lineWidth = 1;
    for (const b of s.beatLines) {
      if (b.time < s.time - 0.1) continue;
      if (b.time > s.time + visibleSec) break;
      const y = Math.round(yOf(b.time)) + 0.5;
      ctx.strokeStyle = b.isBar ? theme.bar : theme.beat;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Notes (forward-only cursor)
    const notes = s.chart.notes;
    const earliest = s.time - s.chart.maxDuration - 1;
    if (earliest < this.cursorTime) this.cursor = 0;
    while (this.cursor < notes.length && notes[this.cursor]!.time < earliest) this.cursor++;
    this.cursorTime = earliest;
    const until = s.time + visibleSec + 0.5;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = this.cursor; i < notes.length; i++) {
      const n = notes[i]!;
      if (n.time > until) break;
      const vis = s.noteVisuals[i];
      const col = layout.columns.get(n.pitch);
      if (!col) continue;
      if (vis?.state === 'hit' && s.time - vis.hitTime > HIT_FADE) continue;
      if (n.time + n.duration < s.time - 0.5) continue;
      this.drawNote(n, col, yOf, vis, s, hitY);
    }

    // Hit line
    ctx.fillStyle = theme.hitLine;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(0, hitY - 2, width, 3);
    ctx.globalAlpha = 1;

    this.drawKeyboard(s, layout, hitY, keyboardH);
    this.drawPopups(s, layout, hitY);
    this.drawHud(s, width);
  }

  private drawNote(
    n: ChartNote,
    col: { x: number; w: number; isBlack: boolean },
    yOf: (t: number) => number,
    vis: NoteVisual | undefined,
    s: RenderState,
    hitY: number,
  ): void {
    const ctx = this.ctx;
    const yTop = yOf(n.time + n.duration);
    const yBottom = yOf(n.time);
    const h = Math.max(MIN_NOTE_HEIGHT, yBottom - yTop);
    const y = yBottom - h;
    if (y > hitY + 40 || y + h < -10) return;
    let color = n.hand === 'L' ? theme.noteL : theme.noteR;
    if (vis?.state === 'missed') color = theme.noteMissed;
    let alpha = 1;
    if (vis?.state === 'hit') alpha = 1 - (s.time - vis.hitTime) / HIT_FADE;
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = col.isBlack && vis?.state !== 'missed' ? shade(color, theme.noteBlackDim) : color;
    const x = col.x + 1;
    const w = Math.max(2, col.w - 2);
    const r = Math.min(4, w / 2, h / 2);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
    if (h > 14) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x, y, w, 2);
    }
    if (n.folded) {
      ctx.fillStyle = theme.folded;
      ctx.font = `${Math.min(12, w)}px system-ui`;
      ctx.fillText(n.origPitch > n.pitch ? '⌃' : '⌄', x + w / 2, Math.min(y + h - 6, yBottom - 6));
    }
    if (s.showNoteNames && w >= 14 && h >= 14) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.font = `${Math.min(11, w * 0.7)}px system-ui`;
      ctx.fillText(noteName(n.pitch).replace(/-?\d+$/, ''), x + w / 2, yBottom - 8);
    }
    ctx.globalAlpha = 1;
  }

  private drawKeyboard(s: RenderState, layout: KeyboardLayout, hitY: number, keyboardH: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, hitY, this.width, keyboardH);
    const blackH = keyboardH * 0.62;
    const drawKey = (col: { pitch: number; x: number; w: number; isBlack: boolean }) => {
      const kv = s.keyVisuals.get(col.pitch);
      const h = col.isBlack ? blackH : keyboardH;
      let fill = col.isBlack ? theme.blackKey : theme.whiteKey;
      if (kv) {
        const c = kv.kind === 'wrong' ? theme.wrong : kv.kind === 'perfect' ? theme.perfect : kv.kind === 'great' ? theme.great : kv.kind === 'good' ? theme.good : theme.hitLine;
        fill = c;
      }
      ctx.fillStyle = fill;
      ctx.fillRect(col.x + 0.5, hitY, col.w - 1, h);
      ctx.strokeStyle = theme.keyBorder;
      ctx.strokeRect(col.x + 0.5, hitY + 0.5, col.w - 1, h - 1);
      const isC = col.pitch % 12 === 0;
      if (!col.isBlack && (s.showNames || isC) && col.w >= 12) {
        ctx.fillStyle = kv ? '#000' : isC ? '#333' : '#777';
        ctx.font = `${isC ? 'bold ' : ''}${Math.min(12, col.w * 0.6)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(isC ? noteName(col.pitch) : noteName(col.pitch).replace(/-?\d+$/, ''), col.x + col.w / 2, hitY + keyboardH - 6);
      }
    };
    for (const col of layout.columns.values()) if (!col.isBlack) drawKey(col);
    for (const col of layout.columns.values()) if (col.isBlack) drawKey(col);
    if (s.physical) {
      ctx.strokeStyle = theme.hitLine;
      ctx.lineWidth = 2;
      const l = layout.columns.get(s.physical.low);
      const h = layout.columns.get(s.physical.high);
      if (l && h) ctx.strokeRect(l.x + 1, hitY + 1, h.x + h.w - l.x - 2, keyboardH - 2);
      ctx.lineWidth = 1;
    }
  }

  private drawPopups(s: RenderState, layout: KeyboardLayout, hitY: number): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 18px system-ui';
    for (const p of s.popups) {
      const age = s.time - p.time;
      if (age < 0 || age > POPUP_LIFE) continue;
      const t = age / POPUP_LIFE;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, hitY - 40 - t * 30);
    }
    ctx.globalAlpha = 1;
    void layout;
  }

  private drawHud(s: RenderState, width: number): void {
    const ctx = this.ctx;
    // progress bar
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, 0, width, 3);
    ctx.fillStyle = theme.hitLine;
    ctx.fillRect(0, 0, width * Math.max(0, Math.min(1, s.hud.progress)), 3);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.text;
    ctx.font = 'bold 22px system-ui';
    ctx.fillText(String(s.hud.score), 16, 14);
    ctx.font = '14px system-ui';
    ctx.fillStyle = theme.muted;
    if (s.hud.combo > 0) ctx.fillText(`${s.hud.combo}x combo`, 16, 42);
    ctx.textAlign = 'right';
    ctx.fillStyle = theme.text;
    ctx.font = 'bold 22px system-ui';
    ctx.fillText(`${(s.hud.accuracy * 100).toFixed(1)}%`, width - 16, 14);
    if (s.hud.hint) {
      ctx.font = '13px system-ui';
      ctx.fillStyle = theme.muted;
      ctx.fillText(s.hud.hint, width - 16, 42);
    }
  }
}

export { isBlackKey };
