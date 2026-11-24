import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The player ships as a single self-contained HTML file so it can be opened
// directly from disk (file://) without a web server.
export default defineConfig({
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 100 * 1024 * 1024,
    chunkSizeWarningLimit: 4096,
    cssCodeSplit: false,
  },
});
