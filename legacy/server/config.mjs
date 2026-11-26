import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadEnvFile } from 'node:process'
try { loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))) }
catch (error) { if (error.code !== 'ENOENT') throw error }
export const categories = JSON.parse(readFileSync(new URL('../shared/categories.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''))
const envNumber = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isFinite(value)) throw new Error(`Invalid ${name}`)
  return value
}
export const config = {
  name: process.env.COVERAGE_NAME || 'Pune',
  bounds: { south: envNumber('COVERAGE_SOUTH', 18.4), west: envNumber('COVERAGE_WEST', 73.73), north: envNumber('COVERAGE_NORTH', 18.65), east: envNumber('COVERAGE_EAST', 74.04) },
  center: { lat: envNumber('CENTER_LAT', 18.5204), lng: envNumber('CENTER_LNG', 73.8567) },
  maxRadiusKm: 20, maxNearestN: 200, geoserverLayer: 'nearby:facilities',
}
const b = config.bounds
export function inCoverage({ lat, lng }) { return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east }
if (b.south < -90 || b.north > 90 || b.west < -180 || b.east > 180 || b.south >= b.north || b.west >= b.east || !inCoverage(config.center)) throw new Error('Coverage bounds or centre are invalid.')
export const databaseUrl = process.env.DATABASE_URL || 'postgres://nearby:nearby_local@127.0.0.1:5432/nearby'
export const geoserverUrl = process.env.GEOSERVER_URL || 'http://127.0.0.1:8081/geoserver'

