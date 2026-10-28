#!/usr/bin/env bash
# Rebuilds a throw-away database, applies migrations, runs the RLS/business-rule tests.
set -euo pipefail
pg_lsclusters -h 2>/dev/null | grep -q online || { service postgresql start; sleep 3; }
cd "$(dirname "$0")"
DB=sxi_test
PSQL="psql -X -q -v ON_ERROR_STOP=1"
su postgres -c "psql -X -q -c 'drop database if exists $DB' -c 'create database $DB'" >/dev/null
# roles are cluster-wide; ignore "already exists"
su postgres -c "$PSQL -d $DB -f $PWD/tests/00_supabase_stub.sql" 2>&1 
for f in migrations/*.sql; do echo "== applying $f"; su postgres -c "$PSQL -d $DB -f $PWD/$f"; done
echo "== running tests"
su postgres -c "$PSQL -d $DB -f $PWD/tests/rls_tests.sql"
