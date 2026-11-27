-- Q3: data quality (study area only).  services_raw = points before near-duplicate merging,
-- services = cleaned table (analysis/01_acquire_and_load.py merges same-name points within 25 m).

-- (a) share of services with no name tag
SELECT 'before merge' AS stage, count(*) AS total,
       count(*) FILTER (WHERE name IS NULL) AS unnamed,
       round((100.0 * count(*) FILTER (WHERE name IS NULL) / count(*))::numeric, 1) AS pct_unnamed
FROM services_raw WHERE in_area
UNION ALL
SELECT 'after merge', count(*), count(*) FILTER (WHERE name IS NULL),
       round((100.0 * count(*) FILTER (WHERE name IS NULL) / count(*))::numeric, 1)
FROM services WHERE in_area;

-- (b) pairs of services within 25 m of each other (each pair counted once)
SELECT 'before merge' AS stage, count(*) AS pairs_within_25m
FROM services_raw a JOIN services_raw b ON a.osm_id < b.osm_id AND ST_DWithin(a.geom_utm, b.geom_utm, 25)
WHERE a.in_area AND b.in_area
UNION ALL
SELECT 'after merge', count(*)
FROM services a JOIN services b ON a.osm_id < b.osm_id AND ST_DWithin(a.geom_utm, b.geom_utm, 25)
WHERE a.in_area AND b.in_area;

-- (b2) what is still within 25 m after cleaning (distinct facilities that share a building)
SELECT a.osm_id, a.name, b.osm_id AS other_id, b.name AS other_name,
       round(ST_Distance(a.geom_utm, b.geom_utm)::numeric, 1) AS metres
FROM services a JOIN services b ON a.osm_id < b.osm_id AND ST_DWithin(a.geom_utm, b.geom_utm, 25)
WHERE a.in_area AND b.in_area ORDER BY metres;

-- (c) five random services to verify against a second source (site visit / official list / street imagery)
SELECT osm_id, name, service_type, round(ST_Y(geom)::numeric, 6) AS lat, round(ST_X(geom)::numeric, 6) AS lon
FROM services WHERE in_area ORDER BY random() LIMIT 5;
