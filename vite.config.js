import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function copyStaticAssets() {
  return {
    name: 'copy-static-assets',
    closeBundle() {
      const copyItems = ['icons', 'manifest.webmanifest', 'sw.js', 'app'];
      for (const item of copyItems) {
        const src = path.resolve(__dirname, item);
        const dest = path.resolve(__dirname, 'dist', item);
        if (fs.existsSync(src)) {
          fs.cpSync(src, dest, { recursive: true, force: true });
        }
      }
    }
  };
}

export default defineConfig({
  root: '.',
  plugins: [copyStaticAssets()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 8081,
  },
});

