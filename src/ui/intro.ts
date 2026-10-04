import { virtualWon } from '../core/copy'
import { NEWS_LEAD_TICKS, TICKS_PER_SECOND } from '../core/market'
import { PRODUCT_ORDER, PRODUCTS } from '../core/products'
import { SEASON_START } from '../core/season'
import { save } from '../core/storage'
import { h } from './dom'
import { openSheet } from './sheet'

const pct = (x: number) => `${+(x * 100).toFixed(2)}%`

/** "0.05~0.1%" across every product, so the rule stays true as products change. */
function feeRange() {
  const fees = PRODUCT_ORDER.map((k) => PRODUCTS[k].fee)
  const lo = Math.min(...fees)
  const hi = Math.max(...fees)
  return lo === hi ? pct(lo) : `${+(lo * 100).toFixed(2)}~${pct(hi)}`
}

/** Shown once in the rules and once in the tutorial. */
export const DISCLAIMER = '등장하는 회사·코인·뉴스·가격은 모두 지어낸 것이에요. 실제 돈은 오가지 않고, 투자 권유나 조언이 아니에요.'

/**
 * The rules, a few lines and one button. First launch now goes through the
 * tutorial round instead; this stays for "게임 방법" in settings and as a
 * fallback. Esc closes without calling onDone.
 */
export function showIntro(onDone: () => void) {
  const lead = `${(NEWS_LEAD_TICKS / TICKS_PER_SECOND).toFixed(1)}초`
  let toggle = false
  try {
    toggle = save.getSettings().tapToggle
  } catch {
    // Default controls.
  }
  let close = () => {}
  const li = (bold: string, rest = '') => h('li', null, h('span', null, h('b', null, bold), rest ? ` ${rest}` : ''))
  const scrim = h(
    'div',
    { class: 'sheet-scrim', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'intro-title' },
    h(
      'div',
      { class: 'sheet sheet-scroll' },
      h('h2', { id: 'intro-title' }, '목표: 그냥 계속 들고 있는 것보다', h('br'), '더 버는 것'),
      h(
        'ul',
        { class: 'rules' },
        toggle
          ? li('한 번 톡 치면 사고, 한 번 더 치면 팔아요.', '한 판 동안 몇 번이든 괜찮아요.')
          : li('손가락을 대고 있는 동안만 산 상태예요.', '떼면 팔아요. 한 판 동안 몇 번이든 괜찮아요.'),
        li(`사고팔 때마다 수수료 ${feeRange()}가 빠져요.`, '너무 자주 하면 손해예요.'),
        li(`뉴스가 뜨고 ${lead} 뒤에 가격이 움직여요.`, '이 게임에서 공식 발표는 항상 사실이고, 소문은 반만 맞아요.'),
        li('안 들고 있을 땐 현금에 이자가 조금 붙어요.', '그래서 안 사도 돈이 조금 늘어요.'),
        li(`오늘의 차트 결과는 ${virtualWon(SEASON_START)} 계좌에 한 달 동안 쌓여요.`),
      ),
      h('p', { class: 'sheet-note' }, 'HOLD는 가상 돈으로 하는 연습 게임이에요. ', DISCLAIMER),
      h(
        'button',
        {
          class: 'btn btn-primary',
          onclick: () => {
            close()
            onDone()
          },
        },
        '알겠어요',
      ),
    ),
  )
  close = openSheet(scrim)
}
