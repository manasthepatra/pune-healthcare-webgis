#!/usr/bin/env sh
# Run a Python script from the repo inside the analysis container, joined to the Compose network.
# usage: tools/pyrun.sh analysis/01_acquire_and_load.py [args]   (reads credentials from .env)
set -eu
set -a; . ./.env; set +a
exec docker run --rm --network webgis_gis -v "$PWD:/work" -w /work \
  -e "DATABASE_URL=postgresql+psycopg2://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}" \
  -e "ROUTING_DATABASE_URL=postgresql+psycopg2://${POSTGRES_USER}:${POSTGRES_PASSWORD}@routing_db:5432/${POSTGRES_DB}" \
  -e "API_URL=http://api:8000" \
  -e "GEOSERVER_URL=http://geoserver:8080/geoserver" \
  webgis-analysis python -u "$@"
