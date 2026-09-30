import { h } from './dom'

export function confirmSheet(opts: {
  title: string
  body: string
  confirm: string
  cancel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const done = (fn: () => void) => () => {
    scrim.remove()
    fn()
  }
  const scrim = h(
    'div',
    { class: 'sheet-scrim', role: 'alertdialog', 'aria-modal': 'true' },
    h(
      'div',
      { class: 'sheet' },
      h('h2', null, opts.title),
      h('p', { class: 'sheet-body' }, opts.body),
      h(
        'div',
        { class: 'sheet-actions' },
        h('button', { class: 'btn btn-quiet', onclick: done(opts.onConfirm) }, opts.confirm),
        h('button', { class: 'btn btn-primary', onclick: done(opts.onCancel) }, opts.cancel),
      ),
    ),
  )
  document.body.append(scrim)
}
