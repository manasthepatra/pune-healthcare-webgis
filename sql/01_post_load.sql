-- Run AFTER analysis/01_acquire_and_load.py has loaded study_area, services and buildings
-- (EPSG:4326, column "geom"). Adds the metric UTM copy and the indexes used by the web layers.
-- Pune (lon ~73.85 E) is in UTM zone 43N -> EPSG:32643. Change 32643 everywhere if your area differs.

ALTER TABLE study_area ADD COLUMN IF NOT EXISTS geom_utm geometry(Geometry, 32643);
UPDATE study_area SET geom_utm = ST_Transform(geom, 32643);

ALTER TABLE services ADD COLUMN IF NOT EXISTS geom_utm geometry(Point, 32643);
UPDATE services SET geom_utm = ST_Transform(geom, 32643);

ALTER TABLE buildings ADD COLUMN IF NOT EXISTS geom_utm geometry(Geometry, 32643);
UPDATE buildings SET geom_utm = ST_Transform(geom, 32643);
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS area_m2 double precision;
UPDATE buildings SET area_m2 = ST_Area(geom_utm);

-- Indexes on the 4326 geometry (tile / WMS / WFS bounding-box queries).
-- NOTE: the GiST index on geom_utm is deliberately NOT created here; Q2 creates it by hand
-- so that EXPLAIN ANALYZE can be compared without and with the index.
CREATE INDEX IF NOT EXISTS services_geom_gix  ON services  USING gist (geom);
CREATE INDEX IF NOT EXISTS buildings_geom_gix ON buildings USING gist (geom);
CREATE INDEX IF NOT EXISTS area_geom_gix      ON study_area USING gist (geom);
ALTER TABLE services ADD PRIMARY KEY (osm_id);
ALTER TABLE buildings ADD PRIMARY KEY (osm_id);

ANALYZE;
