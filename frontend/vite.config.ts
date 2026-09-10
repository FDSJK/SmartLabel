import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 监听 0.0.0.0，使开发服务器可通过局域网 IP（如 192.168.0.240）访问，
    // 并让 HMR WebSocket 绑定到同一主机，避免远程访问时热更新失效。
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
