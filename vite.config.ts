import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API_PORT = process.env.PORT ?? '8080';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: 'src/client',
  publicDir: '../../public',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    // The kiosk boots offline-first; keep chunks few and large rather than many.
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
      '/img': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
    },
  },
});
