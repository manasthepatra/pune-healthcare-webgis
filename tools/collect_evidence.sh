#!/usr/bin/env sh
# Re-runs the pre-filled Q1-Q5 queries/requests and stores the RAW output in docs/evidence/ and docs/screenshots/.
# Run from the repo root with the Compose stack up and the layers published:   sh tools/collect_evidence.sh
# (At the viva you can run any block by hand to reproduce a number from ANSWERS.md.)
set -eu
set -a; . ./.env; set +a
PSQL="docker compose exec -T db psql -U $POSTGRES_USER -d $POSTGRES_DB"
GS="http://127.0.0.1:8081/geoserver/webgis"
EV=docs/evidence
SH=docs/screenshots
mkdir -p "$EV" "$SH"

echo "== Q1"; $PSQL -x < sql/02_q1_area.sql > "$EV/q1_area.txt"; cat "$EV/q1_area.txt"

echo "== Q2 (three EXPLAIN ANALYZE runs)"; $PSQL < sql/03_q2_indexes.sql > "$EV/q2_explain.txt" 2>&1
grep -E "Scan|Execution Time" "$EV/q2_explain.txt" | sed 's/^ *//' | cut -c1-110

echo "== Q3"; $PSQL < sql/04_q3_quality.sql > "$EV/q3_quality.txt" 2>&1; head -14 "$EV/q3_quality.txt"

echo "== Q4 capabilities BoundingBox + the two GetMap images"
curl -s "$GS/wms?service=WMS&version=1.3.0&request=GetCapabilities" -o "$EV/q4_capabilities.xml"
python - <<'EOF' | tee docs/evidence/q4_boundingbox.txt
import re
x = open("docs/evidence/q4_capabilities.xml", encoding="utf-8").read()
i = x.index("<Name>services</Name>")
print("services layer, WMS 1.3.0 GetCapabilities:")
print(re.findall(r'<EX_GeographicBoundingBox>.*?</EX_GeographicBoundingBox>', x[i:i+3000], re.S)[0].replace("\n", " "))
print(re.findall(r'<BoundingBox CRS="EPSG:4326"[^>]*>', x[i:i+3000])[0])
EOF
# the four numbers exactly as the 1.3.0 capabilities print them (minx,miny,maxx,maxy = lat,lon,lat,lon for EPSG:4326)
BBOX=$(python -c "
import re
x = open('docs/evidence/q4_capabilities.xml', encoding='utf-8').read()
i = x.index('<Name>services</Name>')
m = re.search(r'<BoundingBox CRS=\"EPSG:4326\" minx=\"([^\"]+)\" miny=\"([^\"]+)\" maxx=\"([^\"]+)\" maxy=\"([^\"]+)\"', x[i:i+3000])
print(','.join(m.groups()))")
echo "BBOX used in both requests: $BBOX"
URL111="$GS/wms?service=WMS&version=1.1.1&request=GetMap&layers=webgis:study_area,webgis:services&styles=&srs=EPSG:4326&bbox=$BBOX&width=700&height=700&format=image/png"
URL130="$GS/wms?service=WMS&version=1.3.0&request=GetMap&layers=webgis:study_area,webgis:services&styles=&crs=EPSG:4326&bbox=$BBOX&width=700&height=700&format=image/png"
printf '%s\n%s\n' "$URL111" "$URL130" > "$EV/q4_urls.txt"
curl -s -o "$SH/q4-wms111.png" -w "1.1.1: %{http_code} %{content_type} %{size_download} B\n" "$URL111"
curl -s -o "$SH/q4-wms130.png" -w "1.3.0: %{http_code} %{content_type} %{size_download} B\n" "$URL130"

echo "== Q5 WFS 2.0 filter, two formats"
F="name_status='named' AND in_area=true"
base() { curl -sG "$GS/ows" --data-urlencode "service=WFS" --data-urlencode "version=2.0.0" --data-urlencode "request=GetFeature" \
  --data-urlencode "typeNames=webgis:services" --data-urlencode "cql_filter=$F" "$@"; }
base --data-urlencode "resultType=hits" | grep -o 'numberMatched="[0-9]*"' | tee "$EV/q5_numberMatched.txt"
base --data-urlencode "outputFormat=gml32" -o "$EV/q5_named_services.gml"
base --data-urlencode "outputFormat=application/json" -o "$EV/q5_named_services.geojson"
python - <<'EOF' | tee docs/evidence/q5_summary.txt
import json, os, re
g = "docs/evidence/q5_named_services.gml"; j = "docs/evidence/q5_named_services.geojson"
print("GML 3.2 : %.1f KB" % (os.path.getsize(g) / 1024))
print("GeoJSON : %.1f KB" % (os.path.getsize(j) / 1024))
x = open(g, encoding="utf-8").read()
print("first GML point    :", re.search(r"<gml:pos[^>]*>([^<]*)</gml:pos>", x).group(0))
d = json.load(open(j, encoding="utf-8"))
print("first GeoJSON point:", d["features"][0]["geometry"]["coordinates"], "| numberMatched =", d.get("numberMatched"), "| features =", len(d["features"]))
EOF
echo "(URLs used are in docs/evidence/q4_urls.txt and, for Q5, the three requests above)"
