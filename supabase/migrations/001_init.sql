-- =====================================================================
-- Carte Clients : schéma de la base partagée (Supabase / PostgreSQL)
-- À exécuter une fois dans Supabase : SQL Editor → New query → Run.
-- =====================================================================

-- ---------- Collaborateurs autorisés ----------
-- Seules les adresses e-mail présentes ici peuvent voir et modifier la base.
create table if not exists public.members (
  email      text primary key check (email = lower(email)),
  role       text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

-- L'utilisateur connecté est-il un collaborateur autorisé ?
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where email = lower(auth.jwt() ->> 'email'));
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where email = lower(auth.jwt() ->> 'email') and role = 'admin');
$$;

-- ---------- Base clients commune ----------
create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null,
  adresse     text not null default '',
  code_postal text not null default '',
  ville       text not null default '',
  telephone   text not null default '',
  email       text not null default '',
  notes       text not null default '',
  lat         double precision,
  lng         double precision,
  hubspot_id  text,                                   -- lien vers la fiche HubSpot
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists clients_hubspot_idx on public.clients (hubspot_id);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists clients_touch on public.clients;
create trigger clients_touch before update on public.clients
  for each row execute function public.touch_updated_at();

-- ---------- Favoris (propres à chaque collaborateur) ----------
create table if not exists public.favorites (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id  uuid not null references public.clients (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, client_id)
);

-- ---------- Champs HubSpot affichés dans l'appli ----------
-- Liste modifiable par un administrateur depuis l'appli (menu → Champs CRM).
create table if not exists public.crm_fields (
  property text primary key,
  label    text not null,
  position int  not null default 0
);
insert into public.crm_fields (property, label, position) values
  ('name', 'Nom dans le CRM', 1),
  ('lifecyclestage', 'Étape du cycle de vie', 2),
  ('notes_last_contacted', 'Dernier contact', 3)
on conflict do nothing;

-- ---------- Sécurité (Row Level Security) ----------
alter table public.members    enable row level security;
alter table public.clients    enable row level security;
alter table public.favorites  enable row level security;
alter table public.crm_fields enable row level security;

-- members : chacun voit sa propre ligne, l'admin voit et gère tout.
drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated
  using (email = lower(auth.jwt() ->> 'email') or public.is_admin());
drop policy if exists members_admin on public.members;
create policy members_admin on public.members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- clients : base commune à tous les collaborateurs autorisés.
-- Lecture, ajout et modification : tous. Suppression : l'auteur ou un admin.
drop policy if exists clients_read on public.clients;
create policy clients_read on public.clients for select to authenticated using (public.is_member());
drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients for insert to authenticated
  with check (public.is_member() and created_by = auth.uid());
drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients for update to authenticated
  using (public.is_member()) with check (public.is_member());
drop policy if exists clients_delete on public.clients;
create policy clients_delete on public.clients for delete to authenticated
  using (public.is_member() and (created_by = auth.uid() or public.is_admin()));

-- favorites : chacun ne voit et ne gère que les siens.
drop policy if exists favorites_own on public.favorites;
create policy favorites_own on public.favorites for all to authenticated
  using (user_id = auth.uid() and public.is_member())
  with check (user_id = auth.uid() and public.is_member());

-- crm_fields : lecture pour tous les collaborateurs, modification par l'admin.
drop policy if exists crm_fields_read on public.crm_fields;
create policy crm_fields_read on public.crm_fields for select to authenticated using (public.is_member());
drop policy if exists crm_fields_admin on public.crm_fields;
create policy crm_fields_admin on public.crm_fields for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Empêche un collaborateur de s'attribuer un client créé par un autre.
create or replace function public.keep_created_by() returns trigger language plpgsql as $$
begin new.created_by := old.created_by; return new; end $$;
drop trigger if exists clients_keep_created_by on public.clients;
create trigger clients_keep_created_by before update on public.clients
  for each row execute function public.keep_created_by();

-- ---------- Temps réel : les ajouts des collègues apparaissent en direct ----------
do $$ begin
  alter publication supabase_realtime add table public.clients;
exception when others then null; end $$;

-- =====================================================================
-- PREMIER ADMINISTRATEUR : remplacez l'adresse ci-dessous par la vôtre,
-- puis exécutez cette ligne (une seule fois).
-- insert into public.members (email, role) values ('prenom.nom@societe.fr', 'admin');
-- =====================================================================
