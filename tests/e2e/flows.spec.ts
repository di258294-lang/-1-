import { expect, test, type Page } from '@playwright/test'
import { encodeChallenge } from '../../src/core/challenge'
import { dailySeed, dateKey, dayNumber } from '../../src/core/daily'
import { dailyProduct } from '../../src/core/products'

// Whole flows against the production build, with Playwright's fake clock
// driving the round (timers and requestAnimationFrame).

/** A returning player: the tutorial is done, so 시작하기 opens the daily. */
async function returningPlayer(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('hold.save.v1')) localStorage.setItem('hold.save.v1', JSON.stringify({ v: 2, seenIntro: true }))
  })
}

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('hold.save.v1') ?? '{}'))

test('first launch: tutorial round records nothing, then the daily is offered', async ({ page }) => {
  await page.clock.install()
  await page.goto('./')
  await page.getByRole('button', { name: '시작하기' }).click()
  await expect(page.locator('.equity-label')).toContainText('처음 연습')
  const pad = page.locator('.pad')
  await page.clock.runFor(3000) // countdown
  await pad.dispatchEvent('pointerdown', { pointerId: 1, button: 0 })
  await page.clock.runFor(4000)
  await pad.dispatchEvent('pointerup', { pointerId: 1, button: 0 })
  await page.clock.runFor(60_000)
  // The handoff card says the next one is real, and its button starts it (ux2 P1-7).
  await expect(page.getByText('이번엔 진짜예요')).toBeVisible()
  await expect(page.getByRole('button', { name: '오늘의 차트 시작' })).toBeVisible()
  const save = await saved(page)
  expect(save.seenIntro).toBe(true)
  expect(save.practice?.rounds ?? 0).toBe(0)
  expect(save.habits ?? []).toHaveLength(0)
  expect(save.coach?.lessons ?? []).toHaveLength(0)
  await page.getByRole('button', { name: '오늘의 차트 시작' }).click()
  await expect(page.locator('.equity-label')).toContainText('오늘의 차트 #')
})

test('a tapper is caught by the tutorial and offered another try first', async ({ page }) => {
  await page.clock.install()
  await page.goto('./')
  await page.getByRole('button', { name: '시작하기' }).click()
  const pad = page.locator('.pad')
  await page.clock.runFor(3000)
  for (let i = 0; i < 6; i++) {
    await page.clock.runFor(1500)
    await pad.dispatchEvent('pointerdown', { pointerId: 1, button: 0 })
    await page.clock.runFor(150)
    await pad.dispatchEvent('pointerup', { pointerId: 1, button: 0 })
  }
  await page.clock.runFor(60_000)
  await expect(page.locator('h1')).toHaveText("아직 '계속 누르기'가 안 됐어요")
  await expect(page.locator('.btn-primary')).toHaveText('한 번 더 연습')
  await expect(page.getByText('연습이라 기록에는 남지 않아요.')).toBeVisible()
  // Not learned yet: home's 시작하기 still leads to the tutorial (qa3 P2-2).
  expect((await saved(page)).seenIntro ?? false).toBe(false)
})

// arch2 P1-1, QA #7: the one intro gate (ui/gate.ts) shows the rules for a
// replay without marking the intro seen.
test('records replay before the tutorial must not skip the tutorial', async ({ page }) => {
  await page.goto('./')
  // First launch shows only 시작하기; records open from the week strip's sheet.
  await page.locator('.wk-strip').click()
  await page.getByRole('button', { name: '기록 보기' }).click()
  await expect(page.locator('h1')).toHaveText('내 기록')
  await page.locator('button.cal-cell').first().click()
  await page.getByRole('button', { name: '해볼게요' }).click()
  await page.getByRole('button', { name: '알겠어요' }).click()
  await page.goto('./')
  await page.getByRole('button', { name: '시작하기' }).click()
  await expect(page.locator('.equity-label')).toContainText('처음 연습')
})

test("a challenge on today's daily is held back until the daily is played, and ?c= is stripped", async ({ page }) => {
  const today = dateKey()
  const code = encodeChallenge({
    seed: dailySeed(today),
    product: dailyProduct(today),
    length: 'short',
    ret: 0.042,
    day: dayNumber(today),
    luck: null,
    name: '민수',
  })
  await page.goto(`./?c=${code}`)
  await expect(page.getByRole('dialog')).toContainText('민수 님이 오늘의 차트로 도전장을 보냈어요')
  await expect(page.getByRole('button', { name: '오늘의 차트부터 할게요' })).toBeVisible()
  expect(new URL(page.url()).searchParams.has('c')).toBe(false)
  // Kept for the daily's result screen (ux2 P0-2).
  expect((await saved(page)).pendingChallenge).toBe(code)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('daily: reload mid-round keeps the checkpoint and the daily cannot be replayed', async ({ page }) => {
  await returningPlayer(page)
  await page.clock.install()
  await page.goto('./')
  await page.getByRole('button', { name: '시작하기' }).click()
  const pad = page.locator('.pad')
  await page.clock.runFor(3000)
  await pad.dispatchEvent('pointerdown', { pointerId: 1, button: 0 })
  await page.clock.runFor(5000)
  await pad.dispatchEvent('pointerup', { pointerId: 1, button: 0 })
  await page.clock.runFor(2000)
  const mid = await page.evaluate(() => ({
    daily: JSON.parse(localStorage.getItem('hold.save.v1')!).daily,
    live: JSON.parse(localStorage.getItem('hold.live') ?? 'null'),
  }))
  const [key] = Object.keys(mid.daily)
  // The placeholder is in the save; the checkpoints go to the small live record.
  expect(mid.daily[key].abandoned).toBe(true)
  expect(mid.live.key).toBe(key)
  expect(mid.live.held.length).toBeGreaterThan(0)
  expect(mid.live.yourReturn).not.toBe(0)
  // The tab asks before leaving a live daily; this test leaves anyway.
  page.on('dialog', (d) => void d.accept())
  await page.reload()
  await expect(page.locator('.home-title')).toHaveText('오늘 차트는 끝났어요')
  await expect(page.getByRole('button', { name: '시작하기' })).toHaveCount(0)
})

test('daily: the back button asks first, pauses, and resumes after the count', async ({ page }) => {
  await returningPlayer(page)
  await page.clock.install()
  await page.goto('./')
  await page.getByRole('button', { name: '시작하기' }).click()
  await expect(page.locator('.equity-label')).toContainText('오늘의 차트 #')
  await page.clock.runFor(3000) // countdown
  await page.clock.runFor(5000)

  // Browser back reaches the game (history guard), like the Android button.
  await page.goBack()
  const sheet = page.getByRole('alertdialog')
  await expect(sheet).toContainText('오늘 차트를 여기서 끝낼까요?')
  await expect(page).toHaveURL(/localhost/)
  const clock = page.locator('.play-clock')
  const paused = await clock.textContent()
  await page.clock.runFor(3000)
  await expect(clock).toHaveText(paused!)

  await sheet.getByRole('button', { name: '계속하기' }).click()
  await expect(sheet).toHaveCount(0)
  await page.clock.runFor(500) // still inside the 1-second resume count
  await expect(clock).toHaveText(paused!)
  await page.clock.runFor(2500)
  await expect(clock).not.toHaveText(paused!)

  // The close button asks the same; ending there records the day.
  await page.getByRole('button', { name: '나가기' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '여기서 끝내기' }).click()
  await expect(page.getByText(/오늘의 차트 #/).first()).toBeVisible()
  await expect(page.locator('.play')).toHaveCount(0)
  const save = await saved(page)
  const [key] = Object.keys(save.daily)
  expect(save.daily[key].abandoned).toBeUndefined()
})

test('settings: the privacy policy opens inside the game', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: '설정' }).click()
  await page.getByRole('button', { name: '개인정보 처리방침' }).click()
  const sheet = page.getByRole('dialog', { name: '개인정보 처리방침' })
  await expect(sheet).toContainText('개인정보를 수집하지 않아요')
  expect(new URL(page.url()).pathname).not.toContain('privacy')
  expect(page.context().pages()).toHaveLength(1)
})
