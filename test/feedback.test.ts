import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/audio/clock.ts';
import { FEEDBACK_CHANNEL, RecordingSynth, WebAudioSynth } from '../src/audio/synth.ts';
import { DEFAULT_JUDGE_CONFIG } from '../src/game/judge.ts';
import { PlaySession, type SessionOptions } from '../src/game/session.ts';
import { buildChart } from '../src/midi/chart.ts';
import { parseSong } from '../src/midi/parse.ts';
import { effectiveFeedback, sanitize, urlOverrides, DEFAULT_SETTINGS } from '../src/ui/settings.ts';
import { FakeAudioContext } from './helpers/fakeAudio.ts';
import { end, off, on, smf, tempo } from './helpers/smf.ts';

const PPQ = 480;
const secs = (s: number) => Math.round(s * 2 * PPQ);

/** Notes as [time, pitch, seconds, velocity] at 120 BPM. */
function makeChart(notes: [number, number, number?, number?][], window: { low: number; high: number } | null = null) {
  const evs = notes.flatMap(([t, p, d = 0.25, v = 80]) => [on(secs(t), p, 0, v), off(secs(t + d), p)]);
  const song = parseSong(smf([[tempo(0, 120), ...evs, end(secs(notes.at(-1)![0]) + PPQ)]]));
  return buildChart(song, { parts: [{ track: 0, channel: 0 }], window });
}

function harness(over: Partial<SessionOptions> = {}, notes: [number, number, number?, number?][] = [[1, 60], [2, 62], [3, 64]]) {
  const t = { perfMs: 10_000 };
  const clock = new GameClock(() => t.perfMs);
  const synth = new RecordingSynth();
  const chart = over.chart ?? makeChart(notes);
  const session = new PlaySession({
    chart, clock, judgeConfig: DEFAULT_JUDGE_CONFIG, rate: 1, inputOffsetMs: 0, synth, relative: false,
    visibleSeconds: 1, barSeconds: 1, autoplay: null, hint: '', feedbackSound: 'chart', feedbackPrograms: { '0:0': 73 }, ...over,
  });
  const advance = (sec: number) => {
    t.perfMs += sec * 1000;
    session.update();
  };
  const goTo = (songTime: number) => advance(songTime - session.now());
  const down = (pitch: number, velocity = 90) => session.handleInput({ type: 'on', pitch, velocity, channel: 0, perfMs: t.perfMs, source: 'midi' });
  const up = (pitch: number) => session.handleInput({ type: 'off', pitch, velocity: 0, channel: 0, perfMs: t.perfMs, source: 'midi' });
  const notesOn = () => synth.calls.filter((c) => c.method === 'noteOn');
  const sounds = () => synth.calls.filter((c) => c.method === 'noteOn' || c.method === 'clunk');
  return { session, synth, advance, goTo, down, up, notesOn, sounds, t };
}

describe('chart-note feedback', () => {
  it('sets the part program on the feedback channel', () => {
    const { synth } = harness();
    expect(synth.calls[0]).toEqual({ method: 'program', args: [FEEDBACK_CHANNEL, 73] });
  });

  it('a hit sounds the chart note once, synchronously, with the chart velocity', () => {
    const { goTo, down, notesOn, synth } = harness({}, [[1, 60, 0.25, 101]]);
    goTo(1.02);
    const before = synth.calls.length;
    down(60, 33);
    expect(notesOn()).toHaveLength(1);
    expect(synth.calls[before]).toEqual({ method: 'noteOn', args: [FEEDBACK_CHANNEL, 60, 101, 0] });
  });

  it('sounds the original pitch of a folded note, not the key that was pressed', () => {
    const chart = makeChart([[1, 40]], { low: 60, high: 84 });
    expect(chart.notes[0]).toMatchObject({ pitch: 64, origPitch: 40, folded: true });
    const { goTo, down, notesOn } = harness({ chart });
    goTo(1);
    down(64);
    expect(notesOn().map((c) => c.args.slice(0, 2))).toEqual([[FEEDBACK_CHANNEL, 40]]);
  });

  it('a wrong press clunks at the played velocity and sounds no pitched note', () => {
    const { session, goTo, down, up, notesOn, synth } = harness();
    goTo(0.5);
    down(61, 77);
    up(61);
    expect(session.judge.counts.wrong).toBe(1);
    expect(notesOn()).toHaveLength(0);
    expect(synth.calls.filter((c) => c.method === 'clunk')).toEqual([{ method: 'clunk', args: [77, 0] }]);
  });

  it('a miss is silent', () => {
    const { session, goTo, sounds } = harness();
    goTo(1.5);
    expect(session.judge.counts.miss).toBe(1);
    expect(sounds()).toHaveLength(0);
  });

  it('holds a short note for its written length, whatever the key does', () => {
    const { goTo, down, up, advance, synth } = harness({}, [[1, 60, 0.4], [4, 62]]);
    goTo(1);
    down(60);
    advance(0.1);
    up(60); // a quick tap
    const offs = () => synth.calls.filter((c) => c.method === 'noteOff');
    expect(offs()).toHaveLength(0);
    goTo(1.3);
    expect(offs()).toHaveLength(0);
    goTo(1.36); // inside the scheduling lookahead
    expect(offs()).toEqual([{ method: 'noteOff', args: [FEEDBACK_CHANNEL, 60, 1.4, 1] }]); // the voice the hit started
    goTo(3);
    expect(offs()).toHaveLength(1);
  });

  it('a sustained note sounds for its written length too, even when it is let go early', () => {
    const { goTo, down, up, advance, synth } = harness({}, [[1, 60, 1], [4, 62]]);
    const offs = () => synth.calls.filter((c) => c.method === 'noteOff');
    goTo(1);
    down(60);
    advance(0.3);
    up(60); // let go after 0.3 s of a 1 s note: the hold is over, the sound is not
    goTo(1.9);
    expect(offs()).toHaveLength(0);
    goTo(1.96);
    expect(offs()).toEqual([{ method: 'noteOff', args: [FEEDBACK_CHANNEL, 60, 2, 1] }]);
  });

  it('lets the last note ring out before the song finishes', () => {
    const { session, goTo, down } = harness({}, [[1, 60, 1]]);
    goTo(1);
    down(60);
    goTo(1.5);
    expect(session.judge.finished).toBe(true);
    expect(session.status).toBe('playing');
    goTo(2.5);
    expect(session.status).toBe('playing');
    goTo(2.7);
    expect(session.status).toBe('finished');
  });

  it('autoplay with timing jitter only ever sounds chart notes or clunks', () => {
    const notes: [number, number][] = Array.from({ length: 12 }, (_, i) => [1 + i * 0.5, 60 + (i % 5)]);
    const { session, advance, notesOn } = harness({ autoplay: { jitterMs: 0 } }, notes);
    for (let i = 0; i < 300 && session.status === 'playing'; i++) advance(0.033);
    expect(session.status).toBe('finished');
    expect(notesOn().map((c) => c.args[1])).toEqual(notes.map(([, p]) => p));
    expect(notesOn().every((c) => c.args[0] === FEEDBACK_CHANNEL)).toBe(true);
  });
});

describe('feedback modes', () => {
  it("'press' sounds every pressed key on channel 0 (free play)", () => {
    const { goTo, down, up, synth } = harness({ feedbackSound: 'press' });
    goTo(0.5);
    down(61);
    up(61);
    expect(synth.calls).toEqual([
      { method: 'noteOn', args: [0, 61, 90, 0] },
      { method: 'noteOff', args: [0, 61, 0] },
    ]);
  });

  it("'off' makes no sound at all", () => {
    const { goTo, down, synth } = harness({ feedbackSound: 'off' });
    goTo(0.5);
    down(61);
    goTo(1);
    down(60);
    expect(synth.calls).toHaveLength(0);
  });

  it('settings: chart is the default, synth off means off, and the URL can choose', () => {
    expect(DEFAULT_SETTINGS.feedbackSound).toBe('chart');
    expect(effectiveFeedback(DEFAULT_SETTINGS)).toBe('chart');
    expect(effectiveFeedback(sanitize({ synth: false }))).toBe('off');
    expect(effectiveFeedback(sanitize({ feedbackSound: 'press' }))).toBe('press');
    expect(sanitize({ synth: true, feedbackSound: 'off' }).feedbackSound).toBe('chart');
    expect(urlOverrides('?feedback=press')).toMatchObject({ feedbackSound: 'press', synth: true });
    expect(urlOverrides('?feedback=off')).toMatchObject({ feedbackSound: 'off', synth: false });
  });
});

describe('WebAudioSynth feedback', () => {
  it('plays pitched notes on the feedback channel', () => {
    const ctx = new FakeAudioContext();
    const synth = new WebAudioSynth(ctx as unknown as AudioContext);
    synth.program(FEEDBACK_CHANNEL, 73);
    synth.noteOn(FEEDBACK_CHANNEL, 60, 100, 0);
    expect(ctx.oscillators.length).toBeGreaterThan(0);
    expect(ctx.oscillators[0]!.frequency.value).toBeCloseTo(261.63, 1);
  });

  it('the clunk is a short low thud, not a note', () => {
    const ctx = new FakeAudioContext();
    const synth = new WebAudioSynth(ctx as unknown as AudioContext);
    synth.clunk(100, 0);
    expect(ctx.oscillators).toHaveLength(1);
    const o = ctx.oscillators[0]!;
    expect(o.frequency.value).toBe(90);
    expect(o.started).toBe(ctx.currentTime);
    expect(o.stopped! - o.started!).toBeLessThan(0.15);
  });
});
