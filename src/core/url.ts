/** `base` with `query` (already URL-encoded, e.g. "c=AbC") appended, keeping any query or hash it already has. */
export function withQuery(base: string, query: string) {
  const hashAt = base.indexOf('#')
  const head = hashAt < 0 ? base : base.slice(0, hashAt)
  const hash = hashAt < 0 ? '' : base.slice(hashAt)
  const sep = head.includes('?') ? (/[?&]$/.test(head) ? '' : '&') : '?'
  return `${head}${sep}${query}${hash}`
}
