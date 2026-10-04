import { platform } from '#platform'
import { REMINDER_BODY, REMINDER_PRESETS, REMINDER_TITLE, reminderTimes } from '../core/reach'
import { save } from '../core/storage'
import { h, toast } from './dom'
import { logError } from './errors'

/**
 * The opt-in daily reminder (Capacitor apps only): one local notification a
 * day at a time the player picks, skipped on days already played. Off by
 * default; permission is asked only when the player turns it on. On the web
 * and in Toss, platform.reminders is null and the setting is not shown.
 */

export const reminderAvailable = () => platform.reminders !== null

/**
 * Schedule the next two weeks again from the saved setting, or cancel when it
 * is off. Call at boot and after each recorded daily (ui/reach.ts).
 * Fire-and-forget; never throws.
 */
export function refreshReminders(now = Date.now()): Promise<void> {
  const r = platform.reminders
  if (!r) return Promise.resolve()
  try {
    const { reminder, reminderHour } = save.getSettings()
    if (!reminder) return r.cancelAll()
    const times = reminderTimes(now, reminderHour, (key) => save.daily(key) !== undefined)
    return r.replace(times, REMINDER_TITLE, REMINDER_BODY).catch((err) => logError(err, 'reminder schedule'))
  } catch (err) {
    logError(err, 'reminder refresh')
    return Promise.resolve()
  }
}

/** Turn the reminder on (asking for permission) or off. Resolves with the new state. */
export async function setReminder(on: boolean): Promise<boolean> {
  const r = platform.reminders
  if (!r) return false
  if (!on) {
    save.updateSettings({ reminder: false })
    await r.cancelAll()
    return false
  }
  if ((await r.ensurePermission()) !== 'granted') {
    toast('알림이 꺼져 있어요. 기기 설정에서 HOLD 알림을 허용해 주세요')
    return false
  }
  save.updateSettings({ reminder: true })
  await refreshReminders()
  return true
}

/**
 * The settings sheet's rows: the "매일 알림" switch and, while it is on, the
 * three preset times. Empty where there are no reminders (web, Toss).
 */
export function reminderRows(): HTMLElement[] {
  if (!reminderAvailable()) return []
  let on = save.getSettings().reminder
  let busy = false

  const times = h('div', { role: 'radiogroup', 'aria-label': '알림 시간' })
  // Rows draw their divider only right after another row, so this block
  // draws the next row's line itself: under the presets, or alone when off.
  const SHOWN = 'display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; padding:4px 0 14px; box-shadow:inset 0 -1px var(--grid)'
  const LINE = 'height:1px; background:var(--grid)'
  const drawTimes = () => {
    const hour = save.getSettings().reminderHour
    times.setAttribute('style', on ? SHOWN : LINE)
    if (!on) {
      times.setAttribute('aria-hidden', 'true')
      times.replaceChildren()
      return
    }
    times.removeAttribute('aria-hidden')
    times.replaceChildren(
      ...REMINDER_PRESETS.map((p) =>
        h(
          'button',
          {
            class: `btn ${p.hour === hour ? 'btn-primary' : 'btn-quiet'}`,
            role: 'radio',
            'aria-checked': String(p.hour === hour),
            style: 'height:44px; font-size:15px',
            onclick: () => {
              save.updateSettings({ reminderHour: p.hour })
              drawTimes()
              void refreshReminders()
            },
          },
          p.label,
        ),
      ),
    )
  }

  const btn = h(
    'button',
    { class: 'list-row setting-row', role: 'switch', 'aria-checked': String(on) },
    h('span', { class: 'list-label' }, '매일 알림', h('small', null, '오늘의 차트가 열렸다고 하루 한 번 알려줘요. 이미 한 날은 건너뛰어요')),
    h('span', { class: 'switch', 'aria-hidden': 'true' }),
  )
  btn.addEventListener('click', async () => {
    if (busy) return
    busy = true
    try {
      on = await setReminder(!on)
    } catch (err) {
      logError(err, 'reminder toggle')
    } finally {
      busy = false
      btn.setAttribute('aria-checked', String(on))
      drawTimes()
    }
  })

  drawTimes()
  return [btn, times]
}
