// Pure helpers for the Worker. No Cloudflare APIs here, so they run under `node --test` too.

// Lowercase letters and digits without look-alikes (0/o, 1/l/i), so an id can be read aloud.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

function randomPart(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

/** "Acme Corp, Head of Data" -> "acme-corp": the part before a comma or bracket, as a URL slug. */
export function slugify(text: string): string {
  return text
    .split(/[,(]/)[0]
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // drop accents: "zürich" -> "zurich"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/, '')
}

/**
 * A link id. With a name it reads like "acme-k3f9": readable, plus 4 random characters so one
 * company's link doesn't reveal another's. Without a name it is 10 random characters (~49 bits).
 */
export function newId(name = ''): string {
  const slug = slugify(name)
  return slug ? `${slug}-${randomPart(4)}` : randomPart(10)
}

export function isValidId(id: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{4,38}[a-z0-9])$/.test(id)
}

// Email security gateways and link-preview fetchers open links before (or instead of) a person.
const BOT_UA = /bot|crawl|spider|preview|scan|safelinks|proofpoint|mimecast|barracuda|symantec|trendmicro|fireeye|forcepoint|sophos|python-requests|curl|wget|go-http|httpclient|okhttp|headless|phantom|slack|whatsapp|telegram|discord|facebookexternalhit|skypeuripreview|google-?inspection|microsoft office|ms-office|outlook-?(ios|android)?-?link/i

/** Seconds after "sent" in which a click is almost surely an automatic scan. 15, not 60: a live
 * test (2026-10-24) had a real person on Android click 50s after sending. */
export const FAST_CLICK_SECONDS = 15

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
  | { kind: 'deleteLink'; id: string }
  | { kind: 'stats' }
  | { kind: 'notFound' }

export function parseRoute(method: string, pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean)
  if (method === 'GET' || method === 'HEAD') {
    // "/acme-k3f9" (current links) and "/r/<id>" (links made before readable ids)
    if (parts.length === 1 && parts[0] !== 'api' && isValidId(parts[0])) return { kind: 'click', id: parts[0] }
    if (parts.length === 2 && parts[0] === 'r' && isValidId(parts[1])) return { kind: 'click', id: parts[1] }
  }
  if (parts[0] === 'api') {
    if (method === 'POST' && parts.length === 2 && parts[1] === 'links') return { kind: 'addLink' }
    if (method === 'POST' && parts.length === 4 && parts[1] === 'links' && parts[3] === 'sent' && isValidId(parts[2])) {
      return { kind: 'markSent', id: parts[2] }
    }
    if (method === 'DELETE' && parts.length === 3 && parts[1] === 'links' && isValidId(parts[2])) {
      return { kind: 'deleteLink', id: parts[2] }
    }
    if (method === 'GET' && parts.length === 2 && parts[1] === 'stats') return { kind: 'stats' }
  }
  return { kind: 'notFound' }
}

/**
 * The RESUMES secret: a JSON object from a short key to a resume URL, e.g.
 * {"data": "https://drive.google.com/...", "backend": "https://drive.google.com/..."}.
 * Bad JSON or non-http(s) values are dropped, so a typo can't redirect anywhere odd.
 */
export function parseResumes(raw: string | undefined): Record<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw ?? '')
  } catch {
    return {}
  }
  const out: Record<string, string> = {}
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [key, value] of Object.entries(parsed)) {
      if (/^[a-z0-9-]{1,20}$/.test(key) && typeof value === 'string' && /^https?:\/\//.test(value)) out[key] = value
    }
  }
  return out
}

/** The URL for a link's resume: its own key, else "default", else the first one listed. */
export function pickResume(resumes: Record<string, string>, cv: string | null): string | undefined {
  return (cv ? resumes[cv] : undefined) ?? resumes.default ?? Object.values(resumes)[0]
}
