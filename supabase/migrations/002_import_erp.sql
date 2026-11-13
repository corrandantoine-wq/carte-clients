-- =====================================================================
-- Carte Clients : import depuis un ERP
-- - code_client : identifiant du client dans l'ERP. Un ré-import met à jour
--   les clients ayant le même code au lieu de créer des doublons.
-- - set_coords : enregistre en une fois les coordonnées de milliers de clients.
-- À exécuter après 001_init.sql (SQL Editor → New query → Run).
-- =====================================================================

alter table public.clients add column if not exists code_client text;

do $$ begin
  alter table public.clients add constraint clients_code_client_key unique (code_client);
exception when duplicate_object or duplicate_table then null; end $$;

-- Coordonnées en masse : items = [{"id": "...", "lat": 48.8, "lng": 2.3}, ...]
-- « security invoker » : les règles d'accès (RLS) de l'utilisateur s'appliquent.
create or replace function public.set_coords(items jsonb) returns integer
language sql security invoker set search_path = public as $$
  with u as (
    update public.clients c
       set lat = (i ->> 'lat')::double precision,
           lng = (i ->> 'lng')::double precision
      from jsonb_array_elements(items) i
     where c.id = (i ->> 'id')::uuid
    returning 1
  )
  select count(*)::int from u;
$$;
revoke all on function public.set_coords(jsonb) from public, anon;
grant execute on function public.set_coords(jsonb) to authenticated;
