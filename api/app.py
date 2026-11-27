"""Live walking-isochrone API (bonus): pgRouting + FastAPI.

  GET /isochrone?lon=&lat=&minutes=&hull=concave|convex|buffer&ratio=0.8&mode=bbox|naive   -> GeoJSON Feature
  GET /nearest?lon=&lat=&k=5&radius_m=3600&mode=bbox|naive                                  -> JSON list of services
  GET /health

Walking speed is 4.8 km/h = 80 m/min. A click is snapped to the nearest network node (KNN on the GiST index); the snap
distance is added to every route. `mode=naive` hands pgRouting the whole edge table (the first version); `mode=bbox`
hands it only the edges near the click and thins the points before the concave hull (the optimisations measured in B1).
"""
import os
import time

import psycopg2
import psycopg2.pool
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware

UTM = int(os.getenv("UTM_EPSG", "32643"))
SPEED_M_PER_MIN = 4.8 * 1000 / 60  # 80 m/min
DSN = os.environ["DATABASE_DSN"]

pool = psycopg2.pool.ThreadedConnectionPool(1, 8, DSN)
app = FastAPI(title="Walking isochrone API", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])


def edges_sql(mode: str, dist_m: float, lon: float, lat: float) -> str:
    """The edge set pgRouting works on. pgRouting runs this text as its own query, so the click point is inlined
    (lon/lat are floats validated by FastAPI). bbox mode uses the GiST index on routing_edges.geom_utm."""
    if mode == "naive":
        return "SELECT id, source, target, cost, reverse_cost FROM routing_edges"
    pt = f"ST_Transform(ST_SetSRID(ST_MakePoint({float(lon):.7f}, {float(lat):.7f}), 4326), {UTM})"
    return ("SELECT id, source, target, cost, reverse_cost FROM routing_edges "
            f"WHERE geom_utm && ST_Expand({pt}, {dist_m + 100:.0f})")


def snap(cur, lon: float, lat: float):
    cur.execute(
        f"""WITH pt AS (SELECT ST_Transform(ST_SetSRID(ST_MakePoint(%s, %s), 4326), {UTM}) AS g)
            SELECT n.id, ST_Distance(n.geom_utm, pt.g) FROM routing_nodes n, pt ORDER BY n.geom_utm <-> pt.g LIMIT 1""",
        (lon, lat))
    row = cur.fetchone()
    if row is None:
        raise HTTPException(404, "no network nodes loaded")
    return row


def check(lon, lat):
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        raise HTTPException(400, "lon/lat out of range")


@app.get("/health")
def health():
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM routing_edges")
            return {"status": "ok", "edges": cur.fetchone()[0]}
    finally:
        pool.putconn(conn)


@app.get("/isochrone")
def isochrone(response: Response, lon: float, lat: float, minutes: float = Query(15, gt=0, le=60),
              hull: str = Query("concave", pattern="^(concave|convex|buffer)$"), ratio: float = Query(0.8, ge=0, le=1),
              mode: str = Query("bbox", pattern="^(bbox|naive)$")):
    check(lon, lat)
    t0 = time.perf_counter()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            d0 = time.perf_counter()
            node, off = snap(cur, lon, lat)
            dist = max(minutes * SPEED_M_PER_MIN - off, 0)
            # the point CTE is referenced by the bbox edge filter
            base = f"""WITH pt AS (SELECT ST_Transform(ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326), {UTM}) AS g),
                 reached AS (SELECT * FROM pgr_drivingDistance($e${edges_sql(mode, dist, lon, lat)}$e$, %(node)s::bigint, %(dist)s, false))"""
            params = {"lon": lon, "lat": lat, "node": node, "dist": dist}
            if hull == "buffer":
                shape = """SELECT ST_Union(ST_Buffer(e.geom_utm, 30)) AS g, count(DISTINCT e.id) AS n
                           FROM routing_edges e JOIN reached a ON a.node = e.source JOIN reached b ON b.node = e.target"""
            elif hull == "convex":
                shape = "SELECT ST_ConvexHull(ST_Collect(n.geom_utm)) AS g, count(*) AS n FROM reached r JOIN routing_nodes n ON n.id = r.node"
            else:
                # optimised mode thins the points on a grid of ~1/12 of the walking distance before the (expensive)
                # concave hull; naive mode hulls every reached node
                pts = "ST_Collect(DISTINCT ST_SnapToGrid(n.geom_utm, %(grid)s))" if mode == "bbox" else "ST_Collect(n.geom_utm)"
                shape = f"SELECT ST_ConcaveHull({pts}, %(ratio)s) AS g, count(*) AS n FROM reached r JOIN routing_nodes n ON n.id = r.node"
                params["ratio"] = ratio
                params["grid"] = max(dist / 12, 10)
            cur.execute(
                base + f""", shp AS ({shape})
                SELECT ST_AsGeoJSON(ST_Transform(g, 4326), 6), ST_Area(g) / 1e6, n FROM shp""", params)
            gj, area_km2, n = cur.fetchone()
            db_ms = (time.perf_counter() - d0) * 1000
    finally:
        conn.rollback()
        pool.putconn(conn)
    if gj is None:
        raise HTTPException(404, "no reachable network around this point")
    total = (time.perf_counter() - t0) * 1000
    response.headers["Server-Timing"] = f"db;dur={db_ms:.1f}, total;dur={total:.1f}"
    import json
    return {"type": "Feature", "geometry": json.loads(gj),
            "properties": {"minutes": minutes, "hull": hull, "mode": mode, "area_km2": round(area_km2, 4),
                           "elements": n, "snap_m": round(off, 1), "db_ms": round(db_ms, 1), "total_ms": round(total, 1)}}


@app.get("/nearest")
def nearest(response: Response, lon: float, lat: float, k: int = Query(5, ge=1, le=50),
            radius_m: float = Query(3600, gt=0, le=10000), mode: str = Query("bbox", pattern="^(bbox|naive)$")):
    check(lon, lat)
    t0 = time.perf_counter()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            d0 = time.perf_counter()
            node, off = snap(cur, lon, lat)
            # optimised mode widens the search 1.2 km -> 2.4 km -> radius_m and stops once k services are found;
            # naive mode searches the full radius over all edges every time
            radii = [radius_m] if mode == "naive" else sorted({min(1200, radius_m), min(2400, radius_m), radius_m})
            rows = []
            for rad in radii:
                dist = max(rad - off, 0)
                sql = f"""WITH reached AS (SELECT * FROM pgr_drivingDistance($e${edges_sql(mode, dist, lon, lat)}$e$, %(node)s::bigint, %(dist)s, false))
                     SELECT sn.osm_id, sn.name, s.service_type, round((%(off)s + r.agg_cost + sn.snap_m)::numeric, 1) AS metres,
                            ST_X(s.geom), ST_Y(s.geom)
                     FROM reached r JOIN routing_service_nodes sn ON sn.node = r.node JOIN services s ON s.osm_id = sn.osm_id
                     ORDER BY metres LIMIT %(k)s"""
                cur.execute(sql, {"node": node, "dist": dist, "off": off, "k": k})
                rows = cur.fetchall()
                if len(rows) >= k:
                    break
            db_ms = (time.perf_counter() - d0) * 1000
    finally:
        conn.rollback()
        pool.putconn(conn)
    total = (time.perf_counter() - t0) * 1000
    response.headers["Server-Timing"] = f"db;dur={db_ms:.1f}, total;dur={total:.1f}"
    return {"query": {"lon": lon, "lat": lat, "k": k, "radius_m": radius_m, "mode": mode, "snap_m": round(off, 1)},
            "timing": {"db_ms": round(db_ms, 1), "total_ms": round(total, 1)},
            "services": [{"osm_id": r[0], "name": r[1], "type": r[2], "walk_m": float(r[3]),
                          "walk_min": round(float(r[3]) / SPEED_M_PER_MIN, 1), "lon": r[4], "lat": r[5]} for r in rows]}
