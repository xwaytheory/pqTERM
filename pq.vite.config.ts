import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
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
    build: {
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
  }
})
