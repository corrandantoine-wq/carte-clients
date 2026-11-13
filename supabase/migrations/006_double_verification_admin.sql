-- =====================================================================
-- Carte Clients : double vérification obligatoire pour les administrateurs
-- Un compte administrateur n'a accès à rien (ni données, ni administration)
-- tant que sa session n'a pas validé le code à 6 chiffres de son appli
-- d'authentification (niveau « aal2 » de Supabase). Un mot de passe volé
-- ne suffit donc plus. Les collaborateurs ne sont pas concernés.
-- Perte du téléphone : Supabase → Authentication → Users → le compte →
-- supprimer le facteur MFA, puis se reconnecter pour en enregistrer un nouveau.
-- À exécuter après 005_verrou_anon.sql.
-- =====================================================================

-- Session validée par la double vérification ?
create or replace function public.session_aal2() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members
     where email = lower(auth.jwt() ->> 'email')
       and (role <> 'admin' or public.session_aal2())
  );
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members
     where email = lower(auth.jwt() ->> 'email') and role = 'admin'
  ) and public.session_aal2();
$$;

-- Droits d'exécution (cf. 005) : réservés aux utilisateurs connectés.
revoke all on function public.session_aal2() from anon, public;
grant execute on function public.session_aal2() to authenticated, service_role;
