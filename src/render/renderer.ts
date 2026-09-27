import type { Chart, ChartNote } from '../midi/chart.ts';
import type { BeatLine } from '../midi/parse.ts';
import { fitCanvas } from './canvas.ts';
import { Tint, type FxState } from './fx.ts';
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
  pitch: number;
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

/** The contract between the session and any highway renderer. */
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
  /** effects and meters, filled by the session (see fx.ts) */
  fx: FxState;
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
  star: '#ffd23f',
  multiplier: ['#9aa0b4', '#ffd166', '#3ddc84', '#c77dff'],
  healthGreen: '#3ddc84',
  healthYellow: '#ffd166',
  healthRed: '#ff5c5c',
};

/** Colour of each effect tint, indexed by TintId. */
const TINT_COLOR: readonly string[] = [theme.perfect, theme.great, theme.good, theme.muted, theme.wrong, theme.star];
const TINT_RGB: readonly string[] = ['61,220,132', '79,140,255', '255,209,102', '154,160,180', '255,92,92', '255,210,63'];

const KEYBOARD_FRACTION = 0.18;
const MIN_NOTE_HEIGHT = 6;
const HIT_FADE = 0.15;
const POP_SCALE = 0.6; // a hit gem grows by this much while it fades
const POPUP_LIFE = 0.45;
const PASS_THROUGH = 70; // px a missed note stays visible below the hit line
const MAX_PASSING = 64;
const STREAK_MIN = 3; // the big counter appears from this streak
const TAU = Math.PI * 2;

function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `rgb(${r},${g},${b})`;
}

const NOTE_R_BLACK = shade(theme.noteR, theme.noteBlackDim);
const NOTE_L_BLACK = shade(theme.noteL, theme.noteBlackDim);

/** Text that changes rarely, so the string is built only when the number changes. */
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

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private layout: KeyboardLayout | null = null;
  private layoutKey = '';
  private width = 0;
  private height = 0;
  private cursor = 0;
  private cursorTime = -Infinity;
  /** indices of missed notes that are passing below the hit line this frame */
  private passing = new Int32Array(MAX_PASSING);
  private passingCount = 0;
  /** red flash per key, 0..1, rebuilt every frame from the effects state */
  private keyFlash = new Float32Array(128);
  private gradients = new Map<number, CanvasGradient>();
  private gradientKey = '';
  private bigFont = '';
  private scoreText = new CachedText((v) => String(v));
  private accuracyText = new CachedText((v) => `${(v / 10).toFixed(1)}%`);
  private streakText = new CachedText((v) => String(v));
  private shatterText = new CachedText((v) => String(v));
  private multiplierText = new CachedText((v) => `${v}x`);
  private countdownText = new CachedText((v) => String(v));

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

  /** Gradients are built once per canvas size. */
  private gradient(id: number, make: () => CanvasGradient): CanvasGradient {
    let g = this.gradients.get(id);
    if (!g) this.gradients.set(id, (g = make()));
    return g;
  }

  draw(s: RenderState): void {
    const { width, height } = fitCanvas(this.canvas);
    if (width !== this.width || height !== this.height) {
      this.gradients.clear();
      this.gradientKey = `${width}:${height}`;
    }
    this.width = width;
    this.height = height;
    const ctx = this.ctx;
    const fx = s.fx;
    const layout = this.ensureLayout(s.low, s.high);
    const keyboardH = Math.round(height * KEYBOARD_FRACTION);
    const hitY = height - keyboardH;
    const pps = s.pixelsPerSecond;
    const star = fx.meters.starActive;
    this.bigFont = `bold ${Math.round(Math.min(150, hitY * 0.3))}px system-ui`;

    ctx.fillStyle = theme.highway;
    ctx.fillRect(0, 0, width, hitY);
    if (star) {
      ctx.fillStyle = this.gradient(100, () => {
        const g = ctx.createLinearGradient(0, 0, 0, hitY);
        g.addColorStop(0, 'rgba(255,210,63,0.05)');
        g.addColorStop(1, 'rgba(255,210,63,0.24)');
        return g;
      });
      ctx.fillRect(0, 0, width, hitY);
    }

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
    // Low health: the lane goes dark and red; the notes on top stay bright.
    if (fx.meters.low) {
      const pulse = 0.5 + 0.5 * Math.sin(fx.clock * 5);
      ctx.fillStyle = `rgba(40,0,0,${(0.4 + 0.12 * pulse).toFixed(3)})`;
      ctx.fillRect(0, 0, width, hitY);
    }

    // Beat and bar lines
    const visibleSec = hitY / pps;
    ctx.lineWidth = 1;
    const lines = s.beatLines;
    for (let i = 0; i < lines.length; i++) {
      const b = lines[i]!;
      if (b.time < s.time - 0.1) continue;
      if (b.time > s.time + visibleSec) break;
      const y = Math.round(hitY - (b.time - s.time) * pps) + 0.5;
      ctx.strokeStyle = b.isBar ? (star ? 'rgba(255,210,63,0.4)' : theme.bar) : theme.beat;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    this.drawStreak(fx, width, hitY);

    // Notes (forward-only cursor)
    const notes = s.chart.notes;
    const earliest = s.time - s.chart.maxDuration - 1;
    if (earliest < this.cursorTime) this.cursor = 0;
    while (this.cursor < notes.length && notes[this.cursor]!.time < earliest) this.cursor++;
    this.cursorTime = earliest;
    const until = s.time + visibleSec + 0.5;
    this.passingCount = 0;
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
      if (vis?.state === 'missed' && n.time < s.time && this.passingCount < MAX_PASSING) this.passing[this.passingCount++] = i;
      this.drawNote(n, col, vis, s, hitY, star);
    }

    this.drawHitLine(fx, layout, width, hitY, star);
    this.drawKeyboard(s, layout, hitY, keyboardH);
    this.drawPassing(s, layout, hitY);
    this.drawEffects(fx, layout, hitY);
    this.drawPopups(s, layout, hitY);
    this.drawGlow(fx, width, height);
    this.drawHud(s, width, hitY);
    this.drawCallouts(fx, width, hitY);
    this.drawCountdown(fx, width, hitY);
  }

  private drawNote(
    n: ChartNote,
    col: { x: number; w: number; isBlack: boolean },
    vis: NoteVisual | undefined,
    s: RenderState,
    hitY: number,
    star: boolean,
  ): void {
    const ctx = this.ctx;
    const pps = s.pixelsPerSecond;
    const yTop = hitY - (n.time + n.duration - s.time) * pps;
    const yBottom = hitY - (n.time - s.time) * pps;
    let h = Math.max(MIN_NOTE_HEIGHT, yBottom - yTop);
    let y = yBottom - h;
    if (y > hitY + 40 || y + h < -10) return;
    const missed = vis?.state === 'missed';
    const hit = vis?.state === 'hit';
    const gold = !missed && (star || n.star === true);
    let color: string;
    if (missed) color = theme.noteMissed;
    else if (n.hand === 'L') color = col.isBlack ? NOTE_L_BLACK : theme.noteL;
    else color = col.isBlack ? NOTE_R_BLACK : theme.noteR;
    let x = col.x + 1;
    let w = Math.max(2, col.w - 2);
    let alpha = 1;
    if (hit) {
      // gem pop: the note swells around its head and fades
      const t = Math.max(0, Math.min(1, (s.time - vis!.hitTime) / HIT_FADE));
      alpha = 0.75 * (1 - t);
      const grow = 1 + POP_SCALE * t;
      const head = Math.min(h, w * 1.2);
      const cx = x + w / 2;
      w *= grow;
      h = head * grow;
      x = cx - w / 2;
      y = Math.min(yBottom, hitY) - h / 2 - head / 2;
      color = gold ? theme.star : '#ffffff';
    }
    ctx.globalAlpha = alpha;
    if (gold && !hit) {
      // glow: a soft halo behind the note
      ctx.fillStyle = 'rgba(255,210,63,0.28)';
      ctx.beginPath();
      ctx.roundRect(x - 3, y - 3, w + 6, h + 6, 6);
      ctx.fill();
    }
    ctx.fillStyle = color;
    const r = Math.min(4, w / 2, h / 2);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
    if (gold && !hit) {
      ctx.strokeStyle = theme.star;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    if (h > 14 && !hit) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x, y, w, 2);
    }
    if (n.folded && !hit) {
      ctx.fillStyle = theme.folded;
      ctx.font = w >= 12 ? '12px system-ui' : '9px system-ui';
      ctx.fillText(n.origPitch > n.pitch ? '⌃' : '⌄', x + w / 2, Math.min(y + h - 6, yBottom - 6));
    }
    if (s.showNoteNames && w >= 14 && h >= 14 && !hit) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.font = w >= 16 ? '11px system-ui' : '9px system-ui';
      ctx.fillText(noteName(n.pitch).replace(/-?\d+$/, ''), x + w / 2, yBottom - 8);
    }
    ctx.globalAlpha = 1;
  }

  private drawHitLine(fx: FxState, layout: KeyboardLayout, width: number, hitY: number, star: boolean): void {
    const ctx = this.ctx;
    ctx.fillStyle = star ? theme.star : theme.hitLine;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(0, hitY - 2, width, 3);
    // Shockwaves run along the line from the key that was hit
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

  private drawKeyboard(s: RenderState, layout: KeyboardLayout, hitY: number, keyboardH: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, hitY, this.width, keyboardH);
    const flash = this.keyFlash;
    flash.fill(0);
    const flashes = s.fx.flashes;
    for (let i = 0; i < flashes.length; i++) {
      const f = flashes[i]!;
      if (!f.active || f.pitch < 0 || f.pitch > 127) continue;
      flash[f.pitch] = Math.max(flash[f.pitch]!, 1 - f.age / f.life);
    }
    const blackH = keyboardH * 0.62;
    for (let pass = 0; pass < 2; pass++) {
      for (const col of layout.columns.values()) {
        if (col.isBlack !== (pass === 1)) continue;
        const kv = s.keyVisuals.get(col.pitch);
        const h = col.isBlack ? blackH : keyboardH;
        let fill = col.isBlack ? theme.blackKey : theme.whiteKey;
        if (kv) fill = kv.kind === 'wrong' ? theme.wrong : kv.kind === 'perfect' ? theme.perfect : kv.kind === 'great' ? theme.great : kv.kind === 'good' ? theme.good : theme.hitLine;
        ctx.fillStyle = fill;
        ctx.fillRect(col.x + 0.5, hitY, col.w - 1, h);
        const red = flash[col.pitch]!;
        if (red > 0 && !kv) {
          ctx.globalAlpha = red * 0.85;
          ctx.fillStyle = theme.wrong;
          ctx.fillRect(col.x + 0.5, hitY, col.w - 1, h);
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = theme.keyBorder;
        ctx.strokeRect(col.x + 0.5, hitY + 0.5, col.w - 1, h - 1);
        const isC = col.pitch % 12 === 0;
        if (!col.isBlack && (s.showNames || isC) && col.w >= 12) {
          ctx.fillStyle = kv ? '#000' : isC ? '#333' : '#777';
          ctx.font = isC ? (col.w >= 20 ? 'bold 12px system-ui' : 'bold 9px system-ui') : col.w >= 20 ? '12px system-ui' : '9px system-ui';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          ctx.fillText(isC ? noteName(col.pitch) : noteName(col.pitch).replace(/-?\d+$/, ''), col.x + col.w / 2, hitY + keyboardH - 6);
        }
      }
    }
    if (s.physical) {
      ctx.strokeStyle = theme.hitLine;
      ctx.lineWidth = 2;
      const l = layout.columns.get(s.physical.low);
      const h = layout.columns.get(s.physical.high);
      if (l && h) ctx.strokeRect(l.x + 1, hitY + 1, h.x + h.w - l.x - 2, keyboardH - 2);
      ctx.lineWidth = 1;
    }
  }

  /** Missed notes keep falling through the hit line, grey, and fade over the keys. */
  private drawPassing(s: RenderState, layout: KeyboardLayout, hitY: number): void {
    const ctx = this.ctx;
    const pps = s.pixelsPerSecond;
    ctx.fillStyle = theme.noteMissed;
    for (let k = 0; k < this.passingCount; k++) {
      const n = s.chart.notes[this.passing[k]!]!;
      const col = layout.columns.get(n.pitch);
      if (!col) continue;
      const yBottom = hitY - (n.time - s.time) * pps;
      const h = Math.max(MIN_NOTE_HEIGHT, n.duration * pps);
      const top = Math.max(hitY, yBottom - h);
      const bottom = Math.min(yBottom, hitY + PASS_THROUGH);
      if (bottom <= top) continue;
      ctx.globalAlpha = 0.75 * Math.max(0, 1 - (top - hitY) / PASS_THROUGH);
      ctx.fillRect(col.x + 1, top, Math.max(2, col.w - 2), bottom - top);
    }
    ctx.globalAlpha = 1;
  }

  private drawEffects(fx: FxState, layout: KeyboardLayout, hitY: number): void {
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

  private drawPopups(s: RenderState, layout: KeyboardLayout, hitY: number): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 14px system-ui';
    for (let i = 0; i < s.popups.length; i++) {
      const p = s.popups[i]!;
      const age = s.time - p.time;
      if (age < 0 || age > POPUP_LIFE) continue;
      const col = layout.columns.get(p.pitch);
      if (!col) continue;
      const t = age / POPUP_LIFE;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, col.x + col.w / 2, hitY - 40 - t * 30);
    }
    ctx.globalAlpha = 1;
  }

  /** The big streak counter sits behind the notes; it swells on every hit and breaks apart when the streak ends. */
  private drawStreak(fx: FxState, width: number, hitY: number): void {
    const ctx = this.ctx;
    const st = fx.streak;
    const cx = width / 2;
    const cy = hitY * 0.36;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (st.value >= STREAK_MIN) {
      const scale = 1 + 0.22 * st.pulse;
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
      const drop = t * t * hitY * 0.35;
      for (let side = -1; side <= 1; side += 2) {
        ctx.save();
        ctx.translate(cx + side * t * 50, cy + drop);
        ctx.rotate(side * t * 0.5);
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

  /** Light at the left and right edges: multiplier level-up, star power, or red for a broken streak. */
  private drawGlow(fx: FxState, width: number, height: number): void {
    const g = fx.glow;
    if (g.life <= 0) return;
    const ctx = this.ctx;
    const w = Math.min(120, width * 0.14);
    const rgb = TINT_RGB[g.tint]!;
    ctx.globalAlpha = 1 - g.age / g.life;
    ctx.fillStyle = this.gradient(g.tint * 2, () => {
      const gr = ctx.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, `rgba(${rgb},0.55)`);
      gr.addColorStop(1, `rgba(${rgb},0)`);
      return gr;
    });
    ctx.fillRect(0, 0, w, height);
    ctx.fillStyle = this.gradient(g.tint * 2 + 1, () => {
      const gr = ctx.createLinearGradient(width, 0, width - w, 0);
      gr.addColorStop(0, `rgba(${rgb},0.55)`);
      gr.addColorStop(1, `rgba(${rgb},0)`);
      return gr;
    });
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
    const r = 22 * (1 + 0.25 * m.multiplierPulse);
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
      ctx.globalAlpha = m.starActive || m.starReady ? 0.75 + 0.25 * Math.sin(s.fx.clock * 8) : 0.6;
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
    if (m.low) ctx.globalAlpha = 0.6 + 0.4 * Math.sin(s.fx.clock * 10);
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
      const scale = 0.6 + 0.4 * intro + 0.15 * Math.sin(intro * Math.PI);
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
    const scale = 1.35 - 0.35 * Math.min(1, c.phase * 3);
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

export { isBlackKey, Tint };
