-- =====================================================================
-- Carte Clients : corbeille et historique des modifications
-- - Corbeille : « supprimer » un client le met à la corbeille (deleted_at).
--   Tout collaborateur peut le restaurer ; seul un admin peut le supprimer
--   définitivement.
-- - Historique : chaque création, modification, mise à la corbeille et
--   restauration est enregistrée automatiquement (qui, quand, quoi).
-- À exécuter après 002_import_erp.sql.
-- =====================================================================

-- ---------- Corbeille ----------
alter table public.clients add column if not exists deleted_at timestamptz;
alter table public.clients add column if not exists deleted_by uuid references auth.users (id) on delete set null;
create index if not exists clients_deleted_idx on public.clients (deleted_at);

-- Mettre à la corbeille : réservé à l'auteur de la fiche ou à un admin. Restaurer : tout collaborateur.
create or replace function public.guard_trash() returns trigger language plpgsql as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    if not (old.created_by is not distinct from auth.uid() or public.is_admin()) then
      raise exception 'Seul l''auteur de la fiche ou un administrateur peut la supprimer.' using errcode = '42501';
    end if;
    new.deleted_by := auth.uid();
  elsif new.deleted_at is null then
    new.deleted_by := null;
  end if;
  return new;
end $$;
drop trigger if exists clients_guard_trash on public.clients;
create trigger clients_guard_trash before update on public.clients
  for each row execute function public.guard_trash();

-- La suppression définitive est désormais réservée aux administrateurs.
drop policy if exists clients_delete on public.clients;
create policy clients_delete on public.clients for delete to authenticated using (public.is_admin());

-- ---------- Historique ----------
create table if not exists public.client_history (
  id         bigint generated always as identity primary key,
  client_id  uuid not null,              -- pas de clé étrangère : l'historique survit à la suppression définitive
  client_nom text not null,
  action     text not null check (action in ('création', 'modification', 'suppression', 'restauration', 'suppression définitive')),
  changes    jsonb not null default '{}',  -- { "champ": [ancienne valeur, nouvelle valeur] }
  user_id    uuid,
  user_email text,
  at         timestamptz not null default now()
);
create index if not exists client_history_client_idx on public.client_history (client_id, at desc);

alter table public.client_history enable row level security;
drop policy if exists client_history_read on public.client_history;
create policy client_history_read on public.client_history for select to authenticated using (public.is_member());
-- Aucune politique d'écriture : seul le déclencheur ci-dessous écrit dans l'historique.

create or replace function public.log_client_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  changes jsonb := '{}';
  k text;
  act text;
  rec public.clients;
begin
  if tg_op = 'INSERT' then
    act := 'création'; rec := new;
  elsif tg_op = 'DELETE' then
    act := 'suppression définitive'; rec := old;
  else
    rec := new;
    foreach k in array array['nom', 'code_client', 'adresse', 'code_postal', 'ville', 'telephone', 'email', 'notes', 'hubspot_id'] loop
      if (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k) then
        changes := changes || jsonb_build_object(k, jsonb_build_array(to_jsonb(old) -> k, to_jsonb(new) -> k));
      end if;
    end loop;
    if old.deleted_at is null and new.deleted_at is not null then act := 'suppression';
    elsif old.deleted_at is not null and new.deleted_at is null then act := 'restauration';
    elsif changes <> '{}' then act := 'modification';
    else return null; -- ex. seules les coordonnées GPS ont changé : rien à journaliser
    end if;
  end if;
  insert into public.client_history (client_id, client_nom, action, changes, user_id, user_email)
  values (rec.id, rec.nom, act, changes, auth.uid(), auth.jwt() ->> 'email');
  return null;
end $$;
drop trigger if exists clients_log on public.clients;
create trigger clients_log after insert or update or delete on public.clients
  for each row execute function public.log_client_change();
