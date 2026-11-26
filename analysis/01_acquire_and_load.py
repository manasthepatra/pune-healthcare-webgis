"""Phase 1: download OSM data for the area, clean it, load it into PostGIS (EPSG:4326).

Run from the repo root with the Compose stack up:   python analysis/01_acquire_and_load.py
Then run sql/01_post_load.sql (adds the UTM copy + indexes).
"""
import os
import sys
import time
from pathlib import Path

import geopandas as gpd
import osmnx as ox
import pandas as pd
from shapely.geometry import box
from sqlalchemy import create_engine, text

sys.path.insert(0, str(Path(__file__).parent))
import config as C  # noqa: E402

ox.settings.use_cache = True
ox.settings.cache_folder = str(C.DATA / "cache")
ox.settings.requests_timeout = 300

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
    if C.WARDS_FILE.exists():
        g = gpd.read_file(C.WARDS_FILE).to_crs(4326)
        if "name" not in g:
            g["name"] = [f"ward {i + 1}" for i in range(len(g))]
        return g[["name", "geometry"]]
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


def fetch_services(poly_margin) -> gpd.GeoDataFrame:
    raw = with_retry(ox.features_from_polygon, poly_margin, tags=C.SERVICE_TAGS).reset_index()
    raw["osm_id"] = osm_ids(raw)
    n_raw = len(raw)
    # a) polygon / line features (hospital building outlines) -> one point each
    raw["geometry"] = raw.geometry.representative_point()
    # b) drop duplicates: same OSM id, or same name at identical coordinates (6 dp)
    raw = raw.drop_duplicates("osm_id")
    names = raw["name"].fillna("").astype(str) if "name" in raw else pd.Series("", index=raw.index)
    key = names + "|" + raw.geometry.x.round(6).astype(str) + "|" + raw.geometry.y.round(6).astype(str)
    raw = raw.loc[~key.duplicated()]

    def col(c):
        return raw[c] if c in raw else None

    keep = pd.DataFrame({
        "osm_id": raw["osm_id"].values,
        "name": col("name").values if "name" in raw else None,
        "service_type": raw.apply(service_type, axis=1).values,
        "amenity": col("amenity").values if "amenity" in raw else None,
        "healthcare": col("healthcare").values if "healthcare" in raw else None,
        "addr_street": col("addr:street").values if "addr:street" in raw else None,
        "opening_hours": col("opening_hours").values if "opening_hours" in raw else None,
    })
    out = gpd.GeoDataFrame(keep, geometry=raw.geometry.values, crs=4326)
    blank = out["name"].isna() | (out["name"].astype(str).str.strip() == "")
    out.loc[blank, "name"] = None
    out["name_status"] = blank.map({True: "unnamed", False: "named"})
    print(f"services: {n_raw} raw features -> {len(out)} after points + dedup")
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
    services = fetch_services(margin_poly)
    services["in_area"] = services.geometry.within(union)
    print(f"services inside the area: {int(services.in_area.sum())}  (brief requires >= 15)")
    if services.in_area.sum() < 15:
        sys.exit("Fewer than 15 features in the area: widen the area or add tags (see the brief).")

    print("downloading buildings (area only; buildings in the margin are not needed) ...")
    buildings = fetch_buildings(union)

    print("downloading walking network (area + 2 km margin) ...")
    G = with_retry(ox.graph_from_polygon, margin_poly, network_type="walk", simplify=True)
    ox.save_graphml(G, C.GRAPH_FILE)
    print(f"graph: {len(G.nodes)} nodes, {len(G.edges)} edges -> {C.GRAPH_FILE}")

    eng = create_engine(C.DATABASE_URL)
    with eng.begin() as con:
        for t in ("study_area", "services", "buildings"):
            con.execute(text(f"DROP TABLE IF EXISTS {t} CASCADE"))
    area.rename_geometry("geom").to_postgis("study_area", eng, if_exists="replace", index=False)
    services.rename_geometry("geom").to_postgis("services", eng, if_exists="replace", index=False)
    buildings.rename_geometry("geom").to_postgis("buildings", eng, if_exists="replace", index=False)
    print("loaded study_area, services, buildings. Next: run sql/01_post_load.sql")


if __name__ == "__main__":
    main()
