import { readFile } from 'node:fs/promises'
import { config } from '../server/config.mjs'
import { pool } from '../server/db.mjs'
import { normalizePayload } from '../server/osm.mjs'
import { describeError, fetchOverpass } from '../server/overpass.mjs'

let client
try {
  const fileIndex = process.argv.indexOf('--file')
  let payload
  if (fileIndex !== -1) {
    if (!process.argv[fileIndex + 1]) throw new Error('Supply an Overpass JSON file after --file.')
    payload = JSON.parse((await readFile(process.argv[fileIndex + 1], 'utf8')).replace(/^\uFEFF/, ''))
  } else {
    payload = await fetchOverpass()
  }
  const facilities = normalizePayload(payload)
  client = await pool.connect()
  await client.query('BEGIN')
  // One atomic refresh of imported OSM records; other sources are preserved.
  await client.query("DELETE FROM facilities WHERE source = 'OpenStreetMap'")
  for (let i = 0; i < facilities.length; i += 500) {
    await client.query(`INSERT INTO facilities (id,name,category,subcategory,geom,address,phone,website,opening_hours,wheelchair,tags)
      SELECT id,name,category,subcategory,ST_SetSRID(ST_MakePoint(lng,lat),4326),address,phone,website,opening_hours,wheelchair,tags
      FROM jsonb_to_recordset($1::jsonb) AS x(id text,name text,category text,subcategory text,lng double precision,lat double precision,
        address text,phone text,website text,opening_hours text,wheelchair text,tags jsonb)`, [JSON.stringify(facilities.slice(i, i + 500))])
  }
  await client.query('INSERT INTO dataset_imports (facility_count,coverage) VALUES ($1,$2::jsonb)', [facilities.length, JSON.stringify(config.bounds)])
  await client.query('COMMIT')
  await client.query('ANALYZE facilities')
  console.log(`Imported ${facilities.length} facilities. Data source: © OpenStreetMap contributors (ODbL).`)
} catch (error) {
  if (client) await client.query('ROLLBACK').catch(() => {})
  console.error(describeError(error)); process.exitCode = 1
} finally { client?.release(); await pool.end() }

