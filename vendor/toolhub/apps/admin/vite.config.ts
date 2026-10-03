import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/admin/api': {
        target: `http://127.0.0.1:${process.env.BACKEND_PORT || process.env.PORT || 3000}`,
        changeOrigin: true,
        secure: false,
      }
    }
  }
})