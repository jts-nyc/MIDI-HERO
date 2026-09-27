import { defineConfig } from 'vite';

// GitHub Pages serves the project at https://<user>.github.io/MIDI-HERO/,
// so production builds need that base path. Dev stays at the root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/MIDI-HERO/' : '/',
  // PORT lets a second checkout (a worktree, another session) run its own dev server.
  server: { port: Number(process.env.PORT) || 5173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
}));
