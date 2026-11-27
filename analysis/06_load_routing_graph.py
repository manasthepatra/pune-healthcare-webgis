"""Bonus: load the walking network into PostGIS as a pgRouting topology.

Needs the routing_db compose service (pgrouting/pgrouting image) and the cleaned services table in the main database,
which is copied across (the routing database is separate: the main db image has no pgRouting).
    python analysis/06_load_routing_graph.py

Tables written:
  routing_nodes(id, geom 4326, geom_utm)                      OSM node ids as vertex ids
  routing_edges(id, source, target, cost, reverse_cost, geom, geom_utm)   cost in METRES, undirected
  routing_service_nodes(osm_id, name, node, snap_m)           each service snapped to its nearest network node

The graph is the same OSMnx "walk" network used in Phase 3 (written to data/walk.graphml). Walkers ignore one-way tags,
so every edge is loaded once with cost = reverse_cost = length. Unlike Phase 3 we do NOT keep only the largest
connected component - isolated pieces stay in, so B2 can show what that does.
"""
import sys
from pathlib import Path

import geopandas as gpd
import networkx as nx
import osmnx as ox
import pandas as pd
from shapely.geometry import LineString, Point
from sqlalchemy import create_engine, text

sys.path.insert(0, str(Path(__file__).parent))
import config as C  # noqa: E402


def main():
    G = ox.load_graphml(C.GRAPH_FILE)
    nodes = [(int(n), Point(d["x"], d["y"])) for n, d in G.nodes(data=True)]
    gn = gpd.GeoDataFrame({"id": [n for n, _ in nodes]}, geometry=[p for _, p in nodes], crs=4326)

    best = {}
    for u, v, d in G.edges(data=True):
        a, b = sorted((int(u), int(v)))
        if a == b:
            continue
        length = float(d.get("length", 0.0))
        if (a, b) in best and best[(a, b)][0] <= length:
            continue
        geom = d.get("geometry")
        if geom is None:
            geom = LineString([(G.nodes[u]["x"], G.nodes[u]["y"]), (G.nodes[v]["x"], G.nodes[v]["y"])])
        best[(a, b)] = (length, geom)
    ge = gpd.GeoDataFrame(
        {"id": range(1, len(best) + 1), "source": [k[0] for k in best], "target": [k[1] for k in best],
         "cost": [v[0] for v in best.values()], "reverse_cost": [v[0] for v in best.values()]},
        geometry=[v[1] for v in best.values()], crs=4326)
    print(f"{len(gn)} nodes, {len(ge)} undirected edges, {nx.number_connected_components(G.to_undirected())} components")

    main = create_engine(C.DATABASE_URL)
    svc = gpd.read_postgis("SELECT osm_id, name, service_type, geom FROM services", main, geom_col="geom")
    eng = create_engine(C.ROUTING_DATABASE_URL)
    with eng.begin() as con:
        con.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        con.execute(text("CREATE EXTENSION IF NOT EXISTS pgrouting"))
        for t in ("routing_service_nodes", "routing_edges", "routing_nodes", "services"):
            con.execute(text(f"DROP TABLE IF EXISTS {t} CASCADE"))
    svc.to_postgis("services", eng, if_exists="replace", index=False)
    gn.rename_geometry("geom").to_postgis("routing_nodes", eng, if_exists="replace", index=False)
    ge.rename_geometry("geom").to_postgis("routing_edges", eng, if_exists="replace", index=False)
    with eng.begin() as con:
        con.execute(text(f"ALTER TABLE services ADD COLUMN geom_utm geometry(Point, {C.UTM_EPSG})"))
        con.execute(text(f"UPDATE services SET geom_utm = ST_Transform(geom, {C.UTM_EPSG})"))
        con.execute(text("ALTER TABLE services ADD PRIMARY KEY (osm_id)"))
        con.execute(text(f"ALTER TABLE routing_nodes ADD COLUMN geom_utm geometry(Point, {C.UTM_EPSG})"))
        con.execute(text(f"UPDATE routing_nodes SET geom_utm = ST_Transform(geom, {C.UTM_EPSG})"))
        con.execute(text(f"ALTER TABLE routing_edges ADD COLUMN geom_utm geometry(LineString, {C.UTM_EPSG})"))
        con.execute(text(f"UPDATE routing_edges SET geom_utm = ST_Transform(geom, {C.UTM_EPSG})"))
        con.execute(text("ALTER TABLE routing_nodes ADD PRIMARY KEY (id)"))
        con.execute(text("ALTER TABLE routing_edges ADD PRIMARY KEY (id)"))
        for sql in (
            "CREATE INDEX IF NOT EXISTS routing_nodes_utm_gix ON routing_nodes USING gist (geom_utm)",
            "CREATE INDEX IF NOT EXISTS routing_edges_utm_gix ON routing_edges USING gist (geom_utm)",
            "CREATE INDEX IF NOT EXISTS routing_edges_src ON routing_edges (source)",
            "CREATE INDEX IF NOT EXISTS routing_edges_tgt ON routing_edges (target)",
        ):
            con.execute(text(sql))
        con.execute(text("""
            CREATE TABLE routing_service_nodes AS
            SELECT s.osm_id, s.name, n.id AS node, ST_Distance(s.geom_utm, n.geom_utm) AS snap_m
            FROM services s
            CROSS JOIN LATERAL (SELECT id, geom_utm FROM routing_nodes ORDER BY geom_utm <-> s.geom_utm LIMIT 1) n"""))
        con.execute(text("CREATE INDEX routing_service_nodes_node ON routing_service_nodes (node)"))
        con.execute(text("ANALYZE routing_nodes; ANALYZE routing_edges; ANALYZE routing_service_nodes"))
    with eng.connect() as con:
        print("service nodes:", con.execute(text("SELECT count(*), count(DISTINCT node), round(max(snap_m)::numeric,0) FROM routing_service_nodes")).one())


if __name__ == "__main__":
    main()
