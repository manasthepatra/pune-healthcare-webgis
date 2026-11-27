"""B1: latency of the live API - 50 random clicks inside the study area, scripted (not by hand).

    sh tools/pyrun.sh analysis/07_latency_benchmark.py          # inside the Compose network (API_URL=http://api:8000)
    API_URL=http://127.0.0.1:8010 python analysis/07_latency_benchmark.py   # from the host

For every endpoint and for both API modes we report p50/p95 of
  round trip  = wall clock seen by the client
  database    = time inside PostgreSQL/pgRouting (measured in the API around the SQL)
  API+network = round trip - database
mode=naive : pgRouting gets the whole edge table, concave hull over every reached node (the first version)
mode=bbox  : pgRouting gets only the edges near the click, points thinned before the hull (optimised version)
"""
import json
import os
import random
import statistics
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
import config as C  # noqa: E402

API = os.getenv("API_URL", "http://127.0.0.1:8010").rstrip("/")
N = 50


def pct(values, q):
    v = sorted(values)
    k = (len(v) - 1) * q
    f, c = int(k), min(int(k) + 1, len(v) - 1)
    return v[f] + (v[c] - v[f]) * (k - f)


def run(endpoint, params, points):
    rt, db, srv = [], [], []
    with requests.Session() as s:
        for lon, lat in points[:5]:                      # warm-up (connection pool, caches) - not counted
            s.get(f"{API}/{endpoint}", params={"lon": lon, "lat": lat, **params}, timeout=30)
        for lon, lat in points:
            t0 = time.perf_counter()
            r = s.get(f"{API}/{endpoint}", params={"lon": lon, "lat": lat, **params}, timeout=30)
            rt.append((time.perf_counter() - t0) * 1000)
            if r.status_code != 200:
                continue
            j = r.json()
            t = j["properties"] if endpoint == "isochrone" else j["timing"]
            db.append(t["db_ms"])
            srv.append(t["total_ms"])
    return {
        "n": len(rt),
        "roundtrip_p50_ms": round(pct(rt, 0.5), 1), "roundtrip_p95_ms": round(pct(rt, 0.95), 1),
        "db_p50_ms": round(pct(db, 0.5), 1), "db_p95_ms": round(pct(db, 0.95), 1),
        "api_plus_network_p50_ms": round(statistics.median([a - b for a, b in zip(rt, db)]), 1),
        "api_plus_network_p95_ms": round(pct([a - b for a, b in zip(rt, db)], 0.95), 1),
    }


def main():
    rng = random.Random(C.RANDOM_SEED)
    w, s, e, n = C.AREA_BBOX
    points = [(rng.uniform(w, e), rng.uniform(s, n)) for _ in range(N + 5)]
    out = {"api": API, "clicks": N, "seed": C.RANDOM_SEED, "results": {}}
    for mode in ("naive", "bbox"):
        out["results"][f"isochrone_{mode}"] = run("isochrone", {"minutes": 15, "hull": "concave", "mode": mode}, points)
        out["results"][f"nearest_{mode}"] = run("nearest", {"k": 5, "radius_m": 3600, "mode": mode}, points)
    (C.OUT / "b1_latency.json").write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2))
    print("\n| endpoint / mode | round trip p50 | round trip p95 | database p50 | database p95 | API+network p95 |")
    print("|---|---|---|---|---|---|")
    for k, v in out["results"].items():
        print(f"| {k} | {v['roundtrip_p50_ms']} ms | {v['roundtrip_p95_ms']} ms | {v['db_p50_ms']} ms | {v['db_p95_ms']} ms | {v['api_plus_network_p95_ms']} ms |")


if __name__ == "__main__":
    main()
