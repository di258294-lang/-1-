import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  // Store identifier. It can never change after the first upload, so pick
  // the final one before submitting (see docs/RELEASE.md).
  appId: 'com.holdgame.app',
  appName: 'HOLD',
  webDir: 'dist',
  backgroundColor: '#f2f3f5',
  ios: {
    contentInset: 'never',
  },
  android: {
    backgroundColor: '#f2f3f5',
  },
}

export default config
