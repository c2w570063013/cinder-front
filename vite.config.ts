import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// base './' so the built game also runs from file:// inside the macOS app bundle (WKWebView).
export default defineConfig({
  base: './',
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
