# Handoff (Codex / GPT-6 Astra): perspective highway renderer

Scope: one package, one new file, zero changes to game logic. Read `README.md` for commands,
`docs/HANDOFF-gameplay.md` for the renderer contract, and `src/render/renderer.ts` for the flat
renderer you are matching feature for feature.

## Deliverable

`src/render/highway3d.ts` exporting `class PerspectiveRenderer` with the same public surface as
`Renderer` in `src/render/renderer.ts`:

```ts
constructor(canvas: HTMLCanvasElement)
draw(state: RenderState): void
```

`RenderState` (in `renderer.ts`) is the whole contract: chart notes with `time`, `duration`,
`pitch`, `hand`, `folded`; per-note visuals (`pending | hit | missed`, `hitTime`); key visuals;
popups; beat lines; HUD; display range `low..high`; `pixelsPerSecond`; `physical` window. If the
Fable session has landed `fx: FxState` by the time you start, draw those too (the helper
`src/render/fx.ts` owns their state; you only draw).

Also: a `settings.highway: 'flat' | 'perspective'` field in `src/ui/settings.ts` (default `flat`
until you have verified readability, see below), the select in the Settings screen, and the
renderer switch in `src/main.ts` (one line: pick the class). No other files.

## Rendering spec

- Canvas 2D only (no WebGL): the target is low-end Chromebooks; keep `devicePixelRatio ≤ 2`
  (`fitCanvas` in `src/render/canvas.ts` already caps it).
- Highway is a trapezoid: full width at the hit line (bottom of the highway area, 82% of the canvas
  height), narrowing to ~35% width at the top. Per-row projection: `scale(y) = lerp(0.35, 1, y/hitY)`
  applied to x about the centre and to note width; note height follows the same scale so far notes
  look smaller. A vanishing-point tint (darker at the top) sells depth.
- Notes: rounded gems with a lit top edge; black-key notes narrower and darker as in the flat
  renderer; folded notes keep their chevron; hand colour from `theme`.
- Beat lines rush toward the player; **bar lines pulse** (2 px → 4 px, brighter) for 120 ms after
  the beat time passes the hit line. Subtle horizontal sway of the whole highway (±4 px) on bar
  boundaries, disabled when `state.hud.hint` contains "Your keys" is *not* a signal; add a boolean
  `reduceMotion` read from `matchMedia('(prefers-reduced-motion: reduce)')` and honour it.
- Keyboard stays flat and unprojected at the bottom, identical to the flat renderer (it must line
  up with the trapezoid's base exactly: each note must land on its key).
- HUD, popups, key visuals: same content and positions as the flat renderer so the session's
  behaviour is unchanged.

## Performance budget

- `frameMs` (update + draw, shown in `document.getElementById('stage').dataset.state`) must stay
  below 2 ms on the dense pad part of the local Sandstorm file:
  `http://localhost:5173/?file=fixtures/darude-sandstorm.mid&kb=25`, pick "Track 6" in the part
  picker. (`public/fixtures/` is gitignored; ask the owner for the file or use any dense .mid.)
- No per-frame allocations: precompute the row-scale table on resize, reuse path objects,
  no array `filter`/`map` inside `draw`.
- Forward-only note cursor as in the flat renderer (`cursor`/`cursorTime`).

## Readability gate (why the default stays `flat` until proven)

The classroom keyboard is 25 keys, so the display is usually a two-octave window: 15 white keys
across the full width. The perspective must keep notes assignable to keys at the *top* of the
highway, where columns are narrowest. Acceptance: with the display at C4–C6 and the canvas at
1024×600, a note at the top row must still be ≥ 6 px wide and its column visually distinct from
its neighbours. Include a screenshot of that case in the PR. If it cannot be met, keep a milder
narrowing (top width 55%) and say so.

## Tests

- `test/highway3d.test.ts`: the projection helper (`projectX`, `scaleAt`) is pure; test that a
  note at the hit line spans exactly its key column, and that the top row maps monotonically.
- Do not modify existing tests. `npm test` and `npm run build` must pass.

## Out of scope

Anything in `session.ts`, `judge.ts`, `chart.ts`, `synth.ts`, the flat renderer, or the screens
other than the one Settings select. Effects state (`fx.ts`) belongs to the Fable session; you
draw what it provides.
