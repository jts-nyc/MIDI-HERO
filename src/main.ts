import { fitCanvas } from './render/canvas.ts';

// Phase 0 placeholder: a HiDPI test grid. Replaced by the game loop in later phases.
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

function draw(): void {
  const { width, height, dpr } = fitCanvas(canvas);
  ctx.fillStyle = '#0f1117';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#2f3446';
  ctx.lineWidth = 1;
  for (let x = 0.5; x < width; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
  for (let y = 0.5; y < height; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
  ctx.fillStyle = '#e8eaf0';
  ctx.font = '16px system-ui';
  ctx.fillText(`MIDI Hero scaffold — ${width}×${height} @${dpr}x`, 16, 28);
}

window.addEventListener('resize', draw);
draw();
