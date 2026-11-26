import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
let child, base
const project = fileURLToPath(new URL('../', import.meta.url))
before(async () => {
  child = spawn(process.execPath, ['server/index.mjs'], { cwd: project, env: { ...process.env, PORT: '0', HOST: '127.0.0.1' }, stdio: ['ignore','pipe','pipe'] })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('API startup timed out')), 10000)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('exit', code => { clearTimeout(timeout); reject(new Error('API exited with '+code)) })
    child.stdout.on('data', chunk => {
      const match = chunk.toString().match(/http:\/\/localhost:(\d+)/)
      if (match) { base = 'http://127.0.0.1:'+match[1]; clearTimeout(timeout); resolve() }
    })
  })
})
after(() => { child?.kill() })
test('serves production HTML and JavaScript assets', { skip: !existsSync(new URL('../dist/index.html', import.meta.url)) }, async () => {
  const response = await fetch(base)
  assert.equal(response.status, 200)
  const body = await response.text()
  assert.match(body, /Nearby Services WebGIS/)
  assert.match(body, /name="viewport"/)
  const asset = body.match(/src="([^"]+\.js)"/)[1]
  const script = await fetch(base+asset)
  assert.equal(script.status, 200)
  assert.match(script.headers.get('content-type'), /javascript/)
})
test('invalid spatial input returns a user-facing 400 before database access', async () => {
  const response = await fetch(base+'/api/services?lat=91&lng=73.85&categories=hospital')
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /lat/)
})
test('unknown API routes and GIS administrative routes are unavailable', async () => {
  assert.equal((await fetch(base+'/api/unknown')).status, 404)
  assert.equal((await fetch(base+'/geoserver/rest/workspaces')).status, 404)
})
test('unsupported request methods return 405 with Allow header', async () => {
  const response = await fetch(base+'/api/services', { method: 'POST' })
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('allow'), 'GET')
})
test('unsupported WMS operations and layers are rejected before proxying', async () => {
  assert.equal((await fetch(base+'/geoserver/nearby/wms?request=DeleteFeature')).status, 400)
  assert.equal((await fetch(base+'/geoserver/nearby/wms?request=GetMap&layers=unknown')).status, 400)
})

