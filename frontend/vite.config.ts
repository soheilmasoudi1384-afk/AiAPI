import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const BACKEND = process.env.GATEWAY_URL ?? 'http://localhost:8000';

// در حالت dev درخواست‌های API به بک‌اند FastAPI می‌رود؛ صفحه‌ها خودشان از Vite سرو می‌شوند.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 700 },
  server: {
    port: 5173,
    proxy: {
      '/account': BACKEND,
      '/admin/': BACKEND,
      '/api': BACKEND,
      '/v1': BACKEND,
      '/health': BACKEND,
    },
  },
});
