-- =====================================================================
-- Carte Clients : double verrou pour les visiteurs non connectés
-- Par défaut, Supabase donne au rôle « anon » (requêtes sans connexion) tous
-- les droits sur les tables ; seules les règles d'accès (RLS) le bloquaient.
-- On lui retire désormais tout : tables, séquences, fonctions, y compris pour
-- les tables créées à l'avenir. Les règles d'accès restent en place (2e verrou).
-- À exécuter après 004_secteurs.sql.
-- =====================================================================

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon, public;
-- Les utilisateurs connectés gardent l'accès aux fonctions utilisées par les règles d'accès.
grant execute on all functions in schema public to authenticated, service_role;

-- Objets créés à l'avenir (par le rôle postgres, celui des migrations).
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon, public;
