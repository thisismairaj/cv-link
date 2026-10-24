import { botReason, hashVisitor, newId, parseResumes, parseRoute, pickResume, safeEqual } from './logic.ts'

interface Bindings {
  DB: D1Database
  // JSON: {"data": "<share link>", "backend": "<share link>"}; each link picks one key
  RESUMES: string
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
  const link = await env.DB.prepare('SELECT id, sent_at, cv FROM links WHERE id = ?')
    .bind(id)
    .first<{ sent_at: string | null; cv: string | null }>()
  if (!link) return text('Nothing here.', 404)
  const target = pickResume(parseResumes(env.RESUMES), link.cv)
  if (!target) return text('This link is not set up yet.', 503)
  // Log after responding, so a slow write never delays the reader. A failed write is logged, not shown.
  ctx.waitUntil(recordClick(request, env, id, link.sent_at).catch((err) => console.error('click not recorded', err)))
  return new Response(null, { status: 302, headers: { location: target, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } })
}

async function addLink(request: Request, env: Bindings): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { label?: unknown; cv?: unknown; slug?: unknown }
  const label = typeof body.label === 'string' ? body.label.trim() : ''
  if (!label || label.length > 200) return json({ error: 'label is required (1-200 characters)' }, 400)
  const resumes = parseResumes(env.RESUMES)
  const cv = typeof body.cv === 'string' && body.cv ? body.cv : null
  // Refuse an unknown key now, so a typo doesn't quietly send someone the wrong resume later.
  if (cv && !(cv in resumes)) return json({ error: `unknown cv "${cv}"; known: ${Object.keys(resumes).join(', ') || 'none'}` }, 400)
  // The readable part comes from "slug" if given (e.g. the draft file name), else from the label.
  const name = typeof body.slug === 'string' && body.slug ? body.slug : label
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = newId(name)
    const inserted = await env.DB.prepare('INSERT OR IGNORE INTO links (id, label, created_at, cv) VALUES (?, ?, ?, ?)')
      .bind(id, label, new Date().toISOString(), cv)
      .run()
    if (inserted.meta.changes) return json({ id, label, cv, url: `${new URL(request.url).origin}/${id}` }, 201)
  }
  return json({ error: 'could not find a free id, try again' }, 503)
}

async function markSent(env: Bindings, id: string): Promise<Response> {
  const result = await env.DB.prepare('UPDATE links SET sent_at = ? WHERE id = ?').bind(new Date().toISOString(), id).run()
  return result.meta.changes ? json({ id, sent: true }) : json({ error: 'no such link' }, 404)
}

async function deleteLink(env: Bindings, id: string): Promise<Response> {
  // Clicks first, then the link, in one batch, so a link is never left half deleted.
  const [, link] = await env.DB.batch([
    env.DB.prepare('DELETE FROM clicks WHERE link_id = ?').bind(id),
    env.DB.prepare('DELETE FROM links WHERE id = ?').bind(id),
  ])
  return link.meta.changes ? json({ id, deleted: true }) : json({ error: 'no such link' }, 404)
}

async function stats(env: Bindings): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT l.id, l.label, l.cv, l.sent_at,
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
    if (route.kind === 'deleteLink') return deleteLink(env, route.id)
    return stats(env)
  },
} satisfies ExportedHandler<Bindings>
