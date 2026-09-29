import type { Chart, ChartNote } from '../midi/chart.ts';
import type { BeatLine } from '../midi/parse.ts';
import type { FxState } from './fx.ts';
import { fitCanvas, MAX_DPR } from './canvas.ts';
import { layoutKeys, noteName, type KeyColumn, type KeyboardLayout } from './layout.ts';
import { PracticeVenueVisuals, supersededPopup, theme, type NoteVisual, type RenderState } from './renderer.ts';

const TOP_SCALE = 0.35;
const HIT_FADE = 0.15;
const POPUP_LIFE = 0.45;
const BAR_PULSE = 0.12;
const PASS_THROUGH = 70;
const STREAK_MIN = 3;
const TAU = Math.PI * 2;
const TINT_COLOR = [theme.perfect, theme.great, theme.good, theme.muted, theme.wrong, theme.star];
const TINT_RGB = ['61,220,132', '79,140,255', '255,209,102', '154,160,180', '255,92,92', '255,210,63'];

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

class CachedText {
  private value = NaN;
  private text = '';
  constructor(private readonly format: (v: number) => string) {}
  get(v: number): string {
    if (v !== this.value) {
      this.value = v;
      this.text = this.format(v);
    }
    return this.text;
  }
}

/** Canvas 2D highway; only consumes the same state as the flat renderer. */
export class PerspectiveRenderer {
  private ctx: CanvasRenderingContext2D;
  private practiceVenue = new PracticeVenueVisuals();
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
  private keyFlash = new Float32Array(128);
  private gradients: CanvasGradient[] = [];
  private starGradient!: CanvasGradient;
  private bigFont = '';
  private scoreText = new CachedText((v) => String(v));
  private accuracyText = new CachedText((v) => `${(v / 10).toFixed(1)}%`);
  private streakText = new CachedText((v) => String(v));
  private shatterText = new CachedText((v) => String(v));
  private multiplierText = new CachedText((v) => `${v}x`);
  private countdownText = new CachedText((v) => String(v));

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
        font: `${col.pitch % 12 === 0 ? 'bold ' : ''}${col.w >= 20 ? 12 : 9}px system-ui` };
      this.columns.push(cached); // layoutKeys puts white keys before black keys.
      this.byPitch[col.pitch] = cached;
    }
    this.rows = new Float64Array(this.hitY + 1);
    for (let y = 0; y <= this.hitY; y++) this.rows[y] = scaleAt(y, this.hitY);
    this.cacheBackground();
    this.cacheGradients();
    this.bigFont = `bold ${Math.round(Math.min(150, this.hitY * 0.3))}px system-ui`;
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

  /** Build every effect gradient on resize, never during a hit or a frame. */
  private cacheGradients(): void {
    const ctx = this.ctx;
    const w = Math.min(120, this.width * 0.14);
    for (let tint = 0; tint < TINT_RGB.length; tint++) {
      const rgb = TINT_RGB[tint]!;
      for (let side = 0; side < 2; side++) {
        const edge = side === 0 ? 0 : this.width;
        const g = ctx.createLinearGradient(edge, 0, edge + (side === 0 ? w : -w), 0);
        g.addColorStop(0, `rgba(${rgb},0.55)`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        this.gradients[tint * 2 + side] = g;
      }
    }
    this.starGradient = ctx.createLinearGradient(0, 0, 0, this.hitY);
    this.starGradient.addColorStop(0, 'rgba(255,210,63,0.05)');
    this.starGradient.addColorStop(1, 'rgba(255,210,63,0.24)');
  }

  draw(s: RenderState): void {
    this.ensureLayout(s);
    this.reduceMotion = this.motion.matches;
    this.practiceVenue.update(s, this.reduceMotion);
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
    if (s.fx.meters.starActive) {
      this.lane(ctx, 0, width);
      ctx.fillStyle = this.starGradient;
      ctx.fill();
    }
    if (s.physical) {
      const left = this.byPitch[s.physical.low];
      const right = this.byPitch[s.physical.high];
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      if (left && left.x > 0) { this.lane(ctx, 0, left.x); ctx.fill(); }
      if (right && right.x + right.w < width) { this.lane(ctx, right.x + right.w, width); ctx.fill(); }
    }
    if (s.fx.meters.low) {
      this.lane(ctx, 0, width);
      ctx.fillStyle = '#280000';
      ctx.globalAlpha = this.reduceMotion ? 0.46 : 0.46 + 0.06 * Math.sin(s.fx.clock * 5);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    this.practiceVenue.drawVenue(ctx, s.fx, width, hitY, TOP_SCALE, this.reduceMotion);
    // Counters use screen coordinates and sit behind the projected notes.
    ctx.restore();
    this.drawStreak(s.fx, width, hitY);
    ctx.save();
    ctx.transform(1, 0, -sway / hitY, 1, sway, 0);
    ctx.beginPath();
    ctx.rect(-4, 0, width + 8, hitY);
    ctx.clip();
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
      if (!col || (vis?.state === 'hit' && vis.hold !== 'holding' && vis.hold !== 'released' && s.time - (vis.holdEnd ?? vis.hitTime) > HIT_FADE) || n.time + n.duration < s.time - 0.5) continue;
      this.drawNote(n, col, vis, s);
    }
    this.practiceVenue.drawLoop(ctx, s, width, hitY, TOP_SCALE);
    ctx.restore();
    ctx.lineWidth = 1;
    this.drawHitLine(s.fx, this.layout!, width, hitY, s.fx.meters.starActive, s.practice?.waiting === true);
    // Keep a passed bar visible above the keyboard for its entire 120 ms pulse.
    if (pulse > 0 && !this.reduceMotion) {
      ctx.fillStyle = theme.text;
      ctx.globalAlpha = 0.16 + 0.5 * pulse;
      const thickness = 2 + 2 * pulse;
      ctx.fillRect(0, hitY - thickness - 2, width, thickness);
      ctx.globalAlpha = 1;
    }
    this.drawKeyboard(s);
    this.drawPassing(s);
    this.drawEffects(s.fx, this.layout!, hitY);
    this.drawPopups(s);
    this.drawGlow(s.fx, width, this.height);
    this.drawHud(s, width, hitY);
    this.practiceVenue.drawHud(ctx, s, width);
    this.drawCallouts(s.fx, width, hitY);
    this.drawCountdown(s.fx, width, hitY);
  }

  /** Rounded trapezoid with each edge projected at its own row. No Path2D allocation. */
  private gem(left: number, right: number, top: number, bottom: number, inset = 0): void {
    const ctx = this.ctx;
    const tl = this.xAt(left, top) - inset;
    const tr = this.xAt(right, top) + inset;
    const bl = this.xAt(left, bottom) - inset;
    const br = this.xAt(right, bottom) + inset;
    const r = Math.max(0, Math.min(4 * this.rowScale(bottom), (tr - tl) / 2, (bottom - top) / 2));
    ctx.beginPath();
    ctx.moveTo(tl + r, top);
    ctx.lineTo(tr - r, top);
    ctx.quadraticCurveTo(tr, top, tr, top + r);
    ctx.lineTo(br, bottom - r);
    ctx.quadraticCurveTo(br, bottom, br - r, bottom);
    ctx.lineTo(bl + r, bottom);
    ctx.quadraticCurveTo(bl, bottom, bl, bottom - r);
    ctx.lineTo(tl, top + r);
    ctx.quadraticCurveTo(tl, top, tl + r, top);
    ctx.closePath();
  }

  private drawNote(n: ChartNote, col: Column, vis: NoteVisual | undefined, s: RenderState): void {
    const ctx = this.ctx;
    const missed = vis?.state === 'missed';
    const hit = vis?.state === 'hit';
    const gold = !missed && (s.fx.meters.starActive || n.star === true);
    if (hit && (vis.hold === 'holding' || vis.hold === 'released')) {
      this.drawHold(n, col, vis, s, gold);
      return;
    }
    const bottom = this.hitY - (n.time - s.time) * s.pixelsPerSecond;
    const h = Math.max(6, n.duration * s.pixelsPerSecond) * this.rowScale(bottom);
    const top = bottom - h;
    if (hit) {
      // A completed hold starts its pop at holdEnd, even when the onset is far below the keys.
      const t = Math.max(0, Math.min(1, (s.time - (vis.holdEnd ?? vis.hitTime)) / HIT_FADE));
      const grow = this.reduceMotion ? 1 : 1 + 0.6 * t;
      // A column narrower than 2px (a canvas laid out tiny or hidden) must not give a negative size.
      const colW = Math.max(2, col.w - 2);
      const head = Math.min(h, colW * 1.2);
      const w = colW * grow;
      const popH = head * grow;
      const y = Math.min(bottom, this.hitY) - popH / 2 - head / 2;
      ctx.globalAlpha = 0.75 * (1 - t);
      ctx.fillStyle = gold ? theme.star : '#ffffff';
      ctx.beginPath();
      ctx.roundRect(col.x + col.w / 2 - w / 2, y, w, popH, Math.max(0, Math.min(4, w / 2, popH / 2)));
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    if (top > this.hitY || bottom < 0) return;
    if (gold) {
      this.gem(col.x + 1, col.x + col.w - 1, top - 3, bottom + 3, 3 * this.rowScale(bottom));
      ctx.fillStyle = 'rgba(255,210,63,0.28)';
      ctx.fill();
    }
    this.gem(col.x + 1, col.x + col.w - 1, top, bottom);
    ctx.fillStyle = missed ? theme.noteMissed : gold ? theme.star : n.hand === 'L' ?
      (col.isBlack ? BLACK_L : theme.noteL) : (col.isBlack ? BLACK_R : theme.noteR);
    ctx.fill();
    const left = this.xAt(col.x + 1, top);
    const right = this.xAt(col.x + col.w - 1, top);
    const r = Math.min(4 * this.rowScale(bottom), (right - left) / 2, h / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(left + r, top, Math.max(0, right - left - 2 * r), Math.min(h / 2, 2 * this.rowScale(top)));
    const baseW = (col.w - 2) * this.rowScale(bottom);
    const center = this.xAt(col.x + col.w / 2, bottom);
    if (n.folded) {
      ctx.fillStyle = theme.folded;
      ctx.font = FONTS[Math.max(1, Math.floor(Math.min(12, baseW)))]!;
      ctx.fillText(n.origPitch > n.pitch ? '⌃' : '⌄', center, bottom - Math.min(h / 2, 6));
    }
    if (s.showNoteNames && baseW >= 14 && h >= 14) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.font = FONTS[Math.floor(Math.min(11, baseW * 0.7))]!;
      ctx.fillText(col.shortName, center, bottom - 8);
    }
  }

  private drawHold(n: ChartNote, col: Column, vis: NoteVisual, s: RenderState, gold: boolean): void {
    const ctx = this.ctx;
    const top = Math.max(-10, this.hitY - (n.time + n.duration - s.time) * s.pixelsPerSecond);
    if (top >= this.hitY) return;
    const left = col.x + 1;
    const right = col.x + col.w - 1;
    const w = right - left;
    if (vis.hold === 'released') {
      this.gem(left + w * 0.2, right - w * 0.2, top, this.hitY);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = theme.noteMissed;
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    this.gem(left, right, top - 3, this.hitY, 3);
    ctx.fillStyle = gold ? 'rgba(255,210,63,0.3)' : 'rgba(255,255,255,0.22)';
    ctx.globalAlpha = this.reduceMotion ? 0.8 : 0.8 + 0.2 * Math.sin(s.fx.clock * 14);
    ctx.fill();
    ctx.globalAlpha = 1;
    this.gem(left, right, top, this.hitY);
    ctx.fillStyle = gold ? theme.star : n.hand === 'L' ? theme.noteL : theme.noteR;
    ctx.fill();
    this.gem(left + w * 0.35, right - w * 0.35, top, this.hitY);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill();
    const progress = Math.max(0, Math.min(1, (s.time - n.time) / n.duration));
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(col.x, this.hitY - 7, col.w, 6);
    ctx.fillStyle = gold ? theme.star : theme.perfect;
    ctx.fillRect(col.x, this.hitY - 7, col.w * progress, 6);
  }

  /** Redraw only the portion below the hit line, over the flat keyboard. */
  private drawPassing(s: RenderState): void {
    const ctx = this.ctx;
    ctx.fillStyle = theme.noteMissed;
    for (let i = this.cursor; i < s.chart.notes.length; i++) {
      const n = s.chart.notes[i]!;
      if (n.time >= s.time) break;
      if (s.noteVisuals[i]?.state !== 'missed') continue;
      const col = this.byPitch[n.pitch];
      if (!col) continue;
      const bottom = this.hitY + (s.time - n.time) * s.pixelsPerSecond;
      const top = Math.max(this.hitY, bottom - Math.max(6, n.duration * s.pixelsPerSecond));
      const end = Math.min(bottom, this.hitY + PASS_THROUGH);
      if (end <= top) continue;
      ctx.globalAlpha = 0.75 * Math.max(0, 1 - (top - this.hitY) / PASS_THROUGH);
      ctx.fillRect(col.x + 1, top, col.w - 2, end - top);
    }
    ctx.globalAlpha = 1;
  }

  private drawKeyboard(s: RenderState): void {
    const ctx = this.ctx;
    const hitY = this.hitY;
    const keyboardH = this.keyboardH;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, hitY, this.width, keyboardH);
    this.keyFlash.fill(0);
    for (let i = 0; i < s.fx.flashes.length; i++) {
      const f = s.fx.flashes[i]!;
      if (!f.active || f.pitch < 0 || f.pitch > 127) continue;
      this.keyFlash[f.pitch] = Math.max(this.keyFlash[f.pitch]!, 1 - f.age / f.life);
    }
    for (let i = 0; i < this.columns.length; i++) {
      const col = this.columns[i]!;
      const kv = s.keyVisuals.get(col.pitch);
      const h = col.isBlack ? keyboardH * 0.62 : keyboardH;
      ctx.fillStyle = kv ? (kv.kind === 'wrong' ? theme.wrong : kv.kind === 'perfect' ? theme.perfect :
        kv.kind === 'great' ? theme.great : kv.kind === 'good' ? theme.good : theme.hitLine) : col.isBlack ? theme.blackKey : theme.whiteKey;
      ctx.fillRect(col.x + 0.5, hitY, col.w - 1, h);
      const red = this.keyFlash[col.pitch]!;
      if (red > 0 && !kv) {
        ctx.globalAlpha = red * 0.85;
        ctx.fillStyle = theme.wrong;
        ctx.fillRect(col.x + 0.5, hitY, col.w - 1, h);
        ctx.globalAlpha = 1;
      }
      this.practiceVenue.drawKey(ctx, col.pitch, col.x + 0.5, hitY, col.w - 1, h);
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
    ctx.font = 'bold 14px system-ui';
    const xOf = (pitch: number) => { const c = this.byPitch[pitch]; return c ? c.x + c.w / 2 : undefined; };
    for (let i = 0; i < s.popups.length; i++) {
      const p = s.popups[i]!;
      const age = s.time - p.time;
      const col = this.byPitch[p.pitch];
      if (age < 0 || age > POPUP_LIFE || !col || supersededPopup(s.popups, i, xOf, s.time)) continue;
      const t = age / POPUP_LIFE;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, col.x + col.w / 2, this.hitY - 40 - (this.reduceMotion ? 0 : t * 30));
    }
    ctx.globalAlpha = 1;
  }

  private drawHitLine(fx: FxState, layout: KeyboardLayout, width: number, hitY: number, star: boolean, waiting: boolean): void {
    const ctx = this.ctx;
    ctx.fillStyle = waiting ? '#54e4e8' : star ? theme.star : theme.hitLine;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(0, hitY - 2, width, 3);
    // Shockwaves run along the line from the key that was hit
    if (this.reduceMotion) { ctx.globalAlpha = 1; return; }
    const shocks = fx.shocks;
    for (let i = 0; i < shocks.length; i++) {
      const k = shocks[i]!;
      if (!k.active) continue;
      const col = layout.columns.get(k.pitch);
      if (!col) continue;
      const t = k.age / k.life;
      const cx = col.x + col.w / 2;
      const reach = (0.08 + 0.5 * t) * width;
      const len = width * 0.12 * (1 - t) + 6;
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.fillStyle = TINT_COLOR[k.tint]!;
      ctx.fillRect(cx + reach - len, hitY - 4, len, 7);
      ctx.fillRect(cx - reach, hitY - 4, len, 7);
    }
    ctx.globalAlpha = 1;
  }

  private drawEffects(fx: FxState, layout: KeyboardLayout, hitY: number): void {
    if (this.reduceMotion) return;
    const ctx = this.ctx;
    const rings = fx.rings;
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i]!;
      if (!r.active) continue;
      const col = layout.columns.get(r.pitch);
      if (!col) continue;
      const t = r.age / r.life;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = TINT_COLOR[r.tint]!;
      ctx.lineWidth = 1 + 3 * (1 - t);
      ctx.beginPath();
      ctx.arc(col.x + col.w / 2, hitY, (0.3 + 0.7 * t) * r.radius * layout.whiteWidth, 0, TAU);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    ctx.globalCompositeOperation = 'lighter';
    const particles = fx.particles;
    let tint = -1;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]!;
      if (!p.active) continue;
      const col = layout.columns.get(p.pitch);
      if (!col) continue;
      if (p.tint !== tint) {
        tint = p.tint;
        ctx.fillStyle = TINT_COLOR[tint]!;
      }
      ctx.globalAlpha = 1 - p.age / p.life;
      ctx.fillRect(col.x + col.w / 2 + p.x - p.size / 2, hitY + p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  private drawStreak(fx: FxState, width: number, hitY: number): void {
    const ctx = this.ctx;
    const st = fx.streak;
    const cx = width / 2;
    const cy = hitY * 0.36;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (st.value >= STREAK_MIN) {
      const scale = this.reduceMotion ? 1 : 1 + 0.22 * st.pulse;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.font = this.bigFont;
      ctx.globalAlpha = 0.2 + 0.25 * st.pulse;
      ctx.fillStyle = fx.meters.starActive ? theme.star : theme.multiplier[Math.min(3, fx.meters.multiplier - 1)]!;
      ctx.fillText(this.streakText.get(st.value), 0, 0);
      ctx.restore();
      ctx.font = 'bold 13px system-ui';
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = theme.text;
      ctx.fillText('NOTE STREAK', cx, cy + hitY * 0.19);
    }
    if (st.shatterLife > 0) {
      const t = st.shatterAge / st.shatterLife;
      const text = this.shatterText.get(st.shatterValue);
      const half = width / 2;
      const drop = this.reduceMotion ? 0 : t * t * hitY * 0.35;
      for (let side = -1; side <= 1; side += 2) {
        ctx.save();
        ctx.translate(cx + (this.reduceMotion ? 0 : side * t * 50), cy + drop);
        ctx.rotate(this.reduceMotion ? 0 : side * t * 0.5);
        ctx.beginPath();
        if (side < 0) ctx.rect(-half, -hitY, half, hitY * 2);
        else ctx.rect(0, -hitY, half, hitY * 2);
        ctx.clip();
        ctx.font = this.bigFont;
        ctx.globalAlpha = 0.7 * (1 - t);
        ctx.fillStyle = theme.wrong;
        ctx.fillText(text, 0, 0);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawGlow(fx: FxState, width: number, height: number): void {
    const g = fx.glow;
    if (g.life <= 0) return;
    const ctx = this.ctx;
    const w = Math.min(120, width * 0.14);
    ctx.globalAlpha = 1 - g.age / g.life;
    ctx.fillStyle = this.gradients[g.tint * 2]!;
    ctx.fillRect(0, 0, w, height);
    ctx.fillStyle = this.gradients[g.tint * 2 + 1]!;
    ctx.fillRect(width - w, 0, w, height);
    ctx.globalAlpha = 1;
  }

  private drawHud(s: RenderState, width: number, hitY: number): void {
    const ctx = this.ctx;
    const m = s.fx.meters;
    // progress bar
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, 0, width, 3);
    ctx.fillStyle = theme.hitLine;
    ctx.fillRect(0, 0, width * Math.max(0, Math.min(1, s.hud.progress)), 3);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.text;
    ctx.font = 'bold 22px system-ui';
    ctx.fillText(this.scoreText.get(s.hud.score), 16, 14);
    ctx.textAlign = 'right';
    ctx.fillText(this.accuracyText.get(Math.round(s.hud.accuracy * 1000)), width - 16, 14);
    if (s.hud.hint) {
      ctx.font = '13px system-ui';
      ctx.fillStyle = theme.muted;
      ctx.fillText(s.hud.hint, width - 16, 42);
    }

    // Multiplier: a radial meter that fills toward the next level, with the level as its badge
    const shown = m.starActive ? m.multiplier * 2 : m.multiplier;
    const color = m.starActive ? theme.star : theme.multiplier[Math.min(3, m.multiplier - 1)]!;
    const cx = 42;
    const cy = 78;
    const r = 22 * (1 + (this.reduceMotion ? 0 : 0.25 * m.multiplierPulse));
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.stroke();
    if (m.multiplierProgress > 0) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, m.multiplierProgress));
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    ctx.fillStyle = color;
    ctx.font = 'bold 18px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.multiplierText.get(shown), cx, cy + 1);

    // Star gauge: fills a quarter per clean star phrase; the notch marks where it can be switched on
    if (m.starGauge > 0 || m.starActive) {
      const gx = 78;
      const gy = 72;
      const gw = Math.min(150, width * 0.2);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(gx, gy, gw, 10);
      ctx.fillStyle = theme.star;
      ctx.globalAlpha = !this.reduceMotion && (m.starActive || m.starReady) ? 0.75 + 0.25 * Math.sin(s.fx.clock * 8) : 0.6;
      ctx.fillRect(gx, gy, gw * Math.min(1, m.starGauge), 10);
      ctx.globalAlpha = 1;
      ctx.fillStyle = theme.text;
      ctx.fillRect(gx + gw / 2 - 1, gy - 2, 2, 14);
      if (m.starReady && !m.starActive) {
        ctx.font = 'bold 11px system-ui';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = theme.star;
        ctx.fillText('PEDAL or SPACE', gx, gy + 14);
      }
    }

    // Health: a traffic light at the side
    const hx = width - 20;
    const top = 70;
    const hh = Math.max(40, hitY - top - 24);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(hx, top, 8, hh);
    const fillH = hh * Math.max(0, Math.min(1, m.health));
    ctx.fillStyle = m.zone === 'green' ? theme.healthGreen : m.zone === 'yellow' ? theme.healthYellow : theme.healthRed;
    if (m.low && !this.reduceMotion) ctx.globalAlpha = 0.6 + 0.4 * Math.sin(s.fx.clock * 10);
    ctx.fillRect(hx, top + hh - fillH, 8, fillH);
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.text;
    ctx.fillRect(hx - 3, top + hh * 0.7, 14, 1); // 30%: below this the band thins out
  }

  private drawCallouts(fx: FxState, width: number, hitY: number): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let row = 0;
    for (let i = 0; i < fx.callouts.length; i++) {
      const c = fx.callouts[i]!;
      if (!c.active) continue;
      const t = c.age / c.life;
      const intro = Math.min(1, c.age / 0.18);
      const scale = this.reduceMotion ? 1 : 0.6 + 0.4 * intro + 0.15 * Math.sin(intro * Math.PI);
      ctx.save();
      ctx.translate(width / 2, hitY * 0.14 + row * 44);
      ctx.scale(scale, scale);
      ctx.globalAlpha = t < 0.7 ? 1 : Math.max(0, 1 - (t - 0.7) / 0.3);
      ctx.font = 'bold 34px system-ui';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(c.text, 0, 0);
      ctx.fillStyle = c.kind === 'break' || c.kind === 'fail' ? theme.wrong : theme.star;
      ctx.fillText(c.text, 0, 0);
      ctx.restore();
      row++;
    }
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
  }

  private drawCountdown(fx: FxState, width: number, hitY: number): void {
    const c = fx.countdown;
    if (c.value <= 0) return;
    const ctx = this.ctx;
    const scale = this.reduceMotion ? 1 : 1.35 - 0.35 * Math.min(1, c.phase * 3);
    ctx.save();
    ctx.translate(width / 2, hitY * 0.5);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = this.bigFont;
    ctx.globalAlpha = Math.max(0.15, 1 - c.phase * 0.85);
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.strokeText(this.countdownText.get(c.value), 0, 0);
    ctx.fillStyle = theme.text;
    ctx.fillText(this.countdownText.get(c.value), 0, 0);
    ctx.restore();
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
  }
}
