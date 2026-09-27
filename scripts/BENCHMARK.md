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

The command fails if the app throws, playback fails to advance, fewer than 100 frames are
sampled, playback ends during the sample, or perspective exceeds 2 ms p95 at 4× throttle.
Do not edit the app while measuring. CPU throttling is a repeatable development comparison;
the owner still needs to check a real Chromebook before changing the default highway.
