CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE IF NOT EXISTS facilities (
  id text PRIMARY KEY, name text NOT NULL, category text NOT NULL, subcategory text NOT NULL,
  geom geometry(Point,4326) NOT NULL,
  address text, phone text, website text, opening_hours text, wheelchair text,
  source text NOT NULL DEFAULT 'OpenStreetMap', tags jsonb NOT NULL DEFAULT '{}',
  imported_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ST_X(geom) BETWEEN -180 AND 180 AND ST_Y(geom) BETWEEN -90 AND 90)
);
CREATE INDEX IF NOT EXISTS facilities_geom_idx ON facilities USING gist (geom);
CREATE INDEX IF NOT EXISTS facilities_geography_idx ON facilities USING gist ((geom::geography));
CREATE INDEX IF NOT EXISTS facilities_category_idx ON facilities (category, subcategory);
CREATE TABLE IF NOT EXISTS dataset_imports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  imported_at timestamptz NOT NULL DEFAULT now(), facility_count integer NOT NULL, coverage jsonb NOT NULL
);

