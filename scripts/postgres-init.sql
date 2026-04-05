DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_db_user') THEN
    CREATE ROLE app_db_user LOGIN PASSWORD :'POSTGRES_PASSWORD';
  END IF;
END; $$;
GRANT CONNECT ON DATABASE platform_db TO app_db_user;
GRANT USAGE ON SCHEMA public TO app_db_user;
-- Table grants are in migration 014_misc.js
