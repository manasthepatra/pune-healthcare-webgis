-- Runs once, on first creation of the database volume (mounted into docker-entrypoint-initdb.d).
CREATE EXTENSION IF NOT EXISTS postgis;
