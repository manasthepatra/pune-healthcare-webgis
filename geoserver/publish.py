"""Phase 2: publish workspace, PostGIS store, layers, DEM coverage store and SLD styles via the REST API.

    python geoserver/publish.py        (Compose stack up, tables loaded, data/dem/dem_area.tif present)

Inside the Compose network GeoServer reaches PostGIS at host "db" (service name), NOT localhost.
Safe to re-run: existing objects are updated.
"""
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

GS = os.getenv("GEOSERVER_URL", "http://localhost:8081/geoserver").rstrip("/")
AUTH = (os.getenv("GEOSERVER_ADMIN_USER", "admin"), os.getenv("GEOSERVER_ADMIN_PASSWORD", ""))
WS = "webgis"
STORE = "postgis"
LAYERS = {  # table -> default style
    "study_area": "polygon",
    "services": "services_named",
    "buildings": "polygon",
    "hex_r9": "polygon",
}
JSON = {"Content-Type": "application/json", "Accept": "application/json"}


def call(method, path, **kw):
    r = requests.request(method, f"{GS}/rest{path}", auth=AUTH, timeout=120, **kw)
    return r


def ensure(method_create, path_check, path_create, body, what):
    if call("GET", path_check).status_code == 200:
        print(f"  = {what} exists")
        return
    r = call("POST", path_create, json=body, headers=JSON)
    print(f"  + {what}: HTTP {r.status_code}")
    if r.status_code >= 300:
        sys.exit(r.text)


def upload_style(name, sld_path):
    """Create the style by POSTing the SLD itself (GeoServer rejects a JSON style body), or PUT to update it."""
    xml = Path(sld_path).read_bytes()
    hdr = {"Content-Type": "application/vnd.ogc.sld+xml"}
    if call("GET", f"/workspaces/{WS}/styles/{name}.json").status_code == 200:
        r = call("PUT", f"/workspaces/{WS}/styles/{name}", data=xml, headers=hdr)
    else:
        r = call("POST", f"/workspaces/{WS}/styles?name={name}", data=xml, headers=hdr)
    print(f"  style {name}: HTTP {r.status_code}")
    if r.status_code >= 300:
        sys.exit(r.text)


def tidy_featuretype(table):
    """Hide the UTM helper column and set the bounding boxes from the 4326 geometry.

    The tables also hold a metric copy (geom_utm, EPSG:32643). GeoServer then merges the bounds of BOTH geometry
    columns, so GetCapabilities advertised a bbox mixing degrees and metres. We drop geom_utm from the published
    attributes and write the bbox ourselves (recalculation alone does not fix it).
    """
    base = f"/workspaces/{WS}/datastores/{STORE}/featuretypes/{table}"
    ft = call("GET", base + ".json").json()["featureType"]
    attrs = [a for a in ft["attributes"]["attribute"] if a["name"] != "geom_utm"]
    body = {"featureType": {"attributes": {"attribute": attrs}}}
    try:
        from sqlalchemy import create_engine, text
        with create_engine(os.environ["DATABASE_URL"]).connect() as con:
            x0, y0, x1, y1 = con.execute(text(
                f"SELECT ST_XMin(e), ST_YMin(e), ST_XMax(e), ST_YMax(e) FROM (SELECT ST_Extent(geom) AS e FROM {table}) q")).one()
        box = {"minx": x0, "miny": y0, "maxx": x1, "maxy": y1, "crs": "EPSG:4326"}
        body["featureType"]["nativeBoundingBox"] = box
        body["featureType"]["latLonBoundingBox"] = box
    except Exception as exc:  # DATABASE_URL missing/unreachable: keep going, bbox stays GeoServer's own
        print(f"  (bbox not set for {table}: {exc})")
    r = call("PUT", base + ".json", json=body, headers=JSON)
    print(f"  tidy {table}: HTTP {r.status_code}")


def main():
    print("workspace")
    ensure("POST", f"/workspaces/{WS}.json", "/workspaces", {"workspace": {"name": WS}}, f"workspace {WS}")

    print("PostGIS datastore")
    store = {"dataStore": {
        "name": STORE, "type": "PostGIS", "enabled": True,
        "connectionParameters": {"entry": [
            {"@key": "host", "$": "db"},                       # Compose service name
            {"@key": "port", "$": "5432"},
            {"@key": "database", "$": os.getenv("POSTGRES_DB", "webgis")},
            {"@key": "schema", "$": "public"},
            {"@key": "user", "$": os.getenv("POSTGRES_USER", "webgis")},
            {"@key": "passwd", "$": os.getenv("POSTGRES_PASSWORD", "")},
            {"@key": "dbtype", "$": "postgis"},
            {"@key": "Expose primary keys", "$": "true"},
            {"@key": "Loose bbox", "$": "true"},
            {"@key": "preparedStatements", "$": "true"},
        ]}}}
    ensure("POST", f"/workspaces/{WS}/datastores/{STORE}.json", f"/workspaces/{WS}/datastores", store, f"store {STORE}")

    print("styles")
    for sld in sorted((ROOT / "sld").glob("*.sld")):
        upload_style(sld.stem, sld)

    print("vector layers")
    for table, style in LAYERS.items():
        ensure("POST", f"/workspaces/{WS}/datastores/{STORE}/featuretypes/{table}.json",
               f"/workspaces/{WS}/datastores/{STORE}/featuretypes",
               {"featureType": {"name": table, "nativeName": table, "title": table, "srs": "EPSG:4326",
                                "projectionPolicy": "FORCE_DECLARED"}}, f"layer {table}")
        r = call("PUT", f"/layers/{WS}:{table}", json={"layer": {"defaultStyle": {"name": style, "workspace": WS}}}, headers=JSON)
        print(f"  style {style} -> {table}: HTTP {r.status_code}")
        if table != "hex_r9":
            tidy_featuretype(table)

    print("DEM coverage store (GeoTIFF)")
    # The one-step PUT .../external.geotiff upload is rejected ("Failed to locate the input file") on GeoServer 2.28,
    # so create the store and then the coverage with two plain REST calls. The path is relative to the data dir.
    if call("GET", f"/workspaces/{WS}/coveragestores/dem.json").status_code != 200:
        r = call("POST", f"/workspaces/{WS}/coveragestores", headers=JSON, json={"coverageStore": {
            "name": "dem", "type": "GeoTIFF", "enabled": True, "workspace": WS, "url": "file:data/dem/dem_area.tif"}})
        print(f"  + coverage store dem: HTTP {r.status_code}")
        if r.status_code >= 300:
            sys.exit(r.text)
    if call("GET", f"/workspaces/{WS}/coveragestores/dem/coverages/dem.json").status_code != 200:
        r = call("POST", f"/workspaces/{WS}/coveragestores/dem/coverages", headers=JSON,
                 json={"coverage": {"name": "dem", "nativeName": "dem_area", "title": "dem"}})
        print(f"  + coverage dem: HTTP {r.status_code}")
        if r.status_code >= 300:
            sys.exit(r.text)
    r = call("PUT", f"/layers/{WS}:dem", json={"layer": {"defaultStyle": {"name": "dem_ramp", "workspace": WS}}}, headers=JSON)
    print(f"  style dem_ramp -> dem: HTTP {r.status_code}")

    print(f"\nDone. Try: {GS}/{WS}/wms?service=WMS&request=GetCapabilities&version=1.3.0")


if __name__ == "__main__":
    main()
