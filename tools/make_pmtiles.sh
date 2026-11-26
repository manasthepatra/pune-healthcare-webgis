#!/usr/bin/env sh
# Package the exported GeoJSON layers as ONE PMTiles file (run from the repo root).
# Needs Docker only (tippecanoe is built from tools/tippecanoe.Dockerfile). On Windows use make_pmtiles.ps1.
set -eu
docker build -q -t webgis-tippecanoe -f tools/tippecanoe.Dockerfile tools
docker run --rm -v "$PWD:/work" --entrypoint sh webgis-tippecanoe tools/pmtiles_inner.sh
ls -l client/public/data/map.pmtiles
