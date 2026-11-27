-- Apply after webavr-schema-v1.sql in an isolated trial database only.
-- Scene-level explore cards exist in the legacy snapshot. Do not invent hotspots.
BEGIN;
ALTER TABLE webavr.activities ALTER COLUMN hotspot_id DROP NOT NULL;
ALTER TABLE webavr.activities ADD COLUMN scene_id uuid
  REFERENCES webavr.scenes(id) ON DELETE RESTRICT;
ALTER TABLE webavr.activities ADD CONSTRAINT activity_exactly_one_anchor CHECK (
  (hotspot_id IS NOT NULL AND scene_id IS NULL) OR
  (hotspot_id IS NULL AND scene_id IS NOT NULL AND kind='explore')
);
INSERT INTO webavr.schema_versions(version) VALUES ('v1.1-trial-scene-activities');
COMMIT;
