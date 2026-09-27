import type { Chart, ChartNote } from '../midi/chart.ts';
import type { BeatLine } from '../midi/parse.ts';
import { fitCanvas, MAX_DPR } from './canvas.ts';
import { layoutKeys, noteName, type KeyColumn, type KeyboardLayout } from './layout.ts';
import { theme, type NoteVisual, type RenderState } from './renderer.ts';

const TOP_SCALE = 0.35;
const HIT_FADE = 0.15;
const POPUP_LIFE = 0.45;
const BAR_PULSE = 0.12;

/** CSS-pixel projection, clamped at the horizon and keyboard. */
export function scaleAt(y: number, hitY: number): number {
  return TOP_SCALE + (1 - TOP_SCALE) * Math.max(0, Math.min(1, y / Math.max(1, hitY)));
}

export function projectX(x: number, y: number, width: number, hitY: number): number {
  return width / 2 + (x - width / 2) * scaleAt(y, hitY);
}

function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${Math.round(((n >> 16) & 255) * theme.noteBlackDim)},${Math.round(((n >> 8) & 255) * theme.noteBlackDim)},${Math.round((n & 255) * theme.noteBlackDim)})`;
}
const BLACK_R = shade(theme.noteR);
const BLACK_L = shade(theme.noteL);
// Fonts and labels are shared by every frame, including notes at fractional row positions.
const FONTS = Array.from({ length: 13 }, (_, i) => `${i}px system-ui`);

interface Column extends KeyColumn {
  label: string;
  shortName: string;
  font: string;
}

/** Canvas 2D highway; only consumes the same state as the flat renderer. */
export class PerspectiveRenderer {
  private ctx: CanvasRenderingContext2D;
  private background: HTMLCanvasElement;
  private motion: MediaQueryList;
  private reduceMotion: boolean;
  private layout: KeyboardLayout | null = null;
  private columns: Column[] = [];
  private byPitch: (Column | undefined)[] = [];
  private rows = new Float64Array(0);
  private width = 0;
  private height = 0;
  private dpr = 0;
  private hitY = 0;
  private keyboardH = 0;
  private chart: Chart | null = null;
  private cursor = 0;
  private cursorTime = -Infinity;
  private beats: BeatLine[] | null = null;
  private beatCursor = 0;
  private beatTime = -Infinity;
  private score = NaN;
  private combo = NaN;
  private accuracy = NaN;
  private scoreText = '';
  private comboText = '';
  private accuracyText = '';

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.background = document.createElement('canvas');
    this.motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reduceMotion = this.motion.matches;
  }

  private ensureLayout(s: RenderState): void {
    const width = Math.max(1, Math.floor(this.canvas.clientWidth));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight));
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    if (this.layout && this.layout.low === s.low && this.layout.high === s.high &&
        width === this.width && height === this.height && dpr === this.dpr &&
        this.canvas.width === Math.round(width * dpr) && this.canvas.height === Math.round(height * dpr)) return;
    // fitCanvas returns a size object, so call it only when sizing changes.
    fitCanvas(this.canvas);
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.keyboardH = Math.round(height * 0.18);
    this.hitY = height - this.keyboardH;
    this.layout = layoutKeys(s.low, s.high, width);
    this.columns = [];
    this.byPitch = [];
    for (const col of this.layout.columns.values()) {
      const label = noteName(col.pitch);
      const cached = { ...col, label, shortName: label.replace(/-?\d+$/, ''),
        font: `${col.pitch % 12 === 0 ? 'bold ' : ''}${Math.min(12, col.w * 0.6)}px system-ui` };
      this.columns.push(cached); // layoutKeys puts white keys before black keys.
      this.byPitch[col.pitch] = cached;
    }
    this.rows = new Float64Array(this.hitY + 1);
    for (let y = 0; y <= this.hitY; y++) this.rows[y] = scaleAt(y, this.hitY);
    this.cacheBackground();
  }

  private rowScale(y: number): number {
    const row = Math.max(0, Math.min(this.hitY, y));
    const i = Math.floor(row);
    const a = this.rows[i]!;
    return i === this.hitY ? a : a + (this.rows[i + 1]! - a) * (row - i);
  }

  private xAt(x: number, y: number): number {
    return this.width / 2 + (x - this.width / 2) * this.rowScale(y);
  }

  private lane(ctx: CanvasRenderingContext2D, left: number, right: number): void {
    ctx.beginPath();
    ctx.moveTo(this.xAt(left, 0), 0);
    ctx.lineTo(this.xAt(right, 0), 0);
    ctx.lineTo(right, this.hitY);
    ctx.lineTo(left, this.hitY);
    ctx.closePath();
  }

  private cacheBackground(): void {
    const ctx = this.background.getContext('2d')!;
    this.background.width = Math.round(this.width * this.dpr);
    this.background.height = Math.round(this.hitY * this.dpr);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.lane(ctx, 0, this.width);
    const tint = ctx.createLinearGradient(0, 0, 0, this.hitY);
    tint.addColorStop(0, '#090b12');
    tint.addColorStop(1, theme.highway);
    ctx.fillStyle = tint;
    ctx.fill();
    for (let i = 0; i < this.columns.length; i++) {
      const col = this.columns[i]!;
      this.lane(ctx, col.x, col.x + col.w);
      ctx.fillStyle = col.isBlack ? 'rgba(0,0,0,0.22)' :
        Math.floor(col.pitch / 12) % 2 === 0 ? theme.octaveStripe : 'rgba(255,255,255,0.01)';
      ctx.fill();
      ctx.strokeStyle = col.isBlack ? 'rgba(155,173,219,0.10)' : 'rgba(155,173,219,0.20)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  draw(s: RenderState): void {
    this.ensureLayout(s);
    this.reduceMotion = this.motion.matches;
    const ctx = this.ctx;
    const hitY = this.hitY;
    const width = this.width;
    const visibleSec = hitY / s.pixelsPerSecond;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, width, this.height);

    if (this.beats !== s.beatLines || s.time < this.beatTime) this.beatCursor = 0;
    this.beats = s.beatLines;
    this.beatTime = s.time;
    while (this.beatCursor < s.beatLines.length && s.beatLines[this.beatCursor]!.time < s.time - BAR_PULSE) this.beatCursor++;
    let pulse = 0;
    let sway = 0;
    for (let i = this.beatCursor; i < s.beatLines.length; i++) {
      const b = s.beatLines[i]!;
      if (b.time > s.time) break;
      if (!b.isBar) continue;
      const age = (s.time - b.time) / BAR_PULSE;
      pulse = 1 - age;
      if (!this.reduceMotion) sway = Math.sin(age * Math.PI * 2) * 4 * pulse;
    }

    ctx.save();
    // Sway recedes to zero at the base so every note still lands exactly on its key.
    ctx.transform(1, 0, -sway / hitY, 1, sway, 0);
    ctx.beginPath();
    ctx.rect(-4, 0, width + 8, hitY);
    ctx.clip();
    ctx.drawImage(this.background, 0, 0, width, hitY);
    if (s.physical) {
      const left = this.byPitch[s.physical.low];
      const right = this.byPitch[s.physical.high];
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      if (left && left.x > 0) { this.lane(ctx, 0, left.x); ctx.fill(); }
      if (right && right.x + right.w < width) { this.lane(ctx, right.x + right.w, width); ctx.fill(); }
    }
    for (let i = this.beatCursor; i < s.beatLines.length; i++) {
      const b = s.beatLines[i]!;
      if (b.time > s.time + visibleSec) break;
      if (b.time < s.time) continue;
      const y = hitY - (b.time - s.time) * s.pixelsPerSecond;
      ctx.lineWidth = b.isBar ? 2 : 1;
      ctx.strokeStyle = b.isBar ? theme.bar : theme.beat;
      ctx.beginPath();
      ctx.moveTo(this.xAt(0, y), y);
      ctx.lineTo(this.xAt(width, y), y);
      ctx.stroke();
    }
    const notes = s.chart.notes;
    const earliest = s.time - s.chart.maxDuration - 1;
    if (this.chart !== s.chart || earliest < this.cursorTime) this.cursor = 0;
    this.chart = s.chart;
    while (this.cursor < notes.length && notes[this.cursor]!.time < earliest) this.cursor++;
    this.cursorTime = earliest;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = this.cursor; i < notes.length; i++) {
      const n = notes[i]!;
      if (n.time > s.time + visibleSec + 0.5) break;
      const vis = s.noteVisuals[i];
      const col = this.byPitch[n.pitch];
      if (!col || (vis?.state === 'hit' && s.time - vis.hitTime > HIT_FADE) || n.time + n.duration < s.time - 0.5) continue;
      this.drawNote(n, col, vis, s);
    }
    ctx.restore();
    ctx.lineWidth = 1;
    ctx.fillStyle = theme.hitLine;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(0, hitY - 2, width, 3);
    ctx.globalAlpha = 1;
    // Keep a passed bar visible above the keyboard for its entire 120 ms pulse.
    if (pulse > 0) {
      ctx.fillStyle = theme.text;
      ctx.globalAlpha = 0.16 + 0.5 * pulse;
      const thickness = 2 + 2 * pulse;
      ctx.fillRect(0, hitY - thickness - 2, width, thickness);
      ctx.globalAlpha = 1;
    }
    this.drawKeyboard(s);
    this.drawPopups(s);
    this.drawHud(s);
  }

  private drawNote(n: ChartNote, col: Column, vis: NoteVisual | undefined, s: RenderState): void {
    const ctx = this.ctx;
    const bottom = this.hitY - (n.time - s.time) * s.pixelsPerSecond;
    const h = Math.max(6, n.duration * s.pixelsPerSecond) * this.rowScale(bottom);
    const top = bottom - h;
    if (top > this.hitY + 40 || bottom < 0) return;
    const left = this.xAt(col.x + 1, top);
    const right = this.xAt(col.x + col.w - 1, top);
    const baseLeft = this.xAt(col.x + 1, bottom);
    const baseRight = this.xAt(col.x + col.w - 1, bottom);
    const w = right - left;
    const r = Math.min(4 * this.rowScale(bottom), w / 2, h / 2);
    ctx.globalAlpha = vis?.state === 'hit' ? Math.max(0, Math.min(1, 1 - (s.time - vis.hitTime) / HIT_FADE)) : 1;
    ctx.fillStyle = vis?.state === 'missed' ? theme.noteMissed : n.hand === 'L' ?
      (col.isBlack ? BLACK_L : theme.noteL) : (col.isBlack ? BLACK_R : theme.noteR);
    // One reusable context path, with separately projected tail and onset corners.
    ctx.beginPath();
    ctx.moveTo(left + r, top);
    ctx.lineTo(right - r, top);
    ctx.quadraticCurveTo(right, top, right, top + r);
    ctx.lineTo(baseRight, bottom - r);
    ctx.quadraticCurveTo(baseRight, bottom, baseRight - r, bottom);
    ctx.lineTo(baseLeft + r, bottom);
    ctx.quadraticCurveTo(baseLeft, bottom, baseLeft, bottom - r);
    ctx.lineTo(left, top + r);
    ctx.quadraticCurveTo(left, top, left + r, top);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(left + r, top, Math.max(0, w - 2 * r), Math.min(h / 2, 2 * this.rowScale(top)));
    const baseW = baseRight - baseLeft;
    if (n.folded) {
      ctx.fillStyle = theme.folded;
      ctx.font = FONTS[Math.max(1, Math.floor(Math.min(12, baseW)))]!;
      ctx.fillText(n.origPitch > n.pitch ? '⌃' : '⌄', (baseLeft + baseRight) / 2, bottom - Math.min(h / 2, 6));
    }
    if (s.showNoteNames && baseW >= 14 && h >= 14) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.font = FONTS[Math.floor(Math.min(11, baseW * 0.7))]!;
      ctx.fillText(col.shortName, (baseLeft + baseRight) / 2, bottom - 8);
    }
    ctx.globalAlpha = 1;
  }

  private drawKeyboard(s: RenderState): void {
    const ctx = this.ctx;
    const hitY = this.hitY;
    const keyboardH = this.keyboardH;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, hitY, this.width, keyboardH);
    for (let i = 0; i < this.columns.length; i++) {
      const col = this.columns[i]!;
      const kv = s.keyVisuals.get(col.pitch);
      const h = col.isBlack ? keyboardH * 0.62 : keyboardH;
      ctx.fillStyle = kv ? (kv.kind === 'wrong' ? theme.wrong : kv.kind === 'perfect' ? theme.perfect :
        kv.kind === 'great' ? theme.great : kv.kind === 'good' ? theme.good : theme.hitLine) : col.isBlack ? theme.blackKey : theme.whiteKey;
      ctx.fillRect(col.x + 0.5, hitY, col.w - 1, h);
      ctx.strokeStyle = theme.keyBorder;
      ctx.strokeRect(col.x + 0.5, hitY + 0.5, col.w - 1, h - 1);
      const isC = col.pitch % 12 === 0;
      if (!col.isBlack && (s.showNames || isC) && col.w >= 12) {
        ctx.fillStyle = kv ? '#000' : isC ? '#333' : '#777';
        ctx.font = col.font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(isC ? col.label : col.shortName, col.x + col.w / 2, hitY + keyboardH - 6);
      }
    }
    if (s.physical) {
      const left = this.byPitch[s.physical.low];
      const right = this.byPitch[s.physical.high];
      ctx.strokeStyle = theme.hitLine;
      ctx.lineWidth = 2;
      if (left && right) ctx.strokeRect(left.x + 1, hitY + 1, right.x + right.w - left.x - 2, keyboardH - 2);
      ctx.lineWidth = 1;
    }
  }

  private drawPopups(s: RenderState): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 18px system-ui';
    for (let i = 0; i < s.popups.length; i++) {
      const p = s.popups[i]!;
      const age = s.time - p.time;
      const col = this.byPitch[p.pitch];
      if (age < 0 || age > POPUP_LIFE || !col) continue;
      const t = age / POPUP_LIFE;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, col.x + col.w / 2, this.hitY - 40 - t * 30);
    }
    ctx.globalAlpha = 1;
  }

  private drawHud(s: RenderState): void {
    const ctx = this.ctx;
    const width = this.width;
    // Only format text when its value changes; stable frames allocate no JS objects.
    if (s.hud.score !== this.score) { this.score = s.hud.score; this.scoreText = String(this.score); }
    if (s.hud.combo !== this.combo) { this.combo = s.hud.combo; this.comboText = `${this.combo}x combo`; }
    if (s.hud.accuracy !== this.accuracy) { this.accuracy = s.hud.accuracy; this.accuracyText = `${(this.accuracy * 100).toFixed(1)}%`; }
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, 0, width, 3);
    ctx.fillStyle = theme.hitLine;
    ctx.fillRect(0, 0, width * Math.max(0, Math.min(1, s.hud.progress)), 3);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.text;
    ctx.font = 'bold 22px system-ui';
    ctx.fillText(this.scoreText, 16, 14);
    ctx.font = '14px system-ui';
    ctx.fillStyle = theme.muted;
    if (s.hud.combo > 0) ctx.fillText(this.comboText, 16, 42);
    ctx.textAlign = 'right';
    ctx.fillStyle = theme.text;
    ctx.font = 'bold 22px system-ui';
    ctx.fillText(this.accuracyText, width - 16, 14);
    if (s.hud.hint) {
      ctx.font = '13px system-ui';
      ctx.fillStyle = theme.muted;
      ctx.fillText(s.hud.hint, width - 16, 42);
    }
  }
}
