import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, sep, extname } from 'node:path'
import { config, geoserverUrl } from './config.mjs'
import { pool } from './db.mjs'
import { InputError, parseSearch, searchQuery } from './search.mjs'

const dist = resolve(fileURLToPath(new URL('../dist/', import.meta.url)))
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' }
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}
async function datasetInfo() {
  const { rows } = await pool.query('SELECT (SELECT count(*)::integer FROM facilities) AS count, (SELECT max(imported_at) FROM dataset_imports) AS imported_at')
  return rows[0]
}
export const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(res, 405, { error: 'Only GET requests are supported.' }) }
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/api/config') {
      const data = await datasetInfo()
      return json(res, 200, { ...config, datasetCount: data.count, importedAt: data.imported_at })
    }
    if (url.pathname === '/api/health') {
      await pool.query('SELECT PostGIS_Version()')
      return json(res, 200, { status: 'ok', database: 'connected' })
    }
    if (url.pathname === '/api/services') {
      const search = parseSearch(url.searchParams)
      const { rows } = await pool.query(searchQuery(search))
      const info = await datasetInfo()
      return json(res, 200, { ...rows[0], offset: search.offset, limit: search.limit, importedAt: info.imported_at })
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Unknown API endpoint.' })
    if (url.pathname === '/geoserver/nearby/wms') {
      // Proxy only the public WMS endpoint. GeoServer administration is never exposed here.
      const params = new URLSearchParams(url.search)
      for (const key of [...params.keys()]) {
        const value = params.get(key)
        params.delete(key); params.set(key.toUpperCase(), value)
      }
      if (!['GETMAP', 'GETCAPABILITIES', 'GETFEATUREINFO'].includes((params.get('REQUEST') || '').toUpperCase())) return json(res, 400, { error: 'Unsupported WMS request.' })
      if (params.has('LAYERS') && params.get('LAYERS') !== config.geoserverLayer) return json(res, 400, { error: 'Unknown published layer.' })
      const upstream = await fetch(`${geoserverUrl}/nearby/wms?${params}`, { signal: AbortSignal.timeout(15000) })
      const contentType = upstream.headers.get('content-type') || 'application/octet-stream'
      if (!upstream.ok || (params.get('REQUEST')?.toUpperCase() === 'GETMAP' && !contentType.startsWith('image/'))) throw new Error('GeoServer could not render its published layer.')
      const body = Buffer.from(await upstream.arrayBuffer())
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' })
      return res.end(body)
    }
    if (url.pathname.startsWith('/geoserver')) return json(res, 404, { error: 'Unknown map endpoint.' })
    const path = resolve(dist, '.' + decodeURIComponent(url.pathname))
    if (path !== dist && !path.startsWith(dist + sep)) return json(res, 400, { error: 'Invalid path.' })
    let file = path
    try { if (!(await stat(file)).isFile()) file = resolve(dist, 'index.html') }
    catch { file = extname(path) ? path : resolve(dist, 'index.html') }
    let body
    try { body = await readFile(file) }
    catch { return json(res, 404, { error: 'Frontend build not found. Run npm run build, or use the Vite development server.' }) }
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
    res.end(body)
  } catch (error) {
    if (error instanceof InputError || error instanceof URIError) return json(res, 400, { error: error.message })
    console.error('Request failed:', error.message)
    const isMap = req.url?.startsWith('/geoserver/')
    return json(res, 503, { error: isMap ? 'The published map layer is unavailable. Retry the layer when GeoServer is ready.' : 'The spatial database is unavailable. Start PostGIS and initialize the schema, then retry.' })
  }
})
const port = Number(process.env.PORT || 3001)
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Nearby Services API: http://localhost:${server.address().port}`))
const shutdown = () => server.close(() => pool.end().finally(() => process.exit()))
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

