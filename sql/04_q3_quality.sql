-- Q3: data quality.
-- (a) share of services with no name tag (in the study area)
SELECT count(*) AS total,
       count(*) FILTER (WHERE name IS NULL) AS unnamed,
       round(100.0 * count(*) FILTER (WHERE name IS NULL) / count(*), 1) AS pct_unnamed
FROM services WHERE in_area;

-- (b) pairs of services within 25 m of each other (each pair counted once)
SELECT count(*) AS pairs_within_25m
FROM services a JOIN services b
  ON a.osm_id < b.osm_id AND ST_DWithin(a.geom_utm, b.geom_utm, 25)
WHERE a.in_area AND b.in_area;

-- (b2) the pairs themselves (for the write-up / for choosing what to verify)
SELECT a.osm_id, a.name, b.osm_id AS other_id, b.name AS other_name,
       round(ST_Distance(a.geom_utm, b.geom_utm)::numeric, 1) AS metres
FROM services a JOIN services b
  ON a.osm_id < b.osm_id AND ST_DWithin(a.geom_utm, b.geom_utm, 25)
WHERE a.in_area AND b.in_area ORDER BY metres;

-- (c) five random services to verify against a second source (site visit / official list / imagery)
SELECT osm_id, name, service_type, ST_Y(geom) AS lat, ST_X(geom) AS lon
FROM services WHERE in_area ORDER BY random() LIMIT 5;
