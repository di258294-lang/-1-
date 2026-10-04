import { expect, test, type Page } from '@playwright/test'

// Browser back, two tabs on one save, and storage that can't keep a round
// (qa3 P1-1, P2-6, P2-9).

const SEEN = JSON.stringify({ v: 2, seenIntro: true })

async function seed(page: Page, raw = SEEN) {
  await page.addInitScript((r) => {
    if (!localStorage.getItem('hold.save.v1')) localStorage.setItem('hold.save.v1', r)
  }, raw)
}

/** Where the tab is in its history, from the browser itself. */
async function navIndex(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  const h = await cdp.send('Page.getNavigationHistory')
  await cdp.detach()
  return { index: h.currentIndex, length: h.entries.length }
}

test('back on home leaves the page when HOLD is the first page of the tab', async ({ page }) => {
  await seed(page)
  await page.goto('./')
  await expect(page.locator('.home-title')).toBeVisible()
  // A new tab or an in-app browser: nothing before the game.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Page.resetNavigationHistory')
  await cdp.detach()
  expect(await navIndex(page)).toEqual({ index: 0, length: 1 })

  // The first tap arms the guard.
  await page.locator('.wordmark').click()
  await expect.poll(() => navIndex(page)).toEqual({ index: 1, length: 2 })

  // Back on a sheet is the game's: the sheet closes and the guard goes back up.
  await page.getByRole('button', { name: '설정' }).click()
  await expect(page.locator('.sheet-scrim')).toHaveCount(1)
  await page.goBack({ waitUntil: 'commit' })
  await expect(page.locator('.sheet-scrim')).toHaveCount(0)
  await expect.poll(() => navIndex(page)).toEqual({ index: 1, length: 2 })

  // Back on home is not: the guard stays down, so the tab is at its first
  // entry and the next back closes the in-app browser (before the fix the
  // guard was re-pushed every time and back could never leave).
  await page.goBack({ waitUntil: 'commit' })
  await expect.poll(() => navIndex(page)).toEqual({ index: 0, length: 2 })
  await page.waitForTimeout(300)
  expect((await navIndex(page)).index).toBe(0)
  await expect(page.locator('.home-title')).toBeVisible()
})

test('back on home returns to the page the player came from', async ({ page }) => {
  await seed(page)
  await page.goto('./privacy.html')
  await page.goto('./')
  await page.locator('.wordmark').click()
  await expect.poll(() => page.evaluate(() => (history.state as { holdBack?: boolean } | null)?.holdBack)).toBe(true)
  await page.goBack({ waitUntil: 'commit' })
  await expect(page).toHaveURL(/privacy\.html$/)
})

test("another tab's daily doesn't close this tab's open sheet; home catches up when it closes", async ({ context }) => {
  const a = await context.newPage()
  await seed(a)
  await a.clock.install()
  await a.goto('./')
  const b = await context.newPage()
  await b.goto('./')
  await expect(b.locator('.home-title')).toHaveText(/오늘은/)
  await b.getByRole('button', { name: '설정' }).click()
  await expect(b.locator('.sheet-scrim')).toHaveCount(1)

  // A goes live: its placeholder write reaches B as a storage event.
  await a.getByRole('button', { name: '시작하기' }).click()
  await a.clock.runFor(3000)
  await a.clock.runFor(2000)
  await expect.poll(() => b.evaluate(() => JSON.parse(localStorage.getItem('hold.save.v1') ?? '{}').daily)).toBeTruthy()
  await b.waitForTimeout(200)
  await expect(b.locator('.sheet-scrim')).toHaveCount(1)
  await expect(b.locator('.home-title')).toHaveText(/오늘은/)

  await b.keyboard.press('Escape')
  await expect(b.locator('.sheet-scrim')).toHaveCount(0)
  await expect(b.locator('.home-title')).toHaveText('오늘 차트는 끝났어요')
})

test('a save from a newer version: home offers practice instead of a daily that would not be kept', async ({ page }) => {
  await seed(page, JSON.stringify({ v: 99, seenIntro: true }))
  await page.goto('./')
  await expect(page.locator('.home-actions .storage-warn')).toBeVisible()
  await expect(page.getByRole('button', { name: '시작하기' })).toHaveCount(0)
  await expect(page.locator('.home-actions .btn-primary')).toHaveText('연습 한 판')
})

test('blocked storage: warned at once, and the tutorial runs only once per session', async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem
    Storage.prototype.getItem = function (k: string) {
      if (k === 'hold.save.v1') throw new DOMException('denied', 'SecurityError')
      return get.call(this, k)
    }
  })
  await page.clock.install()
  await page.goto('./')
  await expect(page.locator('.home-actions .storage-warn')).toBeVisible()
  await expect(page.getByRole('button', { name: '시작하기' })).toHaveCount(0)
  await page.getByRole('button', { name: '연습 한 판' }).click()
  await expect(page.locator('.equity-label')).toContainText('처음 연습')
  const pad = page.locator('.pad')
  await page.clock.runFor(3000)
  await pad.dispatchEvent('pointerdown', { pointerId: 1, button: 0 })
  await page.clock.runFor(4000)
  await pad.dispatchEvent('pointerup', { pointerId: 1, button: 0 })
  await page.clock.runFor(60_000)
  await expect(page.getByText('연습이라 기록에는 남지 않아요.')).toBeVisible()
  await page.goBack({ waitUntil: 'commit' }).catch(() => {})
  await expect(page.locator('.home-actions')).toBeVisible()
  await page.getByRole('button', { name: '연습 한 판' }).click()
  // Seen for this session: practice, not the tutorial again.
  await expect(page.locator('.equity-label')).not.toContainText('처음 연습')
})

// qa3 P2-11: on short screens the teaser chart is either a real chart or
// gone (with its label), and 시작하기 is fully on screen.
for (const viewport of [
  { width: 288, height: 512 },
  { width: 320, height: 568 },
  { width: 360, height: 640 },
]) {
  test.describe(`home at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport })

    for (const recap of [false, true]) {
      test(`a returning player sees all of 시작하기 and no sliver of a chart${recap ? ' (month recap showing)' : ''}`, async ({ page }) => {
        const d = (product: string) => ({ yourReturn: 0.01, buyHoldReturn: 0.02, held: '0.2s.8c', trades: 2, title: 't', product })
        const daily = { '2026-09-01': d('coin'), '2026-09-02': d('stock') }
        // An unseen closed month puts its recap card on home (the scrolling layout).
        await seed(page, JSON.stringify({ v: 2, seenIntro: true, daily, seenSeasons: recap ? [] : ['2026-09'] }))
        await page.goto('./')
        await page.evaluate(() => document.fonts.ready)
        const start = page.getByRole('button', { name: '시작하기' })
        await expect(start).toBeVisible()
        await expect
          .poll(async () => {
            const box = await start.boundingBox()
            return box !== null && box.y >= 0 && box.y + box.height <= viewport.height
          })
          .toBe(true)
        const canvas = page.locator('.teaser canvas')
        const label = page.locator('.teaser-flow')
        if (await canvas.isVisible()) {
          expect((await canvas.boundingBox())!.height).toBeGreaterThanOrEqual(40)
          await expect(label).toBeVisible()
        } else {
          await expect(label).toBeHidden()
          await expect(page.locator('.quote-price')).toBeVisible()
        }
        if (recap) await expect(page.locator('.recap-card')).toBeVisible()
      })
    }
  })
}
