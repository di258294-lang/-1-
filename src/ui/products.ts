import { generateMarket, type RoundLength } from '../core/market'
import { PRODUCT_ORDER, PRODUCTS, type ProductKey } from '../core/products'
import { hashString } from '../core/rng'
import { save } from '../core/storage'
import type { Navigate } from './app'
import { h } from './dom'

export function startPractice(go: Navigate, product: ProductKey, length: RoundLength = 'short') {
  const seed = hashString(`practice/${product}/${length}/${Date.now()}/${Math.random()}`)
  go({ name: 'play', mode: { kind: 'practice' }, market: generateMarket(seed, product, length) })
}

/** Bottom sheet: pick what to practice. Locked products say how to open them. */
export function showProductSheet(go: Navigate, length: RoundLength = 'short') {
  const played = save.roundsPlayed()
  const close = () => scrim.remove()
  const pick = (key: ProductKey) => () => {
    close()
    startPractice(go, key, length)
  }

  const rows = PRODUCT_ORDER.map((key) => {
    const p = PRODUCTS[key]
    const open = save.isUnlocked(key)
    return h(
      'button',
      { class: `product-row${open ? '' : ' locked'}`, onclick: open ? pick(key) : undefined, disabled: !open },
      h('span', { class: 'product-name' }, p.name, h('small', null, p.pitch)),
      h(
        'span',
        { class: 'product-state num' },
        open ? h('span', { class: 'chev', 'aria-hidden': 'true' }, '›') : `${p.unlockAt - played}판 더`,
      ),
    )
  })

  const scrim = h(
    'div',
    {
      class: 'sheet-scrim',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'product-title',
      onclick: (e: Event) => e.target === scrim && close(),
    },
    h(
      'div',
      { class: 'sheet' },
      h('h2', { id: 'product-title' }, length === 'long' ? '1년을 5분에, 무엇으로 할까요?' : '무엇으로 연습할까요?'),
      h(
        'p',
        { class: 'sheet-body' },
        length === 'long'
          ? '장기 모드는 1년치 시장을 5분에 보여줘요. 짧은 판에서는 안 보이던 것들이 보여요.'
          : '판을 할수록 새 상품이 열려요. 요일마다 오늘의 차트 상품도 바뀌어요.',
      ),
      h('div', { class: 'product-list' }, ...rows),
    ),
  )
  document.body.append(scrim)
}
