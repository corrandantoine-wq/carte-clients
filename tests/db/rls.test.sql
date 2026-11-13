-- Tests des règles d'accès (Row Level Security). Toute assertion fausse arrête le script.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
\o /dev/null

create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'ÉCHEC : %', label; end if;
  raise notice 'ok : %', label;
end $$;
-- Exécute une requête qui DOIT être refusée.
create or replace function pg_temp.refused(label text, sql text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then raise notice 'ok : % (refusé)', label; return; end;
  raise exception 'ÉCHEC : % aurait dû être refusé', label;
end $$;
create or replace function pg_temp.as_user(uid text, email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', uid, 'email', email)::text, false); end $$;

insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a', 'admin@soc.fr'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@soc.fr'),
  ('00000000-0000-0000-0000-00000000000c', 'intrus@gmail.com');
insert into public.members values ('admin@soc.fr', 'admin'), ('bob@soc.fr', 'user');

set role authenticated;

-- Collaborateur
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b', 'Bob@Soc.fr');
select pg_temp.check('bob est collaborateur (e-mail insensible à la casse)', public.is_member());
select pg_temp.check('bob n''est pas admin', not public.is_admin());
insert into public.clients (nom, code_client) values ('Client de Bob', 'B1');
select pg_temp.check('bob voit la base commune', (select count(*) from public.clients) = 1);
insert into public.favorites (client_id) select id from public.clients;
select pg_temp.check('bob a 1 favori', (select count(*) from public.favorites) = 1);
select pg_temp.check('bob ne voit que sa ligne de collaborateur', (select count(*) from public.members) = 1);
select pg_temp.refused('bob se nomme admin', $$insert into public.members values ('pirate@x.fr', 'admin')$$);
update public.members set role = 'admin' where email = 'bob@soc.fr'; -- ignoré silencieusement par les règles d'accès
reset role; select pg_temp.check('bob ne peut pas changer son rôle', (select role from public.members where email = 'bob@soc.fr') = 'user'); set role authenticated;

-- Administrateur
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', 'admin@soc.fr');
insert into public.clients (nom, code_client) values ('Client admin', 'A1');
select pg_temp.check('l''admin voit tous les collaborateurs', (select count(*) from public.members) = 2);
select pg_temp.check('l''admin ne voit pas les favoris de bob', (select count(*) from public.favorites) = 0);
update public.clients set notes = 'modifié', created_by = '00000000-0000-0000-0000-00000000000a' where code_client = 'B1';
select pg_temp.check('l''auteur d''un client ne peut pas être changé',
  (select created_by from public.clients where code_client = 'B1') = '00000000-0000-0000-0000-00000000000b');

-- Suppression : auteur ou admin seulement
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b', 'bob@soc.fr');
delete from public.clients where code_client = 'A1';
select pg_temp.check('bob ne peut pas supprimer le client de l''admin', (select count(*) from public.clients where code_client = 'A1') = 1);

-- Import ERP : mise à jour par code client, sans écraser les notes non envoyées
insert into public.clients (code_client, nom, ville) values ('B1', 'Client de Bob SAS', 'Paris')
  on conflict (code_client) do update set nom = excluded.nom, ville = excluded.ville;
select pg_temp.check('ré-import : pas de doublon', (select count(*) from public.clients) = 2);
select pg_temp.check('ré-import : nom mis à jour, notes conservées',
  (select nom = 'Client de Bob SAS' and notes = 'modifié' from public.clients where code_client = 'B1'));
select pg_temp.refused('code client en double', $$insert into public.clients (nom, code_client) values ('X', 'A1')$$);
select pg_temp.check('set_coords enregistre les positions',
  public.set_coords((select jsonb_agg(jsonb_build_object('id', id, 'lat', 48.85, 'lng', 2.35)) from public.clients)) = 2);

-- Corbeille et historique
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b', 'bob@soc.fr');
select pg_temp.refused('bob met à la corbeille le client de l''admin', $$update public.clients set deleted_at = now() where code_client = 'A1'$$);
update public.clients set deleted_at = now() where code_client = 'B1';
select pg_temp.check('bob met son propre client à la corbeille (auteur noté)',
  (select deleted_at is not null and deleted_by = '00000000-0000-0000-0000-00000000000b' from public.clients where code_client = 'B1'));
delete from public.clients where code_client = 'B1';
select pg_temp.check('bob ne peut pas supprimer définitivement', (select count(*) from public.clients where code_client = 'B1') = 1);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', 'admin@soc.fr');
update public.clients set deleted_at = null where code_client = 'B1';
select pg_temp.check('restauration depuis la corbeille', (select deleted_at is null and deleted_by is null from public.clients where code_client = 'B1'));
select pg_temp.check('historique : création, modification, suppression et restauration journalisées',
  (select array_agg(action order by id) from public.client_history where client_nom like 'Client de Bob%')
    = array['création', 'modification', 'modification', 'suppression', 'restauration']);
select pg_temp.check('historique : ancienne et nouvelle valeur, auteur',
  (select changes -> 'nom' = '["Client de Bob", "Client de Bob SAS"]'::jsonb and user_email = 'bob@soc.fr'
     from public.client_history where action = 'modification' and changes ? 'nom'));
select pg_temp.check('historique : un simple changement de coordonnées n''est pas journalisé',
  (select count(*) from public.client_history where action = 'modification' and changes = '{}') = 0);
select pg_temp.refused('personne ne peut écrire dans l''historique', $$insert into public.client_history (client_id, client_nom, action) values (gen_random_uuid(), 'faux', 'création')$$);
delete from public.client_history;
reset role;
select pg_temp.check('l''historique ne peut pas être effacé', (select count(*) from public.client_history) > 0);
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', 'admin@soc.fr');
delete from public.clients where code_client = 'B1';
select pg_temp.check('l''admin supprime définitivement (et c''est journalisé)',
  (select count(*) from public.clients where code_client = 'B1') = 0
  and exists (select 1 from public.client_history where action = 'suppression définitive'));
insert into public.clients (nom, code_client) values ('Client de Bob SAS', 'B1'); -- remis pour la suite

-- Secteurs (commercial attitré)
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b', 'bob@soc.fr');
update public.clients set assigned_to = 'bob@soc.fr' where code_client = 'B1';
select pg_temp.check('bob prend un client libre', (select assigned_to from public.clients where code_client = 'B1') = 'bob@soc.fr');
select pg_temp.refused('bob attribue un client à l''admin', $$update public.clients set assigned_to = 'admin@soc.fr' where code_client = 'A1'$$);
select pg_temp.refused('bob crée un client attribué à un autre', $$insert into public.clients (nom, assigned_to) values ('X', 'admin@soc.fr')$$);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', 'admin@soc.fr');
update public.clients set assigned_to = 'Admin@Soc.fr' where code_client = 'B1';
select pg_temp.check('l''admin réattribue (e-mail mis en minuscules)', (select assigned_to from public.clients where code_client = 'B1') = 'admin@soc.fr');
select pg_temp.refused('attribution à une adresse non autorisée', $$update public.clients set assigned_to = 'inconnu@x.fr' where code_client = 'A1'$$);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b', 'bob@soc.fr');
select pg_temp.refused('bob retire le client attribué à l''admin', $$update public.clients set assigned_to = null where code_client = 'B1'$$);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a', 'admin@soc.fr');
update public.clients set assigned_to = 'bob@soc.fr' where code_client = 'B1';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b', 'bob@soc.fr');
update public.clients set assigned_to = null where code_client = 'B1';
select pg_temp.check('bob rend un client qui lui était attribué', (select assigned_to is null from public.clients where code_client = 'B1'));
select pg_temp.check('les attributions sont dans l''historique',
  (select count(*) from public.client_history where changes ? 'assigned_to') = 4);
reset role;
delete from public.members where email = 'bob@soc.fr';
update public.clients set assigned_to = null; insert into public.members values ('bob@soc.fr', 'user');
set role authenticated;

-- Personne non autorisée
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c', 'intrus@gmail.com');
select pg_temp.check('l''intrus ne voit aucun client', (select count(*) from public.clients) = 0);
select pg_temp.check('l''intrus ne voit aucun collaborateur', (select count(*) from public.members) = 0);
select pg_temp.check('l''intrus ne voit aucun champ CRM', (select count(*) from public.crm_fields) = 0);
select pg_temp.check('l''intrus ne voit pas l''historique', (select count(*) from public.client_history) = 0);
select pg_temp.refused('l''intrus ajoute un client', $$insert into public.clients (nom) values ('spam')$$);
select pg_temp.check('l''intrus ne peut pas déplacer les clients',
  public.set_coords((select jsonb_agg(jsonb_build_object('id', id, 'lat', 0, 'lng', 0)) from (select id from public.clients) s)) = 0);

-- Sans connexion (clé publique seule)
reset role;
set role anon;
select pg_temp.refused('anonyme : lecture des clients', $$select count(*) from public.clients$$);
select pg_temp.refused('anonyme : set_coords', $$select public.set_coords('[]'::jsonb)$$);
reset role;
select pg_temp.check('les positions n''ont pas été modifiées par l''intrus', (select bool_and(lat = 48.85) from public.clients));
\o
\echo '✅ Tous les tests de sécurité de la base sont passés.'
