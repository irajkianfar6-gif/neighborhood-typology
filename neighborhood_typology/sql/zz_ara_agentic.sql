-- ذخیره‌سازی پایدار دادهٔ عملیاتی (PGSYNC-v1). سرور همین جدول‌ها را هنگام راه‌اندازی خودکار می‌سازد (IF NOT EXISTS).
CREATE SCHEMA IF NOT EXISTS ara;
CREATE TABLE IF NOT EXISTS ara.server_files (
  rel_path text PRIMARY KEY, collection text NOT NULL, neighborhood_id text, status text,
  is_json boolean NOT NULL, doc jsonb, bytes bytea NOT NULL, sha256 text NOT NULL, size_bytes integer NOT NULL,
  mtime timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS server_files_collection_idx ON ara.server_files (collection, neighborhood_id);
CREATE INDEX IF NOT EXISTS server_files_status_idx ON ara.server_files (collection, status);
CREATE TABLE IF NOT EXISTS ara.sync_meta (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
-- اختیاری (نیازمند pgvector): پاره‌های حافظهٔ پژوهشی با بردار ۲۵۶ بُعدی
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE TABLE IF NOT EXISTS ara.research_chunks (
    chunk_id text PRIMARY KEY, kind text NOT NULL, ref_id text NOT NULL, page integer NOT NULL, title text NOT NULL, body text NOT NULL,
    embedding vector(256) NOT NULL, embed_version text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
  CREATE INDEX IF NOT EXISTS research_chunks_ref_idx ON ara.research_chunks (ref_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pgvector در دسترس نیست؛ جست‌وجوی برداری درون‌برنامه‌ای می‌ماند';
END $$;
