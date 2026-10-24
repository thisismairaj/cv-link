import { test } from 'node:test'
import assert from 'node:assert/strict'
import { botReason, hashVisitor, isValidId, newId, parseResumes, parseRoute, pickResume, safeEqual } from '../src/logic.ts'

test('newId is 10 readable characters and different each time', () => {
  const ids = new Set(Array.from({ length: 1000 }, () => newId()))
  assert.equal(ids.size, 1000)
  for (const id of ids) assert.ok(isValidId(id) && id.length === 10 && !/[01ilo]/.test(id), id)
})

test('a person in a browser is not marked as a bot', () => {
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
  assert.equal(botReason('GET', chrome, null), null)
  assert.equal(botReason('GET', chrome, 3600), null)
})

test('scanners, previews, HEAD requests and instant clicks are marked, with a reason', () => {
  const chrome = 'Mozilla/5.0 Chrome/130.0'
  assert.equal(botReason('HEAD', chrome, null), 'HEAD request')
  assert.equal(botReason('GET', null, null), 'no user agent')
  for (const ua of ['Slackbot-LinkExpanding 1.0', 'python-requests/2.32', 'Mozilla/5.0 (compatible; Barracuda Sentinel)', 'WhatsApp/2.23', 'curl/8.4']) {
    assert.equal(botReason('GET', ua, null), 'scanner or preview user agent', ua)
  }
  assert.equal(botReason('GET', chrome, 12), 'clicked 12s after sending')
  assert.equal(botReason('GET', chrome, 61), null)
})

test('visitor hash is stable, salted and does not contain the IP', async () => {
  const a = await hashVisitor('203.0.113.7', 'salt-1')
  assert.equal(a, await hashVisitor('203.0.113.7', 'salt-1'))
  assert.notEqual(a, await hashVisitor('203.0.113.7', 'salt-2'))
  assert.match(a, /^[0-9a-f]{16}$/)
})

test('safeEqual', () => {
  assert.ok(safeEqual('Bearer abc', 'Bearer abc'))
  assert.ok(!safeEqual('Bearer abc', 'Bearer abd'))
  assert.ok(!safeEqual('Bearer ab', 'Bearer abc'))
})

test('routes', () => {
  assert.deepEqual(parseRoute('GET', '/r/abcdef2345'), { kind: 'click', id: 'abcdef2345' })
  assert.deepEqual(parseRoute('HEAD', '/r/abcdef2345'), { kind: 'click', id: 'abcdef2345' })
  assert.deepEqual(parseRoute('GET', '/r/../etc'), { kind: 'notFound' })
  assert.deepEqual(parseRoute('GET', '/r/ABC'), { kind: 'notFound' })
  assert.deepEqual(parseRoute('POST', '/api/links'), { kind: 'addLink' })
  assert.deepEqual(parseRoute('POST', '/api/links/abcdef2345/sent'), { kind: 'markSent', id: 'abcdef2345' })
  assert.deepEqual(parseRoute('GET', '/api/stats'), { kind: 'stats' })
  assert.deepEqual(parseRoute('DELETE', '/api/links/abcdef2345'), { kind: 'deleteLink', id: 'abcdef2345' })
  assert.deepEqual(parseRoute('DELETE', '/api/links'), { kind: 'notFound' })
  assert.deepEqual(parseRoute('GET', '/api/links'), { kind: 'notFound' })
  assert.deepEqual(parseRoute('GET', '/'), { kind: 'notFound' })
})

test('RESUMES secret: keeps valid keys and http(s) URLs only', () => {
  const r = parseResumes('{"data":"https://drive.google.com/a","backend":"https://drive.google.com/b","Bad Key":"https://x","js":"javascript:alert(1)"}')
  assert.deepEqual(r, { data: 'https://drive.google.com/a', backend: 'https://drive.google.com/b' })
  assert.deepEqual(parseResumes('not json'), {})
  assert.deepEqual(parseResumes(undefined), {})
  assert.deepEqual(parseResumes('["https://x"]'), {})
})

test('pickResume: the link\'s own cv, then "default", then the first listed', () => {
  const r = { data: 'https://d', backend: 'https://b' }
  assert.equal(pickResume(r, 'backend'), 'https://b')
  assert.equal(pickResume(r, null), 'https://d')
  assert.equal(pickResume({ ...r, default: 'https://x' }, 'missing'), 'https://x')
  assert.equal(pickResume({}, 'data'), undefined)
})
