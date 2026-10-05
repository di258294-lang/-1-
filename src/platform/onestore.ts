/**
 * ONE store web game (H5) bridge. ONE store opens the game's URL inside its
 * own iframe and requires its H5 SDK even for a free game with no ads or
 * payments: initialize, report loading, then declare the game ready so the
 * app removes its native loading screen.
 *
 * The SDK is loaded only for the URL registered in ONEconsole, which carries
 * `?store=onestore`; the plain web build, the native apps and Apps in Toss
 * never fetch it. Docs: https://onestore-dev.gitbook.io/dev/tools/web-sdk
 */

const SDK_VERSION = 'v1.1.0'
const SDK_URL = `https://h5sdk.onestore.net/lib/${SDK_VERSION}/onestore-h5-sdk.min.js`

type OneStoreSdk = {
  on(event: 'pause' | 'resume' | 'exit', fn: (ev?: unknown) => void): void
  onBackPressed(fn: () => boolean): void
  initializeAsync(): Promise<{ err?: unknown } | undefined>
  setLoadingProgress(progress: number): void
  startGameAsync(): Promise<void>
}

export type OneStoreSession = {
  /** Call once the first screen is on: ONE store then shows the game. */
  ready(): void
}

export function isOneStore(search = typeof location === 'undefined' ? '' : location.search) {
  try {
    return new URLSearchParams(search).get('store') === 'onestore'
  } catch {
    return false
  }
}

/**
 * Starts the SDK when running as the ONE store web game, without holding the
 * first paint: the import and handshake run in the background, and
 * `ready()` declares the game started once both the first screen and the SDK
 * are up (in either order). `onBack` is the game's own back handler (true =
 * handled); otherwise the app shows its exit confirmation. Returns null
 * outside ONE store; any SDK failure is reported and the game keeps running.
 */
export function startOneStore(onBack: () => boolean, onError: (err: unknown) => void): OneStoreSession | null {
  if (!isOneStore()) return null
  const sdkReady = connect(onBack).catch((err) => {
    onError(err)
    return null
  })
  let started = false
  return {
    ready() {
      if (started) return
      started = true
      void sdkReady.then((sdk) => {
        if (!sdk) return
        // Everything is bundled: loading is done once the first screen is on.
        sdk.setLoadingProgress(100)
        sdk.startGameAsync().catch(onError)
      })
    },
  }
}

async function connect(onBack: () => boolean): Promise<OneStoreSdk> {
  const mod = (await import(/* @vite-ignore */ SDK_URL)) as { createSDK(): OneStoreSdk }
  const sdk = mod.createSDK()
  // Listeners before initializeAsync, as the SDK asks. The app going to the
  // background (or an ad) pauses the round the same way losing window focus
  // does; resume hands it back.
  sdk.on('pause', () => window.dispatchEvent(new Event('blur')))
  sdk.on('resume', () => window.dispatchEvent(new Event('focus')))
  // Saves are written synchronously as they happen: nothing to flush.
  sdk.on('exit', () => {})
  sdk.onBackPressed(() => {
    try {
      return onBack() === true
    } catch {
      return false
    }
  })
  const info = await sdk.initializeAsync()
  if (info && info.err) throw new Error('ONE store SDK: unsupported environment')
  return sdk
}
