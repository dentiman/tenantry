-- AI-2a: run as the container administrator on a fresh volume.
-- db:roles repeats this for existing databases, reset, and e2e.
SELECT current_database() AS app_database \gset
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public VERSION '0.8.6';
-- Automatic Prisma shadow databases inherit this preinstalled extension.
\connect template1
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public VERSION '0.8.6';
\connect :app_database
