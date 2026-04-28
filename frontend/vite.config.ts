import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
  ],
  resolve: {
    alias: { '@src': path.resolve(__dirname, 'src') }
  },
  server: {
    port: 10201,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true }
    }
  },
  optimizeDeps: {
    exclude: ['@coderline/alphatab'],
  },
  build: { outDir: 'dist' }
})
