const won = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 })
const price = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 })

export function formatWon(value: number) {
  return `${won.format(Math.round(value))}원`
}

export function formatPrice(value: number) {
  return price.format(Math.round(value))
}

/** 0.1234 -> "+12.34%". Plain hyphen, like Korean brokerage apps. */
export function formatPct(ratio: number, digits = 2) {
  const v = ratio * 100
  const fixed = Math.abs(v).toFixed(digits)
  if (Number(fixed) === 0) return `${(0).toFixed(digits)}%`
  return `${v > 0 ? '+' : '-'}${fixed}%`
}

/** Signed won difference, "+124,000원" / "-3,200원". */
export function formatWonDelta(value: number) {
  const r = Math.round(value)
  if (r === 0) return '0원'
  return `${r > 0 ? '+' : '-'}${won.format(Math.abs(r))}원`
}

export function direction(value: number): 'up' | 'down' | 'flat' {
  if (Math.abs(value) < 1e-9) return 'flat'
  return value > 0 ? 'up' : 'down'
}

export function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}
