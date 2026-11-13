#!/usr/bin/env bash
# Rejoue les migrations sur une base PostgreSQL vierge, puis les tests de sécurité.
# Usage : PGHOST=… PGPORT=… PGUSER=postgres bash tests/db/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=carte_clients_test
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { PGOPTIONS="--client-min-messages=warning" psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$1"; }
run tests/db/stub-auth.sql
for f in supabase/migrations/*.sql; do echo "→ migration $f"; run "$f"; run "$f"; done  # chaque migration doit pouvoir être rejouée

run tests/db/rls.test.sql 2>&1 | sed "s/^psql:[^ ]* NOTICE:  /  /"
