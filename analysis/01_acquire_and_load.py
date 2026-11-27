"""Phase 1: download OSM data for the area, clean it, load it into PostGIS (EPSG:4326).

Run from the repo root with the Compose stack up:   python analysis/01_acquire_and_load.py
Then run sql/01_post_load.sql (adds the UTM copy + indexes).

Cleaning (the brief: "convert polygon features to points, drop duplicates, keep the name and type tags"):
  1. polygon / line features -> one representative point each
  2. exact duplicates (same OSM id, or same name at identical coordinates) dropped
  3. near-duplicates merged: features within DEDUP_M metres whose names match (equal, one contains the other,
     or very similar spelling) are the same facility mapped twice (typically a node plus the building outline, or two
     mappers). One survivor is kept and missing tags are filled from the others. Distinct facilities that merely share a
     building (different names) are kept.
The pre-merge points are kept in table services_raw so Q3 can report the duplicate pairs before and after cleaning.
"""
import difflib
import json
import os
import re
import sys
import time
from pathlib import Path

import geopandas as gpd
import numpy as np
import osmnx as ox
import pandas as pd
from scipy.spatial import cKDTree
from shapely.geometry import box
from sqlalchemy import create_engine, text

sys.path.insert(0, str(Path(__file__).parent))
import config as C  # noqa: E402

ox.settings.use_cache = True
ox.settings.cache_folder = str(C.DATA / "cache")
ox.settings.requests_timeout = 300

DEDUP_M = 25
SIMILARITY = 0.8

# Public Overpass servers are often "at capacity" (HTTP 502/504/429). Try each endpoint with exponential backoff.
OVERPASS_URLS = [u for u in os.getenv(
    "OVERPASS_URLS", "https://overpass-api.de/api,https://overpass.private.coffee/api").split(",") if u]


def with_retry(fn, *args, attempts=6, **kw):
    delay = 20
    for i in range(attempts):
        url = OVERPASS_URLS[i % len(OVERPASS_URLS)]
        ox.settings.overpass_url = url
        try:
            return fn(*args, **kw)
        except Exception as exc:  # network / overpass errors are not typed consistently across osmnx versions
            print(f"  attempt {i + 1}/{attempts} on {url} failed: {str(exc).splitlines()[0][:120]}; retry in {delay}s")
            time.sleep(delay)
            delay = min(delay * 2, 240)
    raise SystemExit("All Overpass attempts failed - try again later or set OVERPASS_URLS.")


def area_polygon() -> gpd.GeoDataFrame:
    """The study area is the bounding box in config.py (wards, if supplied, are only used to aggregate Q7)."""
    return gpd.GeoDataFrame({"name": [C.AREA_NAME]}, geometry=[box(*C.AREA_BBOX)], crs=4326)


def osm_ids(df: pd.DataFrame) -> pd.Series:
    """osmnx 2.x gives a (element, id) MultiIndex; make a text id such as n123 / w456 / r789."""
    return df["element"].str[0] + df["id"].astype(str)


def service_type(row) -> str:
    for key in ("amenity", "healthcare"):
        v = row.get(key)
        if isinstance(v, str) and v:
            return v
    return "other"


# ----------------------------------------------------------------- near-duplicate merging
def _name_variants(name):
    if not isinstance(name, str) or not name.strip():
        return []
    out = []
    for part in name.split(";"):
        p = re.sub(r"[^a-z0-9]+", " ", part.lower()).strip()
        if p:
            out.append(p)
    return out


def same_facility(a, b, dist_m) -> bool:
    va, vb = _name_variants(a), _name_variants(b)
    if not va and not vb:
        return dist_m <= 10                    # two unnamed features on top of each other
    if not va or not vb:
        return dist_m <= 5                     # unnamed next to named, practically the same spot
    for x in va:
        for y in vb:
            if x == y:
                return True
            if (len(x) >= 5 and x in y) or (len(y) >= 5 and y in x):
                return True
            if difflib.SequenceMatcher(None, x, y).ratio() >= SIMILARITY:
                return True
    return False


def merge_near_duplicates(gdf: gpd.GeoDataFrame):
    """-> (cleaned GeoDataFrame, DataFrame describing every merged pair)."""
    utm = gdf.to_crs(C.UTM_EPSG)
    xy = np.column_stack([utm.geometry.x, utm.geometry.y])
    parent = list(range(len(gdf)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    pairs = []
    for i, j in cKDTree(xy).query_pairs(DEDUP_M):
        d = float(np.hypot(*(xy[i] - xy[j])))
        if same_facility(gdf.iloc[i]["name"], gdf.iloc[j]["name"], d):
            parent[find(i)] = find(j)
            pairs.append({"osm_id_a": gdf.iloc[i]["osm_id"], "name_a": gdf.iloc[i]["name"],
                          "osm_id_b": gdf.iloc[j]["osm_id"], "name_b": gdf.iloc[j]["name"], "metres": round(d, 1)})
    groups = {}
    for i in range(len(gdf)):
        groups.setdefault(find(i), []).append(i)

    attr_cols = ["name", "amenity", "healthcare", "addr_street", "opening_hours"]
    keep_rows = []
    for members in groups.values():
        sub = gdf.iloc[members]
        # survivor: has a name, then most tags filled, then a way/relation outline before a bare node, then id
        score = sub.apply(lambda r: (r["name"] is not None and not pd.isna(r["name"]),
                                     int(r[attr_cols].notna().sum()), r["osm_id"][0] != "n"), axis=1)
        best = sub.loc[score.sort_values(ascending=False).index[0:1]].iloc[0].copy()
        for c in attr_cols:                    # fill gaps from the merged duplicates
            if pd.isna(best[c]):
                vals = sub[c].dropna()
                if len(vals):
                    best[c] = vals.iloc[0]
        best["merged_n"] = len(members)
        keep_rows.append(best)
    cleaned = gpd.GeoDataFrame(pd.DataFrame(keep_rows).reset_index(drop=True), geometry="geometry", crs=4326)
    cleaned["name_status"] = cleaned["name"].map(lambda n: "unnamed" if n is None or pd.isna(n) else "named")
    return cleaned, pd.DataFrame(pairs)


# ----------------------------------------------------------------- downloads
def fetch_services(poly_margin) -> gpd.GeoDataFrame:
    raw = with_retry(ox.features_from_polygon, poly_margin, tags=C.SERVICE_TAGS).reset_index()
    raw["osm_id"] = osm_ids(raw)
    n_raw = len(raw)
    # a) polygon / line features (hospital building outlines) -> one point each
    raw["geometry"] = raw.geometry.representative_point()
    # b) exact duplicates: same OSM id, or same name at identical coordinates (6 dp)
    raw = raw.drop_duplicates("osm_id")
    names = raw["name"].fillna("").astype(str) if "name" in raw else pd.Series("", index=raw.index)
    key = names + "|" + raw.geometry.x.round(6).astype(str) + "|" + raw.geometry.y.round(6).astype(str)
    raw = raw.loc[~key.duplicated()]

    def col(c):
        return raw[c].values if c in raw else None

    keep = pd.DataFrame({
        "osm_id": raw["osm_id"].values,
        "name": col("name"),
        "service_type": raw.apply(service_type, axis=1).values,
        "amenity": col("amenity"),
        "healthcare": col("healthcare"),
        "addr_street": col("addr:street"),
        "opening_hours": col("opening_hours"),
    })
    out = gpd.GeoDataFrame(keep, geometry=raw.geometry.values, crs=4326)
    blank = out["name"].isna() | (out["name"].astype(str).str.strip() == "")
    out.loc[blank, "name"] = None
    out["name_status"] = blank.map({True: "unnamed", False: "named"})
    print(f"services: {n_raw} raw OSM features -> {len(out)} points after exact-duplicate removal")
    return out


def fetch_buildings(poly) -> gpd.GeoDataFrame:
    b = with_retry(ox.features_from_polygon, poly, tags={"building": True}).reset_index()
    b = b[b.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
    b["osm_id"] = osm_ids(b)
    b = b.drop_duplicates("osm_id")
    out = gpd.GeoDataFrame(
        {"osm_id": b["osm_id"].values, "building": b["building"].astype(str).values,
         "name": b["name"].values if "name" in b else None},
        geometry=b.geometry.values, crs=4326)
    print(f"buildings: {len(out)}")
    return out


def main():
    area = area_polygon()
    union = area.union_all()
    # 2 km margin, built in UTM so the buffer is really metres
    margin_poly = gpd.GeoSeries([union], crs=4326).to_crs(C.UTM_EPSG).buffer(C.MARGIN_M).to_crs(4326).iloc[0]

    print("downloading services (area + margin) ...")
    raw_points = fetch_services(margin_poly)
    raw_points["in_area"] = raw_points.geometry.within(union)

    cleaned, pairs = merge_near_duplicates(raw_points)
    cleaned["in_area"] = cleaned.geometry.within(union)
    report = {
        "raw_points_in_area": int(raw_points.in_area.sum()), "raw_points_total": int(len(raw_points)),
        "after_merge_in_area": int(cleaned.in_area.sum()), "after_merge_total": int(len(cleaned)),
        "merged_pairs": int(len(pairs)), "dedup_distance_m": DEDUP_M, "similarity": SIMILARITY,
    }
    print("dedup report:", json.dumps(report))
    (C.OUT / "dedup_report.json").write_text(json.dumps(report, indent=2))
    pairs.to_csv(C.OUT / "dedup_merged_pairs.csv", index=False)
    if cleaned.in_area.sum() < 15:
        sys.exit("Fewer than 15 features in the area: widen the area or add tags (see the brief).")

    print("downloading buildings (area only; buildings in the margin are not needed) ...")
    buildings = fetch_buildings(union)

    print("downloading walking network (area + 2 km margin) ...")
    G = with_retry(ox.graph_from_polygon, margin_poly, network_type="walk", simplify=True)
    ox.save_graphml(G, C.GRAPH_FILE)
    print(f"graph: {len(G.nodes)} nodes, {len(G.edges)} edges -> {C.GRAPH_FILE}")

    eng = create_engine(C.DATABASE_URL)
    with eng.begin() as con:
        for t in ("study_area", "services", "services_raw", "buildings"):
            con.execute(text(f"DROP TABLE IF EXISTS {t} CASCADE"))
    area.rename_geometry("geom").to_postgis("study_area", eng, if_exists="replace", index=False)
    cleaned.drop(columns=["merged_n"]).assign(merged_n=cleaned["merged_n"].astype(int)).rename_geometry("geom") \
        .to_postgis("services", eng, if_exists="replace", index=False)
    raw_points.rename_geometry("geom").to_postgis("services_raw", eng, if_exists="replace", index=False)
    buildings.rename_geometry("geom").to_postgis("buildings", eng, if_exists="replace", index=False)
    print("loaded study_area, services (cleaned), services_raw (before merge), buildings. Next: run sql/01_post_load.sql")


if __name__ == "__main__":
    main()
