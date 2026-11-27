"""Phase 3 input: ward polygons for the by-ward aggregation in Q7.

OSM has no ward or pin-code polygons for this area (only the city and the subdistrict), so we use the PMC *admin wards*
(ward-office areas, 2017) from DataMeet's Municipal_Spatial_Data repository, clip them to the study area and keep
analysis/area_wards.geojson (a few KB). The study area itself stays the bounding box; wards are only used to
aggregate results, so each unit is "ward part inside the study area".

    python analysis/02c_prepare_wards.py

Source: https://github.com/datameet/Municipal_Spatial_Data (Pune/pune-admin-wards_2017.geojson), traced from PMC maps.
"""
import sys
from pathlib import Path

import geopandas as gpd
import requests
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).parent))
import config as C  # noqa: E402

URL = "https://raw.githubusercontent.com/datameet/Municipal_Spatial_Data/master/Pune/pune-admin-wards_2017.geojson"
RAW = C.RAW / "pune-admin-wards_2017.geojson"

if __name__ == "__main__":
    if not RAW.exists():
        RAW.write_bytes(requests.get(URL, timeout=60).content)
    wards = gpd.read_file(RAW).to_crs(4326)
    area = box(*C.AREA_BBOX)
    wards["geometry"] = wards.geometry.intersection(area)
    wards = wards[~wards.geometry.is_empty].copy()
    wards["name"] = wards["name"].str.replace(r"^Admin Ward \d+\s*", "", regex=True).str.strip()
    wards["area_km2"] = wards.to_crs(C.UTM_EPSG).area / 1e6
    # drop slivers (< 0.5 % of the study area): they would give meaningless shares
    study_km2 = gpd.GeoSeries([area], crs=4326).to_crs(C.UTM_EPSG).area.iloc[0] / 1e6
    wards = wards[wards.area_km2 > 0.005 * study_km2]
    wards[["name", "area_km2", "geometry"]].to_file(C.WARDS_FILE, driver="GeoJSON")
    print(wards[["name", "area_km2"]].sort_values("area_km2", ascending=False).to_string(index=False))
    print("wrote", C.WARDS_FILE)
