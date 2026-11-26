"""Phase 5A: export the hex results, services, buildings and area to GeoJSON for tippecanoe.

    python analysis/04_export_static.py
    tools/make_pmtiles.sh            (or tools\\make_pmtiles.ps1 on Windows)  -> client/public/data/map.pmtiles
"""
import sys
from pathlib import Path

import geopandas as gpd
from sqlalchemy import create_engine

sys.path.insert(0, str(Path(__file__).parent))
import config as C  # noqa: E402

OUT = C.DATA / "export"
OUT.mkdir(parents=True, exist_ok=True)

QUERIES = {
    "hex8": "SELECT h3, round(pop::numeric,1)::float AS pop, round(dist_m::numeric,0)::float AS dist_m, "
            "nearest_name, covered_48, covered_36, in_buffer, geom FROM hex_r8",
    "hex9": "SELECT h3, round(pop::numeric,1)::float AS pop, round(dist_m::numeric,0)::float AS dist_m, "
            "nearest_name, covered_48, covered_36, in_buffer, geom FROM hex_r9",
    "services": "SELECT osm_id, name, service_type, name_status, in_area, addr_street, opening_hours, geom FROM services",
    "buildings": "SELECT osm_id, building, round(area_m2::numeric,0)::float AS area_m2, geom FROM buildings",
    "area": "SELECT name, geom FROM study_area",
}

if __name__ == "__main__":
    eng = create_engine(C.DATABASE_URL)
    for name, sql in QUERIES.items():
        g = gpd.read_postgis(sql, eng, geom_col="geom")
        path = OUT / f"{name}.geojson"
        g.to_file(path, driver="GeoJSON", COORDINATE_PRECISION=6)
        print(f"{name}: {len(g)} features, {path.stat().st_size / 1024:.0f} KB")
