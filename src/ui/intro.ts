import { h } from './dom'

/** First-run rules. Three lines, one button. */
export function showIntro(onDone: () => void) {
  const close = () => {
    scrim.remove()
    onDone()
  }
  const scrim = h(
    'div',
    { class: 'sheet-scrim', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'intro-title' },
    h(
      'div',
      { class: 'sheet' },
      h('h2', { id: 'intro-title' }, '누르고 있는 동안만', h('br'), '주식을 들고 있어요'),
      h(
        'ul',
        { class: 'rules' },
        h('li', null, h('span', null, h('b', null, '손가락을 대면 사고, 떼면 팔아요.'), ' 40초 동안 몇 번이든 괜찮아요.')),
        h('li', null, h('span', null, h('b', null, '사고팔 때마다 수수료 0.1%'), '가 빠져요. 너무 자주 누르면 손해예요.')),
        h('li', null, h('span', null, h('b', null, '뉴스가 뜨고 1.5초 뒤에 가격이 움직여요.'), ' 공시는 믿어도 되지만 지라시는 반은 틀려요.')),
        h('li', null, h('span', null, h('b', null, '오늘의 차트 결과는 한 달 동안 계좌에 쌓여요.'), ' 판이 끝날 때마다 내 매매 습관도 알려줘요.')),
      ),
      h('button', { class: 'btn btn-primary', onclick: close }, '알겠어요'),
    ),
  )
  document.body.append(scrim)
}
