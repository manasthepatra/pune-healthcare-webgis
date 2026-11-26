import { writeFile } from 'node:fs/promises'
import { fetchOverpass, describeError } from '../server/overpass.mjs'
import { normalizePayload } from '../server/osm.mjs'

try {
  const destination = process.argv[2] || 'response.json'
  const payload = await fetchOverpass()
  const facilities = normalizePayload(payload)
  await writeFile(destination, JSON.stringify(payload), 'utf8')
  console.log(`Saved ${facilities.length} facilities to ${destination}.`)
} catch (error) {
  console.error(describeError(error))
  process.exitCode = 1
}
