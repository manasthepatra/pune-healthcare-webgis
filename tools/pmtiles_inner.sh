#!/bin/sh
# Runs INSIDE the tippecanoe container (cwd = repo root mounted at /work). Called by make_pmtiles.sh/.ps1.
set -eu
mkdir -p client/public/data
tippecanoe -o client/public/data/map.pmtiles --force \
  -Z8 -z16 -B8 --no-tile-size-limit --no-feature-limit \
  -L '{"file":"data/export/area.geojson","layer":"area","minzoom":8,"maxzoom":16}' \
  -L '{"file":"data/export/hex8.geojson","layer":"hex8","minzoom":8,"maxzoom":16}' \
  -L '{"file":"data/export/hex9.geojson","layer":"hex9","minzoom":8,"maxzoom":16}' \
  -L '{"file":"data/export/services.geojson","layer":"services","minzoom":8,"maxzoom":16}' \
  -L '{"file":"data/export/buildings.geojson","layer":"buildings","minzoom":13,"maxzoom":16}'
