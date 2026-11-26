# PowerShell version of make_pmtiles.sh (run from the repo root). Needs Docker Desktop only.
$ErrorActionPreference = "Stop"
docker build -q -t webgis-tippecanoe -f tools/tippecanoe.Dockerfile tools
docker run --rm -v "${PWD}:/work" --entrypoint sh webgis-tippecanoe tools/pmtiles_inner.sh
Get-Item client/public/data/map.pmtiles | Select-Object Name, Length
