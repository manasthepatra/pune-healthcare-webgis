import catalog from '../shared/categories.json'
import type { AppConfig, CategoryId, Position, SearchOptions, SearchResponse } from './types'
export const categories = catalog as Array<{ id: CategoryId; label: string; icon: string; color: string; subcategories: string[] }>
export const puneCenter: Position = { lat: 18.5204, lng: 73.8567 }
export function isInCoverage({ lat, lng }: Position, bounds: AppConfig['bounds']) {
  return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east
}
async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  let response: Response
  try { response = await fetch(url, { signal }) }
  catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    throw new Error('Cannot reach the nearby service. Check your connection and try again.')
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || 'The nearby service is unavailable. Please try again.')
  if (!payload) throw new Error('The nearby service returned an invalid response.')
  return payload as T
}
export function fetchConfig(signal: AbortSignal) { return getJson<AppConfig>('/api/config', signal) }
export function fetchFacilities(center: Position, options: SearchOptions, offset: number, signal: AbortSignal) {
  const query = new URLSearchParams({ lat: String(center.lat), lng: String(center.lng), mode: options.mode,
    categories: options.categories.join(','), subcategories: options.subcategories.join(','), offset: String(offset), limit: '50' })
  if (options.mode !== 'nearest') query.set('radiusKm', String(options.radiusKm))
  if (options.mode !== 'radius') query.set('n', String(options.nearestN))
  return getJson<SearchResponse>(`/api/services?${query}`, signal)
}

