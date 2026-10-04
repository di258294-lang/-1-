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
  plugins: {
    // The opt-in daily reminder (src/ui/reminder.ts).
    LocalNotifications: {
      // android/app/src/main/res/drawable/ic_stat_hold.xml
      smallIcon: 'ic_stat_hold',
      iconColor: '#111418',
      // iOS: show it even while the app is open.
      presentationOptions: ['banner', 'list', 'sound'],
    },
  },
}

export default config
