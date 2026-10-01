import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ base: './', publicDir: false, plugins: [react()],
    define: { 'import.meta.env.LAB_MODULE_BUILD': 'true' }, worker: { format: 'es' },
    build: { outDir: 'dist/module', target: 'es2022', assetsInlineLimit: 0, cssCodeSplit: false,
        rollupOptions: { input: { index: 'src/lab/index.js' }, preserveEntrySignatures: 'strict',
            output: { format: 'es', entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js',
                assetFileNames: asset => asset.names?.includes('style.css') ? 'style.css' : 'assets/[name]-[hash][extname]' } } } });
