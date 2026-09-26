import { parseMidi, type MidiEvent } from 'midi-file';
import type { ControlEvent, ProgramChange, SongData, SongNote, TempoEntry, TimeSigEntry } from '../types.ts';

export class MidiParseError extends Error {}

const DEFAULT_US_PER_BEAT = 500_000; // 120 BPM
/** Seconds after the last real noteOff at which an unterminated note is cut. */
const UNTERMINATED_CAP_SECONDS = 2;

export function ticksToSeconds(map: TempoEntry[], ppq: number, tick: number): number {
  const e = tempoAt(map, tick);
  return e.seconds + ((tick - e.tick) * e.usPerBeat) / 1e6 / ppq;
}

export function secondsToTicks(map: TempoEntry[], ppq: number, seconds: number): number {
  let lo = 0;
  let hi = map.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (map[mid]!.seconds <= seconds) lo = mid;
    else hi = mid - 1;
  }
  const e = map[lo]!;
  return e.tick + ((seconds - e.seconds) * 1e6 * ppq) / e.usPerBeat;
}

export function tempoAt(map: TempoEntry[], tick: number): TempoEntry {
  let lo = 0;
  let hi = map.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (map[mid]!.tick <= tick) lo = mid;
    else hi = mid - 1;
  }
  return map[lo]!;
}

export function timeSigAt(sigs: TimeSigEntry[], tick: number): TimeSigEntry {
  let lo = 0;
  let hi = sigs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sigs[mid]!.tick <= tick) lo = mid;
    else hi = mid - 1;
  }
  return sigs[lo]!;
}

/** Build the tempo map from raw (tick, usPerBeat) pairs collected from every track. */
export function buildTempoMap(raw: { tick: number; usPerBeat: number }[], ppq: number): TempoEntry[] {
  const sorted = [...raw].sort((a, b) => a.tick - b.tick);
  // Same tick: last one wins.
  const dedup: { tick: number; usPerBeat: number }[] = [];
  for (const t of sorted) {
    const last = dedup[dedup.length - 1];
    if (last && last.tick === t.tick) last.usPerBeat = t.usPerBeat;
    else dedup.push({ ...t });
  }
  if (dedup.length === 0 || dedup[0]!.tick > 0) dedup.unshift({ tick: 0, usPerBeat: DEFAULT_US_PER_BEAT });
  const map: TempoEntry[] = [];
  let seconds = 0;
  for (let i = 0; i < dedup.length; i++) {
    const cur = dedup[i]!;
    if (i > 0) {
      const prev = dedup[i - 1]!;
      seconds += ((cur.tick - prev.tick) * prev.usPerBeat) / 1e6 / ppq;
    }
    map.push({ tick: cur.tick, usPerBeat: cur.usPerBeat, seconds });
  }
  return map;
}

/** GS "use for rhythm part" sysex: F0 41 10 42 12 40 1x 15 nn cs F7 → channel index. */
function gsRhythmChannel(data: ArrayLike<number>): { channel: number; drums: boolean } | null {
  // midi-file strips the leading F0; data starts at the manufacturer id.
  if (data.length < 9) return null;
  if (data[0] !== 0x41 || data[2] !== 0x42 || data[3] !== 0x12 || data[4] !== 0x40) return null;
  const part = data[5]!;
  if ((part & 0xf0) !== 0x10 || data[6] !== 0x15) return null;
  const x = part & 0x0f;
  const channel = x === 0 ? 9 : x <= 9 ? x - 1 : x;
  return { channel, drums: (data[7] ?? 0) !== 0 };
}

export function parseSong(bytes: Uint8Array): SongData {
  let midi;
  try {
    midi = parseMidi(bytes);
  } catch (e) {
    throw new MidiParseError(`Not a valid MIDI file: ${e instanceof Error ? e.message : String(e)}`);
  }
  const ppq = midi.header.ticksPerBeat;
  if (ppq === undefined || ppq <= 0) {
    throw new MidiParseError('SMPTE-timed MIDI files are not supported');
  }

  const rawTempos: { tick: number; usPerBeat: number }[] = [];
  const rawSigs: { tick: number; numerator: number; denominator: number }[] = [];
  const trackNames: string[] = [];
  const trackEndTicks: number[] = [];
  const drumSet = new Set<number>();
  type Open = { tick: number; velocity: number; note: SongNote };
  const notes: SongNote[] = [];
  const programs: ProgramChange[] = [];
  const controls: ControlEvent[] = [];
  const openNotes: SongNote[] = [];

  midi.tracks.forEach((track, trackIndex) => {
    let tick = 0;
    let name = '';
    const open = new Map<number, Open[]>();
    for (const ev of track as MidiEvent[]) {
      tick += ev.deltaTime;
      switch (ev.type) {
        case 'trackName':
          if (!name) name = ev.text.trim();
          break;
        case 'setTempo':
          rawTempos.push({ tick, usPerBeat: ev.microsecondsPerBeat });
          break;
        case 'timeSignature':
          rawSigs.push({ tick, numerator: ev.numerator, denominator: ev.denominator });
          break;
        case 'sysEx': {
          const gs = gsRhythmChannel(ev.data);
          if (gs) {
            if (gs.drums) drumSet.add(gs.channel);
            else drumSet.delete(gs.channel);
          }
          break;
        }
        case 'programChange':
          programs.push({ track: trackIndex, channel: ev.channel, tick, time: 0, program: ev.programNumber });
          break;
        case 'controller':
          if (ev.controllerType === 0 && ev.value === 127) drumSet.add(ev.channel); // XG bank MSB 127
          controls.push({ track: trackIndex, channel: ev.channel, tick, time: 0, kind: 'cc', controller: ev.controllerType, value: ev.value });
          break;
        case 'pitchBend':
          controls.push({ track: trackIndex, channel: ev.channel, tick, time: 0, kind: 'bend', controller: -1, value: ev.value });
          break;
        case 'noteOn': {
          const key = ev.channel * 128 + ev.noteNumber;
          const note: SongNote = {
            track: trackIndex, channel: ev.channel, pitch: ev.noteNumber, velocity: ev.velocity,
            tick, endTick: -1, time: 0, duration: 0,
          };
          notes.push(note);
          let stack = open.get(key);
          if (!stack) open.set(key, (stack = []));
          stack.push({ tick, velocity: ev.velocity, note });
          break;
        }
        case 'noteOff': {
          const key = ev.channel * 128 + ev.noteNumber;
          const stack = open.get(key);
          const o = stack?.shift(); // earliest open note closes first
          if (o) o.note.endTick = Math.max(tick, o.tick);
          break;
        }
        default:
          break;
      }
    }
    trackNames.push(name);
    trackEndTicks.push(tick);
    for (const stack of open.values()) for (const o of stack) openNotes.push(o.note);
  });

  const tempoMap = buildTempoMap(rawTempos, ppq);
  const toSec = (t: number) => ticksToSeconds(tempoMap, ppq, t);

  // Real (terminated) notes define where the music ends.
  let lastNoteOffTick = 0;
  for (const n of notes) if (n.endTick >= 0 && n.endTick > lastNoteOffTick) lastNoteOffTick = n.endTick;
  const lastNoteOffTime = toSec(lastNoteOffTick);

  // Unterminated notes: earlier of their track end and (last real noteOff + 2 s).
  const capTick = secondsToTicks(tempoMap, ppq, lastNoteOffTime + UNTERMINATED_CAP_SECONDS);
  for (const n of openNotes) {
    const trackEnd = trackEndTicks[n.track] ?? n.tick;
    n.endTick = Math.max(n.tick, Math.min(trackEnd, Math.round(capTick)));
    n.unterminated = true;
  }

  for (const n of notes) {
    n.time = toSec(n.tick);
    n.duration = Math.max(0, toSec(n.endTick) - n.time);
  }
  for (const p of programs) p.time = toSec(p.tick);
  for (const c of controls) c.time = toSec(c.tick);

  notes.sort((a, b) => a.time - b.time || a.pitch - b.pitch);
  programs.sort((a, b) => a.tick - b.tick);
  controls.sort((a, b) => a.tick - b.tick);

  const sigsSorted = rawSigs.sort((a, b) => a.tick - b.tick);
  const timeSigs: TimeSigEntry[] = [];
  for (const s of sigsSorted) {
    const last = timeSigs[timeSigs.length - 1];
    if (last && last.tick === s.tick) {
      last.numerator = s.numerator;
      last.denominator = s.denominator;
    } else timeSigs.push({ tick: s.tick, seconds: toSec(s.tick), numerator: s.numerator, denominator: s.denominator });
  }
  if (timeSigs.length === 0 || timeSigs[0]!.tick > 0) timeSigs.unshift({ tick: 0, seconds: 0, numerator: 4, denominator: 4 });

  return {
    format: midi.header.format,
    ppq,
    tempoMap,
    timeSigs,
    trackNames,
    trackEndTicks,
    notes,
    programs,
    controls,
    drumChannels: [...drumSet].sort((a, b) => a - b),
    lastNoteOffTime,
  };
}

/** Beat and bar lines for the renderer, from the tempo and time-signature maps. */
export interface BeatLine {
  time: number;
  isBar: boolean;
}

export function beatLines(song: SongData, untilSeconds: number): BeatLine[] {
  const out: BeatLine[] = [];
  const sigs = song.timeSigs;
  for (let i = 0; i < sigs.length; i++) {
    const sig = sigs[i]!;
    const next = sigs[i + 1];
    const endTick = next ? next.tick : Number.POSITIVE_INFINITY;
    const beatTicks = (song.ppq * 4) / sig.denominator;
    let beat = 0;
    for (let tick = sig.tick; tick < endTick; tick += beatTicks, beat++) {
      const time = ticksToSeconds(song.tempoMap, song.ppq, tick);
      if (time > untilSeconds) return out;
      out.push({ time, isBar: beat % sig.numerator === 0 });
      if (out.length > 100_000) return out;
    }
  }
  return out;
}
