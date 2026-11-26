import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
const execute=promisify(execFile)
test('publication creates and updates expected GeoServer REST resources', async () => {
  const requests=[]
  let exists=false
  const server=createServer(async(req,res)=>{
    let body=''; for await(const chunk of req) body+=chunk
    requests.push({method:req.method,path:req.url,body})
    res.writeHead(req.method==='GET' && !exists ? 404 : 200); res.end('{}')
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const env={...process.env,GEOSERVER_URL:'http://127.0.0.1:'+server.address().port+'/geoserver',DATABASE_URL:'postgres://nearby:test@db:5432/nearby',GEOSERVER_DB_HOST:'db'}
  try {
    await execute(process.execPath,['scripts/publish-geoserver.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env})
    const store=JSON.parse(requests.find(r=>r.method==='POST' && r.path.endsWith('/datastores')).body)
    assert.ok(store.dataStore.connectionParameters.entry.some(e=>e['@key']==='host' && e.$==='db'))
    const layer=JSON.parse(requests.find(r=>r.method==='POST' && r.path.endsWith('/featuretypes')).body)
    assert.equal(layer.featureType.srs,'EPSG:4326')
    const style=requests.find(r=>r.method==='PUT' && r.path.endsWith('/styles/nearby_services'))
    assert.match(style.body,/<ogc:Literal>pharmacy<\/ogc:Literal>/)
    assert.match(style.body,/<ogc:Literal>park<\/ogc:Literal>/)
    exists=true; requests.length=0
    await execute(process.execPath,['scripts/publish-geoserver.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env})
    assert.equal(requests.filter(r=>r.method==='POST').length,0)
    assert.ok(requests.some(r=>r.method==='PUT' && r.path.includes('recalculate=nativebbox,latlonbbox')))
  } finally { await new Promise(resolve=>server.close(resolve)) }
})

