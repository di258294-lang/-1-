import { expect, test } from '@playwright/test'

test('home loads without page errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })

  await page.goto('./')
  await expect(page.locator('.wordmark')).toHaveText('HOLD')
  await expect(page.locator('canvas').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)

  expect(errors).toEqual([])
})
