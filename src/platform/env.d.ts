/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Link appended to share texts on web and in the Capacitor apps. */
  readonly VITE_SHARE_URL?: string
  /** Apps in Toss appName (console). Used for intoss:// share links. */
  readonly VITE_AIT_APP_NAME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
