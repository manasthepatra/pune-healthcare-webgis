"""Replay the DB write of Phase 3 from data/cache/phase3.pkl (written by 03_access_analysis.py)."""
import sys
from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine

sys.path.insert(0, str(Path(__file__).parent))
import config as C  # noqa: E402

d = pd.read_pickle(C.DATA / "cache" / "phase3.pkl")
eng = create_engine(C.DATABASE_URL)
iso = d["iso"].copy()
iso["geometry"] = iso.geometry.simplify(5)          # 5 m tolerance in UTM: the raw edge-buffer unions have huge vertex counts
iso["area_m2"] = iso.area
for name, g in (("isochrones", iso.to_crs(4326)), ("buffers", d["buffers"].to_crs(4326))):
    print("writing", name, len(g), "vertices:", int(g.geometry.count_coordinates().sum()), flush=True)
    g.rename_geometry("geom").to_postgis(name, eng, if_exists="replace", index=False, chunksize=50)
for res, g in d["hexes"].items():
    print("writing hex", res, len(g), flush=True)
    g.drop(columns=["cx", "cy"]).rename_geometry("geom").to_postgis(f"hex_r{res}", eng, if_exists="replace", index=False)
print("done. Next: sql/05_hex_post.sql")
