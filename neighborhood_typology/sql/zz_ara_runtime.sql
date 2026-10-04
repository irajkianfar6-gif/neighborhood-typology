-- ARA-NB-2.0 runtime schema (تحلیل فقط با نام محله)
-- در docker-compose (profile postgis) به‌صورت خودکار پس از schema.sql اجرا می‌شود.
-- جدول‌ها append-only طراحی شده‌اند: هیچ ردیف شواهد/کارت به‌روزرسانی نمی‌شود؛ نسخهٔ جدید درج می‌شود.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS ara;

CREATE TABLE IF NOT EXISTS ara.neighborhoods (
  neighborhood_id text PRIMARY KEY,          -- مثل tehran:m605
  name_fa text NOT NULL, name_en text, city_fa text NOT NULL, city_slug text NOT NULL,
  district_fa text, province_fa text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ara.boundary_versions (
  neighborhood_id text NOT NULL REFERENCES ara.neighborhoods(neighborhood_id),
  boundary_hash text NOT NULL, version text NOT NULL, tier text NOT NULL CHECK (tier IN ('official','osm_admin','derived')),
  is_proxy boolean NOT NULL, source text NOT NULL, area_km2 numeric,
  geom geometry(MultiPolygon, 4326), registered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (neighborhood_id, boundary_hash)
);
CREATE INDEX IF NOT EXISTS boundary_versions_geom_idx ON ara.boundary_versions USING gist (geom);

CREATE TABLE IF NOT EXISTS ara.context_snapshots (
  snapshot_id bigserial PRIMARY KEY, neighborhood_id text NOT NULL REFERENCES ara.neighborhoods(neighborhood_id),
  population numeric, population_source text, population_year int, population_tier text,
  area_km2 numeric, grid_cells int, grid_weighting text, taken_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ara.decision_runs (
  run_id text PRIMARY KEY, neighborhood_id text NOT NULL REFERENCES ara.neighborhoods(neighborhood_id),
  publication_level text NOT NULL CHECK (publication_level IN ('PUBLISHABLE','PROVISIONAL','EXPLORATORY','INSUFFICIENT')),
  fingerprint text NOT NULL, reproducibility_key jsonb NOT NULL, engine_run_id text,
  requested_by text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS decision_runs_nb_idx ON ara.decision_runs (neighborhood_id, created_at DESC);
CREATE TABLE IF NOT EXISTS ara.documented_values (
  run_id text NOT NULL REFERENCES ara.decision_runs(run_id), code text NOT NULL,
  raw numeric, unit text, score numeric, percentile numeric, reliability numeric NOT NULL,
  tier text NOT NULL, channel text NOT NULL, geography_level text NOT NULL, source text NOT NULL,
  observed_at date, method text, scoring_method text, conflict boolean NOT NULL DEFAULT false, missing_reason text,
  PRIMARY KEY (run_id, code),
  CHECK (score IS NULL OR geography_level IN ('block','neighborhood','district'))   -- مقدار ملی/استانی هرگز امتیاز محله نمی‌گیرد
);
CREATE TABLE IF NOT EXISTS ara.cards (
  run_id text PRIMARY KEY REFERENCES ara.decision_runs(run_id), card jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ara.ingestion_batches (
  batch_id text PRIMARY KEY, template text NOT NULL, status text NOT NULL, uploaded_by text, reviewed_by text,
  row_count int NOT NULL, issue_count int NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz
);
CREATE TABLE IF NOT EXISTS ara.survey_responses (
  response_id text PRIMARY KEY, neighborhood_id text NOT NULL REFERENCES ara.neighborhoods(neighborhood_id),
  accepted boolean NOT NULL, qc_reasons text[], answers jsonb NOT NULL, demographics jsonb NOT NULL,
  device_hash text, collected_at timestamptz, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ara.reference_distributions (
  version text PRIMARY KEY, city_slug text NOT NULL, neighborhoods int NOT NULL, payload jsonb NOT NULL, built_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS ara.audit_log (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), role text, token_fp text, method text, path text, status int, ip text, correlation_id text
);
-- جلوگیری از ویرایش/حذف شواهد و کارت‌ها (append-only)
CREATE OR REPLACE FUNCTION ara.forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append-only table %', TG_TABLE_NAME; END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'documented_values_append_only') THEN
    CREATE TRIGGER documented_values_append_only BEFORE UPDATE OR DELETE ON ara.documented_values FOR EACH ROW EXECUTE FUNCTION ara.forbid_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cards_append_only') THEN
    CREATE TRIGGER cards_append_only BEFORE UPDATE OR DELETE ON ara.cards FOR EACH ROW EXECUTE FUNCTION ara.forbid_mutation();
  END IF;
END $$;
