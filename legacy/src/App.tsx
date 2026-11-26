import { useCallback, useEffect, useRef, useState } from 'react'
import MapView from './MapView'
import { categories, fetchConfig, fetchFacilities, isInCoverage, puneCenter } from './facilities'
import type { AppConfig, CategoryId, Facility, Position, SearchMode, SearchOptions } from './types'

const defaults = categories.map(category => category.id)
const initialOptions: SearchOptions = { mode: 'radius', radiusKm: 2, nearestN: 10, categories: defaults, subcategories: [] }
type Query = { center: Position; options: SearchOptions }
function safeWebsite(value?: string) {
  if (!value) return null
  try { const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); return ['http:', 'https:'].includes(url.protocol) ? url.href : null }
  catch { return null }
}
export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [configError, setConfigError] = useState('')
  const [configRetry, setConfigRetry] = useState(0)
  const [center, setCenter] = useState<Position>(puneCenter)
  const [latitude, setLatitude] = useState(String(puneCenter.lat))
  const [longitude, setLongitude] = useState(String(puneCenter.lng))
  const [locationNote, setLocationNote] = useState('Pune city centre')
  const [locationError, setLocationError] = useState('')
  const [locating, setLocating] = useState(false)
  const locationRequest = useRef(0)
  const [selected, setSelected] = useState<CategoryId[]>(defaults)
  const [subcategories, setSubcategories] = useState<string[]>([])
  const [mode, setMode] = useState<SearchMode>('radius')
  const [radius, setRadius] = useState('2')
  const [nearestN, setNearestN] = useState('10')
  const [query, setQuery] = useState<Query | null>(null)
  const [offset, setOffset] = useState(0)
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [total, setTotal] = useState(0)
  const [active, setActive] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [status, setStatus] = useState('Connecting to the nearby service…')
  const [layerError, setLayerError] = useState<string | null>(null)
  const resultNodes = useRef(new Map<string, HTMLButtonElement>())
  const activeFacility = facilities.find(facility => facility.id === active)

  useEffect(() => {
    const controller = new AbortController()
    setConfigError('')
    fetchConfig(controller.signal).then(data => {
      if (controller.signal.aborted) return
      setSelected(defaults); setSubcategories([]); setMode('radius'); setRadius('2'); setNearestN('10')
      setConfig(data); setCenter(data.center); setLatitude(String(data.center.lat)); setLongitude(String(data.center.lng))
      setLocationNote(`${data.name} search centre`)
      setOffset(0); setQuery({ center: data.center, options: initialOptions })
    }).catch(error => { if (!controller.signal.aborted) { setConfigError(error.message); setStatus('Nearby service unavailable.') } })
    return () => controller.abort()
  }, [configRetry])

  useEffect(() => {
    if (!query) return
    const controller = new AbortController()
    setLoading(true); setSearchError('')
    fetchFacilities(query.center, query.options, offset, controller.signal).then(data => {
      if (controller.signal.aborted) return
      setFacilities(current => offset ? [...current, ...data.facilities.filter(item => !current.some(existing => existing.id === item.id))] : data.facilities)
      setTotal(data.total)
      setStatus(data.total ? `${data.total} matching services · straight-line distance` : 'No matches. Try a wider radius or different categories.')
      if (!offset) setActive(null)
      setConfig(current => current ? { ...current, importedAt: data.importedAt } : current)
    }).catch(error => {
      if (controller.signal.aborted) return
      setSearchError(error.message); setStatus('Search could not be completed.')
      if (!offset) { setFacilities([]); setTotal(0) }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [query, offset])

  const invalidate = useCallback(() => {
    setQuery(null); setOffset(0); setFacilities([]); setTotal(0); setActive(null); setLoading(false); setSearchError('')
    setStatus('Choose your options and press Search nearby.')
  }, [])
  const chooseOrigin = useCallback((position: Position, label: string) => {
    locationRequest.current++; setLocating(false)
    if (!config || !isInCoverage(position, config.bounds)) { setLocationError(`Choose a point inside the ${config?.name || 'Pune'} coverage rectangle.`); return }
    setCenter(position); setLatitude(String(position.lat)); setLongitude(String(position.lng))
    setLocationNote(label); setLocationError(''); invalidate()
  }, [config, invalidate])
  const onMapOrigin = useCallback((position: Position) => chooseOrigin(position, 'Location selected on map'), [chooseOrigin])
  const pickFacility = useCallback((facility: Facility) => setActive(facility.id), [])
  useEffect(() => {
    if (active) resultNodes.current.get(active)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [active])

  function applyCoordinates(event: React.FormEvent) {
    event.preventDefault()
    const lat = Number(latitude), lng = Number(longitude)
    if (!latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setLocationError('Enter valid latitude (−90 to 90) and longitude (−180 to 180).'); return
    }
    chooseOrigin({ lat, lng }, 'Entered coordinates')
  }
  function requestLocation() {
    if (!navigator.geolocation) { setLocationError('This browser does not support location. Enter coordinates or click the map.'); return }
    const requestId = ++locationRequest.current
    setLocating(true); setLocationError('')
    navigator.geolocation.getCurrentPosition(position => {
      if (locationRequest.current !== requestId) return
      chooseOrigin({ lat: position.coords.latitude, lng: position.coords.longitude }, 'Your current location')
    }, error => {
      if (locationRequest.current !== requestId) return
      setLocating(false)
      setLocationError(error.code === 1 ? 'Location permission was denied. Enter coordinates or click the map.' : error.code === 3 ? 'Location request timed out. Try again or click the map.' : 'Your location could not be determined. Enter coordinates or click the map.')
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 })
  }
  function toggleCategory(id: CategoryId) {
    const next = selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id]
    setSelected(next)
    const allowed = categories.filter(category => next.includes(category.id)).flatMap(category => category.subcategories)
    setSubcategories(current => current.filter(sub => allowed.includes(sub))); invalidate()
  }
  function search() {
    if (!config) return
    if (!selected.length) { setSearchError('Choose at least one service category.'); return }
    const radiusKm = Number(radius), n = Number(nearestN)
    if (mode !== 'nearest' && (!radius.trim() || !Number.isFinite(radiusKm) || radiusKm < 0.1 || radiusKm > config.maxRadiusKm)) { setSearchError(`Radius must be between 0.1 and ${config.maxRadiusKm} km.`); return }
    if (mode !== 'radius' && (!nearestN.trim() || !Number.isInteger(n) || n < 1 || n > config.maxNearestN)) { setSearchError(`N must be a whole number between 1 and ${config.maxNearestN}.`); return }
    setFacilities([]); setTotal(0); setActive(null); setOffset(0)
    setQuery({ center: { ...center }, options: { mode, radiusKm, nearestN: n, categories: [...selected], subcategories: [...subcategories] } })
  }
  const website = safeWebsite(activeFacility?.website)
  const phone = activeFacility?.phone?.replace(/[^+\d]/g, '')
  const availableSubcategories = [...new Set(categories.filter(c => selected.includes(c.id)).flatMap(c => c.subcategories))]
  return <main className="app-shell">
    <header className="topbar"><a className="brand" href="#top"><span>◉</span> Nearby Services</a><div className="city-tag">{config?.name || 'Pune'} coverage</div>
      <button className="locate-button" onClick={requestLocation} disabled={!config || locating}>{locating ? 'Locating…' : 'Use my location'}</button></header>
    <section className="intro" id="top"><p className="eyebrow">NEARBY SERVICES WEBGIS</p><h1>Find the services around you.</h1><p>Click the map, enter coordinates or use your location. Explore services by distance.</p></section>
    {configError && <div className="service-banner" role="alert">{configError} <button onClick={() => setConfigRetry(value => value + 1)}>Retry connection</button></div>}
    <section className="workspace">
      <aside className="sidebar">
        <div className="search-origin"><span className="pulse" /><div><strong>{locationNote}</strong><small>{center.lat.toFixed(5)}, {center.lng.toFixed(5)}</small></div></div>
        <form className="coordinates" onSubmit={applyCoordinates}><label>Latitude<input type="number" step="any" min="-90" max="90" required value={latitude} onChange={e => setLatitude(e.target.value)} /></label><label>Longitude<input type="number" step="any" min="-180" max="180" required value={longitude} onChange={e => setLongitude(e.target.value)} /></label><button disabled={!config} type="submit">Set location</button></form>
        <p className="hint">Click inside the dashed coverage rectangle to choose a search point.</p>
        {locationError && <p className="error" role="alert">{locationError}</p>}
        <div className="filter-header"><h2>Service categories</h2><button onClick={() => { setSelected(selected.length === categories.length ? [] : defaults); setSubcategories([]); invalidate() }}>{selected.length === categories.length ? 'Clear all' : 'Select all'}</button></div>
        <div className="filters">{categories.map(category => <label className={`filter ${selected.includes(category.id) ? 'checked' : ''}`} key={category.id}>
          <input type="checkbox" checked={selected.includes(category.id)} onChange={() => toggleCategory(category.id)} />
          <span className="category-icon" style={{ background: `${category.color}15`, color: category.color }}>{category.icon}</span><span>{category.label}</span>
        </label>)}</div>
        <details className="subcategories"><summary>Optional subcategories{subcategories.length ? ` (${subcategories.length})` : ''}</summary><p className="hint">None selected means all subcategories.</p>
          {availableSubcategories.map(sub => <label key={sub}><input type="checkbox" checked={subcategories.includes(sub)} onChange={() => { setSubcategories(current => current.includes(sub) ? current.filter(value => value !== sub) : [...current, sub]); invalidate() }} />{sub.replaceAll('_', ' ')}</label>)}</details>
        <div className="search-controls"><label>Search mode<select value={mode} onChange={e => { setMode(e.target.value as SearchMode); invalidate() }}><option value="radius">Within a radius</option><option value="nearest">Nearest N services</option><option value="combined">Nearest N within radius</option></select></label>
          {mode !== 'nearest' && <label>Radius (km)<input type="number" min="0.1" max={config?.maxRadiusKm || 20} step="0.1" value={radius} onChange={e => { setRadius(e.target.value); invalidate() }} /></label>}
          {mode !== 'radius' && <label>Number of services (N)<input type="number" min="1" max={config?.maxNearestN || 200} step="1" value={nearestN} onChange={e => { setNearestN(e.target.value); invalidate() }} /></label>}
          <button className="search-button" disabled={!config || loading} onClick={search}>{loading ? 'Searching…' : 'Search nearby'}</button>
        </div>
        <p className="data-note">© OpenStreetMap contributors · ODbL. Results reflect the imported dataset. Distances are straight-line, not travel distances.</p>
        {config && <p className="hint">{config.datasetCount.toLocaleString()} imported services{config.importedAt ? ` · Updated ${new Date(config.importedAt).toLocaleDateString()}` : ' · No import yet'}. Coverage uses an approximate rectangle.</p>}
      </aside>
      <div className="map-panel"><MapView center={center} facilities={facilities} activeId={active} radiusKm={mode === 'nearest' || !radius || !Number.isFinite(Number(radius)) || Number(radius) <= 0 || Number(radius) > (config?.maxRadiusKm || 20) ? null : Number(radius)}
        config={config} selectedCategories={selected} selectedSubcategories={subcategories} onPick={pickFacility} onOrigin={onMapOrigin} onLayerError={setLayerError} />
        <div className="map-title"><span>●</span><div><strong>{config?.name || 'Pune'} nearby services</strong><small role="status" aria-live="polite">{loading ? 'Searching nearby services…' : status}</small></div></div>
        {layerError && <div className="layer-error" role="alert">{layerError}</div>}
      </div>
      <aside className="results">
        <div className="results-heading"><div><p className="eyebrow">DISTANCE SORTED</p><h2>Places nearby</h2></div><span>{total}</span></div>
        {activeFacility && <section className="service-details" aria-label="Selected service details"><button className="close-details" aria-label="Close service details" onClick={() => setActive(null)}>×</button>
          <h3>{activeFacility.name}</h3><p>{activeFacility.subcategory.replaceAll('_', ' ')} · {activeFacility.distance.toFixed(2)} km</p>
          <dl><dt>Address</dt><dd>{activeFacility.address || 'Not available'}</dd><dt>Phone</dt><dd>{phone ? <a href={`tel:${phone}`}>{activeFacility.phone}</a> : 'Not available'}</dd>
            <dt>Website</dt><dd>{website ? <a href={website} target="_blank" rel="noopener noreferrer">Visit website</a> : 'Not available'}</dd>
            <dt>Opening hours</dt><dd>{activeFacility.openingHours || 'Not available'}</dd><dt>Wheelchair access</dt><dd>{activeFacility.wheelchair || 'Not available'}</dd><dt>Data source</dt><dd>{activeFacility.source}</dd></dl>
        </section>}
        {searchError && <div className="error result-error" role="alert">{searchError}<button onClick={() => { if (offset) setQuery(current => current ? { ...current } : current); else search() }}>Retry search</button></div>}
        <p className="result-summary">{facilities.length ? `Showing ${facilities.length} of ${total} · these results are marked on the map` : 'Choose a location and search options.'}</p>
        <div className="result-list">{facilities.map(facility => {
          const category = categories.find(item => item.id === facility.category)
          return <button ref={node => { if (node) resultNodes.current.set(facility.id, node); else resultNodes.current.delete(facility.id) }} key={facility.id} className={`result ${active === facility.id ? 'active' : ''}`} aria-pressed={active === facility.id} onClick={() => setActive(facility.id)}>
            <span className="category-icon" style={{ background: `${category?.color}15`, color: category?.color }}>{category?.icon}</span><span className="result-copy"><strong>{facility.name}</strong><small>{facility.subcategory.replaceAll('_', ' ')} · {facility.distance.toFixed(2)} km</small>{facility.address && <small>{facility.address}</small>}</span>
          </button>
        })}{!facilities.length && <div className="empty"><span>⌕</span><p>{loading ? 'Searching…' : status}</p>{config?.datasetCount === 0 && <p>No service data has been imported yet.</p>}</div>}</div>
        {facilities.length < total && !searchError && <button className="load-more" disabled={loading} onClick={() => setOffset(facilities.length)}>{loading ? 'Loading…' : 'Load more services'}</button>}
      </aside>
    </section>
  </main>
}

