import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve('src/phone'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve('out/phone'),
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@shared': resolve('src/shared')
    }
  }
})
