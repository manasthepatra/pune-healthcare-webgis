import { categories, config } from './config.mjs'

export function buildOverpassQuery() {
  const { south, west, north, east } = config.bounds
  const selectors = [...new Set(categories.flatMap(c => c.selectors))]
  const parts = selectors.map(selector => {
    const filters = selector.split(',').map(rule => {
      const [, key, operator, value] = rule.match(/^([^!=]+)(!?=)(.+)$/)
      return `["${key}"${operator}"${value}"]`
    }).join('')
    return `nwr${filters}(${south},${west},${north},${east});`
  })
  return `[out:json][timeout:120];(${parts.join('')});out center tags;`
}

export function overpassEndpoints(env = process.env) {
  return [...new Set([
    env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter',
    ...(env.OVERPASS_FALLBACK_URLS ?? 'https://overpass.private.coffee/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter').split(','),
  ].map(url => url.trim()).filter(Boolean))]
}

export function describeError(error) {
  return [error.message, error.cause?.code, error.cause?.message].filter(Boolean).join(': ')
}

export async function fetchOverpass({ endpoints = overpassEndpoints(), fetchImpl = fetch, log = console.log } = {}) {
  const failures = []
  const query = buildOverpassQuery()
  for (const url of endpoints) {
    log(`Fetching ${config.name} facilities from ${url}...`)
    try {
      const response = await fetchImpl(url, {
        method: 'POST', body: query,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        signal: AbortSignal.timeout(180000),
      })
      if (!response.ok) {
        await response.body?.cancel()
        const error = new Error(`HTTP ${response.status}`)
        // A malformed query will also fail on another server.
        if (response.status < 500 && response.status !== 429) {
          throw Object.assign(error, { permanent: true })
        }
        throw error
      }
      const payload = await response.json()
      if (!Array.isArray(payload?.elements) || payload.remark) {
        throw new Error(`Incomplete Overpass response${payload?.remark ? `: ${payload.remark}` : ''}`)
      }
      return payload
    } catch (error) {
      const detail = `${url}: ${describeError(error)}`
      if (error.permanent) throw new Error(`Overpass request failed: ${detail}`, { cause: error })
      failures.push(detail)
      log(`Overpass attempt failed: ${detail}`)
    }
  }
  throw new Error(`Unable to fetch OpenStreetMap data.\n${failures.join('\n')}\nCheck Docker/VPN/firewall connectivity or set OVERPASS_URL to a reachable interpreter. On Windows, run "powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\download-osm.ps1 -Import" to download through Windows and import without local Node.js/npm. Alternatively run "npm run data:download -- response.json", then "docker compose cp response.json app:/tmp/response.json" and "docker compose exec -T app npm run data:import -- --file /tmp/response.json". Existing data was preserved.`)
}
