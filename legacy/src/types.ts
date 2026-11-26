export type CategoryId = 'hospital' | 'pharmacy' | 'police' | 'atm' | 'education' | 'fuel' | 'park' | 'bus' | 'metro' | 'rail' | 'food' | 'fire'
export type Position = { lat: number; lng: number }
export type SearchMode = 'radius' | 'nearest' | 'combined'
export type Facility = Position & {
  id: string; category: CategoryId; subcategory: string; name: string
  address?: string; phone?: string; website?: string; openingHours?: string
  wheelchair?: string; source: string; distance: number
}
export type SearchOptions = { mode: SearchMode; radiusKm: number; nearestN: number; categories: CategoryId[]; subcategories: string[] }
export type SearchResponse = { facilities: Facility[]; total: number; offset: number; limit: number; importedAt: string | null }
export type AppConfig = {
  name: string; center: Position
  bounds: { south: number; west: number; north: number; east: number }
  maxRadiusKm: number; maxNearestN: number; datasetCount: number; importedAt: string | null
  geoserverLayer: string
}

