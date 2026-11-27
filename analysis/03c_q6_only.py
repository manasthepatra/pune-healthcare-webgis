"""Re-run ONLY Q6 (about 2 minutes) and patch it into analysis/out/results.json.

Useful when the Q6 rules change without needing the 30-minute isochrone/H3 part of 03_access_analysis.py.
    python analysis/03c_q6_only.py
"""
import importlib
import json
import sys
from pathlib import Path

from scipy.spatial import cKDTree
from sqlalchemy import create_engine

sys.path.insert(0, str(Path(__file__).parent))
m = importlib.import_module("03_access_analysis")
C = m.C

eng = create_engine(C.DATABASE_URL)
area_utm, svc, bld, wards = m.load_db(eng)
net = m.Network(m.load_graph(), svc)
res = m.q6(net, area_utm, svc, cKDTree(svc[["x", "y"]].to_numpy()))
path = C.OUT / "results.json"
data = json.loads(path.read_text()) if path.exists() else {}
data["q6"] = res
path.write_text(json.dumps(data, indent=2, default=str))
print("patched q6 into", path)
