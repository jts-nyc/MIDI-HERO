// Shared data types. Pure data, no DOM.

/** One entry of the tempo map. `seconds` is the absolute time at `tick`. */
export interface TempoEntry {
  tick: number;
  usPerBeat: number;
  seconds: number;
}

export interface TimeSigEntry {
  tick: number;
  seconds: number;
  numerator: number;
  denominator: number;
}

/** A note from the file, in both tick and second units. */
export interface SongNote {
  track: number;
  channel: number;
  pitch: number;
  velocity: number;
  tick: number;
  endTick: number;
  time: number;
  duration: number;
  /** true when the note had no noteOff and was closed artificially */
  unterminated?: true;
}

export interface ProgramChange {
  track: number;
  channel: number;
  tick: number;
  time: number;
  program: number;
}

export type ControlKind = 'cc' | 'bend';

/** Control changes and pitch bends that the backing synth cares about. */
export interface ControlEvent {
  track: number;
  channel: number;
  tick: number;
  time: number;
  kind: ControlKind;
  /** controller number for 'cc' */
  controller: number;
  /** 0..127 for cc, -8192..8191 for bend */
  value: number;
}

export interface SongData {
  format: number;
  ppq: number;
  tempoMap: TempoEntry[];
  timeSigs: TimeSigEntry[];
  trackNames: string[];
  trackEndTicks: number[];
  /** all notes, sorted by time then pitch */
  notes: SongNote[];
  programs: ProgramChange[];
  controls: ControlEvent[];
  /** channel indices flagged as rhythm parts by GS sysex or XG bank select, besides channel 9 */
  drumChannels: number[];
  /** end of the last real noteOff in the whole file, in seconds */
  lastNoteOffTime: number;
}

export type PartKind = 'melodic' | 'drums' | 'sfx';

export interface PartId {
  track: number;
  channel: number;
}

export interface Part extends PartId {
  key: string;
  name: string;
  program: number;
  kind: PartKind;
  noteCount: number;
  minPitch: number;
  maxPitch: number;
  medianPitch: number;
  /** pitch range between the 10th and 90th percentile, in semitones */
  pitchSpread: number;
  firstNoteTime: number;
  lastNoteEnd: number;
  notesPerSec: number;
  maxChord: number;
  /** fraction of onsets with no other onset of this part within 30 ms */
  monophonicRatio: number;
  /** key of the part this one duplicates, if any */
  duplicateOf?: string;
  /** default-part heuristic score; higher is a better player part */
  score: number;
}

export const partKey = (id: PartId): string => `${id.track}:${id.channel}`;
