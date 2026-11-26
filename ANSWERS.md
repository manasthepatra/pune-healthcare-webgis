# ANSWERS

> Every answer needs: the **exact URL or SQL**, the **raw output (key lines)**, a **screenshot where asked** (relative link into
> `docs/screenshots/`), and **2-4 sentences of explanation in your own words**. Commands are pre-filled below; the
> `RESULT:` and `EXPLAIN:` slots must be filled with what *you* ran. Nothing in this file has been run for you.

## Study set-up
| | |
|---|---|
| Area | Central Pune (default bbox 73.835,18.495 - 73.875,18.535; replace with your registered wards) - **TODO: match the class sheet** |
| Area type | city -> **15 min / 1.2 km** threshold (TODO: confirm) |
| Service type | Healthcare. Tags counted: `amenity=hospital`, `amenity=clinic`, `amenity=doctors`, `healthcare=*`; polygons converted to points, duplicates removed |
| OSM feature count (registered) | TODO (`python analysis/01_acquire_and_load.py` prints it) |
| UTM zone / EPSG | 43N / **EPSG:32643** (lon of centre ~73.855; zone = floor((lon+180)/6)+1 = 43) |
| Earlier project | `legacy/` (Leaflet + Overpass, local snapshot `legacy/response.json`); repo link: TODO |
| Walking speed | 4.8 km/h (and 3.6 km/h for Q8) |
| Population | WorldPop 100 m **or** building-footprint proxy - state which: TODO |

---

## Phase 1

### Q1. One area, four areas
SQL: [`sql/02_q1_area.sql`](sql/02_q1_area.sql)
```
RESULT: (paste the output row: area_4326_deg2, area_geography_m2, area_utm32643_m2, area_3857_m2, ratio, 1/cos2(lat))
```
EXPLAIN: why `3857 / UTM` equals `1 / cos^2(lat)` (areas scale by the square of the linear factor `1/cos(lat)`), which CRS is the correct one, units of each number.
Which CRS did the earlier project measure distance in? *Fact from its code:* `legacy/src/facilities.ts` (`haversineKm`) used great-circle distance on a sphere of radius 6371 km
computed from lat/lon degrees - i.e. no projected CRS; the later `legacy/server/search.mjs` cast to `geography` (spheroid, metres).

### Q2. Indexes and query plans
SQL: [`sql/03_q2_indexes.sql`](sql/03_q2_indexes.sql) (three `EXPLAIN (ANALYZE, BUFFERS)` runs)
| Variant | Scan node on `buildings` | Execution time |
|---|---|---|
| (a) `ST_DWithin`, no GiST index | TODO | TODO ms |
| (b) `ST_DWithin`, GiST index | TODO | TODO ms |
| (c) `ST_Distance(a,b) < 500`, index present | TODO | TODO ms |

EXPLAIN: `ST_DWithin` is rewritten by the planner to a `&&` bounding-box test that the GiST index can answer, plus an exact test; `ST_Distance(...) < 500` is an opaque function comparison, so every pair is evaluated (see study/S2).

### Q3. Data quality vs the earlier source
SQL: [`sql/04_q3_quality.sql`](sql/04_q3_quality.sql); comparison: `python analysis/05_baseline_compare.py`
```
RESULT: total / unnamed / pct_unnamed:
RESULT: pairs within 25 m:
RESULT (baseline_compare): earlier snapshot N features vs new table M features; in both / only old / only new:
```
Five-service verification (second source: TODO site visit / official list / street imagery):
| osm_id | name | source used | correct / misplaced / closed |
|---|---|---|---|
| TODO | | | |

EXPLAIN: what the earlier project did differently (it replaced a missing name by "<category> nearby" and de-duplicated only by name + 4-decimal coordinates, so near-duplicates survived/merged differently).

---

## Phase 2

### Q4. The axis-order trap
GetCapabilities: `http://localhost:8081/geoserver/webgis/wms?service=WMS&version=1.3.0&request=GetCapabilities`
```
RESULT: paste <BoundingBox CRS="EPSG:4326" minx= miny= maxx= maxy= /> of layer webgis:services
```
Replace `A,B,C,D` with the four numbers of that BoundingBox (in the order it prints them):
```
http://localhost:8081/geoserver/webgis/wms?service=WMS&version=1.1.1&request=GetMap&layers=webgis:services,webgis:study_area&styles=&srs=EPSG:4326&bbox=A,B,C,D&width=768&height=768&format=image/png
http://localhost:8081/geoserver/webgis/wms?service=WMS&version=1.3.0&request=GetMap&layers=webgis:services,webgis:study_area&styles=&crs=EPSG:4326&bbox=A,B,C,D&width=768&height=768&format=image/png
```
Screenshots: `docs/screenshots/q4-wms111.png`, `docs/screenshots/q4-wms130.png`
EXPLAIN: 1.1.1 reads BBOX as lon,lat; 1.3.0 reads EPSG:4326 as lat,lon - so the second request asks for a rectangle in the wrong place (usually an empty or mirrored image).

### Q5. WFS with a filter, two formats
```
# numberMatched (hits only)
http://localhost:8081/geoserver/webgis/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webgis:services&resultType=hits&cql_filter=name_status='named' AND in_area=true
# GML 3.2
http://localhost:8081/geoserver/webgis/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webgis:services&outputFormat=gml32&cql_filter=name_status='named' AND in_area=true
# GeoJSON
http://localhost:8081/geoserver/webgis/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=webgis:services&outputFormat=application/json&cql_filter=name_status='named' AND in_area=true
```
(The brief says "WFS 2.0 with filters": `cql_filter` is GeoServer's shortcut. For a pure standard request use `FILTER=` with URL-encoded `<Filter xmlns="http://www.opengis.net/fes/2.0"><PropertyIsEqualTo><ValueReference>name_status</ValueReference><Literal>named</Literal></PropertyIsEqualTo></Filter>` and show which you used.)
```
RESULT: numberMatched=   GML3.2 size= KB, first point (order)=   GeoJSON size= KB, first point (order)=
```
EXPLAIN: GML 3.2/EPSG:4326 -> lat,lon; GeoJSON -> lon,lat; why GML is larger.

---

## Phase 3

Run: `python analysis/03_access_analysis.py` -> numbers in `analysis/out/results.json`, worst-case map `analysis/out/q6_worst_case.png`.

### Q6. Straight line vs street network
```
RESULT: of 30 random points, N have a different nearest service; median ratio = ; max ratio = (analysis/out/q6_summary.json, q6_points.csv)
```
Screenshot of the worst case: `analysis/out/q6_worst_case.png` (copy to `docs/screenshots/`). **Name the barrier** (river / railway / expressway / gated campus / hill): TODO (look at the map).
EXPLAIN + compare with the earlier project: it ranked by haversine only (`legacy/src/facilities.ts`), so it would have recommended the straight-line nearest in N of 30 cases.

### Q7. Coverage and the MAUP
SQL: [`sql/05_hex_post.sql`](sql/05_hex_post.sql); numbers: `analysis/out/results.json` (`q7`), `analysis/out/q7_by_ward.csv`
| Unit | Population beyond threshold (%) |
|---|---|
| Network, finest (building points) | TODO |
| Network, H3 res 9 | TODO |
| Network, H3 res 8 | TODO |
| Network, by ward/pin/village | TODO (needs `analysis/area_wards.geojson`) |
| Straight-line buffer, H3 res 9 | TODO |
Worst-served populated cell (res 9): `H3 index = TODO`
EXPLAIN: does the conclusion change with the unit? (MAUP - study/S3).

### Q8. Who is the model for?
`results.json -> q8`; map file `analysis/out/q8_newly_uncovered_r9.geojson`
```
RESULT: coverage lost at 3.6 km/h = X percentage points (res 9), where: (name the areas / top cells)
```

---

## Phase 4

### Q9. Three ways to ship the same map
Client toggle "Buildings": (a) tiled WMS PNG, (b) one WFS GeoJSON request, (c) MVT from pg_tileserv. DevTools -> Network -> *Disable cache*, clear, set the zoom, toggle the mode, wait for idle; read the footer ("N requests, X kB transferred, Finish: Y s").
| Mode | z12 requests / KB / s | z14 requests / KB / s | z16 requests / KB / s |
|---|---|---|---|
| (a) WMS PNG | | | |
| (b) WFS GeoJSON | | | |
| (c) MVT | | | |
Reproducible URLs (server-mode client at `http://localhost:5173` via `npm run dev`, or the built preview): `/?z=12&bld=wms`, `/?z=14&bld=wfs`, `/?z=16&bld=mvt` (`z` = zoom, `bld` = `wms|wfs|mvt`). Reload the page for every run so each measurement starts clean.
Screenshot: `docs/screenshots/q9-network-*.png`
EXPLAIN: which breaks first as the area grows (WFS: size grows with the whole dataset, independent of zoom).
Earlier project: it sent an Overpass `around:` query on every search (`legacy/src/facilities.ts`) and kept everything in React state; at city scale each search would pull tens of thousands of elements over one HTTP request with the public API's rate limits and timeouts.

---

## Phase 5

### Q10. Image size
```
docker build -t webgis-client:full -f client/Dockerfile.single client
docker build -t webgis-client:slim client
docker images | findstr webgis-client
docker history webgis-client:slim
```
```
RESULT: full = MB, slim = MB; docker history output:
```
EXPLAIN: largest layer of the slim image and why.

### Q11. Self-healing and state
```
kind create cluster --name webgis
kubectl apply -f k8s/
kubectl -n webgis get pods -w            # keep running in a second terminal
kubectl -n webgis delete pod postgis-0   # note the timestamps
```
Load data first (see README "Kubernetes"), then check a table count before and after the delete.
```
RESULT: pod deleted at HH:MM:SS, Running again at HH:MM:SS (Ns). Row count before / after (PVC):
RESULT (emptyDir variant k8s/experiments/postgis-emptydir.yaml): row count before / after:
```
EXPLAIN: why a database is a StatefulSet (stable identity, per-replica PVC, ordered rollout) and not a Deployment.

### Q12. Static vs server deployment
Public URL: TODO. DevTools at zoom 14: filter `map.pmtiles`.
```
RESULT: Range: bytes=...  -> status 206   total KB for the view =
```
Compare with Q9 (c). Two things the server stack can do that the static site cannot (e.g. WMS/WCS of the DEM, live SQL/WFS filters, always-fresh data from the database, large-area on-demand tiling) and one advantage of static (free, no server to run/patch, CDN-cached, scales to any number of viewers).

---

## Bonus (not attempted)
B1-B3 / live isochrone API were not attempted in this version; see README "Next steps".
