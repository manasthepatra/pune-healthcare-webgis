import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { categories } from './facilities'
import type { AppConfig, CategoryId, Facility, Position } from './types'

type Props = { center: Position; facilities: Facility[]; activeId: string | null; radiusKm: number | null; config: AppConfig | null
  selectedCategories: CategoryId[]; selectedSubcategories: string[]
  onPick: (facility: Facility) => void; onOrigin: (position: Position) => void; onLayerError: (message: string | null) => void }
export default function MapView({ center, facilities, activeId, radiusKm, config, selectedCategories, selectedSubcategories, onPick, onOrigin, onLayerError }: Props) {
  const node = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layers = useRef<L.LayerGroup | null>(null)
  const originLayer = useRef<L.LayerGroup | null>(null)
  const markers = useRef(new Map<string, L.Marker>())
  const wms = useRef<L.TileLayer.WMS | null>(null)
  const callbacks = useRef({ onPick, onOrigin, onLayerError })
  callbacks.current = { onPick, onOrigin, onLayerError }
  useEffect(() => {
    if (!node.current) return
    const instance = L.map(node.current, { zoomControl: false }).setView([center.lat, center.lng], 13)
    map.current = instance
    L.control.zoom({ position: 'bottomright' }).addTo(instance)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(instance)
    layers.current = L.layerGroup().addTo(instance)
    originLayer.current = L.layerGroup().addTo(instance)
    instance.on('click', (event: L.LeafletMouseEvent) => callbacks.current.onOrigin({ lat: event.latlng.lat, lng: event.latlng.lng }))
    const resize = new ResizeObserver(() => instance.invalidateSize())
    resize.observe(node.current)
    return () => { resize.disconnect(); instance.remove(); map.current = null; markers.current.clear() }
  }, [])
  useEffect(() => {
    if (!map.current || !originLayer.current) return
    originLayer.current.clearLayers()
    map.current.flyTo([center.lat, center.lng], 14, { duration: 0.5 })
    L.marker([center.lat, center.lng], { icon: L.divIcon({ className: 'user-pin', html: '<span></span>', iconSize: [22,22], iconAnchor: [11,11] }) })
      .bindTooltip('Search centre').addTo(originLayer.current)
    if (radiusKm) L.circle([center.lat, center.lng], { radius: radiusKm * 1000, color: '#2563eb', weight: 1.5, fillOpacity: 0.04, interactive: false }).addTo(originLayer.current)
  }, [center.lat, center.lng, radiusKm])
  useEffect(() => {
    if (!map.current || !config) return
    const { south, west, north, east } = config.bounds
    const boundary = L.rectangle([[south, west], [north, east]], { color: '#52705e', dashArray: '7 5', weight: 2, fill: false, interactive: false }).addTo(map.current)
    const published = L.tileLayer.wms('/geoserver/nearby/wms', { layers: config.geoserverLayer, format: 'image/png', transparent: true, version: '1.1.1', attribution: 'Services: © OpenStreetMap contributors',
      cql_filter: "INCLUDE" } as L.WMSOptions)
    wms.current = published
    published.on('tileerror', () => callbacks.current.onLayerError('Published layer unavailable. Turn it off and on in the layer control to retry.'))
    published.on('loading', () => callbacks.current.onLayerError(null))
    published.on('remove', () => callbacks.current.onLayerError(null))
    const control = L.control.layers({}, { 'Published services (GeoServer)': published, 'Study area': boundary }, { position: 'topright' }).addTo(map.current)
    return () => { control.remove(); boundary.remove(); published.remove(); wms.current = null }
  }, [config?.geoserverLayer, config?.bounds.south, config?.bounds.west, config?.bounds.north, config?.bounds.east])
  useEffect(() => {
    const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'"
    const categoryFilter = selectedCategories.length ? `category IN (${selectedCategories.map(quote).join(',')})` : 'EXCLUDE'
    const subFilter = selectedSubcategories.length ? ` AND subcategory IN (${selectedSubcategories.map(quote).join(',')})` : ''
    if (wms.current) wms.current.setParams({ ...wms.current.wmsParams, cql_filter: categoryFilter + subFilter } as L.WMSParams)
  }, [selectedCategories, selectedSubcategories, config?.geoserverLayer])
  useEffect(() => {
    if (!layers.current) return
    layers.current.clearLayers(); markers.current.clear()
    facilities.forEach(facility => {
      const category = categories.find(item => item.id === facility.category)
      const iconElement = document.createElement('span')
      iconElement.style.background = category?.color || '#52705e'
      iconElement.textContent = category?.icon || '•'
      const marker = L.marker([facility.lat, facility.lng], { title: facility.name, icon: L.divIcon({ className: 'facility-pin', html: iconElement, iconSize: [32,32], iconAnchor: [16,32] }) })
      const popup = document.createElement('div'), title = document.createElement('strong'), subtitle = document.createElement('p')
      title.textContent = facility.name
      subtitle.textContent = `${facility.subcategory.replaceAll('_', ' ')} · ${facility.distance.toFixed(2)} km straight-line`
      popup.append(title, subtitle)
      if (facility.address) { const address = document.createElement('p'); address.textContent = facility.address; popup.append(address) }
      marker.bindPopup(popup).on('click', () => callbacks.current.onPick(facility)).addTo(layers.current!)

      const element = marker.getElement()
      element?.setAttribute('aria-label', facility.name + ', ' + facility.distance.toFixed(2) + ' km')
      element?.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); callbacks.current.onPick(facility); marker.openPopup() }
      })
      markers.current.set(facility.id, marker)
    })
  }, [facilities])
  useEffect(() => {
    markers.current.forEach((marker, id) => {
      marker.getElement()?.classList.toggle('is-active', id === activeId)
      marker.setZIndexOffset(id === activeId ? 1000 : 0)
    })
    if (activeId) {
      const marker = markers.current.get(activeId)
      if (marker && map.current) { map.current.panTo(marker.getLatLng()); marker.openPopup() }
    } else markers.current.forEach(marker => marker.closePopup())
  }, [activeId, facilities])
  return <div ref={node} className="map" aria-label="Interactive services map. Click to select a search location." />
}


