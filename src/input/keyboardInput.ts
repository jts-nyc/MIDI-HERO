import type { InputEvent } from './normalize.ts';

/**
 * Computer-keyboard fallback: two rows of piano keys.
 *   lower octave:  Z S X D C V G B H N J M  (, = next C)
 *   upper octave:  Q 2 W 3 E R 5 T 6 Y 7 U  (I = next C)
 *   octave shift:  - / =
 */
const LOWER = ['KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM', 'Comma'];
const UPPER = ['KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU', 'KeyI'];
const LOWER_KEYS = 'zsxdcvgbhnjm,';
const UPPER_KEYS = 'q2w3er5t6y7ui';

/** Physical key code for an event; falls back to the printed key when `code` is missing (synthetic events, some virtual keyboards). */
function codeOf(e: KeyboardEvent): string {
  if (e.code) return e.code;
  const k = e.key.toLowerCase();
  let i = LOWER_KEYS.indexOf(k);
  if (i >= 0 && k) return LOWER[i]!;
  i = UPPER_KEYS.indexOf(k);
  if (i >= 0 && k) return UPPER[i]!;
  if (k === '-') return 'Minus';
  if (k === '=') return 'Equal';
  return '';
}

export class KeyboardInput {
  /** MIDI pitch of the lower row's C */
  base = 48;
  onEvent: (ev: InputEvent) => void = () => {};
  onOctaveChange: (base: number) => void = () => {};
  private down = new Map<string, number>();
  private attached = false;

  private pitchFor(code: string): number | null {
    let i = LOWER.indexOf(code);
    if (i >= 0) return this.base + i;
    i = UPPER.indexOf(code);
    if (i >= 0) return this.base + 12 + i;
    return null;
  }

  private keydown = (e: KeyboardEvent): void => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
    const code = codeOf(e);
    if (code === 'Minus' || code === 'Equal') {
      this.base = Math.max(0, Math.min(96, this.base + (code === 'Minus' ? -12 : 12)));
      this.onOctaveChange(this.base);
      return;
    }
    const pitch = this.pitchFor(code);
    if (pitch === null) return;
    if (this.down.has(code)) return; // key already held (repeat without the repeat flag)
    e.preventDefault();
    this.down.set(code, pitch);
    this.onEvent({ type: 'on', pitch, velocity: 90, channel: 0, perfMs: e.timeStamp, source: 'keyboard' });
  };

  private keyup = (e: KeyboardEvent): void => {
    const code = codeOf(e);
    const pitch = this.down.get(code);
    if (pitch === undefined) return;
    this.down.delete(code);
    this.onEvent({ type: 'off', pitch, velocity: 0, channel: 0, perfMs: e.timeStamp, source: 'keyboard' });
  };

  attach(): void {
    if (this.attached) return;
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    this.attached = false;
  }
}
