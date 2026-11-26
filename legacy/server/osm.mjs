import { categories, inCoverage } from './config.mjs'
function matches(tags, selector) {
  return selector.split(',').every(rule => {
    const match = rule.match(/^([^!=]+)(!?=)(.+)$/)
    return match[2] === '!=' ? tags[match[1]] !== match[3] : tags[match[1]] === match[3]
  })
}
export function normalizeFacility(element) {
  if (!element || !['node','way','relation'].includes(element.type) || !Number.isSafeInteger(element.id) || element.id <= 0) return null
  const tags = element.tags || {}
  const category = categories.find(c => c.selectors.some(selector => matches(tags, selector)))
  const lat = element.lat ?? element.center?.lat
  const lng = element.lon ?? element.center?.lon
  if (!category || !Number.isFinite(lat) || !Number.isFinite(lng) || !inCoverage({ lat, lng })) return null
  let subcategory = category.id
  if (category.id === 'hospital') subcategory = tags.amenity === 'clinic' || tags.healthcare === 'clinic' ? 'clinic' : 'hospital'
  else if (category.id === 'education' || category.id === 'food' || category.id === 'fire') subcategory = tags.amenity
  else if (category.id === 'park') subcategory = tags.leisure
  else if (category.id === 'bus') subcategory = tags.highway === 'bus_stop' ? 'bus_stop' : tags.amenity === 'bus_station' ? 'bus_station' : 'platform'
  else if (category.id === 'metro' || category.id === 'rail') subcategory = tags.railway
  return { id: `${element.type}-${element.id}`, name: tags.name || tags['name:en'] || `Unnamed ${subcategory.replaceAll('_', ' ')}`,
    category: category.id, subcategory, lat, lng,
    address: [tags['addr:housenumber'], tags['addr:street'], tags['addr:suburb'], tags['addr:city'], tags['addr:postcode']].filter(Boolean).join(', ') || null,
    phone: tags.phone || tags['contact:phone'] || null, website: tags.website || tags['contact:website'] || null,
    opening_hours: tags.opening_hours || null, wheelchair: tags.wheelchair || null, tags }
}

export function normalizePayload(payload) {
  if (!payload || !Array.isArray(payload.elements) || payload.remark) throw new Error('Overpass data is incomplete or invalid; existing data was preserved.')
  const unique = new Map()
  for (const element of payload.elements) {
    const facility = normalizeFacility(element)
    if (facility) unique.set(facility.id, facility)
  }
  const facilities = [...unique.values()]
  if (!facilities.length) throw new Error('No facilities matched the configured coverage; existing data was preserved.')
  return facilities
}
