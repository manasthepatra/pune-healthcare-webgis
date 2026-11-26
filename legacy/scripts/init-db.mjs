import { readFile } from 'node:fs/promises'
import { pool } from '../server/db.mjs'
try {
  await pool.query(await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8'))
  console.log('PostGIS schema and spatial indexes are ready.')
} catch (error) { console.error(error.message); process.exitCode = 1 }
finally { await pool.end() }

