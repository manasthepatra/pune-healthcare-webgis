// Reproducible "DevTools Network tab" measurements via the Chrome DevTools Protocol (Node 22+, no dependencies).
//
//   node tools/measure_network.mjs q9  http://127.0.0.1:4174      # buildings as WMS PNG / WFS GeoJSON / MVT at z12, 14, 16
//   node tools/measure_network.mjs q12 https://<user>.github.io/<repo>/   # PMTiles range requests at z14
//
// It launches headless Chrome with the cache disabled (Network.setCacheDisabled), loads the client with the URL presets
// ?z=<zoom>&bld=<mode>, waits until the map and all requests are idle, and reports requests, transferred KB (the
// "transferred" column of DevTools = encodedDataLength) and time to finish (first request start -> last response end).
// Each cell is run RUNS times; the median is reported and every raw run is kept in analysis/out/.
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [, , scenario, baseUrl] = process.argv
if (!['q9', 'q12'].includes(scenario) || !baseUrl) {
  console.error('usage: node tools/measure_network.mjs <q9|q12> <client base url>')
  process.exit(2)
}
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9333
const RUNS = Number(process.env.RUNS || 3)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- launch chrome + minimal CDP client
const profile = mkdtempSync(join(tmpdir(), 'cdp-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1400,900', '--no-first-run', 'about:blank',
], { stdio: 'ignore' })

async function pageSocketUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch { /* chrome not up yet */ }
    await sleep(500)
  }
  throw new Error('Chrome did not start')
}

const ws = new WebSocket(await pageSocketUrl())
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let nextId = 1
const waiting = new Map()
const handlers = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id) } else if (m.method) handlers.forEach((h) => h(m))
}
const send = (method, params = {}, sessionId) => new Promise((res) => {
  const id = nextId++; waiting.set(id, res)
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
})

// ---------------------------------------------------------------- network bookkeeping
const reqs = new Map()
handlers.push((m) => {
  const p = m.params
  const key = (id) => `${m.sessionId || 'page'}:${id}`
  if (m.method === 'Network.requestWillBeSent') {
    // MapLibre loads its web worker from a blob: URL that never reports 'finished'; blob/data URLs are not network traffic
    if (/^(blob|data):/.test(p.request.url)) return
    reqs.set(key(p.requestId), { url: p.request.url, method: p.request.method, range: p.request.headers.Range || p.request.headers.range || null,
      type: p.type, start: p.timestamp, end: null, status: null, bytes: 0, decoded: 0, failed: false })
  } else if (m.method === 'Network.dataReceived') {
    const r = reqs.get(key(p.requestId)); if (r) r.decoded += p.dataLength
  } else if (m.method === 'Network.responseReceived') {
    const r = reqs.get(key(p.requestId)); if (r) r.status = p.response.status
  } else if (m.method === 'Network.loadingFinished') {
    const r = reqs.get(key(p.requestId)); if (r) { r.end = p.timestamp; r.bytes = p.encodedDataLength }
  } else if (m.method === 'Network.loadingFailed') {
    const r = reqs.get(key(p.requestId)); if (r) { r.end = p.timestamp; r.failed = true }
  }
})
// MapLibre fetches vector tiles and GeoJSON inside web workers: attach to them too, or those requests are invisible
handlers.push((m) => {
  if (m.method !== 'Target.attachedToTarget') return
  const sid = m.params.sessionId
  send('Network.enable', { maxTotalBufferSize: 100_000_000 }, sid)
  send('Network.setCacheDisabled', { cacheDisabled: true }, sid)
  send('Runtime.runIfWaitingForDebugger', {}, sid)
})
await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })
await send('Network.enable', { maxTotalBufferSize: 100_000_000 })
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Page.enable')
await send('Runtime.enable')

const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value

async function load(url, match) {
  await send('Page.navigate', { url: 'about:blank' })
  await sleep(500)
  reqs.clear()
  await send('Page.navigate', { url })
  // wait until a matching request exists (the client applies ?bld= / ?z= when the map first goes idle)
  const t0 = Date.now()
  while (match && ![...reqs.values()].some((r) => match(r.url)) && Date.now() - t0 < 45_000) await sleep(250)
  let quiet = 0
  while (quiet < 4 && Date.now() - t0 < 120_000) {
    const pending = [...reqs.values()].filter((r) => r.end === null).length
    const idle = await evalJs('!!(window.map && window.map.loaded() && window.map.areTilesLoaded())')
    quiet = pending === 0 && idle ? quiet + 1 : 0
    await sleep(500)
  }
}

function summarise(match) {
  const rows = [...reqs.values()].filter((r) => match(r.url))
  if (!rows.length) return { requests: 0, kb: 0, decoded_kb: 0, seconds: null, failed: 0 }
  const start = Math.min(...rows.map((r) => r.start))
  const end = Math.max(...rows.map((r) => r.end ?? r.start))
  return { requests: rows.length, kb: +(rows.reduce((a, r) => a + r.bytes, 0) / 1024).toFixed(1),
    decoded_kb: +(rows.reduce((a, r) => a + r.decoded, 0) / 1024).toFixed(1),
    seconds: +(end - start).toFixed(2), failed: rows.filter((r) => r.failed || (r.status && r.status >= 400)).length }
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2 }
const aggregate = (runs) => ({ requests: median(runs.map((r) => r.requests)), kb: +median(runs.map((r) => r.kb)).toFixed(1),
  decoded_kb: +median(runs.map((r) => r.decoded_kb)).toFixed(1),
  seconds: +median(runs.map((r) => r.seconds ?? 0)).toFixed(2), runs })

// ---------------------------------------------------------------- scenarios
const out = { scenario, baseUrl, runs_per_cell: RUNS, chrome_viewport: '1400x900', cache: 'disabled', when: new Date().toISOString(), cells: {} }
try {
  if (scenario === 'q9') {
    const modes = { 'WMS PNG': ['wms', (u) => /buildings/.test(u) && /wms/i.test(u)], 'WFS GeoJSON': ['wfs', (u) => /buildings/.test(u) && /wfs/i.test(u)],
      'MVT': ['mvt', (u) => /public\.buildings/.test(u)] }
    for (const [label, [bld, match]] of Object.entries(modes)) {
      for (const z of [12, 14, 16]) {
        const runs = []
        for (let i = 0; i < RUNS; i++) {
          await load(`${baseUrl.replace(/\/$/, '')}/?z=${z}&bld=${bld}`, match)
          runs.push(summarise(match))
        }
        out.cells[`${label} z${z}`] = aggregate(runs)
        const c0 = out.cells[`${label} z${z}`]
        console.error(`${label} z${z}:`, c0.requests, 'req', c0.kb, 'KB transferred', c0.decoded_kb, 'KB decoded', c0.seconds, 's')
      }
    }
    console.log('\n| Buildings as | z12 req / KB / s | z14 req / KB / s | z16 req / KB / s |\n|---|---|---|---|')
    for (const label of Object.keys(modes)) {
      const c = (z) => { const x = out.cells[`${label} z${z}`]; return `${x.requests} / ${x.kb} (${x.decoded_kb}) / ${x.seconds}` }
      console.log(`| ${label} | ${c(12)} | ${c(14)} | ${c(16)} |`)
    }
  } else {
    // MATCH (regexp), EXTRA (extra query string), LABEL, OUT let the same scenario measure the local server stack for comparison
    const re = new RegExp(process.env.MATCH || 'map\.pmtiles')
    const match = (u) => re.test(u)
    const label = process.env.LABEL || 'PMTiles z14'
    const runs = [], detail = []
    for (let i = 0; i < RUNS; i++) {
      await load(`${baseUrl.replace(/\/$/, '')}/?z=14${process.env.EXTRA || ''}`, match)
      runs.push(summarise(match))
      if (!detail.length) {
        detail.push(...[...reqs.values()].filter((r) => match(r.url) && r.method === 'GET').slice(0, 6)
          .map((r) => ({ url: r.url, range_header: r.range, status: r.status, kb: +(r.bytes / 1024).toFixed(1) })))
      }
      out.all_resources_kb = +([...reqs.values()].reduce((a, r) => a + r.bytes, 0) / 1024).toFixed(1)
      out.all_requests = reqs.size
    }
    out.cells[label] = aggregate(runs)
    out.sample_pmtiles_requests = detail
    console.log(JSON.stringify(out, null, 2))
  }
} finally {
  writeFileSync(`analysis/out/${process.env.OUT || scenario + '_network'}.json`, JSON.stringify(out, null, 2))
  ws.close()
  chrome.kill()
  await sleep(500)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* profile still locked by chrome: harmless temp dir */ }
}
