import { categories, config, inCoverage } from './config.mjs'
export class InputError extends Error {}
const number = (params, key, min, max, fallback) => {
  const raw = params.get(key)
  const value = raw === null ? fallback : raw.trim() === '' ? NaN : Number(raw)
  if (!Number.isFinite(value) || value < min || value > max) throw new InputError(`${key} must be between ${min} and ${max}.`)
  return value
}
const integer = (params, key, min, max, fallback) => {
  const value = number(params, key, min, max, fallback)
  if (!Number.isInteger(value)) throw new InputError(`${key} must be a whole number.`)
  return value
}
export function parseSearch(params) {
  const lat = number(params, 'lat', -90, 90)
  const lng = number(params, 'lng', -180, 180)
  if (!inCoverage({ lat, lng })) throw new InputError(`Choose a location inside the configured ${config.name} coverage.`)
  const mode = params.get('mode') || 'radius'
  if (!['radius', 'nearest', 'combined'].includes(mode)) throw new InputError('Choose radius, nearest or combined search.')
  const selected = [...new Set((params.get('categories') || '').split(',').filter(Boolean))]
  if (!selected.length || selected.some(id => !categories.some(c => c.id === id))) throw new InputError('Choose at least one valid service category.')
  const subcategories = [...new Set((params.get('subcategories') || '').split(',').filter(Boolean))]
  const allowed = categories.filter(c => selected.includes(c.id)).flatMap(c => c.subcategories)
  if (subcategories.some(sub => !allowed.includes(sub))) throw new InputError('Subcategories must belong to the selected categories.')
  return { lat, lng, mode, categories: selected, subcategories,
    radiusM: mode === 'nearest' ? null : number(params, 'radiusKm', 0.1, config.maxRadiusKm, 2) * 1000,
    n: mode === 'radius' ? null : integer(params, 'n', 1, config.maxNearestN, 10),
    offset: integer(params, 'offset', 0, 1000000, 0), limit: integer(params, 'limit', 1, 100, 50) }
}
export function searchQuery(search) {
  // Exact spheroidal ordering; radius queries use the geography expression GiST index.
  return {
    text: `WITH origin AS (SELECT ST_SetSRID(ST_MakePoint($1, $2),4326)::geography AS geog),
    matches AS (
      SELECT f.id, f.name, f.category, f.subcategory, f.address, f.phone, f.website,
        f.opening_hours AS "openingHours", f.wheelchair, f.source,
        ST_Y(f.geom) AS lat, ST_X(f.geom) AS lng,
        ST_Distance(f.geom::geography, o.geog) / 1000 AS distance
      FROM facilities f CROSS JOIN origin o
      WHERE f.category = ANY($3::text[])
        AND (cardinality($4::text[]) = 0 OR f.subcategory = ANY($4::text[]))
        AND ($5::double precision IS NULL OR ST_DWithin(f.geom::geography, o.geog, $5))
        AND ST_Y(f.geom) BETWEEN $9 AND $10 AND ST_X(f.geom) BETWEEN $11 AND $12
    ), ranked AS (
      SELECT * FROM matches ORDER BY distance, id LIMIT $6
    )
    SELECT (SELECT count(*)::integer FROM ranked) AS total,
      COALESCE((SELECT json_agg(page ORDER BY distance, id) FROM
        (SELECT * FROM ranked ORDER BY distance, id LIMIT $7 OFFSET $8) page), '[]'::json) AS facilities`,
    values: [search.lng, search.lat, search.categories, search.subcategories, search.radiusM, search.n, search.limit, search.offset,
      config.bounds.south, config.bounds.north, config.bounds.west, config.bounds.east],
  }
}

