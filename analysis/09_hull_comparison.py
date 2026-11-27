"""B3: hull choice - convex hull vs concave hull (two target ratios) vs buffered-edges polygon, same isochrone.

For one click and N minutes the API returns each polygon. We report their areas and how much of each lies OUTSIDE the
buffered-street polygon (land the hull claims is walkable although no reached street touches it) and draw all four.

    sh tools/pyrun.sh analysis/09_hull_comparison.py
"""
import json
import os
import sys
from pathlib import Path

import geopandas as gpd
import matplotlib
import requests
from shapely import make_valid
from shapely.geometry import shape
from sqlalchemy import create_engine, text

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

sys.path.insert(0, str(Path(__file__).parent))
import config as C  # noqa: E402

API = os.getenv("API_URL", "http://127.0.0.1:8010").rstrip("/")
LON, LAT, MINUTES = 73.8552, 18.5148, 15
VARIANTS = [("convex hull", {"hull": "convex"}), ("concave hull, ratio 0.8", {"hull": "concave", "ratio": 0.8}),
            ("concave hull, ratio 0.3", {"hull": "concave", "ratio": 0.3}), ("buffered edges (30 m)", {"hull": "buffer"})]


def main():
    polys = {}
    for name, extra in VARIANTS:
        j = requests.get(f"{API}/isochrone", params={"lon": LON, "lat": LAT, "minutes": MINUTES, "mode": "naive", **extra}, timeout=60).json()
        g = gpd.GeoSeries([shape(j["geometry"])], crs=4326).to_crs(C.UTM_EPSG).iloc[0]
        polys[name] = g if g.is_valid else make_valid(g)   # concave hulls can come back self-touching
    truth = polys["buffered edges (30 m)"]
    rows = []
    for name, g in polys.items():
        outside = g.difference(truth).area
        rows.append({"polygon": name, "area_km2": round(g.area / 1e6, 3), "vs_buffered_pct": round((g.area / truth.area - 1) * 100, 1),
                     "claimed_but_not_near_a_street_km2": round(outside / 1e6, 3),
                     "share_of_polygon_not_near_a_street_pct": round(outside / g.area * 100, 1)})
    (C.OUT / "b3_hulls.json").write_text(json.dumps(rows, indent=2))
    print(json.dumps(rows, indent=2))

    # draw, with the street edges that were reachable as backdrop
    with create_engine(C.ROUTING_DATABASE_URL).connect() as con:
        minx, miny, maxx, maxy = truth.union(polys["convex hull"]).bounds
        edges = gpd.read_postgis(text(
            f"SELECT geom_utm AS geom FROM routing_edges WHERE geom_utm && ST_MakeEnvelope({minx - 50}, {miny - 50}, {maxx + 50}, {maxy + 50}, {C.UTM_EPSG})"),
            con, geom_col="geom", crs=C.UTM_EPSG)
    fig, axes = plt.subplots(2, 2, figsize=(12, 12))
    colours = ["#d62728", "#ff7f0e", "#2ca02c", "#1f77b4"]
    for ax, (name, g), col in zip(axes.ravel(), polys.items(), colours):
        edges.plot(ax=ax, color="#bbbbbb", linewidth=0.5)
        gpd.GeoSeries([g], crs=C.UTM_EPSG).plot(ax=ax, facecolor=col, alpha=0.3, edgecolor=col, linewidth=2)
        r = next(x for x in rows if x["polygon"] == name)
        ax.set_title(f"{name}\n{r['area_km2']} km2 ({r['vs_buffered_pct']:+}% vs buffered edges)")
        ax.set_aspect("equal")
        ax.set_axis_off()
    fig.suptitle(f"{MINUTES}-minute walk from lon {LON}, lat {LAT}: same reached nodes, four outlines")
    fig.savefig(C.OUT / "b3_hulls.png", dpi=130, bbox_inches="tight")
    print("wrote analysis/out/b3_hulls.png")


if __name__ == "__main__":
    main()
