#!/usr/bin/env node
// Small CLI for your cv-link Worker.
//   CV_LINK_URL=https://cv-link.<you>.workers.dev CV_LINK_ADMIN_KEY=... node scripts/cv-link.mjs <command>
// Commands:
//   add "<label>" [cv]   create a link for one person (cv = a key in RESUMES, e.g. data), prints its URL
//   sent <id>       mark the link as sent now (opens in the next 60 seconds count as automatic)
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
  const rows = await call('GET', '/api/stats')
  if (!rows.length) console.log('No links yet.')
  for (const r of rows) {
    const opened = r.opens ? `opened ${r.opens}x by ${r.visitors} visitor(s), first ${r.first_open}, last ${r.last_open}` : 'not opened'
    const auto = r.automatic_opens ? `, ${r.automatic_opens} automatic` : ''
    console.log(`${r.id}  ${r.label}${r.cv ? ` [${r.cv} cv]` : ''}\n    sent ${r.sent_at ?? 'not marked'}; ${opened}${auto}`)
  }
} else {
  console.log('Usage: cv-link.mjs add "<label>" [cv] | sent <id> | delete <id> | stats')
  process.exit(command ? 1 : 0)
}
