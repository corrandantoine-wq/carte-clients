-- Reproduit le strict nécessaire de Supabase (schéma auth, rôles, publication temps réel)
-- pour tester les migrations sur un PostgreSQL ordinaire.
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema if not exists auth;
grant usage on schema auth to authenticated, anon;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
do $$ begin create publication supabase_realtime; exception when duplicate_object then null; end $$;
grant usage on schema public to authenticated, anon;
-- Droits par défaut de Supabase : anon et authenticated reçoivent tout (les règles d'accès filtrent).
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
