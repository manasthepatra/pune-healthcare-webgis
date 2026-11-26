# Who can't walk to healthcare? - a Web GIS for central Pune

**Public URL:** _TODO - add your GitHub Pages URL here after the first green workflow run_
(`https://<user>.github.io/<repo>/`)

This repository rebuilds the earlier *Nearby location* app (Leaflet + Overpass, kept in [`legacy/`](legacy/)) as a provider/analyst
Web GIS: OSM data in PostGIS, own WMS/WFS/MVT/OGC API endpoints, real walking-network access analysis with H3 hexagons, and
deployment to GitHub Pages (PMTiles) and a local kind cluster. Planning question: **which residents cannot reach a healthcare
service on foot within 15 minutes (1.2 km), and why?**

Answers and evidence: [ANSWERS.md](ANSWERS.md) | Study notes: [study/](study/)

## Repository layout
```
docker-compose.yml   PostGIS + GeoServer + pg_tileserv + pg_featureserv on one network
.env.example         variable names only (copy to .env)
sql/                 every SQL script (00 extensions ... 05 hex post-processing, Q1-Q3 queries)
sld/                 services (rule-based), polygon, DEM colour ramp
analysis/            Python scripts for Phases 1 and 3 (+ export, baseline comparison)
geoserver/publish.py REST script: workspace, store, layers, DEM coverage, styles
client/              MapLibre GL JS app, Dockerfile (multi-stage), Dockerfile.single (Q10 baseline)
k8s/                 namespace, Secret, PostGIS StatefulSet + PVC, client Deployment + Services
tools/               tippecanoe-in-Docker helper that builds the PMTiles file
.github/workflows/   GitHub Pages deployment
study/               Phase 0 notes
legacy/              the earlier projects (baseline for Q3, Q6, Q9)
```

## Setup (local stack)
Requirements: Docker Desktop (Linux containers), Python 3.11+, Node 22+.

```powershell
copy .env.example .env            # then edit the two passwords AND the password inside DATABASE_URL
docker compose up -d
docker compose ps                 # screenshot: all four containers healthy  (setup checkpoint)
# GeoServer admin page: http://localhost:8081/geoserver  -> screenshot for the checkpoint
```
PostGIS is published on host port **5433** (not 5432) so it does not clash with a Postgres already installed on the machine; `DATABASE_URL` in `.env` must use the same port.
Inside Compose services reach each other by **service name** (`db`, not `localhost`): that is why GeoServer's store host is `db`.

Python environment and data (Phases 1-3):
```powershell
python -m venv .venv ; .venv\Scripts\activate
pip install -r analysis/requirements.txt
python analysis/01_acquire_and_load.py                 # OSM -> PostGIS (needs internet; Overpass can be slow)
docker compose exec -T db psql -U webgis -d webgis < sql/01_post_load.sql     # (PowerShell: Get-Content sql\01_post_load.sql | docker compose exec -T db psql -U webgis -d webgis)
python analysis/02_prepare_dem.py                      # SRTM 30 m tile -> data/dem/dem_area.tif
python geoserver/publish.py                            # workspace, layers, DEM, SLDs
python analysis/03_access_analysis.py                  # isochrones, H3 hexes, Q6-Q8 numbers
Get-Content sql\05_hex_post.sql | docker compose exec -T db psql -U webgis -d webgis
```
Optional better population: download a WorldPop 100 m raster clipped to the area as `data/worldpop/population.tif`; otherwise building footprint area is used as a proxy (and the client says so).
Restart `pg_tileserv` / `pg_featureserv` after creating tables (`docker compose restart pg_tileserv pg_featureserv`) so they discover them.

Endpoints once everything is loaded:
| Service | URL |
|---|---|
| WMS / WFS | `http://localhost:8081/geoserver/webgis/wms`, `.../ows` |
| Vector tiles | `http://localhost:7800/public.hex_r9/{z}/{x}/{y}.pbf` (index: `http://localhost:7800/`) |
| OGC API - Features | `http://localhost:9000/collections/public.services/items.json` |

Client (server mode): `cd client; npm install; npm run dev` -> http://localhost:5173

## Static build (PMTiles) and GitHub Pages
```powershell
python analysis/04_export_static.py        # PostGIS -> data/export/*.geojson
tools\make_pmtiles.ps1                      # tippecanoe (in Docker) -> client/public/data/map.pmtiles
```
Commit `client/public/data/map.pmtiles` (keep it < 100 MB; reduce buildings with a higher `-Z`/minzoom if needed), push to `main`;
the workflow builds the client with `VITE_MODE=static` and deploys to Pages. In the repo settings choose **Pages -> Source: GitHub Actions**.
Run `npm install` once in `client/` and commit the generated `package-lock.json`.

## Kubernetes (kind)
```powershell
docker build -t webgis-client:slim client
kind create cluster --name webgis
kind load docker-image webgis-client:slim --name webgis
kubectl apply -f k8s/
kubectl -n webgis get pods
kubectl -n webgis port-forward svc/client 8080:80          # open http://localhost:8080
# load the database into the cluster (optional, needed for Q11):
docker compose exec -T db pg_dump -U webgis webgis | kubectl -n webgis exec -i postgis-0 -- psql -U webgis -d webgis
```

## Sources and tools used
OSMnx, GeoPandas, Shapely, NetworkX, h3-py, rasterio, PostGIS, GeoServer, pg_tileserv, pg_featureserv, MapLibre GL JS, pmtiles,
tippecanoe, Vite, nginx, kind. Data: OpenStreetMap contributors (ODbL), SRTM 30 m via the AWS Terrain Tiles bucket, optional WorldPop.
Documentation: OGC WMS 1.3.0 / WFS 2.0 specs, PostGIS and GeoServer manuals, h3geo.org, OSMnx docs. AI assistance (Claude Code) was used to
scaffold the code and notes; every part must be understood and explainable at the viva.

## Debugging log
_TODO - one real problem you hit: what broke, the log/console lines that showed the cause, and the fix. (Example shape: "GeoServer layer
empty -> `docker compose logs geoserver` showed `connection refused localhost:5432` -> store host must be the Compose service name `db`.")_

## Status / what has been run
Verified by re-running everything on 26 Nov 2026: Compose stack healthy (data survives a restart: 243 healthcare features in the area / 475 with
margin, 12,835 buildings, 190 + 27 hexes); `03_access_analysis.py` runs top to bottom (exit 0) and reproduces the same numbers;
GeoServer WMS/WFS/WCS answer and the DEM, services and buildings render; pg_tileserv and pg_featureserv answer; the Q2/Q3 SQL and the Q4/Q5
requests execute; PMTiles built; the client renders in static and server mode, including the DEM and all three buildings modes
(`docs/screenshots/client-*.png`); slim (79.6 MB) and full (1.8 GB) client images build.
Client URL presets for repeatable runs: `?z=14&bld=wfs|wms|mvt&dem=1&res=8&spd=900`.

Not done yet: recording the Q1-Q12 evidence in `ANSWERS.md`, the Q9 DevTools timings, everything on kind (kind is not installed here), the git history,
the GitHub push / Pages run, the study-note rewrites and lab screenshots, and the viva items. The bonus (live isochrone API, B1-B3) is not implemented.

Notes for reproducing on Windows with Application Control: if compiled Python wheels are blocked on the host, run the analysis in Docker:
`docker build -t webgis-analysis -f analysis/Dockerfile analysis` then `sh tools/pyrun.sh analysis/01_acquire_and_load.py` (same for the other scripts;
`03b_write_results.py` replays the DB write from `data/cache/phase3.pkl`). Replace the bounding-box study area with your registered wards
(`analysis/area_wards.geojson`) and keep `AREA_BBOX`, `client/src/config.js` and `sql/01_post_load.sql` (EPSG) consistent.
