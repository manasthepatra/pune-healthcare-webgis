import test from 'node:test'
import assert from 'node:assert/strict'
import { InputError, parseSearch, searchQuery } from '../server/search.mjs'
const params = (extra = {}) => new URLSearchParams({ lat: '18.5204', lng: '73.8567', categories: 'hospital,pharmacy', ...extra })

test('radius input is converted from kilometres to metres', () => {
  const search = parseSearch(params({ radiusKm: '1.5' }))
  assert.equal(search.radiusM, 1500)
  assert.equal(search.n, null)
})
test('nearest N has no implicit radius and deduplicates categories', () => {
  const search = parseSearch(params({ mode: 'nearest', n: '7', categories: 'hospital,hospital' }))
  assert.equal(search.radiusM, null)
  assert.equal(search.n, 7)
  assert.deepEqual(search.categories, ['hospital'])
})
test('combined mode applies both constraints', () => {
  const search = parseSearch(params({ mode: 'combined', radiusKm: '3', n: '12' }))
  assert.equal(search.radiusM, 3000)
  assert.equal(search.n, 12)
})
test('missing, blank, nonnumeric and out of range coordinates are rejected', () => {
  for (const lat of ['', 'NaN', '91', '-91', 'Infinity']) assert.throws(() => parseSearch(params({ lat })), InputError)
  const input = params(); input.delete('lng')
  assert.throws(() => parseSearch(input), InputError)
})
test('valid global coordinates outside coverage are rejected', () => {
  assert.throws(() => parseSearch(params({ lat: '19.076', lng: '72.8777' })), /coverage/)
})
test('empty and unknown categories are rejected', () => {
  for (const categories of ['', 'unknown', "hospital');DROP TABLE facilities;--"]) assert.throws(() => parseSearch(params({ categories })), InputError)
})
test('subcategories must belong to selected categories', () => {
  assert.deepEqual(parseSearch(params({ subcategories: 'clinic' })).subcategories, ['clinic'])
  assert.throws(() => parseSearch(params({ subcategories: 'school' })), InputError)
})
test('invalid modes, radii and N values are rejected', () => {
  assert.throws(() => parseSearch(params({ mode: 'invalid' })), InputError)
  for (const radiusKm of ['0', '20.1', '', 'NaN']) assert.throws(() => parseSearch(params({ radiusKm })), InputError)
  for (const n of ['0', '201', '2.5', '', 'NaN']) assert.throws(() => parseSearch(params({ mode: 'nearest', n })), InputError)
})
test('pagination is bounded and integral', () => {
  assert.equal(parseSearch(params({ offset: '50', limit: '50' })).offset, 50)
  for (const extra of [{ offset: '-1' }, { offset: '2.5' }, { limit: '101' }, { limit: '0' }]) assert.throws(() => parseSearch(params(extra)), InputError)
})
test('SQL binds longitude first and uses indexed geography distances', () => {
  const search = parseSearch(params({ mode: 'combined', radiusKm: '2', n: '10', offset: '5', subcategories: 'clinic' }))
  const query = searchQuery(search)
  assert.deepEqual(query.values.slice(0, 8), [73.8567, 18.5204, ['hospital', 'pharmacy'], ['clinic'], 2000, 10, 50, 5])
  assert.match(query.text, /ST_DWithin\(f.geom::geography/)
  assert.match(query.text, /ST_Distance\(f.geom::geography/)
  assert.match(query.text, /ORDER BY distance, id/)
  assert.ok(!query.text.includes('73.8567'))
  assert.ok(!query.text.includes("'clinic'"))
})

