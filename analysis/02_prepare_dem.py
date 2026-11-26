"""Phase 2 helper: fetch a free SRTM 30 m (1 arc-second) tile and clip it to the study area.

Source: the public AWS "Terrain Tiles" bucket (skadi = SRTM .hgt tiles, no login, no credit card).
Output: data/dem/dem_area.tif (EPSG:4326, int16, metres) - mounted into GeoServer at /opt/geoserver_data/data/dem.

Alternative: put your own Bhuvan CartoDEM / SRTM GeoTIFF anywhere and pass it as the first argument.
    python analysis/02_prepare_dem.py [path/to/your_dem.tif]
"""
import gzip
import math
import shutil
import sys
from pathlib import Path

import rasterio
import requests
from rasterio.mask import mask
from shapely.geometry import box, mapping

sys.path.insert(0, str(Path(__file__).parent))
import config as C  # noqa: E402


def skadi_url(lon: float, lat: float) -> tuple[str, str]:
    la, lo = math.floor(lat), math.floor(lon)
    name = f"{'N' if la >= 0 else 'S'}{abs(la):02d}{'E' if lo >= 0 else 'W'}{abs(lo):03d}"
    return name, f"https://s3.amazonaws.com/elevation-tiles-prod/skadi/{name[:3]}/{name}.hgt.gz"


def main():
    if len(sys.argv) > 1:
        src = Path(sys.argv[1])
    else:
        w, s, e, n = C.AREA_BBOX
        name, url = skadi_url((w + e) / 2, (s + n) / 2)
        src = C.DEM_DIR / f"{name}.hgt"
        if not src.exists():
            print("downloading", url)
            r = requests.get(url, timeout=120)
            r.raise_for_status()
            gz = C.DEM_DIR / f"{name}.hgt.gz"
            gz.write_bytes(r.content)
            with gzip.open(gz, "rb") as fi, open(src, "wb") as fo:
                shutil.copyfileobj(fi, fo)
    w, s, e, n = C.AREA_BBOX
    pad = 0.005
    clip = box(w - pad, s - pad, e + pad, n + pad)
    with rasterio.open(src) as ds:
        arr, tr = mask(ds, [mapping(clip)], crop=True)
        meta = ds.meta.copy()
    meta.update(driver="GTiff", height=arr.shape[1], width=arr.shape[2], transform=tr, compress="deflate", nodata=-32768)
    out = C.DEM_DIR / "dem_area.tif"
    with rasterio.open(out, "w", **meta) as dst:
        dst.write(arr)
    print(f"wrote {out}  ({arr.shape[2]} x {arr.shape[1]} px, min {arr.min()} m, max {arr.max()} m)")


if __name__ == "__main__":
    main()
