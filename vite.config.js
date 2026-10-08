import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Path relatif supaya hasil build bisa diletakkan di sub-folder (mis. GitHub Pages).
  base: './',
  server: { port: 5173 },
  preview: { port: 4173 },
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
  },
});
