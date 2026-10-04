// Renders the link preview image, public/og.png (1200x630), which
// index.html's og:image points at. KakaoTalk, X and others show it under a
// shared link. Committed, so the web build always carries it.
//
//   npm run og        # node scripts/render-og.mjs
//
// KakaoTalk caches previews: after changing the image, clear the cache at
// https://developers.kakao.com/tool/clear/og
import { launch, ogHtml, renderHtml } from './lib/brand.mjs'

const width = 1200
const height = 630
const browser = await launch()
await renderHtml(browser, ogHtml({ width, height }), { width, height, path: 'public/og.png' })
await browser.close()
console.log(`public/og.png ${width}x${height}`)
