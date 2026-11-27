"""Phase 3: was the earlier "nearest" right?  (Q6, Q7, Q8)

Reads services / buildings / study area from PostGIS (needs sql/01_post_load.sql to have run) and the
walking graph saved by 01_acquire_and_load.py. Writes hex_r8, hex_r9, isochrones and buffers back to
PostGIS and the numbers for ANSWERS.md to analysis/out/.

    python analysis/03_access_analysis.py            # full run + write to PostGIS
    python analysis/03_access_analysis.py --no-db-write

Method notes (say these in the viva):
  * Graph = OSM "walk" network, projected to UTM, treated as UNDIRECTED (pedestrians ignore one-way tags),
    largest connected component only.
  * A point is snapped to its nearest graph node; the straight-line snap distance is added to the route
    (so network distance = snap + along-street distance). Services are snapped the same way.
  * Nearest service for every node = one multi-source Dijkstra (virtual source node per service).
  * Network isochrone = union of street edges reached within the threshold, buffered by 30 m
    (frontier edges that are only partly reachable are not clipped - a small, stated approximation).
  * Population: WorldPop 100 m raster if data/worldpop/population.tif exists, otherwise building
    footprint area (m2) as a PROXY. Shares are unaffected by the unit, absolute numbers are not people.
"""
import argparse
import json
import sys
from pathlib import Path

import geopandas as gpd
import h3
import matplotlib
import networkx as nx
import numpy as np
import osmnx as ox
import pandas as pd
import shapely
from scipy.spatial import cKDTree
from shapely import wkt
from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from sqlalchemy import create_engine, text

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

sys.path.insert(0, str(Path(__file__).parent))
import config as C  # noqa: E402

EPSG = C.UTM_EPSG
THR = C.THRESHOLD_M
THR_OLD = C.THRESHOLD_ELDERLY_M
EDGE_BUFFER_M = 30


# ------------------------------------------------------------------ loading
def load_db(eng):
    area_wkt = pd.read_sql(text("SELECT ST_AsText(ST_Union(geom_utm)) AS w FROM study_area"), eng)["w"][0]
    area_utm = wkt.loads(area_wkt)
    svc = pd.read_sql(text(
        "SELECT osm_id, name, in_area, ST_X(geom_utm) AS x, ST_Y(geom_utm) AS y FROM services"), eng)
    bld = pd.read_sql(text(
        "SELECT ST_X(ST_PointOnSurface(geom_utm)) AS x, ST_Y(ST_PointOnSurface(geom_utm)) AS y, area_m2 FROM buildings"), eng)
    wards = None
    if C.WARDS_FILE.exists():
        wards = gpd.read_file(C.WARDS_FILE).to_crs(EPSG)
        if "name" not in wards:
            wards["name"] = [f"ward {i + 1}" for i in range(len(wards))]
    return area_utm, svc, bld, wards


def load_graph():
    G = ox.load_graphml(C.GRAPH_FILE)
    G = ox.project_graph(G, to_crs=f"EPSG:{EPSG}")
    H = nx.Graph()
    for n, d in G.nodes(data=True):
        H.add_node(n, x=d["x"], y=d["y"])
    for u, v, d in G.edges(data=True):
        length = d.get("length", 0.0)
        if H.has_edge(u, v) and H[u][v]["length"] <= length:
            continue
        geom = d.get("geometry")
        if geom is None:
            geom = LineString([(G.nodes[u]["x"], G.nodes[u]["y"]), (G.nodes[v]["x"], G.nodes[v]["y"])])
        H.add_edge(u, v, length=length, geom=geom)
    giant = max(nx.connected_components(H), key=len)
    H = H.subgraph(giant).copy()
    print(f"walking graph (largest component): {H.number_of_nodes()} nodes, {H.number_of_edges()} edges")
    return H


class Network:
    """Snap points to the graph and answer nearest-service questions on the street network."""

    def __init__(self, H, svc: pd.DataFrame):
        self.H = H
        self.nodes = list(H.nodes)
        self.xy = np.array([[H.nodes[n]["x"], H.nodes[n]["y"]] for n in self.nodes])
        self.tree = cKDTree(self.xy)
        self.svc = svc.reset_index(drop=True)
        off, idx = self.tree.query(self.svc[["x", "y"]].to_numpy())
        self.svc["node"] = [self.nodes[i] for i in idx]
        self.svc["snap_m"] = off
        # virtual source per service, joined to its node by the snap distance
        G2 = H.copy()
        self.svc_nodes = []
        for r in self.svc.itertuples():
            vn = ("svc", r.osm_id)
            G2.add_edge(vn, r.node, length=r.snap_m, geom=None)
            self.svc_nodes.append(vn)
        self.dist, self.paths = nx.multi_source_dijkstra(G2, self.svc_nodes, weight="length")

    def snap(self, xs, ys):
        off, idx = self.tree.query(np.column_stack([xs, ys]))
        return off, [self.nodes[i] for i in idx]

    def nearest(self, xs, ys):
        """-> (network distance m, nearest service osm_id, snap offset m); NaN/None if unreachable."""
        off, nodes = self.snap(xs, ys)
        d, who = [], []
        for o, n in zip(off, nodes):
            if n in self.dist:
                d.append(o + self.dist[n])
                who.append(self.paths[n][0][1])
            else:
                d.append(np.nan)
                who.append(None)
        return np.array(d), who, off


# ------------------------------------------------------------------ Q6

def find_barriers(line_utm):
    """OSM features (river, rail, motorway/trunk, wall, military/railway land) crossing the straight line - candidates only."""
    poly = gpd.GeoSeries([line_utm.buffer(25)], crs=EPSG).to_crs(4326).iloc[0]
    tags = {"waterway": ["river", "stream", "canal"], "railway": ["rail", "light_rail", "subway"],
            "highway": ["motorway", "trunk"], "barrier": ["wall", "fence", "city_wall"], "landuse": ["military", "railway"]}
    for url in ("https://overpass-api.de/api", "https://overpass.private.coffee/api"):
        ox.settings.overpass_url = url
        try:
            f = ox.features_from_polygon(poly, tags=tags)
            break
        except ox._errors.InsufficientResponseError:   # Overpass answered: nothing of these types there
            return ["none of the checked OSM barrier types (river, railway, motorway/trunk, wall, military/railway land) "
                    "crosses the straight line - look at the street layout (dead ends, one long detour) on the map"]
        except Exception as exc:  # network/Overpass problems must not stop the analysis
            print("  barrier lookup failed on", url, str(exc).splitlines()[0][:80])
    else:
        return ["lookup failed (Overpass unavailable) - identify the barrier from the map"]
    f = f.reset_index()
    f = f[f.to_crs(EPSG).geometry.intersects(line_utm.buffer(5))]
    out = []
    for r in f.itertuples():
        kind = next((f"{k}={getattr(r, k)}" for k in tags if isinstance(getattr(r, k, None), str)), "?")
        nm = getattr(r, "name", None)
        out.append(f"{kind} {nm if isinstance(nm, str) else '(unnamed)'} [{r.element[0]}{r.id}]")
    return sorted(set(out)) or ["none of the checked OSM barrier types crosses the straight line"]


def q6(net: Network, area_utm, svc_all, svc_tree, n=30):
    rng = np.random.default_rng(C.RANDOM_SEED)
    minx, miny, maxx, maxy = area_utm.bounds
    pts = []
    while len(pts) < n:
        p = Point(rng.uniform(minx, maxx), rng.uniform(miny, maxy))
        if area_utm.contains(p):
            pts.append(p)
    xs = np.array([p.x for p in pts])
    ys = np.array([p.y for p in pts])
    d_line, i_line = svc_tree.query(np.column_stack([xs, ys]))
    id_line = svc_all["osm_id"].to_numpy()[i_line]
    d_net, id_net, snap = net.nearest(xs, ys)
    df = pd.DataFrame({"x": xs, "y": ys, "straight_m": d_line, "straight_nearest": id_line,
                       "network_m": d_net, "network_nearest": id_net})
    df["different"] = df.straight_nearest != df.network_nearest
    df["ratio"] = df.network_m / df.straight_m
    df["extra_m"] = df.network_m - df.straight_m
    df.to_csv(C.OUT / "q6_points.csv", index=False)

    def case(row, stem, title):
        sl = svc_all.set_index("osm_id").loc[row.straight_nearest]
        barriers = find_barriers(LineString([(row.x, row.y), (sl.x, sl.y)]))
        draw_case(net, svc_all, row, stem, title)
        return {"straight_m": float(row.straight_m), "network_m": float(row.network_m), "ratio": float(row.ratio),
                "extra_walk_m": float(row.extra_m), "straight_nearest": row.straight_nearest,
                "network_nearest": row.network_nearest, "nearest_service_differs": bool(row.straight_nearest != row.network_nearest),
                "point_utm": [float(row.x), float(row.y)], "barrier_candidates": barriers,
                "map": f"analysis/out/{stem}.png"}

    summary = {
        "n_points": n,
        "n_different_nearest": int(df.different.sum()),
        "median_ratio": float(df.ratio.median()),
        "max_ratio": float(df.ratio.max()),
        # the two ways to read "worst case": the longest extra walk, and the largest ratio (often a close neighbour behind a wall)
        "worst_case_longest_extra_walk": case(df.loc[df.extra_m.idxmax()], "q6_worst_case", "Q6 worst case: longest extra walk"),
        "worst_case_max_ratio": case(df.loc[df.ratio.idxmax()], "q6_max_ratio_case", "Q6 largest ratio"),
    }
    (C.OUT / "q6_summary.json").write_text(json.dumps(summary, indent=2))
    print("Q6", json.dumps(summary, indent=2))
    return summary


def draw_case(net: Network, svc_all, worst, stem, title):
    H = net.H
    s_line = svc_all.set_index("osm_id").loc[worst.straight_nearest]
    s_net = svc_all.set_index("osm_id").loc[worst.network_nearest]
    off, nodes = net.snap([worst.x], [worst.y])
    start = nodes[0]
    target = net.svc.set_index("osm_id").loc[worst.network_nearest, "node"]
    route = nx.shortest_path(H, start, target, weight="length")
    coords = [(worst.x, worst.y)] + [(H.nodes[n]["x"], H.nodes[n]["y"]) for n in route] + [(s_net.x, s_net.y)]
    route_line = LineString(coords)
    gpd.GeoDataFrame({"kind": ["network_route"]}, geometry=[route_line], crs=EPSG).to_crs(4326).to_file(
        C.OUT / f"{stem}_route.geojson", driver="GeoJSON")
    minx, miny, maxx, maxy = route_line.union(Point(s_line.x, s_line.y)).bounds
    pad = 350
    fig, ax = plt.subplots(figsize=(9, 9))
    for u, v, d in H.edges(data=True):
        g = d["geom"]
        a, b, c, e = g.bounds
        if c < minx - pad or a > maxx + pad or e < miny - pad or b > maxy + pad:
            continue
        xs, ys = g.xy
        ax.plot(xs, ys, color="#bbbbbb", lw=0.8, zorder=1)
    ax.plot(*route_line.xy, color="#d62728", lw=2.5, label=f"walking route {worst.network_m:.0f} m", zorder=3)
    ax.plot([worst.x, s_line.x], [worst.y, s_line.y], "--", color="#1f77b4", lw=2,
            label=f"straight line {worst.straight_m:.0f} m (earlier project's nearest)", zorder=2)
    ax.scatter([worst.x], [worst.y], c="k", s=60, zorder=4, label="random point")
    ax.scatter([s_line.x], [s_line.y], c="#1f77b4", marker="s", s=70, zorder=4, label="nearest by straight line")
    ax.scatter([s_net.x], [s_net.y], c="#d62728", marker="^", s=80, zorder=4, label="nearest by walking")
    ax.set_xlim(minx - pad, maxx + pad)
    ax.set_ylim(miny - pad, maxy + pad)
    ax.set_aspect("equal")
    ax.set_title(f"{title}: ratio {worst.ratio:.2f}, walk {worst.network_m:.0f} m vs {worst.straight_m:.0f} m straight")
    ax.legend(loc="lower left", fontsize=8)
    fig.savefig(C.OUT / f"{stem}.png", dpi=150, bbox_inches="tight")
    plt.close(fig)


# ------------------------------------------------------------------ isochrones + buffers
def make_isochrones(net: Network, thr=THR):
    H = net.H
    edge_buf = {}

    def buf(u, v):
        k = (u, v) if u < v else (v, u)
        if k not in edge_buf:
            edge_buf[k] = H[u][v]["geom"].buffer(EDGE_BUFFER_M, cap_style="round")
        return edge_buf[k]

    rows = []
    for r in net.svc.itertuples():
        reach = nx.single_source_dijkstra_path_length(H, r.node, cutoff=max(thr - r.snap_m, 0))
        parts = [Point(H.nodes[r.node]["x"], H.nodes[r.node]["y"]).buffer(EDGE_BUFFER_M)]
        seen = set(reach)
        for u in seen:
            for v in H[u]:
                if v in seen and str(u) < str(v):
                    parts.append(buf(u, v))
        rows.append((r.osm_id, shapely.union_all(parts)))
    iso = gpd.GeoDataFrame({"osm_id": [r[0] for r in rows]}, geometry=[r[1] for r in rows], crs=EPSG)
    iso["area_m2"] = iso.area
    return iso


# ------------------------------------------------------------------ H3
def hex_cells(area_wgs, res):
    cells = set()
    polys = area_wgs.geoms if isinstance(area_wgs, MultiPolygon) else [area_wgs]
    for p in polys:
        outer = [(y, x) for x, y in p.exterior.coords]
        holes = [[(y, x) for x, y in ring.coords] for ring in p.interiors]
        cells |= set(h3.polygon_to_cells(h3.LatLngPoly(outer, *holes), res))
    return sorted(cells)


def population_per_cell(cells, res, bld_wgs, hex_gdf_wgs):
    """WorldPop people per hex if data/worldpop/population.tif exists, else building footprint area (proxy)."""
    if C.WORLDPOP_TIF.exists():
        import rasterio
        with rasterio.open(C.WORLDPOP_TIF) as ds:
            arr = ds.read(1).astype("float64")
            tr, nodata = ds.transform, ds.nodata
        if nodata is not None:
            arr[arr == nodata] = 0
        arr[arr < 0] = 0
        rows, cols = np.nonzero(arr > 0)
        xs, ys = rasterio.transform.xy(tr, rows, cols)          # pixel centres (lon, lat)
        idx = [h3.latlng_to_cell(y, x, res) for x, y in zip(xs, ys)]
        s = pd.Series(arr[rows, cols]).groupby(idx).sum()
        return s.reindex(cells).fillna(0.0), False
    idx = [h3.latlng_to_cell(y, x, res) for x, y in zip(bld_wgs.x, bld_wgs.y)]
    s = pd.Series(bld_wgs.area_m2.to_numpy()).groupby(idx).sum()
    return s.reindex(cells).fillna(0.0), True


def build_hex(res, area_wgs, net: Network, svc_all, svc_tree, bld, to_wgs, wards):
    cells = hex_cells(area_wgs, res)
    lat_lng = [h3.cell_to_latlng(c) for c in cells]
    centres_wgs = gpd.GeoSeries([Point(lng, lat) for lat, lng in lat_lng], crs=4326)
    centres = centres_wgs.to_crs(EPSG)
    cx, cy = centres.x.to_numpy(), centres.y.to_numpy()
    d_net, who, snap = net.nearest(cx, cy)
    d_line, i_line = svc_tree.query(np.column_stack([cx, cy]))
    polys = [Polygon([(lng, lat) for lat, lng in h3.cell_to_boundary(c)]) for c in cells]
    gdf = gpd.GeoDataFrame({"h3": cells, "res": res}, geometry=polys, crs=4326)
    bld_wgs = pd.DataFrame({"x": bld.lon, "y": bld.lat, "area_m2": bld.area_m2})
    pop, proxy = population_per_cell(cells, res, bld_wgs, gdf)
    names = svc_all.set_index("osm_id")["name"]
    gdf["pop"] = pop.to_numpy()
    gdf["pop_is_proxy"] = proxy
    gdf["dist_m"] = d_net
    gdf["snap_m"] = snap
    gdf["straight_m"] = d_line
    gdf["nearest_service"] = who
    gdf["nearest_name"] = [names.get(w) if w else None for w in who]
    gdf["covered_48"] = (gdf.dist_m <= THR).fillna(False)
    gdf["covered_36"] = (gdf.dist_m <= THR_OLD).fillna(False)
    gdf["in_buffer"] = gdf.straight_m <= THR
    gdf["cx"], gdf["cy"] = cx, cy
    if wards is not None:
        j = gpd.sjoin(gpd.GeoDataFrame(geometry=centres.values, crs=EPSG, index=gdf.index), wards[["name", "geometry"]],
                      how="left", predicate="within")
        gdf["ward"] = j["name"].groupby(level=0).first()
    return gdf


def share_beyond(df, flag_col_ok):
    tot = df["pop"].sum()
    return float(100 * df.loc[~df[flag_col_ok], "pop"].sum() / tot) if tot else float("nan")


# ------------------------------------------------------------------ main
def main(write_db=True):
    eng = create_engine(C.DATABASE_URL)
    area_utm, svc, bld, wards = load_db(eng)
    H = load_graph()
    net = Network(H, svc)
    svc_tree = cKDTree(svc[["x", "y"]].to_numpy())
    to_wgs = gpd.GeoSeries([area_utm], crs=EPSG).to_crs(4326)
    area_wgs = to_wgs.iloc[0]

    # building points -> lon/lat for H3 assignment
    bp = gpd.GeoSeries(gpd.points_from_xy(bld.x, bld.y), crs=EPSG).to_crs(4326)
    bld = bld.assign(lon=bp.x.to_numpy(), lat=bp.y.to_numpy())

    results = {"area": C.AREA_NAME, "utm_epsg": EPSG, "threshold_m": THR, "threshold_elderly_m": THR_OLD,
               "services_total_with_margin": int(len(svc)), "services_in_area": int(svc.in_area.sum())}

    # ---- Q6
    results["q6"] = q6(net, area_utm, svc, svc_tree)

    # ---- isochrones and buffers
    print("building isochrones ...")
    iso = make_isochrones(net)
    buffers = gpd.GeoDataFrame({"osm_id": svc.osm_id}, geometry=[Point(x, y).buffer(THR) for x, y in zip(svc.x, svc.y)], crs=EPSG)
    buffers["area_m2"] = buffers.area
    results["union_area_km2"] = {
        "network_isochrones": float(shapely.union_all(iso.geometry).intersection(area_utm).area / 1e6),
        "straight_buffers": float(shapely.union_all(buffers.geometry).intersection(area_utm).area / 1e6),
        "study_area": float(area_utm.area / 1e6)}

    # ---- hexes
    hexes = {}
    for res in C.H3_RESOLUTIONS:
        print(f"H3 resolution {res} ...")
        hexes[res] = build_hex(res, area_wgs, net, svc, svc_tree, bld, to_wgs, wards)

    h9, h8 = hexes[9], hexes[8]
    q7 = {"threshold_m": THR, "population_unit": "people (WorldPop)" if not h9.pop_is_proxy.iloc[0] else "m2 building footprint (PROXY)"}
    q7["by_network_r9_pct_beyond"] = share_beyond(h9, "covered_48")
    h9b = h9.assign(ok=h9.in_buffer)
    q7["by_buffer_r9_pct_beyond"] = share_beyond(h9b, "ok")
    q7["by_network_r8_pct_beyond"] = share_beyond(h8, "covered_48")
    q7["by_buffer_r8_pct_beyond"] = share_beyond(h8.assign(ok=h8.in_buffer), "ok")
    # reference "finest unit": every building point
    bd, _, _ = net.nearest(bld.x.to_numpy(), bld.y.to_numpy())
    ok = np.nan_to_num(bd, nan=np.inf) <= THR
    q7["by_network_buildings_pct_beyond_(finest_unit)"] = float(100 * bld.area_m2[~ok].sum() / bld.area_m2.sum())
    if "ward" in h9:
        w = h9.dropna(subset=["ward"]).copy()
        w["pd"] = w.dist_m.fillna(w.dist_m.max()) * w["pop"]
        g = w.groupby("ward").agg(pop=("pop", "sum"), pd=("pd", "sum"))
        g["mean_dist_m"] = g.pd / g["pop"]
        g["beyond"] = g.mean_dist_m > THR
        g["pct_pop_beyond_cells"] = w.assign(b=w["pop"] * (~w.covered_48)).groupby("ward")["b"].sum() / g["pop"] * 100
        q7["by_ward_pct_beyond"] = float(100 * g.loc[g.beyond, "pop"].sum() / g["pop"].sum())
        g.drop(columns="pd").to_csv(C.OUT / "q7_by_ward.csv")
    else:
        q7["by_ward_pct_beyond"] = "no analysis/area_wards.geojson provided - add it to aggregate by ward"
    worst = h9[h9["pop"] > 0].copy()
    worst["_d"] = worst.dist_m.fillna(np.inf)
    worst = worst.sort_values("_d", ascending=False).iloc[0]
    q7["worst_served_populated_cell_r9"] = {"h3": worst.h3, "pop": float(worst["pop"]),
                                            "dist_m": None if np.isnan(worst.dist_m) else float(worst.dist_m)}
    results["q7"] = q7

    # ---- Q8: 3.6 km/h
    q8 = {"threshold_m_4_8kmh": THR, "threshold_m_3_6kmh": THR_OLD}
    for res, g in hexes.items():
        a, b = share_beyond(g, "covered_48"), share_beyond(g, "covered_36")
        q8[f"r{res}"] = {"pct_beyond_4_8": a, "pct_beyond_3_6": b, "coverage_lost_pp": b - a}
    lost = h9[h9.covered_48 & ~h9.covered_36].sort_values("pop", ascending=False)
    q8["newly_uncovered_cells_r9"] = int(len(lost))
    q8["top_newly_uncovered"] = lost[["h3", "pop", "dist_m", "nearest_name"]].head(10).to_dict("records")
    lost.drop(columns=["cx", "cy"]).to_file(C.OUT / "q8_newly_uncovered_r9.geojson", driver="GeoJSON")
    results["q8"] = q8

    (C.OUT / "results.json").write_text(json.dumps(results, indent=2, default=str))
    print(json.dumps(results, indent=2, default=str))

    # The raw edge-buffer unions carry millions of vertices; writing them exhausted the container's memory.
    # A 5 m tolerance (UTM metres) is far below the 30 m edge buffer and keeps the shape.
    iso["geometry"] = iso.geometry.simplify(5)
    iso["area_m2"] = iso.area

    # keep the expensive results so a failed DB write can be replayed with analysis/03b_write_results.py
    pd.to_pickle({"iso": iso, "buffers": buffers, "hexes": hexes}, C.DATA / "cache" / "phase3.pkl")
    print("saved data/cache/phase3.pkl", flush=True)

    if write_db:
        iso_w = iso.to_crs(4326)
        buf_w = buffers.to_crs(4326)
        for name, g in (("isochrones", iso_w), ("buffers", buf_w)):
            print("writing", name, flush=True)
            g.rename_geometry("geom").to_postgis(name, eng, if_exists="replace", index=False, chunksize=50)
        for res, g in hexes.items():
            g.drop(columns=["cx", "cy"]).rename_geometry("geom").to_postgis(f"hex_r{res}", eng, if_exists="replace", index=False)
        print("written: isochrones, buffers, hex_r8, hex_r9. Next: run sql/05_hex_post.sql")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-db-write", action="store_true")
    main(write_db=not ap.parse_args().no_db_write)
