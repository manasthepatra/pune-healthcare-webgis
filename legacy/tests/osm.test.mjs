import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeFacility, normalizePayload } from '../server/osm.mjs'
const feature = (tags, extra = {}) => ({type:'node',id:123,lat:18.5204,lon:73.8567,tags,...extra})
test('essential service tags map to the expected category and subtype', () => {
  for (const [tags, category, subcategory] of [
    [{amenity:'hospital'},'hospital','hospital'], [{healthcare:'clinic'},'hospital','clinic'],
    [{amenity:'pharmacy'},'pharmacy','pharmacy'], [{amenity:'police'},'police','police'],
    [{amenity:'atm'},'atm','atm'], [{amenity:'bank',atm:'yes'},'atm','atm'],
    [{amenity:'school'},'education','school'], [{amenity:'fuel'},'fuel','fuel'],
    [{leisure:'park'},'park','park'], [{leisure:'garden'},'park','garden'],
    [{railway:'station',station:'subway'},'metro','station'], [{railway:'station'},'rail','station'],
    [{highway:'bus_stop'},'bus','bus_stop'], [{amenity:'fire_station'},'fire','fire_station'],
  ]) {
    const result=normalizeFacility(feature(tags))
    assert.equal(result.category,category); assert.equal(result.subcategory,subcategory)
  }
})
test('way centres and available contact metadata are preserved', () => {
  const result=normalizeFacility(feature({amenity:'hospital',name:'रुग्णालय', 'contact:phone':'+91 123', 'contact:website':'https://example.com',opening_hours:'24/7',wheelchair:'yes','addr:street':'Test road'}, {type:'way',lat:undefined,lon:undefined,center:{lat:18.52,lon:73.85}}))
  assert.equal(result.lat,18.52); assert.equal(result.lng,73.85)
  assert.equal(result.name,'रुग्णालय'); assert.equal(result.phone,'+91 123')
  assert.equal(result.website,'https://example.com'); assert.equal(result.address,'Test road')
})
test('duplicate IDs are removed while separate objects are retained', () => {
  const first=feature({amenity:'pharmacy',name:'Pharmacy'})
  const second=feature({amenity:'pharmacy',name:'Pharmacy'},{id:124})
  assert.equal(normalizePayload({elements:[first,first,second]}).length,2)
})
test('invalid, incomplete and empty datasets are rejected before replacement', () => {
  for(const payload of [null,{}, {elements:[]}, {elements:[feature({amenity:'hospital'})],remark:'timeout'}]) assert.throws(()=>normalizePayload(payload))
})
test('out of coverage, missing coordinates, unknown categories and invalid IDs are ignored', () => {
  for(const value of [feature({amenity:'hospital'},{lat:19}), feature({amenity:'hospital'},{lat:undefined}), feature({amenity:'bank'}), feature({amenity:'pharmacy'},{id:undefined}), null]) assert.equal(normalizeFacility(value),null)
})

