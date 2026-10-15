import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(({ command }) => {
  const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:4001';

  return {
    base: command === 'build' ? '/QualiBoard/' : '/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      // Gzip reporting is useful for audits, but not needed for deployment.
      reportCompressedSize: false,
    },
    server: {
      port: 4000,
      proxy: {
        '/QualiBoard/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          rewrite: (requestPath) => requestPath.replace(/^\/QualiBoard/, ''),
        },
        // API 代理 - 用于登录等真实 API 调用
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
