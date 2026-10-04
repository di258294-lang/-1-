import { defineConfig } from '@apps-in-toss/web-framework/config'
import { loadEnv } from 'vite'

// Apps in Toss (SDK 3.x) mini-app config, read by `ait build` / `ait deploy`.
// appName must match the app registered in the Apps in Toss console; set it in
// .env.toss (VITE_AIT_APP_NAME) so the app's intoss:// share links match.
// The display name and icon are managed in the console, not here.
const env = loadEnv('toss', process.cwd(), 'VITE_')
const appName = env.VITE_AIT_APP_NAME?.trim() ?? ''
// A placeholder name would ship intoss://TODO share links: refuse to build.
if (!appName || /^todo/i.test(appName)) {
  throw new Error(`apps-in-toss.config.ts: set VITE_AIT_APP_NAME in .env.toss to the console appName (now "${appName}")`)
}

export default defineConfig({
  appName,
  brand: {
    primaryColor: '#111418',
  },
  // Games get the transparent bar: only the more/close capsule floats at the
  // top right (see the .toss rules at the end of src/styles.css).
  navigationBar: {
    transparentBackground: true,
  },
  webView: {
    bounces: false,
    pullToRefreshEnabled: false,
    overScrollMode: 'never',
    allowsBackForwardNavigationGestures: false,
  },
  permissions: [],
  webBundleDir: 'dist-toss',
})
