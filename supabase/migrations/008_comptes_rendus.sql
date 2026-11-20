-- =====================================================================
-- Carte Clients : comptes rendus de visite et enregistrements des rendez-vous
-- - Table « visites » : un compte rendu par visite ou appel (résultat, notes,
--   relance), lisible par toute l'équipe ; modifiable par son auteur ou un admin.
-- - Rendez-vous HubSpot : chaque compte rendu peut être rattaché au rendez-vous
--   planifié dans HubSpot (hubspot_meeting_id). La fonction « rdv » y écrit le
--   compte rendu et y joint l'enregistrement audio.
-- - Enregistrement audio : déposé d'abord dans le stockage privé
--   « enregistrements », puis transféré dans HubSpot (fichier privé, supprimé
--   automatiquement après 6 mois) et effacé du stockage.
-- - Consentement : l'heure à laquelle le commercial a confirmé l'accord du
--   client est conservée (audio_consentement), obligatoire pour un enregistrement.
-- À exécuter après 007_etat_compte.sql.
-- =====================================================================

create table if not exists public.visites (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  user_email text not null default lower(auth.jwt() ->> 'email'),
  at timestamptz not null default now(),
  type text not null default 'visite' check (type in ('visite', 'appel')),
  resultat text check (resultat in ('commande', 'devis', 'relance', 'absent')),
  notes text not null default '',
  relance_le date,
  hubspot_meeting_id text check (hubspot_meeting_id ~ '^\d+$'),
  audio_path text,                    -- en attente de transfert vers HubSpot
  audio_duree integer check (audio_duree >= 0),
  audio_consentement timestamptz,     -- accord du client confirmé par le commercial
  hubspot_file_id text,
  hubspot_statut text not null default 'aucun' check (hubspot_statut in ('aucun', 'en_attente', 'envoye', 'erreur')),
  hubspot_erreur text,
  constraint visites_audio_consentement check (audio_path is null and hubspot_file_id is null or audio_consentement is not null)
);
create index if not exists visites_client_idx on public.visites (client_id, at desc);
create index if not exists visites_user_idx on public.visites (user_id, at desc);

-- L'auteur et la date de création ne peuvent pas être falsifiés.
create or replace function public.guard_visite() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
    new.user_email := lower(auth.jwt() ->> 'email');
  else
    new.user_id := old.user_id;
    new.user_email := old.user_email;
    new.client_id := old.client_id;
    new.audio_consentement := coalesce(old.audio_consentement, new.audio_consentement);
  end if;
  return new;
end $$;
drop trigger if exists visites_guard on public.visites;
create trigger visites_guard before insert or update on public.visites
  for each row execute function public.guard_visite();

alter table public.visites enable row level security;
drop policy if exists "visites : lecture équipe" on public.visites;
create policy "visites : lecture équipe" on public.visites for select to authenticated using (public.is_member());
drop policy if exists "visites : ajout" on public.visites;
create policy "visites : ajout" on public.visites for insert to authenticated
  with check (public.is_member() and user_id = auth.uid());
drop policy if exists "visites : modification auteur ou admin" on public.visites;
create policy "visites : modification auteur ou admin" on public.visites for update to authenticated
  using (public.is_member() and (user_id = auth.uid() or public.is_admin()));
drop policy if exists "visites : suppression auteur ou admin" on public.visites;
create policy "visites : suppression auteur ou admin" on public.visites for delete to authenticated
  using (public.is_member() and (user_id = auth.uid() or public.is_admin()));
revoke all on public.visites from anon;

-- Dernière visite de chaque client (badge « vu il y a … » et filtre « à revoir »).
create or replace view public.dernieres_visites with (security_invoker = true) as
  select client_id, max(at) as at from public.visites group by client_id;
revoke all on public.dernieres_visites from anon;
grant select on public.dernieres_visites to authenticated;

-- ---------- Stockage temporaire des enregistrements ----------
-- Les fichiers ne restent ici que le temps de leur transfert vers HubSpot.
insert into storage.buckets (id, name, public)
  values ('enregistrements', 'enregistrements', false)
  on conflict (id) do update set public = false;

-- Nom du fichier : <id de la visite>.<extension>. On ne peut déposer que l'audio
-- d'un compte rendu dont on est l'auteur et pour lequel le client a donné son accord.
create or replace function public.visite_audio_ok(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.visites v
     where v.id::text = split_part(path, '.', 1)
       and v.user_id = auth.uid()
       and v.audio_consentement is not null
  ) and public.is_member();
$$;
revoke all on function public.visite_audio_ok(text) from anon, public;
grant execute on function public.visite_audio_ok(text) to authenticated;

drop policy if exists "enregistrements : dépôt par l'auteur" on storage.objects;
create policy "enregistrements : dépôt par l'auteur" on storage.objects for insert to authenticated
  with check (bucket_id = 'enregistrements' and public.visite_audio_ok(name));
drop policy if exists "enregistrements : remplacement par l'auteur" on storage.objects;
create policy "enregistrements : remplacement par l'auteur" on storage.objects for update to authenticated
  using (bucket_id = 'enregistrements' and public.visite_audio_ok(name));
drop policy if exists "enregistrements : lecture équipe" on storage.objects;
create policy "enregistrements : lecture équipe" on storage.objects for select to authenticated
  using (bucket_id = 'enregistrements' and public.is_member());
drop policy if exists "enregistrements : suppression auteur ou admin" on storage.objects;
create policy "enregistrements : suppression auteur ou admin" on storage.objects for delete to authenticated
  using (bucket_id = 'enregistrements' and (public.visite_audio_ok(name) or public.is_admin()));
