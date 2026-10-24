import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 开发服务器：5173；/api 与 /ws 代理到后端 3000
export default defineConfig({
  plugins: [vue()],
  // 构建号：给 public 下不带哈希的静态资源（音频）做缓存失效
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    // 兼容较老的移动浏览器（含微信内置浏览器）
    target: ['es2019', 'safari13'],
    cssTarget: ['chrome61', 'safari13'],
    outDir: 'dist',
    chunkSizeWarningLimit: 600,
  },
});
