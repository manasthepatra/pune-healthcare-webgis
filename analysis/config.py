"""Shared settings for the analysis scripts. Edit the AREA section, then everything else follows."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

# ----------------------------------------------------------------- AREA (edit me)
AREA_NAME = "Central Pune (Shivajinagar - Deccan - Peths)"
AREA_TYPE = "city"                      # "city"/"town" -> 15 min (1.2 km); "taluka"/"rural" -> 30 min (2.4 km)
# Default study area = a bounding box (west, south, east, north). To use real ward polygons instead,
# put a GeoJSON of your wards in analysis/area_wards.geojson (a "name" property per ward); it then
# replaces the box and is also used for the by-ward aggregation in Q7.
AREA_BBOX = (73.835, 18.495, 73.875, 18.535)
WARDS_FILE = ROOT / "analysis" / "area_wards.geojson"
MARGIN_M = 2000                         # services + street network are fetched with a 2 km margin

# ----------------------------------------------------------------- SERVICE TYPE
SERVICE_NAME = "healthcare"
# OSM tags counted as a service. Count features AFTER removing duplicates and say so in ANSWERS.md.
SERVICE_TAGS = {
    "amenity": ["hospital", "clinic", "doctors"],
    "healthcare": True,                 # any healthcare=* value
}


# ----------------------------------------------------------------- CRS
def utm_epsg(lon: float, lat: float) -> int:
    zone = int((lon + 180) // 6) + 1
    return (32600 if lat >= 0 else 32700) + zone


_lon = (AREA_BBOX[0] + AREA_BBOX[2]) / 2
_lat = (AREA_BBOX[1] + AREA_BBOX[3]) / 2
UTM_EPSG = utm_epsg(_lon, _lat)         # Pune -> 32643 (also hard-coded in sql/01_post_load.sql)

# ----------------------------------------------------------------- ACCESS MODEL
SPEED_KMH = 4.8
SPEED_ELDERLY_KMH = 3.6
THRESHOLD_MIN = 15 if AREA_TYPE in ("city", "town") else 30
THRESHOLD_M = SPEED_KMH * 1000 / 60 * THRESHOLD_MIN                    # 1200 m (urban) / 2400 m (rural)
THRESHOLD_ELDERLY_M = SPEED_ELDERLY_KMH * 1000 / 60 * THRESHOLD_MIN    # 900 m / 1800 m
H3_RESOLUTIONS = (8, 9)
RANDOM_SEED = 42

# ----------------------------------------------------------------- PATHS
DATA = ROOT / "data"
RAW = DATA / "raw"
OUT = ROOT / "analysis" / "out"
GRAPH_FILE = DATA / "walk.graphml"
DEM_DIR = DATA / "dem"
WORLDPOP_TIF = DATA / "worldpop" / "population.tif"   # optional WorldPop 100 m clip (see README)
BASELINE_JSON = ROOT / "legacy" / "response.json"      # Overpass response the earlier project used

for _p in (RAW, OUT, DEM_DIR):
    _p.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg2://webgis:%s@localhost:5432/webgis" % os.getenv("POSTGRES_PASSWORD", "change_me"),
)
# bonus: separate PostGIS + pgRouting database (compose service routing_db, host port 5434)
ROUTING_DATABASE_URL = os.getenv(
    "ROUTING_DATABASE_URL",
    "postgresql+psycopg2://webgis:%s@localhost:5434/webgis" % os.getenv("POSTGRES_PASSWORD", "change_me"),
)
