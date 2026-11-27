"""Re-build ONLY the isochrone + buffer tables (and the area comparison in results.json), in a few minutes.

Why this exists: make_isochrones() once forgot weight="length", so every isochrone was the whole street network.
    python analysis/03d_isochrones_only.py
"""
import importlib
import json
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import shapely
from shapely.geometry import Point
from sqlalchemy import create_engine

sys.path.insert(0, str(Path(__file__).parent))
m = importlib.import_module("03_access_analysis")
C = m.C

eng = create_engine(C.DATABASE_URL)
area_utm, svc, bld, wards = m.load_db(eng)
net = m.Network(m.load_graph(), svc)
iso = m.make_isochrones(net)
iso["geometry"] = iso.geometry.simplify(5)
iso["area_m2"] = iso.area
buf = gpd.GeoDataFrame({"osm_id": svc.osm_id}, geometry=[Point(x, y).buffer(m.THR) for x, y in zip(svc.x, svc.y)], crs=C.UTM_EPSG)
buf["area_m2"] = buf.area
iso.to_crs(4326).rename_geometry("geom").to_postgis("isochrones", eng, if_exists="replace", index=False, chunksize=50)
buf.to_crs(4326).rename_geometry("geom").to_postgis("buffers", eng, if_exists="replace", index=False, chunksize=50)

ratio = (iso.set_index("osm_id").area / buf.set_index("osm_id").area)
union_iso = shapely.union_all(iso.geometry).intersection(area_utm).area / 1e6
union_buf = shapely.union_all(buf.geometry).intersection(area_utm).area / 1e6

# A fair comparison: an isochrone is a 30 m ribbon along streets, so it is smaller than a circle even with no barrier at all.
# Compare it with the street ribbon INSIDE the circle (what a walker could reach if streets ran straight from the clinic).
ribbon = shapely.union_all([d["geom"].buffer(m.EDGE_BUFFER_M) for _, _, d in net.H.edges(data=True)])
street_in_circle = np.array([g.intersection(ribbon).area for g in buf.geometry])
share = iso.area.to_numpy() / street_in_circle
street_area_in_study = ribbon.intersection(area_utm).area / 1e6
res = {"network_isochrones": union_iso, "straight_buffers": union_buf, "study_area": area_utm.area / 1e6,
       "street_ribbon_within_study_area": street_area_in_study,
       "per_clinic_isochrone_as_share_of_circle": {"median": float(ratio.median()), "min": float(ratio.min()), "max": float(ratio.max())},
       "per_clinic_isochrone_as_share_of_street_area_inside_its_circle": {
           "median": float(np.median(share)), "min": float(share.min()), "max": float(share.max())},
       "note": "isochrone = streets reachable within the threshold, thickened 30 m (so land >30 m from any street counts as unreachable)"}
path = C.OUT / "results.json"
data = json.loads(path.read_text()) if path.exists() else {}
data["union_area_km2"] = res
path.write_text(json.dumps(data, indent=2, default=str))
print(json.dumps(res, indent=2))
