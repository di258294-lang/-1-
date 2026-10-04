import { platform } from '#platform'
import { save } from '../core/storage'
import type { ToggleKey } from '../core/types'
import { setSoundEnabled } from './audio'
import { h, haptic } from './dom'
import { logError } from './errors'
import { showIntro } from './intro'
import { reminderRows } from './reminder'
import { openSheet } from './sheet'

/** Files that ship next to index.html (public/). Relative, so sub-paths and app shells work. */
const PRIVACY_URL = 'privacy.html'
const LICENSES_URL = 'licenses.txt'

/** The font's notice, as compliance gave it (the heading stands in for the dash). */
const FONT_NAME = 'Pretendard'
const FONT_NOTICE = 'Copyright (c) 2021, Kil Hyung-jin, with Reserved Font Name Pretendard. SIL Open Font License 1.1'

/**
 * The privacy policy's blocks as plain elements: headings, paragraphs and
 * list items, with outside links opened by the platform (never inside the
 * game's WebView).
 */
function docBlocks(html: string): HTMLElement[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const body = doc.querySelector('main') ?? doc.body
  const out: HTMLElement[] = []
  for (const el of body.querySelectorAll('h1, h2, h3, p, li')) {
    // The sheet has its own title.
    if (el.tagName === 'H1') continue
    const block = el.tagName.startsWith('H')
      ? h('h3', { class: 'doc-heading' })
      : h('p', { class: 'sheet-body' }, el.tagName === 'LI' ? '· ' : '')
    for (const node of el.childNodes) {
      if (node.nodeName === 'A') {
        const a = node as HTMLAnchorElement
        const href = a.getAttribute('href') ?? ''
        const abs = /^https?:/.test(href) ? href : null
        block.append(
          abs
            ? h('a', { href: abs, onclick: (e: Event) => (e.preventDefault(), void platform.openUrl(abs)) }, a.textContent ?? '')
            : (a.textContent ?? ''),
        )
      } else {
        block.append(node.textContent ?? '')
      }
    }
    out.push(block)
  }
  return out
}

/**
 * A bundled document (public/) shown inside a sheet, so the game never
 * navigates away from itself (no way back in a Capacitor or Toss WebView).
 */
function docSheet(title: string, path: string, render: (text: string) => HTMLElement[]) {
  let close = () => {}
  const content = h('div', { class: 'doc-body' }, h('p', { class: 'sheet-body' }, '불러오는 중이에요'))
  const scrim = h(
    'div',
    {
      class: 'sheet-scrim',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title,
      onclick: (e: Event) => e.target === scrim && close(),
    },
    h(
      'div',
      { class: 'sheet sheet-scroll' },
      h('h2', null, title),
      content,
      h('button', { class: 'btn btn-primary', onclick: () => close() }, '닫기'),
    ),
  )
  close = openSheet(scrim)
  fetch(path)
    .then((res) => {
      if (!res.ok) throw new Error(`${path}: ${res.status}`)
      return res.text()
    })
    .then((text) => content.replaceChildren(...render(text)))
    .catch((err) => {
      logError(err, 'docSheet')
      content.replaceChildren(h('p', { class: 'sheet-body' }, '지금은 불러오지 못했어요. 잠시 뒤에 다시 열어 주세요.'))
    })
}

const showPrivacy = () => docSheet('개인정보 처리방침', PRIVACY_URL, docBlocks)
const showLicenseList = () =>
  docSheet('오픈소스 라이선스', LICENSES_URL, (text) => [
    h('pre', { class: 'sheet-body license-text', lang: 'en', style: 'white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px' }, text),
  ])

const ROWS: Array<{ key: ToggleKey; label: string; sub: string }> = [
  { key: 'sound', label: '소리', sub: '사고팔 때와 뉴스가 뜰 때 작은 소리가 나요' },
  { key: 'haptics', label: '진동', sub: '사고팔 때 살짝 떨려요' },
  { key: 'tapToggle', label: '탭으로 사고팔기', sub: '한 번 톡 치면 사고, 한 번 더 치면 팔아요. 계속 누르기 힘들 때 써요' },
]

function switchRow(key: ToggleKey, label: string, sub: string) {
  let on = save.getSettings()[key]
  const knob = h('span', { class: 'switch', 'aria-hidden': 'true' })
  const btn = h(
    'button',
    { class: 'list-row setting-row', role: 'switch', 'aria-checked': String(on) },
    h('span', { class: 'list-label' }, label, h('small', null, sub)),
    knob,
  )
  btn.addEventListener('click', () => {
    on = save.updateSettings({ [key]: !on })[key]
    btn.setAttribute('aria-checked', String(on))
    if (key === 'sound') setSoundEnabled(on)
    if (key === 'haptics' && on) haptic(10)
  })
  return btn
}

function linkRow(label: string, onclick: () => void) {
  return h(
    'button',
    { class: 'list-row', onclick },
    h('span', { class: 'list-label' }, label),
    h('span', { class: 'list-value' }, h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')),
  )
}

/** Open source notices: the font's OFL line, and the full list in licenses.txt. */
function showLicenses() {
  let close = () => {}
  const scrim = h(
    'div',
    {
      class: 'sheet-scrim',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'licenses-title',
      onclick: (e: Event) => e.target === scrim && close(),
    },
    h(
      'div',
      { class: 'sheet sheet-scroll' },
      h('h2', { id: 'licenses-title' }, '오픈소스 라이선스'),
      h('p', { class: 'sheet-body license-text', lang: 'en' }, h('b', null, FONT_NAME), h('br'), FONT_NOTICE),
      h(
        'div',
        { class: 'sheet-actions' },
        h('button', { class: 'btn btn-quiet', onclick: () => showLicenseList() }, '전체 보기'),
        h('button', { class: 'btn btn-primary', onclick: () => close() }, '닫기'),
      ),
    ),
  )
  close = openSheet(scrim)
}

/** Settings sheet. The integrator opens it from a button in the home top bar. */
export function openSettings() {
  let close = () => {}
  const scrim = h(
    'div',
    {
      class: 'sheet-scrim',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'settings-title',
      onclick: (e: Event) => e.target === scrim && close(),
    },
    h(
      'div',
      { class: 'sheet sheet-scroll' },
      h('h2', { id: 'settings-title' }, '설정'),
      h(
        'div',
        { class: 'settings-list' },
        ...ROWS.map((r) => switchRow(r.key, r.label, r.sub)),
        // The opt-in daily reminder: only in the Capacitor apps.
        ...reminderRows(),
        linkRow('게임 방법', () => {
          close()
          showIntro(() => {})
        }),
        linkRow('개인정보 처리방침', showPrivacy),
        linkRow('오픈소스 라이선스', showLicenses),
      ),
      h('p', { class: 'sheet-note' }, '실제 돈으로 하는 매매를 멈추기 어렵다면 도박문제 상담전화 1336에서 도움을 받을 수 있어요.'),
      h('button', { class: 'btn btn-primary', onclick: () => close() }, '닫기'),
    ),
  )
  close = openSheet(scrim)
}
