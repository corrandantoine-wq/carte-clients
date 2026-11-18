-- =====================================================================
-- Carte Clients : état du compte d'une personne invitée
-- Utilisé uniquement par la fonction serveur « inviter » (clé service_role) pour
-- savoir si une adresse n'a pas encore de compte, a une invitation en attente,
-- ou a déjà un compte actif. Inaccessible depuis l'appli.
-- À exécuter après 006_double_verification_admin.sql.
-- =====================================================================
create or replace function public.compte_etat(p_email text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when u.email_confirmed_at is not null or u.last_sign_in_at is not null then 'actif' else 'en_attente' end
      from auth.users u
     where lower(u.email) = lower(p_email)
     limit 1
  ), 'aucun');
$$;
revoke all on function public.compte_etat(text) from public, anon, authenticated;
grant execute on function public.compte_etat(text) to service_role;
