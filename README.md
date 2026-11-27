# Who can't walk to healthcare? - a Web GIS for central Pune

**Public URL:** https://manasthepatra.github.io/pune-healthcare-webgis/
(static site on GitHub Pages, deployed by the Actions workflow on every push; repo: https://github.com/manasthepatra/pune-healthcare-webgis)

This repository rebuilds the earlier *Nearby location* app (Leaflet + Overpass, kept in [`legacy/`](legacy/)) as a provider/analyst
Web GIS: OSM data in PostGIS, own WMS/WFS/WCS/MVT/OGC API endpoints, a real walking-network access analysis with H3 hexagons and
WorldPop population, deployment to GitHub Pages (PMTiles) and to a local kind cluster, and a live walking-isochrone API (bonus).
Planning question: **which residents cannot reach a healthcare service on foot within 15 minutes (1.2 km), and why?**

Answers and evidence: [ANSWERS.md](ANSWERS.md) | Raw evidence: [docs/evidence/](docs/evidence/) | Study notes: [study/](study/)

## Repository layout
```
docker-compose.yml   PostGIS + GeoServer + pg_tileserv + pg_featureserv (+ routing_db and api for the bonus) on one network
.env.example         variable names only (copy to .env, never commit .env)
sql/                 every SQL script (00 extensions ... 05 hex post-processing, Q1-Q3 queries)
sld/                 services (rule-based named/unnamed), polygon, DEM colour ramp
analysis/            Python for Phases 1 and 3, WorldPop/wards/DEM preparation, static export, bonus B1-B3 (Dockerfile = runner image)
geoserver/publish.py REST script: workspace, store, layers, DEM coverage, styles, bounding boxes
api/                 FastAPI + pgRouting walking-isochrone service (bonus)
client/              MapLibre GL JS app, Dockerfile (multi-stage), Dockerfile.single (Q10 baseline)
k8s/                 namespace, Secret, PostGIS StatefulSet + PVC, client Deployment + Services (+ experiments/ for Q11)
tools/               tippecanoe-in-Docker PMTiles build, DEM image, pyrun.sh, evidence + measurement scripts
.github/workflows/   GitHub Pages deployment
study/               Phase 0 notes
legacy/              the earlier projects (baseline for Q3, Q6, Q9)
```

## Setup (local stack)
Requirements: Docker Desktop (Linux containers), Node 22+, Git Bash (`sh`). Python is **optional on the host**: every script can run in the
analysis container via `sh tools/pyrun.sh <script>` (needed on machines whose Windows Application Control blocks compiled Python wheels).

```powershell
copy .env.example .env            # then set the two passwords AND the password inside DATABASE_URL / ports if 5432/8081 are taken
docker compose up -d
docker compose ps                 # six containers healthy (the setup checkpoint: docs/evidence/setup_compose_ps.txt)
# GeoServer admin page: http://127.0.0.1:8081/geoserver   (docs/screenshots/setup-geoserver-admin.png)
```
PostGIS is published on host port **5433** (not 5432) so it does not clash with a Postgres already on the machine. Inside Compose services
reach each other by **service name** (`db`, `geoserver`, `routing_db`), never `localhost`, which is why GeoServer's store host is `db`.
Use `127.0.0.1` rather than `localhost` from the host: on Windows `localhost` tries IPv6 first and adds ~200 ms to every request.

Data pipeline (each step was run in this order; `sh` = Git Bash):
```sh
docker build -t webgis-analysis -f analysis/Dockerfile analysis          # Python + OSMnx/GeoPandas/H3/rasterio image
sh tools/pyrun.sh analysis/01_acquire_and_load.py                        # OSM -> PostGIS, clean + merge duplicates (Overpass can be slow/busy)
docker compose exec -T db psql -U webgis -d webgis < sql/01_post_load.sql  # UTM copy, indexes, keys
sh tools/pyrun.sh analysis/02_prepare_dem.py                             # SRTM 30 m tile -> data/dem/dem_area.tif
sh tools/pyrun.sh analysis/02b_prepare_worldpop.py                       # WorldPop 100 m people (530 MB download, clipped to ~11 KB)
sh tools/pyrun.sh analysis/02c_prepare_wards.py                          # PMC admin wards for the by-ward aggregation (Q7)
sh tools/pyrun.sh geoserver/publish.py                                   # workspace, layers, DEM coverage, SLDs
sh tools/pyrun.sh analysis/03_access_analysis.py                         # isochrones, H3 hexes, Q6-Q8 (about 35 minutes)
docker compose exec -T db psql -U webgis -d webgis < sql/05_hex_post.sql
docker compose restart pg_tileserv pg_featureserv                        # so they discover the new tables
```
`analysis/03b_write_results.py` replays the database write from `data/cache/phase3.pkl`; `analysis/03c_q6_only.py` re-runs just Q6 (2 minutes).

Endpoints once everything is loaded:
| Service | URL |
|---|---|
| WMS / WFS / WCS | `http://127.0.0.1:8081/geoserver/webgis/wms`, `.../ows`, `.../wcs` |
| Vector tiles | `http://127.0.0.1:7800/public.hex_r9/{z}/{x}/{y}.pbf` (index: `http://127.0.0.1:7800/`) |
| OGC API - Features | `http://127.0.0.1:9000/collections/public.services/items.json` |
| Walking-isochrone API (bonus) | `http://127.0.0.1:8010/docs` |

Client (server mode): `cd client && npm install && npm run dev` -> http://127.0.0.1:5173. URL presets for repeatable runs:
`?z=14&bld=wms|wfs|mvt&dem=1&res=8&spd=900&walk=73.8552,18.5148&min=15&hull=concave`.

## Bonus: live walking-isochrone API
`routing_db` (PostGIS + pgRouting) is a separate service because the main PostGIS image's Debian base no longer receives pgRouting packages.
```sh
docker compose up -d routing_db api
sh tools/pyrun.sh analysis/06_load_routing_graph.py     # walking graph -> pgRouting topology, services snapped to nodes
sh tools/pyrun.sh analysis/07_latency_benchmark.py      # B1      sh tools/pyrun.sh analysis/08_two_engines.py   # B2
sh tools/pyrun.sh analysis/09_hull_comparison.py        # B3
```

## Static build (PMTiles) and GitHub Pages
```sh
sh tools/pyrun.sh analysis/04_export_static.py          # PostGIS -> data/export/*.geojson
sh tools/make_pmtiles.sh                                # tippecanoe (in Docker) -> client/public/data/map.pmtiles   (PowerShell: tools\make_pmtiles.ps1)
sh tools/make_dem_image.sh                              # the DEM as one PNG for the static site (no GeoServer there)
```
Commit those two files and push to `main`; the workflow builds the client with `VITE_MODE=static` and deploys to Pages (repo settings -> Pages ->
Source: GitHub Actions). The point layers use `-B8` and `--no-feature-limit` so tippecanoe does not thin them at lower zooms.

## Kubernetes (kind)
```powershell
winget install Kubernetes.kind                              # then open a new shell
docker build -t webgis-client:slim client
kind create cluster --name webgis
kind load docker-image webgis-client:slim --name webgis
kubectl apply -f k8s/
kubectl -n webgis get pods
kubectl -n webgis port-forward svc/client 8090:80           # open http://127.0.0.1:8090  (8080 is often taken)
sh tools/q11_experiment.sh | tee docs/evidence/q11_timeline.txt   # load data, delete the pod, PVC vs emptyDir (Q11)
```

## Evidence and measurement tools
`sh tools/collect_evidence.sh` re-runs Q1-Q5 and saves raw outputs; `node tools/measure_network.mjs q9 http://127.0.0.1:4174` and
`node tools/measure_network.mjs q12 <public-url>` take the Q9/Q12 Network-tab numbers through the Chrome DevTools Protocol (cache disabled, median
of 3, including requests made inside MapLibre's web workers).

## Sources and tools used
OSMnx, GeoPandas, Shapely, NetworkX, h3-py, rasterio, SciPy, Matplotlib, PostGIS, pgRouting, GeoServer, pg_tileserv, pg_featureserv, FastAPI, MapLibre GL JS,
pmtiles, tippecanoe, Vite, nginx, kind, GitHub Actions/Pages.
Data: OpenStreetMap contributors (ODbL); SRTM 30 m via the AWS Terrain Tiles bucket; WorldPop 2020 constrained 100 m (CC BY 4.0, worldpop.org);
PMC admin wards 2017 from DataMeet's Municipal_Spatial_Data (github.com/datameet/Municipal_Spatial_Data), traced from PMC ward maps.
Documentation: OGC WMS 1.3.0 / WFS 2.0 specs, PostGIS, pgRouting and GeoServer manuals, h3geo.org, OSMnx docs.
AI assistance (Claude Code) was used to scaffold and write code, scripts and notes; every part must be understood and explainable at the viva.

## Debugging log
Things that broke, what showed the cause, and the fix:

1. **GeoServer rejected the DEM.** `PUT .../coveragestores/dem/external.geotiff` returned `HTTP 400 ... Failed to locate the input file file:///opt/dem/dem_area.tif`
   although `docker compose exec geoserver ls /opt/dem` showed the file. Fix: mount the DEM inside GeoServer's data directory and create the coverage store and the
   coverage with two plain REST calls (`geoserver/publish.py`).
2. **Capabilities bounding box mixed degrees and metres.** `<BoundingBox CRS="EPSG:4326" minx="18.478" ... maxx="2051716.2" maxy="382837.2"/>`: the tables
   also hold a UTM copy (`geom_utm`) and GeoServer merged the extent of both geometry columns. Fix: hide `geom_utm` from the published attributes and write the
   bounding box from `ST_Extent(geom)` (`tidy_featuretype` in `publish.py`).
3. **Windows Application Control blocked pandas.** `ImportError: DLL load failed while importing fields: An Application Control policy has blocked this file.` Fix: run
   the analysis in a Linux container (`analysis/Dockerfile`, `tools/pyrun.sh`).
4. **PMTiles lost most of the services.** The map showed 27 of 475 points. tippecanoe thins points below the base zoom by default (the max zoom). Verified by decoding the tile
   (`tippecanoe-decode`); fixed with `-B8` and `--no-feature-limit`.
5. **`localhost` added ~200 ms to every call.** curl `localhost:8010` took 215 ms, `127.0.0.1:8010` 12 ms (IPv6 attempt first on Windows). The client now defaults to `127.0.0.1`.
6. **pgRouting would not install.** `E: The repository 'http://apt.postgresql.org/pub/repos/apt bullseye-pgdg Release' does not have a Release file.` The `postgis:16-3.5` image is Debian
   bullseye (end of life). Fix: a separate `routing_db` service from `pgrouting/pgrouting:16-3.5-4.0.1`.
7. **The first Q11 timing was wrong.** `kubectl delete pod --wait=false` returns before the old pod terminates, so the loop saw the old pod still `Running/true` and printed "Ready after 0.3 s".
   Fix: only accept a pod with a different uid (`tools/q11_experiment.sh`).
8. **My network measurement showed 0 requests for WFS/MVT.** MapLibre fetches GeoJSON and vector tiles inside web workers, which a page-level DevTools session cannot see. Fix: attach to
   worker targets (`Target.setAutoAttach`) in `tools/measure_network.mjs`.

## Status
Done and checked on 27 Nov 2026: stack (6 containers healthy); OSM load and duplicate merging; real WorldPop population and ward aggregation; Phase 3 analysis (Q6-Q8) and its maps;
GeoServer layers (WMS/WFS/WCS, DEM, rule-based SLD); vector tiles and OGC API; PMTiles + GitHub Pages (green workflow run, live site, DEM image);
Q1-Q12 evidence collected in [ANSWERS.md](ANSWERS.md); kind cluster with `kubectl apply -f k8s/`, client through port-forward, PVC vs emptyDir; bonus API with client integration and B1-B3.

Still yours to do (marked **TODO (you)** in ANSWERS.md): register the area in the class sheet; rewrite the study notes in your own words and add two lab screenshots (`study/`);
the second-source check of five services (Q3) and the `05_baseline_compare.py` output; confirm the Q6 barrier from the map; record the 2-minute bonus demo; share the repo with the instructor.
