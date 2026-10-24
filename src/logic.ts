// Pure helpers for the Worker. No Cloudflare APIs here, so they run under `node --test` too.

// Lowercase letters and digits without look-alikes (0/o, 1/l/i), so an id can be read aloud.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

/** A random link id, 10 characters (~49 bits): long enough that nobody guesses a live link. */
export function newId(length = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

export function isValidId(id: string): boolean {
  return /^[a-z2-9]{6,32}$/.test(id)
}

// Email security gateways and link-preview fetchers open links before (or instead of) a person.
const BOT_UA = /bot|crawl|spider|preview|scan|safelinks|proofpoint|mimecast|barracuda|symantec|trendmicro|fireeye|forcepoint|sophos|python-requests|curl|wget|go-http|httpclient|okhttp|headless|phantom|slack|whatsapp|telegram|discord|facebookexternalhit|skypeuripreview|google-?inspection|microsoft office|ms-office|outlook-?(ios|android)?-?link/i

/** Seconds after "sent" in which a click is almost surely an automatic scan, not a reader. */
export const FAST_CLICK_SECONDS = 60

/**
 * Why a click looks automatic, or null if it looks like a person. Never deletes anything:
 * the caller stores the reason so both counts stay visible.
 */
export function botReason(method: string, userAgent: string | null, secondsSinceSent: number | null): string | null {
  if (method === 'HEAD') return 'HEAD request'
  if (!userAgent) return 'no user agent'
  if (BOT_UA.test(userAgent)) return 'scanner or preview user agent'
  if (secondsSinceSent !== null && secondsSinceSent >= 0 && secondsSinceSent < FAST_CLICK_SECONDS) {
    return `clicked ${Math.round(secondsSinceSent)}s after sending`
  }
  return null
}

/**
 * A short, salted hash of the visitor's IP: enough to tell repeat clicks apart, without keeping
 * the IP itself.
 */
export async function hashVisitor(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Compares secrets without returning early on the first different character. */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

export type Route =
  | { kind: 'click'; id: string }
  | { kind: 'addLink' }
  | { kind: 'markSent'; id: string }
  | { kind: 'stats' }
  | { kind: 'notFound' }

export function parseRoute(method: string, pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean)
  if ((method === 'GET' || method === 'HEAD') && parts.length === 2 && parts[0] === 'r' && isValidId(parts[1])) {
    return { kind: 'click', id: parts[1] }
  }
  if (parts[0] === 'api') {
    if (method === 'POST' && parts.length === 2 && parts[1] === 'links') return { kind: 'addLink' }
    if (method === 'POST' && parts.length === 4 && parts[1] === 'links' && parts[3] === 'sent' && isValidId(parts[2])) {
      return { kind: 'markSent', id: parts[2] }
    }
    if (method === 'GET' && parts.length === 2 && parts[1] === 'stats') return { kind: 'stats' }
  }
  return { kind: 'notFound' }
}
