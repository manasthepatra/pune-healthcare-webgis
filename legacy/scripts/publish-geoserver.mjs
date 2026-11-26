import { categories, config, databaseUrl, geoserverUrl } from '../server/config.mjs'

const auth = 'Basic ' + Buffer.from(`${process.env.GEOSERVER_USER || 'admin'}:${process.env.GEOSERVER_PASSWORD || 'nearby_geoserver_local'}`).toString('base64')
const escapeXml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;')
async function rest(path, method = 'GET', body, contentType = 'application/json') {
  const response = await fetch(`${geoserverUrl}/rest/${path}`, {
    method, headers: { Authorization: auth, 'Content-Type': contentType },
    body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  if (method === 'GET' && response.status === 404) return false
  if (!response.ok) throw new Error(`GeoServer ${method} ${path}: HTTP ${response.status}. Check server readiness and credentials.`)
  return true
}
try {
  if (!await rest('workspaces/nearby.json')) await rest('workspaces', 'POST', { workspace: { name: 'nearby' } })
  const db = new URL(databaseUrl)
  const entries = { dbtype: 'postgis', host: process.env.GEOSERVER_DB_HOST || db.hostname, port: db.port || '5432',
    database: db.pathname.slice(1), schema: 'public', user: decodeURIComponent(db.username), passwd: decodeURIComponent(db.password), 'Expose primary keys': 'true' }
  const datastore = { dataStore: { name: 'nearby_postgis', connectionParameters: { entry: [] } } }
  // Construct GeoServer's entry objects using the documented @key/$ representation.
  datastore.dataStore.connectionParameters.entry = Object.entries(entries).map(([key, value]) => ({ '@key': key, '$': value }))
  if (!await rest('workspaces/nearby/datastores/nearby_postgis.json')) await rest('workspaces/nearby/datastores', 'POST', datastore)
  else await rest('workspaces/nearby/datastores/nearby_postgis', 'PUT', datastore)
  if (!await rest('workspaces/nearby/datastores/nearby_postgis/featuretypes/facilities.json')) {
    await rest('workspaces/nearby/datastores/nearby_postgis/featuretypes', 'POST', { featureType: {
      name: 'facilities', nativeName: 'facilities', title: `${config.name} nearby services`, srs: 'EPSG:4326', enabled: true,
    } })
  }
  const rules = categories.map(category => `<Rule><Name>${escapeXml(category.id)}</Name><Title>${escapeXml(category.label)}</Title>
    <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>category</ogc:PropertyName><ogc:Literal>${escapeXml(category.id)}</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
    <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName><Fill><CssParameter name="fill">${category.color}</CssParameter></Fill>
    <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke></Mark><Size>9</Size></Graphic></PointSymbolizer></Rule>`).join('')
  const sld = `<?xml version="1.0" encoding="UTF-8"?><StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc"><NamedLayer><Name>nearby_services</Name><UserStyle><Title>Nearby service categories</Title><FeatureTypeStyle>${rules}</FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>`
  if (!await rest('workspaces/nearby/styles/nearby_services.json')) await rest('workspaces/nearby/styles', 'POST', { style: { name: 'nearby_services', filename: 'nearby_services.sld' } })
  await rest('workspaces/nearby/styles/nearby_services', 'PUT', sld, 'application/vnd.ogc.sld+xml')
  await rest('layers/nearby:facilities', 'PUT', { layer: { defaultStyle: { name: 'nearby_services', workspace: 'nearby' } } })
  // Refresh the published extent after an import or coverage change.
  await rest('workspaces/nearby/datastores/nearby_postgis/featuretypes/facilities?recalculate=nativebbox,latlonbbox', 'PUT', { featureType: { enabled: true } })
  console.log(`Published ${config.geoserverLayer}. WMS: ${geoserverUrl}/nearby/wms`)
} catch (error) { console.error(error.message); process.exitCode = 1 }

