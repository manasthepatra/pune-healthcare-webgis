// Runtime configuration. Two build modes:
//   VITE_MODE=server  (default)  GeoServer WMS/WFS + pg_tileserv MVT + pg_featureserv OGC API  (docker compose)
//   VITE_MODE=static             one PMTiles file read with HTTP range requests (GitHub Pages / kind)
const env = import.meta.env

export const cfg = {
  mode: env.VITE_MODE === 'static' ? 'static' : 'server',
  // Central Pune study area - keep in sync with analysis/config.py (AREA_BBOX)
  bbox: [73.835, 18.495, 73.875, 18.535],
  center: [73.855, 18.515],
  geoserver: env.VITE_GEOSERVER || 'http://localhost:8081/geoserver',
  tileserv: env.VITE_TILESERV || 'http://localhost:7800',
  featureserv: env.VITE_FEATURESERV || 'http://localhost:9000',
  workspace: 'webgis',
  pmtiles: new URL(`${env.BASE_URL}data/map.pmtiles`, window.location.href).href,
}
