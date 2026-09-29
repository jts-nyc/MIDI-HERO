import { defineConfig, type Plugin } from 'vite';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

// Serves your own MIDI files from the gitignored local-songs/ folder, in dev only, so they
// appear in the song list without ever being committed or deployed.
function localSongs(): Plugin {
  const dir = resolve('local-songs');
  return {
    name: 'local-songs',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/local-songs', (req, res) => {
        const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.midi?$/i.test(f)).sort() : [];
        const name = decodeURIComponent((req.url ?? '/').slice(1).split('?')[0]!);
        if (name === 'index.json') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(files.map((file) => ({ file, title: file.replace(/\.midi?$/i, '').replace(/[_-]+/g, ' ') }))));
        } else if (files.includes(basename(name))) {
          res.setHeader('Content-Type', 'audio/midi');
          res.end(readFileSync(join(dir, basename(name))));
        } else {
          res.statusCode = 404;
          res.end();
        }
      });
    },
  };
}

// GitHub Pages serves the project at https://<user>.github.io/MIDI-HERO/,
// so production builds need that base path. Dev stays at the root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/MIDI-HERO/' : '/',
  plugins: [localSongs()],
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
