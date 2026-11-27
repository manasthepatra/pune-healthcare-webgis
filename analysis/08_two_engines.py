"""B2: two engines, one question - pgRouting (API) vs the OSMnx/NetworkX result from Phase 3.

For 10 random points: walking distance to the nearest service from pgRouting (/nearest?k=1) and from the NetworkX
engine of 03_access_analysis.py. Differences above 10 % are diagnosed (different snap node? different nearest service?
different graph?) and the largest difference is drawn.

    sh tools/pyrun.sh analysis/08_two_engines.py
"""
import importlib
import json
import os
import sys
from pathlib import Path

import numpy as np
import requests
from sqlalchemy import create_engine

sys.path.insert(0, str(Path(__file__).parent))
m = importlib.import_module("03_access_analysis")
C = m.C
API = os.getenv("API_URL", "http://127.0.0.1:8010").rstrip("/")


def main():
    eng = create_engine(C.DATABASE_URL)
    area_utm, svc, bld, wards = m.load_db(eng)
    H = m.load_graph()
    net = m.Network(H, svc)

    rng = np.random.default_rng(7)
    minx, miny, maxx, maxy = area_utm.bounds
    pts = []
    while len(pts) < 10:
        x, y = rng.uniform(minx, maxx), rng.uniform(miny, maxy)
        if area_utm.contains(m.Point(x, y)):
            pts.append((x, y))
    xs, ys = np.array([p[0] for p in pts]), np.array([p[1] for p in pts])
    d_nx, who_nx, snap_nx = net.nearest(xs, ys)

    import geopandas as gpd
    ll = gpd.GeoSeries([m.Point(x, y) for x, y in pts], crs=C.UTM_EPSG).to_crs(4326)
    rows = []
    for i, (p, d, w_, so) in enumerate(zip(ll, d_nx, who_nx, snap_nx)):
        r = requests.get(f"{API}/nearest", params={"lon": p.x, "lat": p.y, "k": 1, "radius_m": 10000, "mode": "naive"}, timeout=60).json()
        sv = r["services"][0]
        diff = abs(sv["walk_m"] - d) / d * 100
        cause = ""
        if diff > 10:
            if sv["osm_id"] != w_:
                cause = "different nearest service chosen"
            elif abs(r["query"]["snap_m"] - so) > 1:
                cause = "different snap offset (edge/node snapping)"
            else:
                cause = "unexplained - inspect graph"
        rows.append({"point": i + 1, "lon": round(p.x, 6), "lat": round(p.y, 6), "osmnx_m": round(float(d), 1),
                     "pgrouting_m": sv["walk_m"], "diff_pct": round(diff, 2), "same_service": sv["osm_id"] == w_,
                     "snap_osmnx_m": round(float(so), 1), "snap_pgr_m": r["query"]["snap_m"], "cause_if_over_10pct": cause})
    over = [r for r in rows if r["diff_pct"] > 10]
    out = {"points": rows, "n_over_10pct": len(over),
           "graph_note": f"NetworkX graph: {H.number_of_nodes()} nodes / {H.number_of_edges()} edges (largest component, "
                         "self loops kept); pgRouting graph: loaded from the same GraphML, undirected, self loops dropped, "
                         "all components kept"}
    (C.OUT / "b2_two_engines.json").write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2))
    print("\n| # | OSMnx m | pgRouting m | diff % | same service | snap OSMnx / pgRouting m |\n|---|---|---|---|---|---|")
    for r in rows:
        print(f"| {r['point']} | {r['osmnx_m']} | {r['pgrouting_m']} | {r['diff_pct']} | {r['same_service']} | {r['snap_osmnx_m']} / {r['snap_pgr_m']} |")


if __name__ == "__main__":
    main()
