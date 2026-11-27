#!/usr/bin/env sh
# Pre-render the DEM (same GeoServer WMS layer and SLD as the live map) to a static PNG for the GitHub Pages build.
# Needs the Compose stack with the published webgis:dem layer. Bounds = extent of data/dem/dem_area.tif in EPSG:3857.
set -eu
GS="${GEOSERVER_URL:-http://127.0.0.1:8081/geoserver}"
mkdir -p client/public/data
curl -fsS -o client/public/data/dem.png \
  "$GS/webgis/wms?service=WMS&version=1.1.1&request=GetMap&layers=webgis:dem&styles=&srs=EPSG:3857&bbox=8218702.544227,2094966.4146767468,8224299.440847441,2100868.8165781167&width=1024&height=1080&format=image/png&transparent=true"
ls -l client/public/data/dem.png
