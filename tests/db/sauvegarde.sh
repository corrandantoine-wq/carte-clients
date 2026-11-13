#!/usr/bin/env bash
# Teste la sauvegarde et la restauration (les commandes sont celles du workflow « Sauvegarde quotidienne »).
# Usage : PGHOST=… PGPORT=… PGUSER=postgres bash tests/db/sauvegarde.sh   (après tests/db/run.sh)
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$PWD
H="${PGHOST:-localhost}" P="${PGPORT:-5432}" U="${PGUSER:-postgres}"
url() { if [[ "$H" == /* ]]; then echo "postgresql://$U@/$1?host=$H&port=$P"; else echo "postgresql://$U${PGPASSWORD:+:$PGPASSWORD}@$H:$P/$1"; fi; }
export DB=$(url carte_clients_test) PASS='phrase de test'
R=$(url restauration)
psql "$DB" -qc "create table if not exists auth.identities (id uuid primary key, user_id uuid references auth.users(id))"
psql "$DB" -qc "insert into public.clients (nom, notes) values ('Témoin é à ç', 'note « spéciale »')"
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT; cd "$W"
# Corps de l'étape de sauvegarde, extrait du workflow.
python3 - "$ROOT/.github/workflows/sauvegarde.yml" > step.sh <<'PY'
import re, sys
s = open(sys.argv[1]).read()
body = s.split("- name: Sauvegarder, chiffrer et vérifier")[1].split("run: |\n", 1)[1].split("\n\n")[0]
print(re.sub(r'(?m)^          ', '', body).replace('"$GITHUB_ENV"', '/dev/null'))
PY
bash step.sh
# Sinistre complet : base vide, aucun compte.
psql "$(url postgres)" -qc "drop database if exists restauration" -c "create database restauration"
psql "$R" -q -f "$ROOT/tests/db/stub-auth.sql" 2>/dev/null
psql "$R" -qc "create table auth.identities (id uuid primary key, user_id uuid references auth.users(id))"
printf '%s\n%s\n' "$PASS" RESTAURER | bash "$ROOT/outils/restaurer.sh" sauvegarde-*.tar.gz.gpg "$R"
check() { [ "$2" = "$3" ] || { echo "❌ $1 : attendu $3, obtenu $2"; exit 1; }; echo "ok : $1"; }
for t in clients members crm_fields client_history favorites; do
  check "table $t restaurée" "$(psql "$R" -tAc "select count(*) from public.$t")" "$(psql "$DB" -tAc "select count(*) from public.$t")"
done
check "comptes restaurés" "$(psql "$R" -tAc 'select count(*) from auth.users')" "$(psql "$DB" -tAc 'select count(*) from auth.users')"
check "accents intacts" "$(psql "$R" -tAc "select notes from public.clients where nom = 'Témoin é à ç'")" "note « spéciale »"
check "règles d'accès restaurées" "$(psql "$R" -tAc "select count(*) > 0 from pg_policies where tablename = 'clients'")" "t"
check "temps réel réactivé" "$(psql "$R" -tAc "select count(*) from pg_publication_tables where pubname = 'supabase_realtime'")" "1"
printf 'mauvaise\n' | bash "$ROOT/outils/restaurer.sh" sauvegarde-*.tar.gz.gpg "$R" > /dev/null 2>&1 && { echo "❌ archive déchiffrée avec une mauvaise phrase"; exit 1; }
echo "ok : mauvaise phrase secrète refusée"
echo "✅ Sauvegarde et restauration vérifiées."
