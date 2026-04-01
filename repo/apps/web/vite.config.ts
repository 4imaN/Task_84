import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const devApiTarget = process.env.VITE_DEV_API_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 4173,
    proxy: {
      '/auth': devApiTarget,
      '/graphql': devApiTarget,
      '/profiles': devApiTarget,
      '/community': devApiTarget,
      '/pos': devApiTarget,
      '/attendance': devApiTarget,
      '/moderation': devApiTarget,
      '/admin': devApiTarget,
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: true,
  },
});
