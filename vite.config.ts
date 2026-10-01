import { defineConfig } from 'vite'

export default defineConfig({
  // Relative asset paths, so the same build works inside the native apps
  // and under a GitHub Pages sub-path.
  base: './',
})
