import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 开发模式：前端 5173，API 代理到后端 3001
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist'
  }
})
