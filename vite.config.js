import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/tools/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        split: resolve(__dirname, 'split/index.html'),
        txt2epub: resolve(__dirname, 'txt2epub.html'),
      }
    }
  }
});
