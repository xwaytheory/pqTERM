import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve('src/renderer'),
  base: './',
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@shared': resolve('src/shared'),
      '@ort-wasm': resolve('node_modules/onnxruntime-web/dist')
    }
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web', '@huggingface/transformers']
  },
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: resolve('out/renderer'),
    emptyOutDir: true,
    assetsInlineLimit: 0
  },
  plugins: [
    react(),
    {
      name: 'pq-html',
      transformIndexHtml(html: string) {
        return html.replace(/ crossorigin/g, '')
      }
    }
  ]
})