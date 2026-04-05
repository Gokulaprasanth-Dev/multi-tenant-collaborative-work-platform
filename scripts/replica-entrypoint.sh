#!/bin/bash
set -e
PRIMARY_HOST="${PRIMARY_HOST:-postgres}"
PRIMARY_PORT="${PRIMARY_PORT:-5432}"
PRIMARY_USER="${POSTGRES_USER:-app_user}"
PRIMARY_PASSWORD="${POSTGRES_PASSWORD}"
PGDATA="${PGDATA:-/var/lib/postgresql/data}"

echo "Waiting for primary at $PRIMARY_HOST:$PRIMARY_PORT..."
until pg_isready -h "$PRIMARY_HOST" -p "$PRIMARY_PORT" -U "$PRIMARY_USER"; do
  sleep 2
done
echo "Primary ready."

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "Initializing replica..."
  PGPASSWORD="$PRIMARY_PASSWORD" pg_basebackup \
    -h "$PRIMARY_HOST" -p "$PRIMARY_PORT" -U "$PRIMARY_USER" \
    -D "$PGDATA" -Fp -Xs -R -P
  if [ ! -f "$PGDATA/standby.signal" ]; then
    echo "ERROR: standby.signal not created. PostgreSQL must be 12+."
    exit 1
  fi
  echo "Replica init complete."
else
  echo "Data directory exists. Starting replica."
fi

# CRITICAL: exec postgres directly — NOT docker-entrypoint.sh
# docker-entrypoint.sh would re-run initdb.d scripts causing double-start
exec postgres -D "$PGDATA"
