-- =====================================================================
-- Carte Clients : secteurs (commercial attitré)
-- - Chaque client peut être attribué à un collaborateur (son e-mail).
-- - Un administrateur attribue n'importe quel client à n'importe qui.
-- - Un collaborateur peut seulement prendre un client libre (« Je m'en occupe »)
--   ou rendre un client qui lui est attribué.
-- - Les attributions apparaissent dans l'historique.
-- À exécuter après 003_historique_corbeille.sql.
-- =====================================================================

alter table public.clients add column if not exists assigned_to text
  references public.members (email) on update cascade on delete set null;
create index if not exists clients_assigned_idx on public.clients (assigned_to);

create or replace function public.guard_assign() returns trigger language plpgsql as $$
declare
  me text := lower(auth.jwt() ->> 'email');
  before text := case when tg_op = 'UPDATE' then old.assigned_to end;
begin
  if new.assigned_to is not null then new.assigned_to := lower(new.assigned_to); end if;
  if new.assigned_to is distinct from before and not public.is_admin() then
    if not ((before is null and new.assigned_to = me) or (before = me and new.assigned_to is null)) then
      raise exception 'Seul un administrateur peut attribuer ce client à un autre commercial.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists clients_guard_assign on public.clients;
create trigger clients_guard_assign before insert or update on public.clients
  for each row execute function public.guard_assign();

-- Historique : on suit aussi le commercial attitré.
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
    foreach k in array array['nom', 'code_client', 'adresse', 'code_postal', 'ville', 'telephone', 'email', 'notes', 'hubspot_id', 'assigned_to'] loop
      if (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k) then
        changes := changes || jsonb_build_object(k, jsonb_build_array(to_jsonb(old) -> k, to_jsonb(new) -> k));
      end if;
    end loop;
    if old.deleted_at is null and new.deleted_at is not null then act := 'suppression';
    elsif old.deleted_at is not null and new.deleted_at is null then act := 'restauration';
    elsif changes <> '{}' then act := 'modification';
    else return null;
    end if;
  end if;
  insert into public.client_history (client_id, client_nom, action, changes, user_id, user_email)
  values (rec.id, rec.nom, act, changes, auth.uid(), auth.jwt() ->> 'email');
  return null;
end $$;
