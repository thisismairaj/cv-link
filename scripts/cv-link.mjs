#!/usr/bin/env node
// Small CLI for your cv-link Worker.
//   CV_LINK_URL=https://cv-link.<you>.workers.dev CV_LINK_ADMIN_KEY=... node scripts/cv-link.mjs <command>
// Commands:
//   add "<label>" [cv]   create a link for one person (cv = a key in RESUMES, e.g. data), prints its URL
//   sent <id>       mark the link as sent now (opens in the next 15 seconds count as automatic)
//   delete <id>     remove a link and its opens (e.g. a test link)
//   stats           opens per link

const base = (process.env.CV_LINK_URL ?? '').replace(/\/$/, '')
const key = process.env.CV_LINK_ADMIN_KEY ?? ''
const [command, arg, arg2] = process.argv.slice(2)

if (!base || !key) {
  console.error('Set CV_LINK_URL and CV_LINK_ADMIN_KEY first.')
  process.exit(1)
}

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error(`${res.status}: ${data.error ?? res.statusText}`)
    process.exit(1)
  }
  return data
}

if (command === 'add' && arg) {
  const link = await call('POST', '/api/links', { label: arg, cv: arg2 })
  console.log(`${link.url}   (${link.label}${link.cv ? `, ${link.cv} cv` : ''})`)
} else if (command === 'sent' && arg) {
  await call('POST', `/api/links/${arg}/sent`)
  console.log(`Marked ${arg} as sent.`)
} else if (command === 'delete' && arg) {
  await call('DELETE', `/api/links/${arg}`)
  console.log(`Deleted ${arg} and its opens.`)
} else if (command === 'stats') {
  printStats(await call('GET', '/api/stats'))
} else {
  console.log('Usage: cv-link.mjs add "<label>" [cv] | sent <id> | delete <id> | stats')
  process.exit(command ? 1 : 0)
}

// Opened links first, then unopened, as aligned columns with local times.
function printStats(rows) {
  if (!rows.length) return console.log('No links yet.')
  const color = process.stdout.isTTY && !process.env.NO_COLOR
  const paint = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s)
  const opened = rows.filter((r) => r.opens)
  const waiting = rows.filter((r) => !r.opens)
  const people = opened.reduce((n, r) => n + r.visitors, 0)
  const automatic = rows.reduce((n, r) => n + (r.automatic_opens ?? 0), 0)

  console.log(paint('1', `\n${opened.length} of ${rows.length} links opened`) + ` (${plural(people, 'person', 'people')})`)
  const head = ['', 'Link', 'Recipient', 'CV', 'Sent', 'Opens', 'People', 'Last open', 'Auto']
  const body = [...opened, ...waiting].map((r) => [
    r.opens ? '✔' : '·', r.id, recipient(r), r.cv ?? '', when(r.sent_at),
    String(r.opens ?? 0), String(r.visitors ?? 0), r.opens ? when(r.last_open) : '', r.automatic_opens ? String(r.automatic_opens) : '',
  ])
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((l) => l[i].length)))
  const line = (l, r, m) => l + widths.map((w) => '─'.repeat(w + 2)).join(m) + r
  const row = (cells) => '│' + cells.map((c, i) => ` ${c.padEnd(widths[i])} `).join('│') + '│'
  console.log(line('┌', '┐', '┬'))
  console.log(paint('1', row(head)))
  console.log(line('├', '┤', '┼'))
  for (const [i, l] of body.entries()) console.log(i < opened.length ? paint('32', row(l)) : row(l))
  console.log(line('└', '┘', '┴'))
  if (automatic) console.log(paint('2', `Auto = opens not counted (mail scanners, link previews, clicks within 15 s of sending).`))
  console.log()
}

// Drop the "(draft-name)" the email script adds, since the id already shows it.
function recipient(r) {
  const slug = r.id.replace(/-[^-]+$/, '')
  return r.label.endsWith(` (${slug})`) ? r.label.slice(0, -slug.length - 3) : r.label
}

function when(iso) {
  if (!iso) return 'not marked'
  const d = new Date(iso)
  const stamp = d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const mins = Math.round((Date.now() - d) / 60000)
  const ago = mins < 60 ? `${mins}m` : mins < 2880 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`
  return `${stamp} (${ago} ago)`
}

function plural(n, one, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`
}
