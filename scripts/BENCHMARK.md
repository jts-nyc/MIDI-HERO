# Frame benchmark

Run `npm install`, install Google Chrome, then:

```sh
npm run bench
npm run bench -- --file /path/to/darude-sandstorm.mid --part 5:4
```

`CHROME_PATH` can point to a different Chrome executable. `--seconds 5` controls the sample
length (1–15 seconds). Node must support running the project's TypeScript source, as it does
for `gen-songs` and `inspect` (Node 22.18+ or a newer major).

The script starts and closes its own Vite server and headless Chrome. No MIDI fixture is copied
into the repository. Without `--file`, it compares melodic parts by notes per second and picks
the densest bundled part (currently Minuet in G, part 1:0).

Each combination of flat/perspective and 1×/4×/6× CPU throttle gets a fresh browser context,
1024×600 viewport, DPR 1, 25-key mode, Expert difficulty, autoplay, and effects enabled.
Measurement starts one song-second after the first chart note, following natural count-in and
playback. No seeks or synthetic clock are used. `window.midihero.bench` measures session update
plus canvas draw submission; it does **not** measure presentation latency or GPU completion.
The JSON includes the Chrome version, host CPU, chart size, song-time interval, frame count,
mean, p95 and maximum. Progress is written to stderr; redirect stdout to save the JSON:

```sh
node scripts/bench.mjs --file /path/to/darude-sandstorm.mid --part 5:4 > results.json
```

Add `--practice` to exercise a synthetic `PracticeView` on the same live render state. It shows
section/pass text, scrolling A/B boundaries and three waiting keys throughout the sample. This
measures the renderer overhead; it does not test the practice state machine or pause song time.

The command fails if the app throws, playback fails to advance, fewer than 100 frames are
sampled, playback ends during the sample, or perspective exceeds 2 ms p95 at 4× throttle.
Do not edit the app while measuring. CPU throttling is a repeatable development comparison;
the owner still needs to check a real Chromebook before changing the default highway.

## Round 2 measurements

Recorded on Apple M1 Max / headless Chrome 153.0.8010.53, Sandstorm pad part 5:4,
4,314 folded chart notes, 5-second samples. Values are **mean / p95 milliseconds**.

| Throttle | WP14 flat | WP14 perspective | WP13 flat + practice | WP13 perspective + practice |
| --- | --- | --- | --- | --- |
| 1× | 0.067 / 0.2 | 0.069 / 0.2 | 0.073 / 0.2 | 0.075 / 0.2 |
| 4× | 0.245 / 0.9 | 0.263 / 0.9 | 0.262 / 0.9 | 0.388 / 1.0 |
| 6× | 0.418 / 1.5 | 0.429 / 1.5 | 0.558 / 1.5 | 0.459 / 1.3 |

Raw samples and frame counts: [WP14](bench-results/wp14.json),
[WP13 with synthetic practice](bench-results/wp13-practice.json).
Both packages pass the perspective 4× p95 gate. The values include host/browser variance;
these are CPU-throttled Mac measurements, not Chromebook hardware measurements.

## Feel pass

Measured with the same command after the feel layer (light columns, beat pulse, charge light,
snapping timing words) landed, with the automatic effects fallback off (`governor=0`, which the
script now sets). Mean / p95 ms, Sandstorm pad part 5:4, headless Chrome 154:

| Throttle | flat before | flat after | perspective before | perspective after |
| --- | --- | --- | --- | --- |
| 1× | 0.096 / 0.2 | 0.106 / 0.2 | 0.096 / 0.2 | 0.092 / 0.2 |
| 4× | 0.376 / 0.9 | 0.340 / 1.0 | 0.394 / 0.9 | 0.341 / 1.0 |
| 6× | 0.637 / 1.5 | 0.541 / 1.6 | 0.647 / 1.5 | 0.581 / 1.6 |

Raw: [before](bench-results/feel-before.json), [after](bench-results/feel-after.json). The
difference is inside run-to-run spread on a shared host (see docs/FEEL.md §5).
`node scripts/timing-probe.mjs --throttle 4` measures how evenly the drawn song time advances
per frame (docs/FEEL.md §1).
