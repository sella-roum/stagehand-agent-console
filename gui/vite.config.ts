import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // CUI/バックエンドサーバー(3000)とポートが衝突しないように設定
    port: 5173, 
  },
})
