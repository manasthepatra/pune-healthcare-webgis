# Runs the analysis scripts inside Docker (used because the host's Windows Application Control policy
# blocks compiled Python wheels). Build:  docker build -t webgis-analysis -f analysis/Dockerfile analysis
# Run (repo mounted at /work, joined to the Compose network so the host name "db" works):
#   docker run --rm --network webgis_gis -v "${PWD}:/work" -w /work \
#     -e DATABASE_URL=postgresql+psycopg2://USER:PASS@db:5432/webgis webgis-analysis python analysis/01_acquire_and_load.py
FROM python:3.11-slim
WORKDIR /work
# rasterio's wheel needs libexpat from the OS
RUN apt-get update && apt-get install -y --no-install-recommends libexpat1 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
