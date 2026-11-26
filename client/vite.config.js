import { defineConfig } from 'vite'

// VITE_BASE is "/<repo-name>/" on GitHub Pages (set by the workflow); "./" works for Docker/nginx and dev.
export default defineConfig({
  base: process.env.VITE_BASE || './',
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 1500 },
})
