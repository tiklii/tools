import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        split: resolve(__dirname, 'split.html'),
        txt2epub: resolve(__dirname, 'txt2epub.html'),
      }
    }
  }
});
