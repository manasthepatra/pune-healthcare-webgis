import pg from 'pg'
import { databaseUrl } from './config.mjs'
export const pool = new pg.Pool({ connectionString: databaseUrl, max: 10, connectionTimeoutMillis: 5000, statement_timeout: 15000 })
pool.on('error', error => console.error('Idle database connection error:', error.message))

