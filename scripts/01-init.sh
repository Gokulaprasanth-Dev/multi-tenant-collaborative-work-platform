#!/bin/bash
# Runs inside the postgres container on first init (docker-entrypoint-initdb.d).
# Creates app_db_user with the same password as the superuser (POSTGRES_PASSWORD).
# Table-level grants are handled in migration 014_misc.js.
set -e

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<-EOSQL
  DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_db_user') THEN
      CREATE ROLE app_db_user LOGIN PASSWORD '$POSTGRES_PASSWORD';
    END IF;
  END; \$\$;
  GRANT CONNECT ON DATABASE platform_db TO app_db_user;
  GRANT USAGE ON SCHEMA public TO app_db_user;
EOSQL
