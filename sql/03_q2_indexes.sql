-- Q2: buildings within 500 m of each service point (UTM geometry).
-- Run each block in psql / DBeaver and copy the plan + "Execution Time" into ANSWERS.md.

-- (a) NO GiST index on geom_utm
DROP INDEX IF EXISTS buildings_geom_utm_gix;
ANALYZE buildings;
EXPLAIN (ANALYZE, BUFFERS)
SELECT s.osm_id, count(b.osm_id) AS buildings_500m
FROM services s
JOIN buildings b ON ST_DWithin(s.geom_utm, b.geom_utm, 500)
WHERE s.in_area
GROUP BY s.osm_id;

-- (b) WITH a GiST index
CREATE INDEX buildings_geom_utm_gix ON buildings USING gist (geom_utm);
ANALYZE buildings;
EXPLAIN (ANALYZE, BUFFERS)
SELECT s.osm_id, count(b.osm_id) AS buildings_500m
FROM services s
JOIN buildings b ON ST_DWithin(s.geom_utm, b.geom_utm, 500)
WHERE s.in_area
GROUP BY s.osm_id;

-- (c) index present, but the filter rewritten as ST_Distance(a,b) < 500 (not index-assisted)
EXPLAIN (ANALYZE, BUFFERS)
SELECT s.osm_id, count(b.osm_id) AS buildings_500m
FROM services s
JOIN buildings b ON ST_Distance(s.geom_utm, b.geom_utm) < 500
WHERE s.in_area
GROUP BY s.osm_id;
