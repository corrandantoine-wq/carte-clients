#!/usr/bin/env bash
# Restaure une sauvegarde de Carte Clients dans une base Supabase.
#
# Usage :  bash outils/restaurer.sh sauvegarde-AAAA-MM-JJ.tar.gz.gpg "CHAÎNE_DE_CONNEXION"
#   - Le fichier se télécharge depuis GitHub : onglet Actions → « Sauvegarde quotidienne » → une exécution → Artifacts.
#   - La chaîne de connexion : Supabase → Connect → « Session pooler » (avec le mot de passe de la base).
#   - La phrase secrète (BACKUP_PASSPHRASE) est demandée au lancement.
# Prérequis : PostgreSQL 17 (pg_restore, psql) et gpg.
#
# ⚠️ Les données actuelles de l'appli (schéma public) sont REMPLACÉES par celles de la sauvegarde.
set -euo pipefail
ARCHIVE="${1:?Indiquez le fichier de sauvegarde (.tar.gz.gpg)}"
DB="${2:?Indiquez la chaîne de connexion à la base}"

read -rsp "Phrase secrète de la sauvegarde : " PASS; echo
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
gpg --batch --pinentry-mode loopback --passphrase-fd 3 3<<<"$PASS" -d "$ARCHIVE" 2>/dev/null | tar xzf - -C "$WORK" \
  || { echo "❌ Impossible de déchiffrer : phrase secrète incorrecte ou fichier abîmé."; exit 1; }
DIR=$(find "$WORK" -mindepth 1 -maxdepth 1 -type d | head -1)
echo "Contenu : $(cat "$DIR/resume.txt" 2>/dev/null)"
read -rp "Remplacer les données de l'appli par cette sauvegarde ? Tapez RESTAURER : " OK
[ "$OK" = "RESTAURER" ] || { echo "Annulé."; exit 1; }

# 1. Comptes des collaborateurs : seulement s'ils manquent (projet Supabase recréé).
if [ -f "$DIR/comptes.dump" ] && [ "$(psql "$DB" -tAc 'select count(*) from auth.users')" = "0" ]; then
  echo "→ Restauration des comptes…"
  pg_restore --data-only --no-owner --no-privileges -d "$DB" "$DIR/comptes.dump"
fi
# 2. Données de l'appli (tables, règles d'accès, fonctions, historique).
echo "→ Restauration des données de l'appli…"
pg_restore --clean --if-exists --no-owner --no-privileges -d "$DB" "$DIR/appli.dump" || echo "⚠️ Certains éléments ont signalé une erreur : vérifiez le message ci-dessus."
# 3. Mises à jour en direct (la publication temps réel n'est pas incluse dans la sauvegarde).
psql "$DB" -qc "do \$\$ begin alter publication supabase_realtime add table public.clients; exception when duplicate_object then null; end \$\$;"
echo "✅ Restauration terminée : $(psql "$DB" -tAc 'select count(*) from public.clients') clients."
