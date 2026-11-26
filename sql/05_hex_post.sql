-- Run after analysis/03_access_analysis.py has written hex_r8 / hex_r9 / isochrones / buffers.
-- Indexes for tile serving + helper views.
CREATE INDEX IF NOT EXISTS hex_r8_geom_gix ON hex_r8 USING gist (geom);
CREATE INDEX IF NOT EXISTS hex_r9_geom_gix ON hex_r9 USING gist (geom);
CREATE INDEX IF NOT EXISTS iso_geom_gix    ON isochrones USING gist (geom);
CREATE INDEX IF NOT EXISTS buf_geom_gix    ON buffers USING gist (geom);
ANALYZE hex_r8; ANALYZE hex_r9;

-- Q7 helper: population beyond threshold, by H3 resolution (network distance).
-- :thr is 1200 (urban 15 min) or 2400 (taluka 30 min); 900 = elderly 3.6 km/h x 15 min.
SELECT 'r8' AS unit, sum(pop) AS pop_total,
       sum(pop) FILTER (WHERE dist_m IS NULL OR dist_m > 1200) AS pop_beyond,
       round((100 * sum(pop) FILTER (WHERE dist_m IS NULL OR dist_m > 1200) / sum(pop))::numeric, 1) AS pct_beyond
FROM hex_r8
UNION ALL
SELECT 'r9', sum(pop),
       sum(pop) FILTER (WHERE dist_m IS NULL OR dist_m > 1200),
       round((100 * sum(pop) FILTER (WHERE dist_m IS NULL OR dist_m > 1200) / sum(pop))::numeric, 1)
FROM hex_r9;

-- Q7: worst-served populated cell (res 9)
SELECT h3, pop, dist_m, nearest_service FROM hex_r9
WHERE pop > 0 ORDER BY dist_m DESC NULLS FIRST LIMIT 5;
