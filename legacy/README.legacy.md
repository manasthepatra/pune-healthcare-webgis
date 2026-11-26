# Nearby Services WebGIS

Find nearby services in Pune using React, Leaflet, a Node.js API, PostGIS and GeoServer. This is the current project. The sibling `Nearby location` folder is the older Overpass-only version and does not meet the PostGIS/GeoServer requirements.

See [VALIDATION.md](VALIDATION.md) for the instructor requirement checklist and verification limits.

## Run

Start Docker Desktop with Linux containers, then run from this directory:

```powershell
npm run setup
```

This creates `.env` only if missing, builds and starts the stack, initializes PostGIS, imports real OpenStreetMap facilities, waits for GeoServer, publishes the layer and runs live verification. It needs Node.js 22.12+ and the Docker Compose plugin. Rerunning it refreshes the OSM dataset; other data sources and existing configuration are preserved.

Open **http://localhost:3001** after setup succeeds. The project's GeoServer is at **http://localhost:8081/geoserver**, so an existing GeoServer on port 8080 can keep running. Enable **Published services (GeoServer)** in the map's layer control to view the published WMS layer. Set `GEOSERVER_PORT` and the local `GEOSERVER_URL` together to change its host port; containers communicate internally on 8080.

If Docker says WSL needs updating, run `wsl --update` in your own administrator PowerShell, finish any requested restart, and start Docker Desktop. Confirm `docker info` succeeds in your own terminal before rerunning setup. A Docker CLI installation or a running Desktop window alone does not prove the Linux engine is usable. This agent session may be denied access to Docker even when your own terminal can access it.

For manual setup or recovery:

```powershell
docker compose up -d --build
docker compose exec -T app npm run db:init
docker compose exec -T app npm run data:import
docker compose exec -T app npm run geoserver:publish
docker compose exec -T app npm run verify:live
```

Run publication after GeoServer is ready. The importer tries the primary Overpass server, then a fallback on connection errors, temporary HTTP errors or incomplete responses. `OVERPASS_URL` sets the primary interpreter; `OVERPASS_FALLBACK_URLS` is a comma-separated list of alternatives (set it empty to disable fallback). Compose passes both settings from `.env`; recreate the app after changes with `docker compose up -d --build app`.

`UND_ERR_CONNECT_TIMEOUT` means the HTTPS connection could not be established. The query's 120-second server timeout and 180-second request limit do not change Node's connection timeout. If every endpoint fails inside Docker but Windows has access, download the data on Windows and import the saved file:

```powershell
docker compose up -d --build app
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\download-osm.ps1 -Import
```

This uses Windows PowerShell for HTTPS and the running app container to build the configured query. It needs no local Node.js or npm. It tries each configured server once, saves a complete, nonempty response, then copies and imports it only after a successful download. HTTP 429 means the endpoint is rate-limiting requests; if all servers fail, wait before trying again. With local Node.js installed, you can also download and import manually:

```powershell
npm run data:download -- response.json
docker compose cp response.json app:/tmp/response.json
docker compose exec -T app npm run data:import -- --file /tmp/response.json
docker compose exec -T app npm run geoserver:publish
```

Both download commands use the configured coverage. The Node.js download command validates normalized facilities before saving; the PowerShell command checks response completeness, and the importer validates facilities before touching the database. If Windows also cannot connect, check the network, VPN or firewall, or save a complete Overpass JSON response from an accessible network and use the same copy/import commands. Failed downloads and invalid imports preserve existing database records.

The database schema initializes on the first creation of its volume. For an existing database, run `docker compose exec app npm run db:init`. Stop with `docker compose down`; named volumes retain the data and layer configuration.

## Use

1. Click inside the coverage rectangle, enter latitude/longitude and press **Set location**, or choose **Use my location**.
2. Select categories and optional subcategories. No selected subcategories means all.
3. Choose radius, nearest N, or nearest N within a radius, then press **Search nearby**.
4. Select a result or marker to highlight it and view details. **Load more services** adds the next page to both the list and map.

Radius accepts 0.1–20 km; N accepts 1–200 across all selected categories. Nearest-N searches the configured dataset without an implicit radius. Changing location or filters clears previous results. Missing service details display as unavailable.

The dashed rectangle is approximate Pune coverage (18.40–18.65 latitude, 73.73–74.04 longitude), not an official city boundary. Geolocation requires localhost or HTTPS; denial, timeout and outside-coverage locations show an error and preserve the last valid origin.

## Data and GIS design

```text
OpenStreetMap → import → PostGIS → search API → Leaflet results
                         └────→ GeoServer WMS → Leaflet overlay
```

The importer downloads facilities from Overpass into PostGIS. Searches use the database. Imports replace OpenStreetMap records atomically; invalid, incomplete or empty responses preserve existing data. Saved Overpass JSON can be imported with `npm run data:import -- --file path/to/response.json` using the local Node setup below. Rerun publication after imports to refresh the layer extent.

Points use EPSG:4326 and longitude-first `ST_MakePoint`. `ST_DWithin` and `ST_Distance` cast to geography for spheroidal distances in metres, converted to kilometres for display. Geometry/geography GiST indexes and category/subcategory indexes support searches. Results sort by exact distance, then ID; nearest-N uses exact distance ordering. Leaflet's EPSG:3857 display is not used for measurements.

The publication script creates or updates `nearby:facilities` from the same PostGIS table, applies category colours and refreshes bounds. The API proxies its public WMS endpoint. The optional overlay shows facilities matching category filters throughout the study area; interactive pins show the loaded search results.

Distances are straight-line distances to representative points, not routes or entrances. OSM coverage varies and separate OSM objects may describe one facility. Restart a search if data is reimported while browsing pages. There is no mock-data fallback.

## Local development and checks

Requires Node.js 22.12+ and npm. After the initial `.env` setup:

```powershell
npm ci
docker compose up -d db geoserver
npm run db:init
npm run data:import
npm run geoserver:publish
npm run api
```

In another terminal run `npm run dev` and open Vite's printed address. Vite proxies API/WMS requests to port 3001. For a production frontend, run `npm run build`; `npm run api` serves the resulting `dist` directory.

```powershell
npm run build
npm test
npm run verify:live
```

Tests check validation, query construction, import normalization, HTTP handling and publication requests against a simulated GeoServer. `verify:live` separately requires a running app, populated PostGIS and published GeoServer. It checks actual SQL/API agreement, zero distance at an imported point, all search modes, filtering, pagination, empty responses, invalid requests, WMS capabilities/PNG and a published WFS feature. It fails with a nonzero exit code when a dependency or assertion fails. Use `docker compose exec -T app npm run verify:live` for a container setup, or the local command with `DATABASE_URL`/`GEOSERVER_URL` configured. `APP_URL` optionally overrides the application address.

To use your native GeoServer instead, start only `db` with Compose and run the API locally. Set `GEOSERVER_URL=http://127.0.0.1:8080/geoserver`, `GEOSERVER_DB_HOST=127.0.0.1`, and your installed GeoServer credentials in `.env`. Then initialize, import and publish using the local commands above. The native GeoServer must have its PostGIS datastore support installed. The default `npm run setup` uses the isolated container stack and does not configure your native server.

## Configuration and API

`.env.example` lists database, GeoServer, Overpass and coverage settings. After changing coverage, restart, reimport and republish. `GEOSERVER_DB_HOST` must be reachable from GeoServer (`db` in Docker; usually `127.0.0.1` for native installations). Docker Compose constructs its own container database/GIS URLs; local scripts use `.env`.

- `GET /api/config`: coverage, limits and dataset information.
- `GET /api/health`: PostGIS connectivity.
- `GET /api/services?lat=18.5204&lng=73.8567&mode=radius&radiusKm=2&categories=hospital,pharmacy`
- Nearest: `mode=nearest&n=10`. Combined: `mode=combined&radiusKm=3&n=10`.
- Optional: `subcategories=clinic`, `offset=0`, `limit=50` (maximum 100 per page).
- `GET /geoserver/nearby/wms`: published layer proxy.

The search response contains facilities, total, offset, limit and importedAt. Invalid input returns HTTP 400; unavailable database/GIS services return HTTP 503.

Facility data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licensed under ODbL. Basemap tiles retain visible OSM attribution. Docker ports bind to localhost; deployment elsewhere requires suitable credentials, HTTPS and map hosting.
