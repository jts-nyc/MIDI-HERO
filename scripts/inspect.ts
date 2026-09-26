// Dump the parsed parts of one or more .mid files. Usage: node scripts/inspect.ts file.mid [...]
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseSong } from '../src/midi/parse.ts';
import { buildParts, defaultPart, songEnd } from '../src/midi/parts.ts';

for (const file of process.argv.slice(2)) {
  const song = parseSong(new Uint8Array(readFileSync(file)));
  const parts = buildParts(song);
  const def = defaultPart(parts);
  console.log(`\n=== ${basename(file)}  fmt${song.format} ppq${song.ppq} tempos=${song.tempoMap.length} sigs=${song.timeSigs.map((s) => `${s.numerator}/${s.denominator}`).join(',')} lastOff=${song.lastNoteOffTime.toFixed(1)}s end=${songEnd(parts).toFixed(1)}s drumCh=[${song.drumChannels}]`);
  for (const p of parts) {
    const flag = p.key === def?.key ? '>>' : '  ';
    console.log(`${flag} ${p.key.padEnd(6)} ${p.kind.padEnd(7)} prg${String(p.program).padStart(3)} n=${String(p.noteCount).padStart(5)} ${String(p.minPitch).padStart(3)}-${String(p.maxPitch).padEnd(3)} med=${String(p.medianPitch).padStart(5)} nps=${p.notesPerSec.toFixed(1).padStart(5)} chord=${String(p.maxChord).padStart(2)} mono=${p.monophonicRatio.toFixed(2)} t0=${p.firstNoteTime.toFixed(1).padStart(6)} score=${Number.isFinite(p.score) ? p.score.toFixed(1).padStart(5) : '  -  '} ${p.duplicateOf ? `dup(${p.duplicateOf})` : ''} ${p.name}`);
  }
}
