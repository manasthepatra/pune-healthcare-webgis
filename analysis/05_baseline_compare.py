"""Q3 helper: count what the EARLIER project's data source held for the same area.

The earlier project (legacy/) fetched OSM through Overpass; legacy/response.json is the Overpass response it saved
(timestamp inside the file). We count healthcare features of the same tags inside the study area and compare with
the PostGIS table.   python analysis/05_baseline_compare.py
"""
import json
import sys
from pathlib import Path

import pandas as pd
from shapely.geometry import Point
from sqlalchemy import create_engine, text

sys.path.insert(0, str(Path(__file__).parent))
import config as C  # noqa: E402


def is_health(t: dict) -> bool:
    return t.get("amenity") in ("hospital", "clinic", "doctors") or "healthcare" in t


def main():
    data = json.loads(C.BASELINE_JSON.read_text(encoding="utf-8"))
    w, s, e, n = C.AREA_BBOX
    rows = []
    for el in data["elements"]:
        t = el.get("tags", {})
        lat = el.get("lat", el.get("center", {}).get("lat"))
        lon = el.get("lon", el.get("center", {}).get("lon"))
        if lat is None or not is_health(t) or not (s <= lat <= n and w <= lon <= e):
            continue
        rows.append({"id": f"{el['type'][0]}{el['id']}", "name": t.get("name"), "lat": lat, "lon": lon})
    base = pd.DataFrame(rows).drop_duplicates("id")
    print(f"earlier-project snapshot ({data.get('osm3s', {}).get('timestamp_osm_base')}): "
          f"{len(base)} healthcare features in the area, {int(base.name.isna().sum())} without a name")
    eng = create_engine(C.DATABASE_URL)
    with eng.connect() as con:
        now = con.execute(text("SELECT count(*), count(*) FILTER (WHERE name IS NULL) FROM services WHERE in_area")).one()
        ids = {r[0] for r in con.execute(text("SELECT osm_id FROM services WHERE in_area"))}
    print(f"new PostGIS table: {now[0]} features in the area, {now[1]} without a name")
    old_ids = set(base.id)
    print(f"in both: {len(old_ids & ids)}   only in earlier snapshot: {len(old_ids - ids)}   only in new data: {len(ids - old_ids)}")
    print("note: the earlier app displayed unnamed features as '<category> nearby' instead of flagging them.")


if __name__ == "__main__":
    main()
