import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig} from 'vite';

const key = fs.readFileSync(path.resolve(__dirname, 'key.pem'));
const cert = fs.readFileSync(path.resolve(__dirname, 'cert.pem'));

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
server: {
      https: { key, cert },
      port: 3000,
      proxy: {
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
