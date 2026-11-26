import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Protocol } from 'pmtiles'
import './style.css'
import { cfg } from './config.js'

const isStatic = cfg.mode === 'static'
maplibregl.addProtocol('pmtiles', new Protocol().tile)

// ---------------------------------------------------------------- vector-tile source helpers
// server mode: pg_tileserv serves one tile endpoint per table, layer id inside the tile = "public.<table>"
// static mode : one PMTiles archive holding every layer, layer id = the tippecanoe layer name
function vtSource(table, pmLayer) {
  if (isStatic) return { source: { type: 'vector', url: `pmtiles://${cfg.pmtiles}` }, layer: pmLayer, key: 'pm' }
  return {
    source: { type: 'vector', tiles: [`${cfg.tileserv}/public.${table}/{z}/{x}/{y}.pbf`], minzoom: 0, maxzoom: 22 },
    layer: `public.${table}`,
    key: `ts-${table}`,
  }
}

// ---------------------------------------------------------------- colour logic (data-driven)
// stops are multiples of the walking threshold so the same ramp works for 1200 m and 900 m
const STOPS = [
  [0, '#1a9850'], [0.5, '#a6d96a'], [1, '#fee08b'], [1.5, '#f46d43'], [2.5, '#a50026'],
]
let threshold = 1200

function distColor(thr) {
  return ['interpolate', ['linear'], ['coalesce', ['get', 'dist_m'], 99999],
    ...STOPS.flatMap(([m, c]) => [m * thr, c])]
}
const hexOpacity = ['case', ['>', ['coalesce', ['get', 'pop'], 0], 0], 0.75, 0.18]

// ---------------------------------------------------------------- map
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  },
  center: cfg.center,
  zoom: 13,
  maxBounds: [[cfg.bbox[0] - 0.2, cfg.bbox[1] - 0.2], [cfg.bbox[2] + 0.2, cfg.bbox[3] + 0.2]],
})
map.addControl(new maplibregl.NavigationControl(), 'top-right')
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right')
window.map = map // handy in DevTools during the viva

const $ = (id) => document.getElementById(id)
document.getElementById('mode-note').textContent = isStatic
  ? 'Static deployment: vector tiles read from one PMTiles file by HTTP range requests (no server).'
  : 'Server stack: GeoServer (WMS/WFS) + pg_tileserv (MVT) + pg_featureserv (OGC API - Features).'
if (isStatic) document.querySelectorAll('[data-server]').forEach((el) => {
  el.disabled = true
  el.parentElement.title = 'Needs the server stack (GeoServer) - not available on the static site'
  el.parentElement.classList.add('off')
})

// ---------------------------------------------------------------- layers
function addHex(res) {
  const t = vtSource(`hex_r${res}`, `hex${res}`)
  if (!map.getSource(t.key + res)) map.addSource(t.key + res, t.source)
  map.addLayer({
    id: `hex${res}-fill`, type: 'fill', source: t.key + res, 'source-layer': t.layer,
    paint: { 'fill-color': distColor(threshold), 'fill-opacity': hexOpacity },
  })
  map.addLayer({
    id: `hex${res}-line`, type: 'line', source: t.key + res, 'source-layer': t.layer,
    paint: { 'line-color': '#ffffff', 'line-width': 0.6, 'line-opacity': 0.6 },
  })
  map.on('click', `hex${res}-fill`, (e) => {
    const p = e.features[0].properties
    popup(e.lngLat, [
      ['H3 cell', p.h3],
      ['Population (proxy)', p.pop != null ? Number(p.pop).toFixed(0) : 'n/a'],
      ['Walking distance', p.dist_m != null ? `${Math.round(p.dist_m)} m` : 'unreachable'],
      ['Nearest service', p.nearest_name || '(unnamed)'],
    ])
  })
}

function addServices() {
  const circle = {
    id: 'services', type: 'circle',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 8],
      'circle-color': ['match', ['get', 'name_status'], 'named', '#2563eb', '#f97316'],
      'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5,
    },
  }
  if (isStatic) {
    const t = vtSource('services', 'services')
    map.addSource('svc', t.source)
    map.addLayer({ ...circle, source: 'svc', 'source-layer': t.layer })
  } else {
    // OGC API - Features from pg_featureserv (GeoJSON), as the brief asks
    map.addSource('svc', { type: 'geojson', data: `${cfg.featureserv}/collections/public.services/items.json?limit=5000` })
    map.addLayer({ ...circle, source: 'svc' })
  }
  map.on('click', 'services', (e) => {
    const p = e.features[0].properties
    const id = String(p.osm_id || '')
    const kind = { n: 'node', w: 'way', r: 'relation' }[id[0]]
    popup(e.lngLat, [
      ['Name', p.name || '(no name tag in OSM)'],
      ['Type', p.service_type],
      ['Inside study area', p.in_area === true || p.in_area === 'true' ? 'yes' : 'no (margin)'],
      ['Street', p.addr_street || 'n/a'],
      ['Hours', p.opening_hours || 'n/a'],
    ], kind ? { text: `OSM ${id}`, href: `https://www.openstreetmap.org/${kind}/${id.slice(1)}` } : null)
  })
  map.on('mouseenter', 'services', () => (map.getCanvas().style.cursor = 'pointer'))
  map.on('mouseleave', 'services', () => (map.getCanvas().style.cursor = ''))
}

function addArea() {
  if (isStatic) {
    const t = vtSource('study_area', 'area')
    map.addSource('area', t.source)
    map.addLayer({ id: 'area-line', type: 'line', source: 'area', 'source-layer': t.layer,
      paint: { 'line-color': '#111827', 'line-width': 2, 'line-dasharray': [3, 2] } })
  } else {
    map.addSource('area', { type: 'geojson', data: `${cfg.featureserv}/collections/public.study_area/items.json` })
    map.addLayer({ id: 'area-line', type: 'line', source: 'area',
      paint: { 'line-color': '#111827', 'line-width': 2, 'line-dasharray': [3, 2] } })
  }
}

function addDem() {
  if (isStatic) return
  const q = 'service=WMS&version=1.1.1&request=GetMap&styles=&format=image/png&transparent=true' +
    `&layers=${cfg.workspace}:dem&srs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}`
  map.addSource('dem', { type: 'raster', tileSize: 256, tiles: [`${cfg.geoserver}/${cfg.workspace}/wms?${q}`] })
  map.addLayer({ id: 'dem', type: 'raster', source: 'dem', layout: { visibility: 'none' } }, 'hex9-fill')
}

// ---------------------------------------------------------------- buildings: three ways to ship the same data
const BLD_IDS = ['bld-wms', 'bld-wfs', 'bld-mvt']
function clearBuildings() {
  BLD_IDS.forEach((id) => { if (map.getLayer(id)) map.removeLayer(id) })
  ;['bld-wms', 'bld-wfs', 'bld-mvt'].forEach((id) => { if (map.getSource(id)) map.removeSource(id) })
}
function setBuildings(mode) {
  clearBuildings()
  const fill = { 'fill-color': '#6b7280', 'fill-opacity': 0.55, 'fill-outline-color': '#374151' }
  if (mode === 'wms') {
    const q = 'service=WMS&version=1.1.1&request=GetMap&styles=&format=image/png&transparent=true&tiled=true' +
      `&layers=${cfg.workspace}:buildings&srs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}`
    map.addSource('bld-wms', { type: 'raster', tileSize: 256, minzoom: 12, tiles: [`${cfg.geoserver}/${cfg.workspace}/wms?${q}`] })
    map.addLayer({ id: 'bld-wms', type: 'raster', source: 'bld-wms' }, 'services')
  } else if (mode === 'wfs') {
    const url = `${cfg.geoserver}/${cfg.workspace}/ows?service=WFS&version=2.0.0&request=GetFeature` +
      `&typeNames=${cfg.workspace}:buildings&outputFormat=application/json&srsName=EPSG:4326`
    map.addSource('bld-wfs', { type: 'geojson', data: url })
    map.addLayer({ id: 'bld-wfs', type: 'fill', source: 'bld-wfs', minzoom: 12, paint: fill }, 'services')
  } else if (mode === 'mvt') {
    const t = vtSource('buildings', 'buildings')
    map.addSource('bld-mvt', t.source)
    map.addLayer({ id: 'bld-mvt', type: 'fill', source: 'bld-mvt', 'source-layer': t.layer, minzoom: 12, paint: fill }, 'services')
  }
}

// ---------------------------------------------------------------- UI
let activePopup
function popup(lngLat, rows, link) {
  const box = document.createElement('div')
  box.className = 'pop'
  rows.forEach(([k, v]) => {
    const r = document.createElement('div')
    const b = document.createElement('b'); b.textContent = `${k}: `
    r.append(b, document.createTextNode(String(v ?? 'n/a')))
    box.append(r)
  })
  if (link) {
    const a = document.createElement('a'); a.textContent = link.text; a.href = link.href; a.target = '_blank'; a.rel = 'noopener'
    box.append(a)
  }
  activePopup?.remove()
  activePopup = new maplibregl.Popup({ maxWidth: '280px' }).setLngLat(lngLat).setDOMContent(box).addTo(map)
}

function vis(id, on) { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none') }
function currentRes() { return document.querySelector('input[name=res]:checked').value }
function syncHex() {
  const on = $('l-hex').checked
  ;['8', '9'].forEach((r) => { vis(`hex${r}-fill`, on && currentRes() === r); vis(`hex${r}-line`, on && currentRes() === r) })
}

function renderLegend() {
  const lg = $('legend')
  lg.replaceChildren()
  const h = document.createElement('h2'); h.textContent = 'Legend'; lg.append(h)
  const sub = document.createElement('div'); sub.className = 'lg-title'
  sub.textContent = `Walking distance to nearest service (threshold ${threshold} m)`
  lg.append(sub)
  STOPS.forEach(([m, c]) => {
    const r = document.createElement('div'); r.className = 'lg-row'
    const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = c
    const lab = m === 0 ? '0 m' : m === 1 ? `${threshold} m  (threshold)` : m === 2.5 ? `${Math.round(m * threshold)} m +` : `${Math.round(m * threshold)} m`
    r.append(sw, document.createTextNode(lab)); lg.append(r)
  })
  const faint = document.createElement('div'); faint.className = 'lg-row'
  const fs = document.createElement('span'); fs.className = 'sw'; fs.style.cssText = 'background:#999;opacity:.25'
  faint.append(fs, document.createTextNode('faded = no population (proxy = 0)')); lg.append(faint)
  ;[['#2563eb', 'Service with name'], ['#f97316', 'Service without name tag']].forEach(([c, t]) => {
    const r = document.createElement('div'); r.className = 'lg-row'
    const d = document.createElement('span'); d.className = 'dot'; d.style.background = c
    r.append(d, document.createTextNode(t)); lg.append(r)
  })
}

map.on('load', () => {
  addArea()
  addHex(8)
  addHex(9)
  addDem() // inserted below the hex layers, so it must come after them
  addServices()
  syncHex()
  renderLegend()
  map.fitBounds([[cfg.bbox[0], cfg.bbox[1]], [cfg.bbox[2], cfg.bbox[3]]], { padding: 40, animate: false })
})

// URL presets, e.g. ?z=14&bld=wfs&dem=1&res=8&spd=900 - handy for reproducible screenshots and the Q9 timing runs
function applyPresets() {
  const q = new URLSearchParams(window.location.search)
  const pick = (name, value) => { const el = document.querySelector(`input[name=${name}][value="${value}"]`); if (el && !el.disabled) { el.checked = true; el.dispatchEvent(new Event('change')) } }
  if (q.get('res')) pick('res', q.get('res'))
  if (q.get('spd')) pick('spd', q.get('spd'))
  if (q.get('dem') === '1' && !$('l-dem').disabled) { $('l-dem').checked = true; vis('dem', true) }
  if (q.get('z')) map.jumpTo({ zoom: Number(q.get('z')), center: cfg.center })
  if (q.get('bld')) pick('bld', q.get('bld'))
}
map.once('idle', applyPresets)

$('l-osm').onchange = (e) => vis('osm', e.target.checked)
$('l-dem').onchange = (e) => vis('dem', e.target.checked)
$('l-hex').onchange = syncHex
$('l-svc').onchange = (e) => vis('services', e.target.checked)
$('l-area').onchange = (e) => vis('area-line', e.target.checked)
document.querySelectorAll('input[name=res]').forEach((r) => (r.onchange = syncHex))
document.querySelectorAll('input[name=spd]').forEach((r) => (r.onchange = () => {
  threshold = Number(document.querySelector('input[name=spd]:checked').value)
  ;['8', '9'].forEach((res) => map.setPaintProperty(`hex${res}-fill`, 'fill-color', distColor(threshold)))
  renderLegend()
}))
document.querySelectorAll('input[name=bld]').forEach((r) => (r.onchange = (e) => setBuildings(e.target.value)))
