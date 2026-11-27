"""Phase 3 input: WorldPop 100 m population, clipped to the study area.

Downloads the WorldPop 2020 "constrained" India raster (about 530 MB, the server does not support HTTP range reads
so the whole file is needed) into data/worldpop/ (git-ignored), then clips it to the area to
data/worldpop/population.tif (a few KB). 03_access_analysis.py uses population.tif automatically when it exists,
otherwise it falls back to building footprint area as a proxy.

    python analysis/02b_prepare_worldpop.py

Source: WorldPop (www.worldpop.org), "Global_2000_2020_Constrained / 2020 / BSGM / IND", CC BY 4.0.
"""
import sys
from pathlib import Path

import rasterio
import requests
from rasterio.windows import from_bounds

sys.path.insert(0, str(Path(__file__).parent))
import config as C  # noqa: E402

URL = ("https://data.worldpop.org/GIS/Population/Global_2000_2020_Constrained/2020/BSGM/IND/"
       "ind_ppp_2020_constrained.tif")
FULL = C.DATA / "worldpop" / "ind_ppp_2020_constrained.tif"


def download():
    FULL.parent.mkdir(parents=True, exist_ok=True)
    if FULL.exists() and FULL.stat().st_size > 500_000_000:
        print("already downloaded:", FULL)
        return
    print("downloading", URL)
    with requests.get(URL, stream=True, timeout=120) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        done = 0
        with open(FULL, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
                done += len(chunk)
                if total and done % (50 << 20) < (1 << 20):
                    print(f"  {done / 1e6:.0f} / {total / 1e6:.0f} MB", flush=True)


def clip():
    w, s, e, n = C.AREA_BBOX
    pad = 0.005
    with rasterio.open(FULL) as ds:
        win = from_bounds(w - pad, s - pad, e + pad, n + pad, ds.transform).round_offsets().round_lengths()
        arr = ds.read(1, window=win)
        meta = ds.meta.copy()
        meta.update(driver="GTiff", height=arr.shape[0], width=arr.shape[1],
                    transform=ds.window_transform(win), compress="deflate")
    out = C.WORLDPOP_TIF
    out.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(out, "w", **meta) as dst:
        dst.write(arr, 1)
    valid = arr[arr > 0]
    print(f"wrote {out}: {arr.shape[1]} x {arr.shape[0]} px, people in clip = {valid.sum():.0f}, nodata={meta.get('nodata')}")


if __name__ == "__main__":
    download()
    clip()
