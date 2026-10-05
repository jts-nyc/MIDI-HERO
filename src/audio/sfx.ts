/**
 * Small synthesised cues: menu clicks, star power, milestones, the results stars. Short and
 * quiet on purpose (well under the music and the player's own notes); nothing is loaded, every
 * sound is a few oscillators that stop themselves. See docs/FEEL.md for the list and levels.
 */

export type SfxCue =
  /** a button in a menu */
  | 'tick'
  /** a star phrase was played clean */
  | 'starPhrase'
  /** star power switched on */
  | 'starOn'
  /** "25 NOTE STREAK!" */
  | 'milestone'
  /** the multiplier rose */
  | 'level'
  /** a streak of 10 or more broke (Hard and Expert only; see session.ts) */
  | 'break'
  /** results: the next star lands */
  | 'star'
  /** results: a new best */
  | 'fanfare';

/** Loudness of the whole cue bus against the synth's 0.8 master. */
export const SFX_GAIN = 0.3;

/** A note in the cue's melody: semitones above A4, start (s), length (s), peak gain, waveform. */
interface Tone {
  semis: number;
  at: number;
  len: number;
  peak: number;
  type: OscillatorType;
}

const tone = (semis: number, at: number, len: number, peak: number, type: OscillatorType = 'sine'): Tone => ({ semis, at, len, peak, type });

/** The tones of each cue (the ones made of plain tones; starOn and break add a sweep). */
export const CUE_TONES: Record<Exclude<SfxCue, 'star'>, Tone[]> = {
  tick: [tone(27, 0, 0.03, 0.12)],
  starPhrase: [tone(24, 0, 0.09, 0.2, 'triangle'), tone(28, 0.06, 0.09, 0.2, 'triangle'), tone(31, 0.12, 0.16, 0.2, 'triangle')],
  starOn: [tone(15, 0.18, 0.4, 0.18, 'triangle'), tone(19, 0.18, 0.4, 0.14, 'triangle'), tone(22, 0.18, 0.45, 0.14, 'triangle'), tone(27, 0.22, 0.5, 0.12)],
  milestone: [tone(19, 0, 0.08, 0.2, 'triangle'), tone(26, 0.07, 0.16, 0.2, 'triangle')],
  level: [tone(14, 0, 0.07, 0.16, 'triangle'), tone(21, 0.05, 0.12, 0.16, 'triangle')],
  break: [],
  fanfare: [tone(3, 0, 0.12, 0.2, 'triangle'), tone(7, 0.1, 0.12, 0.2, 'triangle'), tone(10, 0.2, 0.12, 0.2, 'triangle'), tone(15, 0.3, 0.45, 0.22, 'triangle')],
};

/** The results stars ring a rising pentatonic bell: C6 D6 E6 G6 A6. */
export const STAR_STEPS = [15, 17, 19, 22, 24] as const;

/** Audio-context subset the cues need, for tests. */
export type SfxContext = Pick<BaseAudioContext, 'currentTime' | 'destination' | 'createGain' | 'createOscillator' | 'createBiquadFilter'>;

export class Sfx {
  enabled = true;
  private bus: GainNode;
  /** the last time each cue started, so a burst of events makes one sound */
  private last = new Map<string, number>();

  constructor(private readonly ctx: SfxContext) {
    this.bus = ctx.createGain();
    this.bus.gain.value = SFX_GAIN;
    this.bus.connect(ctx.destination);
  }

  /** Play a cue now. `step` picks the results star (0..4). */
  play(cue: SfxCue, step = 0): void {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const key = cue === 'star' ? `star${step}` : cue;
    if (t - (this.last.get(key) ?? -1) < 0.05) return;
    this.last.set(key, t);
    if (cue === 'star') {
      const semis = STAR_STEPS[Math.max(0, Math.min(STAR_STEPS.length - 1, step))]!;
      this.tone(tone(semis, 0, 0.35, 0.22), t);
      this.tone(tone(semis + 12, 0, 0.2, 0.06), t);
      return;
    }
    for (const x of CUE_TONES[cue]) this.tone(x, t);
    if (cue === 'starOn') this.sweep(t, 220, 2400, 0.32, 0.12);
    if (cue === 'break') this.sweep(t, 520, 140, 0.26, 0.1, 'sine');
  }

  private tone(x: Tone, t0: number): void {
    const ctx = this.ctx;
    const t = t0 + x.at;
    const osc = ctx.createOscillator();
    osc.type = x.type;
    osc.frequency.value = 440 * Math.pow(2, x.semis / 12);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(x.peak, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + x.len);
    osc.connect(env).connect(this.bus);
    osc.start(t);
    osc.stop(t + x.len + 0.02);
  }

  /** A pitch glide through a band-pass: rising for star power, falling for a broken streak. */
  private sweep(t: number, from: number, to: number, len: number, peak: number, type: OscillatorType = 'sawtooth'): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + len);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(from * 2, t);
    filter.frequency.exponentialRampToValueAtTime(to * 2, t + len);
    filter.Q.value = 1.5;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.03);
    env.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(filter).connect(env).connect(this.bus);
    osc.start(t);
    osc.stop(t + len + 0.02);
  }
}
