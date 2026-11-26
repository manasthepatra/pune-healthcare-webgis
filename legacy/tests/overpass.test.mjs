import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOverpassQuery, fetchOverpass, overpassEndpoints } from '../server/overpass.mjs'
import { config } from '../server/config.mjs'

const endpoints = ['https://primary.example/api/interpreter', 'https://fallback.example/api/interpreter']
const payload = { elements: [{ type: 'node', id: 1 }] }
const options = { endpoints, log() {} }

test('query uses configured bounds and requests tags and way centres', () => {
  const b = config.bounds
  const query = buildOverpassQuery()
  assert.ok(query.startsWith('[out:json][timeout:120];('))
  assert.ok(query.includes(`(${b.south},${b.west},${b.north},${b.east})`))
  assert.ok(query.includes('nwr["amenity"="hospital"]'))
  assert.ok(query.endsWith('out center tags;'))
})

test('configured primary and fallback URLs are trimmed and deduplicated; empty disables fallback', () => {
  assert.deepEqual(overpassEndpoints({ OVERPASS_URL: endpoints[0], OVERPASS_FALLBACK_URLS: ` ${endpoints[0]}, ${endpoints[1]}, ` }), endpoints)
  assert.deepEqual(overpassEndpoints({ OVERPASS_URL: endpoints[0], OVERPASS_FALLBACK_URLS: '' }), [endpoints[0]])
  assert.equal(overpassEndpoints({}).length, 3)
})

test('connection timeout falls back and sends the same POST query', async () => {
  const calls = []
  const result = await fetchOverpass({ ...options, fetchImpl: async (url, request) => {
    calls.push({ url, request })
    if (calls.length === 1) throw new TypeError('fetch failed', { cause: Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' }) })
    return Response.json(payload)
  } })
  assert.deepEqual(result, payload)
  assert.deepEqual(calls.map(call => call.url), endpoints)
  assert.equal(calls[0].request.body, calls[1].request.body)
  assert.equal(calls[1].request.method, 'POST')
  assert.ok(calls[1].request.signal instanceof AbortSignal)
})

test('temporary HTTP failures, invalid JSON and incomplete data fall back', async () => {
  for (const first of [new Response('', { status: 429 }), new Response('', { status: 504 }), new Response('<html>Unavailable</html>'), Response.json({ elements: [], remark: 'runtime error: timeout' }), Response.json({})]) {
    let calls = 0
    const result = await fetchOverpass({ ...options, fetchImpl: async () => ++calls === 1 ? first : Response.json(payload) })
    assert.equal(calls, 2)
    assert.deepEqual(result, payload)
  }
})

test('malformed requests stop without contacting fallback servers', async () => {
  let calls = 0
  await assert.rejects(fetchOverpass({ ...options, fetchImpl: async () => {
    calls++
    return new Response('', { status: 400 })
  } }), /HTTP 400/)
  assert.equal(calls, 1)
})

test('exhausted endpoints report the connection cause and offline recovery commands', async () => {
  await assert.rejects(fetchOverpass({ ...options, fetchImpl: async () => {
    throw new TypeError('fetch failed', { cause: Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' }) })
  } }), error => {
    for (const text of [...endpoints, 'UND_ERR_CONNECT_TIMEOUT', 'data:download', '--file /tmp/response.json', 'Existing data was preserved']) assert.ok(error.message.includes(text))
    return true
  })
})
