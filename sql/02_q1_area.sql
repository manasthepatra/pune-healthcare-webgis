-- Q1: one area, four areas.  ST_Area on 4326 -> square DEGREES; geography -> m2;
-- UTM -> m2 (accurate); 3857 -> "Web Mercator m2" (inflated by 1/cos^2(lat)).
WITH a AS (SELECT ST_Union(geom) AS g FROM study_area)
SELECT
  ST_Area(g)                                  AS area_4326_deg2,
  ST_Area(g::geography)                       AS area_geography_m2,
  ST_Area(ST_Transform(g, 32643))             AS area_utm32643_m2,
  ST_Area(ST_Transform(g, 3857))              AS area_3857_m2,
  ST_Area(ST_Transform(g, 3857)) / ST_Area(ST_Transform(g, 32643)) AS ratio_3857_over_utm,
  1 / cos(radians(ST_Y(ST_Centroid(g))))^2    AS inv_cos2_lat,   -- compare with the ratio
  1 / cos(radians(ST_Y(ST_Centroid(g))))      AS inv_cos_lat,
  ST_Y(ST_Centroid(g))                        AS centre_lat
FROM a;
