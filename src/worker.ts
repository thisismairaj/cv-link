import { botReason, hashVisitor, newId, parseRoute, safeEqual } from './logic.ts'

interface Bindings {
  DB: D1Database
  RESUME_URL: string // where /r/<id> sends people (e.g. a Google Drive share link)
  ADMIN_KEY: string // bearer token for /api/*
  HASH_SALT: string // salt for the visitor hash
}

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

function authorized(request: Request, env: Bindings): boolean {
  const header = request.headers.get('authorization') ?? ''
  return Boolean(env.ADMIN_KEY) && safeEqual(header, `Bearer ${env.ADMIN_KEY}`)
}

async function recordClick(request: Request, env: Bindings, id: string, sentAt: string | null): Promise<void> {
  const now = new Date()
  const since = sentAt ? (now.getTime() - Date.parse(sentAt)) / 1000 : null
  const ua = request.headers.get('user-agent')
  const ip = request.headers.get('cf-connecting-ip') ?? ''
  const country = (request.cf?.country as string | undefined) ?? null
  await env.DB.prepare(
    'INSERT INTO clicks (link_id, at, country, user_agent, visitor, bot_reason) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, now.toISOString(), country, ua, ip ? await hashVisitor(ip, env.HASH_SALT) : null, botReason(request.method, ua, since))
    .run()
}

async function click(request: Request, env: Bindings, ctx: ExecutionContext, id: string): Promise<Response> {
  const link = await env.DB.prepare('SELECT id, sent_at FROM links WHERE id = ?').bind(id).first<{ sent_at: string | null }>()
  if (!link) return text('Nothing here.', 404)
  // Log after responding, so a slow write never delays the reader. A failed write is logged, not shown.
  ctx.waitUntil(recordClick(request, env, id, link.sent_at).catch((err) => console.error('click not recorded', err)))
  return new Response(null, { status: 302, headers: { location: env.RESUME_URL, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } })
}

async function addLink(request: Request, env: Bindings): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { label?: unknown }
  const label = typeof body.label === 'string' ? body.label.trim() : ''
  if (!label || label.length > 200) return json({ error: 'label is required (1-200 characters)' }, 400)
  const id = newId()
  await env.DB.prepare('INSERT INTO links (id, label, created_at) VALUES (?, ?, ?)').bind(id, label, new Date().toISOString()).run()
  return json({ id, label, url: `${new URL(request.url).origin}/r/${id}` }, 201)
}

async function markSent(env: Bindings, id: string): Promise<Response> {
  const result = await env.DB.prepare('UPDATE links SET sent_at = ? WHERE id = ?').bind(new Date().toISOString(), id).run()
  return result.meta.changes ? json({ id, sent: true }) : json({ error: 'no such link' }, 404)
}

async function stats(env: Bindings): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT l.id, l.label, l.sent_at,
            SUM(c.id IS NOT NULL AND c.bot_reason IS NULL) AS opens,
            COUNT(DISTINCT CASE WHEN c.bot_reason IS NULL THEN c.visitor END) AS visitors,
            SUM(c.bot_reason IS NOT NULL) AS automatic_opens,
            MIN(CASE WHEN c.bot_reason IS NULL THEN c.at END) AS first_open,
            MAX(CASE WHEN c.bot_reason IS NULL THEN c.at END) AS last_open
       FROM links l LEFT JOIN clicks c ON c.link_id = l.id
      GROUP BY l.id ORDER BY l.created_at DESC`,
  ).all()
  return json(results)
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const route = parseRoute(request.method, new URL(request.url).pathname)
    if (route.kind === 'click') return click(request, env, ctx, route.id)
    if (route.kind === 'notFound') return text('Nothing here.', 404)
    if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401)
    if (route.kind === 'addLink') return addLink(request, env)
    if (route.kind === 'markSent') return markSent(env, route.id)
    return stats(env)
  },
} satisfies ExportedHandler<Bindings>
