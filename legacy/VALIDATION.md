# Instructor requirement review — 20 October 2026

Reviewed project: **Nearby Services WebGIS**. The older sibling **Nearby location** queries Overpass directly and lacks the PostGIS/GeoServer implementation.

All requested features are present in the current project's code. Full runtime compliance remains unconfirmed until real PostGIS queries and GeoServer publication/rendering pass. This report was rechecked against the current code and local services on 20 October 2026.

| Instructor requirement | Implementation | Verification |
| --- | --- | --- |
| Map click, latitude/longitude and browser geolocation | `src/App.tsx`, `src/MapView.tsx` share one validated search origin. | Code reviewed; browser interaction checks use a simulated API. |
| Categories and optional subcategories | Shared catalogue; UI and server validate filters. Includes hospitals, pharmacies, police, ATMs, schools, fuel and parks. | Automated parsing/import tests and code review. |
| Radius and/or nearest N | Radius, nearest and combined modes; N applies across selected categories. | Automated input/query-construction tests. Live SQL pending. |
| Distance-sorted list synchronized with map | PostGIS orders by distance and ID; one paginated collection supplies list and markers; selection highlights both. | Code reviewed; simulated browser checks. Live distance ordering pending. |
| Service popup/side panel | Popup and service panel with address, phone, website, hours, access and source when available. | Code reviewed; simulated browser checks. |
| PostGIS query with appropriate CRS/distances | EPSG:4326 storage; geography ST_DWithin/ST_Distance in metres; kilometre display; spatial indexes. | SQL and binding tests pass. Actual PostGIS execution pending. |
| GeoServer layers and Leaflet | Publication script creates PostGIS datastore, layer and style; Leaflet offers a WMS overlay. | Simulated REST test passes. Real publication/rendering pending. |
| Denied geolocation, invalid input and no results | Explicit location errors, validation, empty-state message, service errors and retries. | Automated validation/HTTP tests; simulated browser cases; actual database-unavailable browser check. |

## Checks performed

- `npm run build`: passed after the changes below.
- `npm test`: all 21 tests passed, including production asset serving.
- `docker compose config --quiet`: passed; Docker warned that its user config file could not be read.
- New setup and live-verification scripts pass Node syntax checks.
- Actual database-unavailable browser check: Leaflet initializes and the app shows a clear PostGIS error with Retry connection.
- Playwright browser checks passed for map click, coordinate input, denied geolocation, nearest-N request parameters, list-to-marker highlighting, keyboard marker-to-details selection, empty results and invalid category selection. These use simulated API responses, not real facility searches. No simulated data was added to the application.

## Live verification still required

Docker Desktop processes are running. However, both the default Docker pipe and the Docker Desktop Linux engine pipe return **permission denied** to this session. Docker also reports access denied reading `C:\Users\manas\.docker\config.json`. This does not establish whether Docker works in the user's own terminal.

The installed native GeoServer **does respond with HTTP 200 at http://127.0.0.1:8080/geoserver/web/**. This confirms its web interface is reachable; it does not confirm a PostGIS datastore or the project's layer has been published. PostGIS is not listening on port 5432: `npm run verify:live` fails with `ECONNREFUSED 127.0.0.1:5432`. `npm run setup` stops at Docker's permission error before starting or importing anything.

Run `npm run setup` from this project in the user's PowerShell once `docker info` succeeds. The command initializes/imports/publishes and executes `verify:live`, which checks actual database/API search behavior, CRS/zero distance, category/subcategory filtering, pagination, WMS capabilities, a PNG GetMap response and a real published feature through WFS. Until that command succeeds, PostGIS and GeoServer requirements are **implemented but not verified end to end**. Browser checks with real data should then repeat the interactions listed above, including an allowed geolocation request from inside the configured coverage.

## Changes in this review

- Fixed a real port conflict: the Compose GeoServer now publishes on **8081** by default, leaving the installed native GeoServer on **8080**. Updated local configuration defaults and the example accordingly; container-to-container traffic remains on 8080.
- Added `npm run setup` to create a missing `.env` without overwriting existing settings, start services, initialize the schema, import real OSM services, wait for GeoServer, publish and verify. Rerunning refreshes OSM records while preserving other sources.
- Added `npm run verify:live` as a separate, explicitly live check that fails if prerequisites or assertions fail. It can run inside the app container or against a configured local installation.
- Created the project's `.env` from the example; it is ignored by Git and excluded from Docker's build context.
- Updated README with the setup command, recovery commands, WSL/Docker troubleshooting and instructions to use an existing native GeoServer.
- The old `Nearby location` folder could not be updated because writing its README was denied. Its original source remains intact. Use **Nearby Services WebGIS** for the assignment.
