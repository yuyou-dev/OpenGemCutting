import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { labFonts } from './scripts/module/assets-plugin.mjs';

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [labFonts(), react()],
  define: { 'import.meta.env.LAB_MODULE_BUILD': 'true' },
  worker: { format: 'es' },
  build: {
    outDir: 'dist/module', target: 'es2022', sourcemap: false,
    assetsInlineLimit: 0, cssCodeSplit: false,
    rollupOptions: {
      input: { index: fileURLToPath(new URL('./src/lab/index.js', import.meta.url)), navigation: fileURLToPath(new URL('./src/ui/viewportNavigation.js', import.meta.url)) },
      preserveEntrySignatures: 'strict',
      output: {
        format: 'es', entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: asset => asset.names?.includes('style.css') ? 'style.css' : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
