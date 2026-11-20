-- Tests du schéma : inscription limitée, rôles et règles d'accès (RLS).
-- Chaque vérification lève une erreur si elle échoue (psql s'arrête avec ON_ERROR_STOP).
\set ON_ERROR_STOP on
\o /dev/null
create or replace function pg_temp.ok(cond boolean, what text) returns void language plpgsql as
$$ begin if cond is not true then raise exception 'ÉCHEC : %', what; end if; raise notice 'ok : %', what; end $$;
create or replace function pg_temp.fails(stmt text, expected text, what text) returns void language plpgsql as
$$ begin execute stmt; raise exception 'ÉCHEC (aucune erreur) : %', what;
   exception when others then
     if sqlerrm like 'ÉCHEC%' then raise; end if;
     if sqlerrm not like '%' || expected || '%' then raise exception 'ÉCHEC : % (erreur « % »)', what, sqlerrm; end if;
     raise notice 'ok : %', what; end $$;
create or replace function pg_temp.as_user(u text) returns void language sql as
$$ select set_config('request.uid', u, false) $$;

-- Mise en place (rôle postgres, comme dans le SQL Editor) : le propriétaire et une collègue autorisée
insert into members(email, role) values ('lolo@exemple.fr', 'owner'), ('camille@exemple.fr', 'user');
insert into auth.users(id, email, raw_user_meta_data) values ('11111111-1111-1111-1111-111111111111', 'Lolo@Exemple.fr', '{"name":"Loïc"}');
insert into auth.users(id, email, raw_user_meta_data) values ('22222222-2222-2222-2222-222222222222', 'camille@exemple.fr', '{"name":"Camille"}');
select pg_temp.ok((select user_id from members where email = 'lolo@exemple.fr') = '11111111-1111-1111-1111-111111111111', 'le compte est relié à la liste (majuscules ignorées)');
select pg_temp.ok((select display_name from members where email = 'camille@exemple.fr') = 'Camille', 'le prénom saisi à l''inscription est repris');
select pg_temp.fails($$insert into auth.users(id, email) values ('33333333-3333-3333-3333-333333333333', 'intrus@exemple.fr')$$,
  'WEECERT_NOT_ALLOWED', 'une adresse absente de la liste ne peut pas créer de compte');

-- Camille (utilisatrice) : progression, données privées, lecture des questions
insert into questions(id, data) values ('imp-1', '{"c":"dea","q":"Question test"}');
set role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select pg_temp.ok(public.my_role() = 'user', 'Camille est utilisatrice');
insert into players(user_id, data) values (auth.uid(), '{"xp":10}');
insert into user_data(user_id, key, data) values (auth.uid(), 'srs_dea', '{"m":{}}');
select pg_temp.ok((select count(*) from questions) = 1, 'une utilisatrice lit les questions importées');
select pg_temp.fails($$insert into questions(id, data) values ('imp-2', '{}')$$, 'row-level security', 'une utilisatrice ne peut pas importer de question');
update questions set data = '{"c":"dea","q":"modifiée"}' where id = 'imp-1';
delete from questions where id = 'imp-1';
reset role;
select pg_temp.ok((select data->>'q' from questions where id = 'imp-1') = 'Question test', 'une utilisatrice ne peut ni modifier ni supprimer une question');
set role authenticated;
select pg_temp.fails($$insert into players(user_id, data) values ('11111111-1111-1111-1111-111111111111', '{"xp":9999}')$$, 'row-level security', 'impossible d''écrire la progression d''un autre');
select pg_temp.ok((select count(*) from members) = 1, 'une utilisatrice ne voit que sa propre ligne de la liste (pas les e-mails des autres)');
select pg_temp.fails($$insert into members(email) values ('pote@exemple.fr')$$, 'row-level security', 'une utilisatrice ne peut pas ajouter d''adresse');
select pg_temp.fails($$select public.set_admins(array['22222222-2222-2222-2222-222222222222']::uuid[])$$, 'propriétaire', 'une utilisatrice ne peut pas se nommer administratrice');
select public.set_my_name('Cam');

-- Le propriétaire : voit tout, gère la liste et les rôles
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(public.is_owner(), 'Lolo est propriétaire');
insert into players(user_id, data) values (auth.uid(), '{"xp":500}');
select pg_temp.ok((select count(*) from players) = 2, 'le classement montre toute l''équipe');
select pg_temp.ok((select count(*) from user_data) = 0, 'les données de révision des autres restent privées');
select pg_temp.ok((select count(*) from members) = 2, 'le propriétaire voit toute la liste');
insert into members(email) values ('pote@exemple.fr');
select pg_temp.fails($$insert into members(email, role) values ('boss@exemple.fr', 'owner')$$, 'row-level security', 'impossible de créer un second propriétaire');
select pg_temp.fails($$insert into members(email) values ('pas-une-adresse')$$, 'check', 'adresse mal formée refusée');
select pg_temp.fails($$insert into members(email, user_id) values ('x@exemple.fr', '22222222-2222-2222-2222-222222222222')$$, 'permission denied', 'impossible de relier une adresse à un compte à la main');
select public.set_admins(array['22222222-2222-2222-2222-222222222222']::uuid[]);
select pg_temp.ok((select array_agg(x) from public.list_admins() x) = array['22222222-2222-2222-2222-222222222222']::uuid[], 'Camille devient administratrice');
select pg_temp.ok((select name from public.get_profiles(array['22222222-2222-2222-2222-222222222222']::uuid[])) = 'Cam', 'le prénom modifié est visible, sans l''adresse');
update members set role = 'user' where email = 'lolo@exemple.fr';
delete from members where email = 'lolo@exemple.fr';
select pg_temp.ok(public.is_owner(), 'le propriétaire ne peut pas se rétrograder ni se retirer');

-- Camille administratrice : peut importer et remplacer
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
insert into questions(id, data) values ('imp-2', '{"c":"daa"}');
update questions set data = '{"c":"dea","q":"v2"}' where id = 'imp-1';
select pg_temp.ok((select data->>'q' from questions where id = 'imp-1') = 'v2', 'une administratrice modifie les questions');

-- Retrait d'une personne : plus aucun accès, et disparition du classement
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
delete from members where email = 'camille@exemple.fr';
select pg_temp.ok((select count(*) from players) = 1, 'la personne retirée disparaît du classement');
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select pg_temp.ok((select count(*) from questions) = 0, 'une personne retirée ne lit plus les questions');
select pg_temp.ok((select count(*) from user_data) = 0, 'une personne retirée n''accède plus à ses données');

-- Visiteur non connecté : rien
reset role; set role anon; select pg_temp.as_user('');
select pg_temp.fails($$select count(*) from questions$$, 'permission denied', 'un visiteur anonyme ne lit pas les questions');
select pg_temp.fails($$select count(*) from players$$, 'permission denied', 'un visiteur anonyme ne lit pas le classement');
reset role;
\o
\echo 'Schéma : tous les tests passent.'
