import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// base './' so the built game also runs from file:// inside the macOS app bundle (WKWebView).
export default defineConfig({
  base: './',
  // Identifies this build for LAN play: peers on different builds may not join each other (lockstep desync).
  define: { __CF_BUILD__: JSON.stringify(Date.now().toString(36)) },
  build: {
    target: 'es2022',
    outDir: 'dist',
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html') },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
} as any);
