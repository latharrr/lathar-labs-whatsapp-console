#!/usr/bin/env bash
# Restore a pg_dump into a NEW scratch database and check it. Never touches the working database.
# Usage: scripts/restore-check.sh <dump file> <new database name> [source database to compare counts with]
set -euo pipefail
cd "$(dirname "$0")/.."
DUMP=${1:?dump file}; TARGET=${2:?new database name}; SOURCE=${3:-}
case "$TARGET" in ll_dashboard|ll_dashboard_test|postgres|template0|template1) echo "refusing: $TARGET is not a scratch database" >&2; exit 2;; esac
psql() { docker compose exec -T postgres psql -U ll -v ON_ERROR_STOP=1 "$@"; }
if [ -n "$(psql -d postgres -Atc "select 1 from pg_database where datname = '$TARGET'")" ]; then
  echo "refusing: $TARGET already exists (pick a new name; nothing is dropped by this script)" >&2; exit 2
fi
docker compose exec -T postgres createdb -U ll "$TARGET"
docker compose exec -T postgres pg_restore -U ll -d "$TARGET" --no-owner --exit-on-error < "$DUMP"
echo "restored $DUMP into $TARGET"
counts() { psql -d "$1" -Atc "select string_agg(format('%s=%s', t, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I', t), false, true, '')))[1]::text), ' ' order by t) from (select tablename t from pg_tables where schemaname = 'public') x"; }
echo "rows in $TARGET: $(counts "$TARGET")"
if [ -n "$SOURCE" ]; then
  if [ "$(counts "$SOURCE")" = "$(counts "$TARGET")" ]; then echo "row counts match $SOURCE"; else echo "ROW COUNTS DIFFER from $SOURCE" >&2; exit 1; fi
fi
echo "migrations recorded: $(psql -d "$TARGET" -Atc "select count(*) from _prisma_migrations where finished_at is not null") (latest: $(psql -d "$TARGET" -Atc "select migration_name from _prisma_migrations order by finished_at desc limit 1"))"
