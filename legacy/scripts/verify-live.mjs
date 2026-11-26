import assert from 'node:assert/strict'
import { config, categories, geoserverUrl } from '../server/config.mjs'
import { pool } from '../server/db.mjs'
import { parseSearch, searchQuery } from '../server/search.mjs'

const base = process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 3001}`
async function get(path) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(20000) })
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`)
  return response.json()
}
const ids = items => items.map(item => item.id)
const ordered = items => items.every((item, i) => Number.isFinite(item.distance) && item.distance >= 0 && (!i || items[i - 1].distance <= item.distance))
try {
  await pool.query('SELECT PostGIS_Version()')
  const { rows: points } = await pool.query(`SELECT id,category,subcategory,ST_Y(geom) AS lat,ST_X(geom) AS lng FROM facilities
    WHERE ST_Y(geom) BETWEEN $1 AND $2 AND ST_X(geom) BETWEEN $3 AND $4 ORDER BY id LIMIT 1`,
  [config.bounds.south, config.bounds.north, config.bounds.west, config.bounds.east])
  assert.ok(points.length, 'Import facilities before running live verification.')
  const origin = points[0]
  const parameters = extra => new URLSearchParams({ lat: String(origin.lat), lng: String(origin.lng), categories: categories.map(c => c.id).join(','), ...extra })
  const search = extra => get('/api/services?' + parameters(extra))
  assert.equal((await get('/api/health')).database, 'connected')
  assert.ok((await get('/api/config')).datasetCount > 0)
  const nearest = await search({ mode: 'nearest', n: '10', limit: '100' })
  assert.ok(nearest.facilities.length > 0 && nearest.total <= 10)
  assert.ok(ordered(nearest.facilities), 'Nearest results must be in ascending distance order.')
  assert.ok(nearest.facilities[0].distance < 0.000001, 'A facility at the origin must have zero distance (CRS/axis-order check).')
  const direct = await pool.query(searchQuery(parseSearch(parameters({ mode: 'nearest', n: '10', limit: '100' }))))
  assert.deepEqual(nearest.facilities, direct.rows[0].facilities, 'HTTP results must match real PostGIS results.')
  const radius = await search({ mode: 'radius', radiusKm: '1', limit: '100' })
  assert.ok(radius.facilities.length > 0 && ordered(radius.facilities))
  assert.ok(radius.facilities.every(item => item.distance <= 1.000001), 'Radius is measured in kilometres.')
  const combined = await search({ mode: 'combined', radiusKm: '1', n: '3' })
  assert.deepEqual(ids(combined.facilities), ids(radius.facilities.slice(0, 3)))
  const filtered = await search({ mode: 'nearest', n: '10', categories: origin.category, subcategories: origin.subcategory })
  assert.ok(filtered.facilities.length > 0)
  assert.ok(filtered.facilities.every(item => item.category === origin.category && item.subcategory === origin.subcategory))
  const page1 = await search({ mode: 'nearest', n: '10', limit: '1' })
  const page2 = await search({ mode: 'nearest', n: '10', limit: '1', offset: '1' })
  assert.deepEqual([...ids(page1.facilities), ...ids(page2.facilities)], ids(nearest.facilities.slice(0, 2)))
  const empty = await search({ mode: 'nearest', n: '1', offset: '1' })
  assert.deepEqual(empty.facilities, [])
  for (const input of [{ lat: '91' }, { categories: 'invalid' }, { mode: 'nearest', n: '0' }]) {
    assert.equal((await fetch(base + '/api/services?' + parameters(input))).status, 400)
  }
  console.log('PASS: real PostGIS/API, CRS, radius, nearest N, combined, filters, pagination, empty response and invalid input.')

  const capabilities = await fetch(base + '/geoserver/nearby/wms?SERVICE=WMS&REQUEST=GetCapabilities', { signal: AbortSignal.timeout(20000) })
  assert.equal(capabilities.status, 200)
  assert.match(await capabilities.text(), /<Name>(?:nearby:)?facilities<\/Name>/, 'Published facilities must appear in WMS capabilities.')
  const mapParams = new URLSearchParams({ SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap', LAYERS: config.geoserverLayer,
    STYLES: '', FORMAT: 'image/png', TRANSPARENT: 'true', SRS: 'EPSG:4326', WIDTH: '256', HEIGHT: '256',
    BBOX: [origin.lng - 0.005, origin.lat - 0.005, origin.lng + 0.005, origin.lat + 0.005].join(',') })
  const map = await fetch(base + '/geoserver/nearby/wms?' + mapParams, { signal: AbortSignal.timeout(20000) })
  assert.equal(map.status, 200)
  assert.match(map.headers.get('content-type') || '', /image\/png/)
  assert.ok(Buffer.from(await map.arrayBuffer()).subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'GetMap must return an actual PNG.')
  // Read an actual feature to catch an empty or incorrectly connected datastore.
  const wfs = new URLSearchParams({ service: 'WFS', version: '1.0.0', request: 'GetFeature', typeName: config.geoserverLayer, maxFeatures: '1', outputFormat: 'application/json' })
  const featureResponse = await fetch(geoserverUrl + '/nearby/wfs?' + wfs, { signal: AbortSignal.timeout(20000) })
  assert.equal(featureResponse.status, 200)
  const collection = await featureResponse.json()
  assert.equal(collection.features?.length, 1, 'The published datastore must expose imported features.')
  assert.equal(collection.features[0].geometry.type, 'Point')
  console.log('PASS: real GeoServer capabilities, proxied WMS PNG and published PostGIS feature.')
  console.log('Browser checks still required: map/coordinate/geolocation input, denied permission, list-marker selection and details.')
} catch (error) {
  console.error(`Live verification FAILED: ${error.message}`)
  process.exitCode = 1
} finally { await pool.end() }
