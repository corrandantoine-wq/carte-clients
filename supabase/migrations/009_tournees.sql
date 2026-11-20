-- =====================================================================
-- Carte Clients : tournées
-- - « modele » : tournée enregistrée pour être réutilisée (ex. « Tournée du mardi »).
-- - « faite » : tournée terminée (historique : étapes faites, km et temps prévus).
-- Chaque commercial voit et gère ses propres tournées ; un administrateur voit
-- celles de toute l'équipe (lecture seule).
-- La tournée en cours de préparation reste sur le téléphone jusqu'à son enregistrement.
-- À exécuter après 008_comptes_rendus.sql.
-- =====================================================================

create table if not exists public.tournees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  user_email text not null default lower(auth.jwt() ->> 'email'),
  nom text not null check (length(nom) between 1 and 80),
  genre text not null default 'modele' check (genre in ('modele', 'faite')),
  etapes uuid[] not null default '{}' check (cardinality(etapes) <= 25),   -- clients, dans l'ordre de visite
  faites uuid[] not null default '{}',                                    -- clients effectivement visités
  distance_km numeric(7, 1),
  duree_min integer,
  debut timestamptz,
  fin timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tournees_user_idx on public.tournees (user_id, genre, updated_at desc);

create or replace function public.guard_tournee() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
    new.user_email := lower(auth.jwt() ->> 'email');
  else
    new.user_id := old.user_id;
    new.user_email := old.user_email;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists tournees_guard on public.tournees;
create trigger tournees_guard before insert or update on public.tournees
  for each row execute function public.guard_tournee();

alter table public.tournees enable row level security;
drop policy if exists "tournees : lecture" on public.tournees;
create policy "tournees : lecture" on public.tournees for select to authenticated
  using (public.is_member() and (user_id = auth.uid() or public.is_admin()));
drop policy if exists "tournees : ajout" on public.tournees;
create policy "tournees : ajout" on public.tournees for insert to authenticated
  with check (public.is_member() and user_id = auth.uid());
drop policy if exists "tournees : modification" on public.tournees;
create policy "tournees : modification" on public.tournees for update to authenticated
  using (public.is_member() and user_id = auth.uid());
drop policy if exists "tournees : suppression" on public.tournees;
create policy "tournees : suppression" on public.tournees for delete to authenticated
  using (public.is_member() and user_id = auth.uid());
revoke all on public.tournees from anon;
