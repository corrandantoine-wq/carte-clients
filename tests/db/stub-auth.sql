-- Reproduit le strict nécessaire de Supabase (schéma auth, rôles, publication temps réel)
-- pour tester les migrations sur un PostgreSQL ordinaire.
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema if not exists auth;
grant usage on schema auth to authenticated, anon;
create table if not exists auth.users (id uuid primary key, email text, email_confirmed_at timestamptz default now(), last_sign_in_at timestamptz);
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
-- Stockage de fichiers (schéma « storage » de Supabase, réduit à l'essentiel).
create schema if not exists storage;
grant usage on schema storage to authenticated, anon;
create table if not exists storage.buckets (id text primary key, name text not null, public boolean default false);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
  name text not null, owner uuid default auth.uid(), created_at timestamptz default now(), unique (bucket_id, name));
alter table storage.objects enable row level security;
grant all on storage.objects to authenticated, anon;
grant select on storage.buckets to authenticated, anon;
