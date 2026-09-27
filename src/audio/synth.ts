/**
 * A small Web Audio polysynth used both for the player's own notes and for the
 * backing band. Timbre is chosen per channel from the General MIDI program via a
 * handful of families; channel 9 (and GS/XG rhythm channels) get a noise drum kit.
 */

export interface Synth {
  noteOn(channel: number, pitch: number, velocity: number, when: number): void;
  noteOff(channel: number, pitch: number, when: number): void;
  program(channel: number, program: number): void;
  control(channel: number, controller: number, value: number, when: number): void;
  bend(channel: number, value: number, when: number): void;
  allNotesOff(when: number): void;
  setDrumChannels(channels: number[]): void;
  setMasterGain(gain: number): void;
  /** Unpitched "wrong note" thud: a short low-passed noise burst over a 90 Hz body. */
  clunk(velocity: number, when: number): void;
}

/** Channels 0-15 belong to the MIDI file; chart-note feedback for the player's parts starts here. */
export const FEEDBACK_CHANNEL = 16;
export const FEEDBACK_CHANNELS = 8;
const NUM_CHANNELS = FEEDBACK_CHANNEL + FEEDBACK_CHANNELS;
const CLUNK_SECONDS = 0.08;

type Family = 'keys' | 'organ' | 'plucked' | 'bass' | 'pad' | 'lead' | 'brass';

interface Patch {
  wave1: OscillatorType;
  wave2: OscillatorType;
  detune: number; // cents
  mix2: number;
  cutoff: number; // Hz at velocity 1
  q: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  gain: number;
}

const PATCHES: Record<Family, Patch> = {
  keys:    { wave1: 'triangle', wave2: 'sine',     detune: 3,  mix2: 0.6, cutoff: 5200, q: 0.5, attack: 0.004, decay: 0.9,  sustain: 0.25, release: 0.25, gain: 0.35 },
  organ:   { wave1: 'square',   wave2: 'sine',     detune: 0,  mix2: 0.8, cutoff: 3000, q: 0.3, attack: 0.01,  decay: 0.05, sustain: 1.0,  release: 0.08, gain: 0.22 },
  plucked: { wave1: 'sawtooth', wave2: 'triangle', detune: 5,  mix2: 0.5, cutoff: 4000, q: 0.8, attack: 0.003, decay: 0.5,  sustain: 0.1,  release: 0.15, gain: 0.3 },
  bass:    { wave1: 'sawtooth', wave2: 'square',   detune: 4,  mix2: 0.4, cutoff: 900,  q: 1.0, attack: 0.005, decay: 0.3,  sustain: 0.6,  release: 0.12, gain: 0.35 },
  pad:     { wave1: 'sawtooth', wave2: 'sawtooth', detune: 9,  mix2: 0.9, cutoff: 1800, q: 0.4, attack: 0.12,  decay: 0.4,  sustain: 0.8,  release: 0.5,  gain: 0.2 },
  lead:    { wave1: 'square',   wave2: 'sawtooth', detune: 6,  mix2: 0.5, cutoff: 3500, q: 1.2, attack: 0.01,  decay: 0.2,  sustain: 0.7,  release: 0.15, gain: 0.25 },
  brass:   { wave1: 'sawtooth', wave2: 'sawtooth', detune: 7,  mix2: 0.7, cutoff: 2600, q: 0.9, attack: 0.04,  decay: 0.2,  sustain: 0.8,  release: 0.2,  gain: 0.25 },
};

export function familyFor(program: number): Family {
  if (program <= 7) return 'keys';
  if (program <= 15) return 'plucked'; // chromatic percussion
  if (program <= 23) return 'organ';
  if (program <= 31) return 'plucked'; // guitars
  if (program <= 39) return 'bass';
  if (program <= 47) return 'pad'; // strings
  if (program <= 55) return 'pad'; // ensemble / choir
  if (program <= 63) return 'brass';
  if (program <= 79) return 'lead'; // reeds, pipes
  if (program <= 87) return 'lead'; // synth leads
  if (program <= 95) return 'pad'; // synth pads
  if (program <= 103) return 'pad'; // fx
  if (program <= 111) return 'plucked'; // ethnic
  return 'plucked'; // percussive / sfx (rarely reached; sfx parts are usually muted)
}

interface Voice {
  channel: number;
  pitch: number;
  start: number;
  osc1: OscillatorNode;
  osc2: OscillatorNode | null;
  filter: BiquadFilterNode;
  env: GainNode;
  release: number;
  released: boolean;
}

interface ChannelState {
  program: number;
  gain: GainNode; // CC7 × CC11
  volume: number;
  expression: number;
  bendRange: number; // semitones
  bend: number; // -1..1
  rpnMsb: number;
  rpnLsb: number;
  sustain: boolean;
}

const MAX_VOICES = 32;

export class WebAudioSynth implements Synth {
  private master: GainNode;
  private channels: ChannelState[] = [];
  private voices: Voice[] = [];
  private drumChannels = new Set<number>([9]);
  private noiseBuffer: AudioBuffer;

  constructor(private ctx: AudioContext) {
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    for (let c = 0; c < NUM_CHANNELS; c++) {
      const gain = ctx.createGain();
      gain.connect(this.master);
      this.channels.push({ program: 0, gain, volume: 100, expression: 127, bendRange: 2, bend: 0, rpnMsb: 127, rpnLsb: 127, sustain: false });
    }
    const len = Math.floor(ctx.sampleRate * 0.5);
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setMasterGain(gain: number): void {
    this.master.gain.value = gain;
  }

  setDrumChannels(channels: number[]): void {
    this.drumChannels = new Set([9, ...channels]);
  }

  program(channel: number, program: number): void {
    this.channels[channel]!.program = program;
  }

  private applyGain(ch: ChannelState, when: number): void {
    const g = (ch.volume / 127) * (ch.expression / 127);
    ch.gain.gain.setTargetAtTime(g * g, Math.max(when, this.ctx.currentTime), 0.01);
  }

  control(channel: number, controller: number, value: number, when: number): void {
    const ch = this.channels[channel]!;
    switch (controller) {
      case 7: ch.volume = value; this.applyGain(ch, when); break;
      case 11: ch.expression = value; this.applyGain(ch, when); break;
      case 64: ch.sustain = value >= 64; if (!ch.sustain) this.releaseSustained(channel, when); break;
      case 101: ch.rpnMsb = value; break;
      case 100: ch.rpnLsb = value; break;
      case 6: if (ch.rpnMsb === 0 && ch.rpnLsb === 0 && value >= 0 && value <= 24) ch.bendRange = value; break;
      case 120: case 123: this.allNotesOffChannel(channel, when); break;
      case 121: ch.bend = 0; ch.expression = 127; ch.sustain = false; this.applyGain(ch, when); this.applyBend(channel, when); break;
      default: break;
    }
  }

  bend(channel: number, value: number, when: number): void {
    const ch = this.channels[channel]!;
    ch.bend = Math.max(-1, Math.min(1, value / 8192));
    this.applyBend(channel, when);
  }

  private applyBend(channel: number, when: number): void {
    const ch = this.channels[channel]!;
    const cents = ch.bend * ch.bendRange * 100;
    const t = Math.max(when, this.ctx.currentTime);
    for (const v of this.voices) {
      if (v.channel !== channel) continue;
      v.osc1.detune.setTargetAtTime(cents, t, 0.005);
      if (v.osc2) v.osc2.detune.setTargetAtTime(cents + PATCHES[familyFor(ch.program)].detune, t, 0.005);
    }
  }

  noteOn(channel: number, pitch: number, velocity: number, when: number): void {
    const ctx = this.ctx;
    const t = Math.max(when, ctx.currentTime);
    const ch = this.channels[channel]!;
    if (this.drumChannels.has(channel)) {
      this.drumHit(channel, pitch, velocity, t);
      return;
    }
    // Voice stealing
    if (this.voices.length >= MAX_VOICES) {
      const victim = this.voices.reduce((a, b) => (a.start < b.start ? a : b));
      this.kill(victim, t);
    }
    const patch = PATCHES[familyFor(ch.program)];
    const vel = Math.max(0.05, velocity / 127);
    const freq = 440 * Math.pow(2, (pitch - 69) / 12);
    const cents = ch.bend * ch.bendRange * 100;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(patch.gain * vel, t + patch.attack);
    env.gain.setTargetAtTime(patch.gain * vel * patch.sustain, t + patch.attack, patch.decay / 3);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(ctx.sampleRate / 2.2, patch.cutoff * (0.4 + 0.6 * vel)), t);
    filter.Q.value = patch.q;

    const osc1 = ctx.createOscillator();
    osc1.type = patch.wave1;
    osc1.frequency.value = freq;
    osc1.detune.setValueAtTime(cents, t);
    osc1.connect(filter);
    let osc2: OscillatorNode | null = null;
    if (patch.mix2 > 0) {
      osc2 = ctx.createOscillator();
      osc2.type = patch.wave2;
      osc2.frequency.value = freq;
      osc2.detune.setValueAtTime(cents + patch.detune, t);
      const g2 = ctx.createGain();
      g2.gain.value = patch.mix2;
      osc2.connect(g2).connect(filter);
      osc2.start(t);
    }
    filter.connect(env).connect(ch.gain);
    osc1.start(t);
    const voice: Voice = { channel, pitch, start: t, osc1, osc2, filter, env, release: patch.release, released: false };
    this.voices.push(voice);
    // Same pitch already sounding on this channel: release it (retrigger).
    for (const v of this.voices) if (v !== voice && v.channel === channel && v.pitch === pitch && !v.released) this.release(v, t);
  }

  noteOff(channel: number, pitch: number, when: number): void {
    const t = Math.max(when, this.ctx.currentTime);
    const ch = this.channels[channel]!;
    for (const v of this.voices) {
      if (v.channel === channel && v.pitch === pitch && !v.released) {
        if (ch.sustain) v.released = true; // mark; actually released when the pedal lifts
        else this.release(v, t);
        (v as Voice & { sustained?: boolean }).sustained = ch.sustain;
      }
    }
  }

  private releaseSustained(channel: number, when: number): void {
    const t = Math.max(when, this.ctx.currentTime);
    for (const v of this.voices) {
      if (v.channel === channel && (v as Voice & { sustained?: boolean }).sustained) {
        v.released = false;
        this.release(v, t);
      }
    }
  }

  private release(v: Voice, t: number): void {
    v.released = true;
    v.env.gain.cancelScheduledValues(t);
    v.env.gain.setTargetAtTime(0, t, v.release / 3);
    const stop = t + v.release * 2 + 0.05;
    v.osc1.stop(stop);
    v.osc2?.stop(stop);
    v.osc1.onended = () => this.dispose(v);
  }

  private kill(v: Voice, t: number): void {
    v.released = true;
    v.env.gain.cancelScheduledValues(t);
    v.env.gain.setTargetAtTime(0, t, 0.005);
    v.osc1.stop(t + 0.03);
    v.osc2?.stop(t + 0.03);
    this.dispose(v);
  }

  private dispose(v: Voice): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    try {
      v.osc1.disconnect();
      v.osc2?.disconnect();
      v.filter.disconnect();
      v.env.disconnect();
    } catch {
      /* already disconnected */
    }
  }

  private allNotesOffChannel(channel: number, when: number): void {
    const t = Math.max(when, this.ctx.currentTime);
    for (const v of [...this.voices]) if (v.channel === channel && !v.released) this.release(v, t);
  }

  allNotesOff(when: number): void {
    const t = Math.max(when, this.ctx.currentTime);
    for (const v of [...this.voices]) this.kill(v, t);
  }

  clunk(velocity: number, when: number): void {
    const ctx = this.ctx;
    const t = Math.max(when, ctx.currentTime);
    const vel = Math.max(0.2, velocity / 127);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.7;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.55 * vel, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + CLUNK_SECONDS);
    src.connect(filter).connect(env).connect(this.master);
    src.start(t);
    src.stop(t + CLUNK_SECONDS + 0.02);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + CLUNK_SECONDS);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.7 * vel, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + CLUNK_SECONDS);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + CLUNK_SECONDS + 0.02);
  }

  private drumHit(channel: number, pitch: number, velocity: number, t: number): void {
    const ctx = this.ctx;
    const ch = this.channels[channel]!;
    const vel = Math.max(0.05, velocity / 127);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    const env = ctx.createGain();
    // GM drum map: kick 35/36, snare 38/40, hats 42/44/46, toms 41-50, cymbals 49/51/57
    let decay = 0.08;
    let gain = 0.5;
    if (pitch === 35 || pitch === 36) {
      filter.type = 'lowpass';
      filter.frequency.value = 180;
      decay = 0.18;
      gain = 0.9;
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      const og = ctx.createGain();
      og.gain.setValueAtTime(vel * 0.9, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(og).connect(ch.gain);
      osc.start(t);
      osc.stop(t + 0.3);
    } else if (pitch === 38 || pitch === 40 || pitch === 37) {
      filter.type = 'bandpass';
      filter.frequency.value = 1800;
      filter.Q.value = 0.7;
      decay = 0.15;
      gain = 0.6;
    } else if (pitch === 42 || pitch === 44) {
      filter.type = 'highpass';
      filter.frequency.value = 7000;
      decay = 0.05;
      gain = 0.3;
    } else if (pitch === 46 || pitch === 49 || pitch === 51 || pitch === 57 || pitch === 55) {
      filter.type = 'highpass';
      filter.frequency.value = 5000;
      decay = pitch === 46 ? 0.25 : 0.6;
      gain = 0.3;
    } else {
      filter.type = 'bandpass';
      filter.frequency.value = 300 + (pitch - 41) * 60;
      filter.Q.value = 1.2;
      decay = 0.2;
      gain = 0.5;
    }
    env.gain.setValueAtTime(gain * vel, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(filter).connect(env).connect(ch.gain);
    src.start(t);
    src.stop(t + decay + 0.02);
  }
}

/** Test seam: a synth that only records calls. */
export class RecordingSynth implements Synth {
  calls: { method: string; args: unknown[] }[] = [];
  private rec(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }
  noteOn(channel: number, pitch: number, velocity: number, when: number): void { this.rec('noteOn', channel, pitch, velocity, when); }
  noteOff(channel: number, pitch: number, when: number): void { this.rec('noteOff', channel, pitch, when); }
  program(channel: number, program: number): void { this.rec('program', channel, program); }
  control(channel: number, controller: number, value: number, when: number): void { this.rec('control', channel, controller, value, when); }
  bend(channel: number, value: number, when: number): void { this.rec('bend', channel, value, when); }
  allNotesOff(when: number): void { this.rec('allNotesOff', when); }
  setDrumChannels(channels: number[]): void { this.rec('setDrumChannels', channels); }
  setMasterGain(gain: number): void { this.rec('setMasterGain', gain); }
  clunk(velocity: number, when: number): void { this.rec('clunk', velocity, when); }
}
