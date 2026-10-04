/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import { defineConfig, type PluginOption } from 'vite'

// `--mode toss` builds the Apps in Toss mini-app into dist-toss/ with the
// Toss SDK platform. Every other mode (dev, build, test) builds the web and
// Capacitor bundle into dist/, which never references the Toss SDK.
export default defineConfig(async ({ command, mode }) => {
  const toss = mode === 'toss'
  // scripts/build-single.py: one JS chunk with every asset inlined.
  const single = mode === 'single'
  const plugins: PluginOption[] = []
  if (toss && command === 'serve') {
    // Mocks the Toss SDK in a desktop browser and adds the AIT devtools panel.
    // Dev-only: never part of a build.
    const { default: aitDevtools } = await import('@apps-in-toss/devtools/unplugin')
    plugins.push(aitDevtools.vite())
  }

  return {
    // Relative asset paths, so the same build works inside the native apps,
    // the Toss WebView and under a GitHub Pages sub-path.
    base: './',
    plugins,
    resolve: {
      alias: {
        '#platform': fileURLToPath(new URL(toss ? './src/platform/toss.ts' : './src/platform/web.ts', import.meta.url)),
      },
    },
    build: {
      // Capacitor's webDir stays dist/.
      outDir: toss ? 'dist-toss' : single ? 'dist-single' : 'dist',
      emptyOutDir: true,
      ...(single && {
        assetsInlineLimit: () => true,
        rollupOptions: { output: { inlineDynamicImports: true } },
      }),
    },
    test: {
      // Unit tests only; Playwright owns tests/e2e (npm run test:e2e).
      include: ['src/**/*.test.ts'],
    },
  }
})
