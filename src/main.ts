import { GameClock } from './audio/clock.ts';
import { buildChart } from './midi/chart.ts';
import { beatLines, parseSong } from './midi/parse.ts';
import { buildParts, defaultPart } from './midi/parts.ts';
import { displayRange } from './render/layout.ts';
import { Renderer, type RenderState } from './render/renderer.ts';

// Phase 2: load the first bundled song and scroll it. Input and scoring come in Phase 3.
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const params = new URLSearchParams(location.search);
const base = import.meta.env.BASE_URL;

interface ManifestEntry { id: string; title: string; file: string; defaultParts: { track: number; channel: number }[] }

async function main(): Promise<void> {
  const manifest = (await (await fetch(`${base}songs/manifest.json`)).json()) as ManifestEntry[];
  const entry = manifest.find((m) => m.id === params.get('song')) ?? manifest[1] ?? manifest[0]!;
  const bytes = new Uint8Array(await (await fetch(`${base}songs/${entry.file}`)).arrayBuffer());
  const song = parseSong(bytes);
  const parts = buildParts(song);
  const part = parts.find((p) => p.track === entry.defaultParts[0]?.track && p.channel === entry.defaultParts[0]?.channel) ?? defaultPart(parts)!;
  const chart = buildChart(song, { parts: [part] });
  const range = displayRange(chart.minPitch, chart.maxPitch, null);
  const lines = beatLines(song, chart.duration);
  const clock = new GameClock();
  clock.setRate(Number(params.get('rate') ?? 1));
  const leadIn = 2;
  clock.start(-leadIn);

  const state: RenderState = {
    chart, low: range.low, high: range.high, time: 0,
    pixelsPerSecond: Number(params.get('speed') ?? 300),
    beatLines: lines,
    noteVisuals: chart.notes.map(() => ({ state: 'pending', hitTime: 0, judgment: '' })),
    keyVisuals: new Map(),
    popups: [],
    hud: { score: 0, combo: 0, accuracy: 1, progress: 0, hint: `${entry.title} — ${part.name}` },
    showNames: true,
    showNoteNames: false,
    physical: null,
  };
  document.title = `MIDI Hero — ${entry.title}`;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      if (clock.playing) clock.pause();
      else clock.resume();
    }
  });
  const frame = (): void => {
    state.time = clock.now();
    state.hud.progress = state.time / chart.duration;
    renderer.draw(state);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((e) => {
  console.error(e);
  document.getElementById('overlay')!.innerHTML = `<div class="screen"><div class="panel"><h2>Failed to load</h2><p>${String(e)}</p></div></div>`;
});
