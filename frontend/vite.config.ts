import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:4001';

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 4000,
      proxy: {
        // API 代理 - 用于登录等真实 API 调用
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        // 语音识别 WebSocket 代理
        '/ws-voice': {
          target: 'ws://10.17.150.235:10095',
          ws: true,
        },
      },
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
