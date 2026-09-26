// Builds small Standard MIDI Files in memory for tests, via midi-file's writer.
import { writeMidi, type MidiData, type MidiEvent, type MidiHeader } from 'midi-file';

export type AbsEvent = { tick: number; ev: MidiEvent };

/** Convert absolute-tick events to delta-time events. */
export function deltas(events: AbsEvent[]): MidiEvent[] {
  // Stable sort by tick so tests can list events in any order; same-tick order is kept.
  const sorted = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.tick - b.e.tick || a.i - b.i).map((x) => x.e);
  let last = 0;
  return sorted.map(({ tick, ev }) => {
    const out = { ...ev, deltaTime: tick - last } as MidiEvent;
    last = tick;
    return out;
  });
}

export const on = (tick: number, pitch: number, channel = 0, velocity = 80): AbsEvent => ({
  tick, ev: { deltaTime: 0, type: 'noteOn', channel, noteNumber: pitch, velocity },
});
export const off = (tick: number, pitch: number, channel = 0): AbsEvent => ({
  tick, ev: { deltaTime: 0, type: 'noteOff', channel, noteNumber: pitch, velocity: 0 },
});
export const tempo = (tick: number, bpm: number): AbsEvent => ({
  tick, ev: { deltaTime: 0, meta: true, type: 'setTempo', microsecondsPerBeat: Math.round(60_000_000 / bpm) },
});
export const timeSig = (tick: number, num: number, den: number): AbsEvent => ({
  tick, ev: { deltaTime: 0, meta: true, type: 'timeSignature', numerator: num, denominator: den, metronome: 24, thirtyseconds: 8 },
});
export const name = (text: string): AbsEvent => ({ tick: 0, ev: { deltaTime: 0, meta: true, type: 'trackName', text } });
export const program = (tick: number, channel: number, programNumber: number): AbsEvent => ({
  tick, ev: { deltaTime: 0, type: 'programChange', channel, programNumber },
});
export const cc = (tick: number, channel: number, controllerType: number, value: number): AbsEvent => ({
  tick, ev: { deltaTime: 0, type: 'controller', channel, controllerType, value },
});
export const end = (tick: number): AbsEvent => ({ tick, ev: { deltaTime: 0, meta: true, type: 'endOfTrack' } });
/** GS "rhythm part" sysex for a MIDI channel index (0-15); mode 0 = normal, 1/2 = drum map. */
export const gsRhythm = (channel: number, mode: number): AbsEvent => {
  const x = channel === 9 ? 0 : channel < 9 ? channel + 1 : channel;
  const data = [0x41, 0x10, 0x42, 0x12, 0x40, 0x10 | x, 0x15, mode, 0x00, 0xf7];
  return { tick: 0, ev: { deltaTime: 0, type: 'sysEx', data } };
};

export interface SmfOptions {
  ppq?: number;
  format?: 0 | 1;
  /** raw 16-bit division word, for SMPTE tests */
  timeDivision?: number;
  running?: boolean;
}

export function smf(tracks: AbsEvent[][], opts: SmfOptions = {}): Uint8Array {
  const header: MidiHeader = { format: opts.format ?? (tracks.length > 1 ? 1 : 0), numTracks: tracks.length };
  if (opts.timeDivision !== undefined) header.timeDivision = opts.timeDivision;
  else header.ticksPerBeat = opts.ppq ?? 480;
  const data: MidiData = { header, tracks: tracks.map(deltas) };
  return new Uint8Array(writeMidi(data, { running: opts.running ?? false }));
}
