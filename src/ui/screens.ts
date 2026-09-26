import type { PlayResult } from '../game/session.ts';

const overlay = (): HTMLElement => document.getElementById('overlay')!;

export function hideScreens(): void {
  overlay().innerHTML = '';
}

function screen(html: string, transparent = false): HTMLElement {
  const el = document.createElement('div');
  el.className = `screen${transparent ? ' transparent' : ''}`;
  el.innerHTML = html;
  overlay().replaceChildren(el);
  return el;
}

export function toast(message: string, kind: 'info' | 'error' = 'info', ms = 3000): void {
  const el = document.createElement('div');
  el.className = `toast ${kind === 'error' ? 'error' : ''}`;
  el.textContent = message;
  overlay().appendChild(el);
  setTimeout(() => el.remove(), ms);
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface SongListItem {
  id: string;
  title: string;
  subtitle: string;
}

export interface StartScreenOptions {
  songs: SongListItem[];
  midiStatus: string;
  onPick: (id: string) => void;
  onRetryMidi?: () => void;
}

export function showStart(o: StartScreenOptions): void {
  const items = o.songs
    .map((s) => `<div class="item" data-id="${esc(s.id)}"><div><div>${esc(s.title)}</div><div class="meta">${esc(s.subtitle)}</div></div><button class="primary">Play</button></div>`)
    .join('');
  const el = screen(`<div class="panel">
    <h1>MIDI Hero</h1>
    <p>${esc(o.midiStatus)} ${o.onRetryMidi ? '<button id="retry-midi">Retry</button>' : ''}</p>
    <p>No keyboard? Use the computer keyboard: <span class="kbd">Z</span>–<span class="kbd">M</span> and <span class="kbd">Q</span>–<span class="kbd">U</span> play notes, <span class="kbd">-</span>/<span class="kbd">=</span> shift octave.</p>
    <h2>Songs</h2>
    <div class="list">${items}</div>
  </div>`);
  el.querySelectorAll<HTMLElement>('.item').forEach((item) => item.addEventListener('click', () => o.onPick(item.dataset.id!)));
  el.querySelector('#retry-midi')?.addEventListener('click', () => o.onRetryMidi?.());
}

export function showPause(o: { onResume: () => void; onRestart: () => void; onQuit: () => void }): void {
  const el = screen(`<div class="panel" style="text-align:center">
    <h2>Paused</h2>
    <div class="row" style="justify-content:center">
      <button class="primary big" id="resume">Resume</button>
      <button id="restart">Restart</button>
      <button id="quit">Song select</button>
    </div>
    <p>Space or Esc to resume</p>
  </div>`);
  el.querySelector('#resume')!.addEventListener('click', o.onResume);
  el.querySelector('#restart')!.addEventListener('click', o.onRestart);
  el.querySelector('#quit')!.addEventListener('click', o.onQuit);
}

export function showPlayHud(o: { onPause: () => void; onSkip: (() => void) | null }): void {
  const el = screen(`<div class="hud-hint">
      ${o.onSkip ? '<button id="skip">Skip to my part ⏩</button>' : ''}
      <button id="pause">Pause</button>
    </div>`, true);
  el.querySelector('#pause')!.addEventListener('click', o.onPause);
  el.querySelector('#skip')?.addEventListener('click', () => {
    o.onSkip?.();
    el.querySelector('#skip')?.remove();
  });
}

export function stars(accuracy: number): string {
  const n = accuracy >= 0.95 ? 5 : accuracy >= 0.85 ? 4 : accuracy >= 0.7 ? 3 : accuracy >= 0.5 ? 2 : accuracy > 0 ? 1 : 0;
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

export function showResults(o: { title: string; detail: string; result: PlayResult; badges: string[]; onRetry: () => void; onQuit: () => void }): void {
  const r = o.result;
  const c = r.counts;
  const el = screen(`<div class="panel" style="text-align:center">
    <h2>${esc(o.title)}</h2>
    <p>${esc(o.detail)}</p>
    <div class="accuracy">${(r.accuracy * 100).toFixed(1)}%</div>
    <div class="stars">${stars(r.accuracy)}</div>
    <p>${o.badges.map((b) => `<span class="badge warn">${esc(b)}</span>`).join(' ')}</p>
    <table style="max-width:420px;margin:12px auto">
      <tr><td>Score</td><td><b>${r.score}</b></td><td>Max combo</td><td><b>${r.maxCombo}</b></td></tr>
      <tr><td>Perfect</td><td>${c.perfect}</td><td>Great</td><td>${c.great}</td></tr>
      <tr><td>Good</td><td>${c.good}</td><td>Late/early</td><td>${c.late}</td></tr>
      <tr><td>Missed</td><td>${c.miss}</td><td>Wrong notes</td><td>${c.wrong}</td></tr>
    </table>
    <div class="row" style="justify-content:center">
      <button class="primary big" id="retry">Play again</button>
      <button id="quit">Song select</button>
    </div>
  </div>`);
  el.querySelector('#retry')!.addEventListener('click', o.onRetry);
  el.querySelector('#quit')!.addEventListener('click', o.onQuit);
}

export function showError(title: string, message: string, onBack?: () => void): void {
  const el = screen(`<div class="panel"><h2>${esc(title)}</h2><p>${esc(message)}</p>${onBack ? '<button id="back">Back</button>' : ''}</div>`);
  el.querySelector('#back')?.addEventListener('click', () => onBack?.());
}
