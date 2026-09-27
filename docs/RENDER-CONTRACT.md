# Render contract: what a highway renderer draws

For anyone writing or maintaining a renderer (`src/render/renderer.ts` is the flat one,
`src/render/highway3d.ts` the perspective one). A renderer has one entry point,
`draw(state: RenderState)`, and reads nothing but that state: not the judge, not the session.
Everything below landed with WP4, WP5 and WP7; the flat renderer is the reference for how it
looks.

## RenderState

Unchanged from v0.1, plus one field:

```ts
fx: FxState   // effects and meters, filled by the session every frame (src/render/fx.ts)
```

## FxState (src/render/fx.ts)

Pure state in fixed pools; the renderer only draws. Skip entries with `active === false`.
All effects run on `fx.clock` (real seconds), not song time. Positions are relative to an
anchor: **the top centre of the key `pitch` on the hit line**; x to the right, y downward, CSS px.
In a perspective view the anchor is where that key meets the base of the trapezoid, so the same
numbers work unprojected.

| Field | What to draw |
|---|---|
| `particles[]` `{pitch, x, y, size, age, life, tint}` | a square of `size` at anchor + (x, y), alpha `1 - age/life`, additive blending |
| `rings[]` `{pitch, radius, age, life, tint}` | ring around the anchor; `radius` is in white-key widths and grows from 30% to 100% over its life |
| `shocks[]` `{pitch, age, life, tint}` | two short bars running outward along the hit line from the key (Perfect only) |
| `flashes[]` `{pitch, age, life, tint}` | the key lit red, alpha `1 - age/life` (missed note, wrong key) |
| `callouts[]` `{text, kind, age, life}` | centred text near the top: "25 NOTE STREAK!", "STAR POWER!", "SONG FAILED" |
| `streak` `{value, pulse, shatterValue, shatterAge, shatterLife}` | big counter behind the notes from a streak of 3; scale and alpha follow `pulse`; while `shatterLife > 0` the old value falls apart in red |
| `glow` `{age, life, tint}` | light at the left and right screen edges while `life > 0` |
| `meters` | `multiplier`, `multiplierProgress` (0..1 radial meter), `multiplierPulse`, `health` (0..1), `zone` (green/yellow/red), `low` (dim the highway), `canFail`, `starGauge` (0..1), `starReady`, `starActive` (gold highway, notes glow, badge shows multiplier × 2) |
| `countdown` `{value, phase}` | the number of beats left in the count-in when `value > 0`; `phase` runs 0..1 through the beat |
| `enabled` | false when the player turned effects off; the session then emits no particles, rings or shocks, so there is nothing to check |

`tint` is an index: `Tint = { perfect: 0, great: 1, good: 2, late: 3, wrong: 4, gold: 5 }`.

## Notes

- `ChartNote.star === true`: a pending note of a star phrase; draw it gold. The session clears
  the flag on the rest of a phrase once it is spoiled.
- `NoteVisual.hold` (sustains only) with `NoteVisual.holdEnd`:
  - `'holding'`: the trail from the hit line up to the end of the note is lit, and a hold bar on
    the key fills with `(time - note.time) / note.duration`;
  - `'released'`: let go early; what is left of the trail is grey;
  - `'held'`: held to the end; the gem pop starts at `holdEnd` instead of `hitTime`.
- A hit note without a hold pops (grows and fades) for 0.15 s of song time from `hitTime`.
- Missed notes (`state === 'missed'`) keep falling through the hit line, grey, and fade over
  about 70 px on top of the keyboard.
- Key visuals: kind `'wrong'` is also set on a key that is held too long after its note.

## Performance

No allocation per frame: indexed loops over the pools, cached gradients and strings. With
everything on, the flat renderer measures 0.10 ms mean and 0.2 ms p95 per frame (update and
draw) on the 4.3k-note Sandstorm pad part on the owner's Mac; the budget is 2 ms.
In a dev build: `await window.midihero.bench(5)`.

## Practice mode

`RenderState.practice?: PracticeView` (`src/render/practice.ts`) carries sections, the A–B loop,
passes and the wait-mode state. Absent outside practice mode. What to draw: `docs/HANDOFF-next.md`,
WP13.
