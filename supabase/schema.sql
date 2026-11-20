-- WeeCert : tables, fonctions et règles d'accès (RLS).
-- À exécuter dans Supabase → SQL Editor. Le script peut être relancé sans erreur.
--
-- Principe :
--   * members   : liste des adresses autorisées et rôle de chacun (owner, admin, user).
--                 Seules ces adresses peuvent créer un compte.
--   * players   : progression visible de chaque joueur (XP, séries, badges, avatar), lue par toute l'équipe.
--   * user_data : données privées de chaque joueur (répétition espacée par certification).
--   * questions : questions importées, lisibles par les membres, modifiables par les administrateurs.
-- Les questions importées ne sont jamais dans le code du site : elles restent dans cette base.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.members (
  email        text primary key check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role         text not null default 'user' check (role in ('owner', 'admin', 'user')),
  display_name text check (char_length(display_name) <= 40),
  user_id      uuid unique references auth.users (id) on delete set null,
  added_at     timestamptz not null default now()
);

create table if not exists public.players (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb check (pg_column_size(data) < 65536),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_data (
  user_id    uuid not null references auth.users (id) on delete cascade,
  key        text not null check (key ~ '^[a-z0-9_]{1,40}$'),
  data       jsonb not null default '{}'::jsonb check (pg_column_size(data) < 262144),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table if not exists public.questions (
  id         text primary key check (id ~ '^[A-Za-z0-9_.-]{1,80}$'),
  data       jsonb not null check (pg_column_size(data) < 65536),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Fonctions d'appartenance (security definer : lisent members sans passer par la RLS)
-- ---------------------------------------------------------------------------
create or replace function public.my_role() returns text
language sql stable security definer set search_path = '' as
$$ select m.role from public.members m where m.user_id = auth.uid() $$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = '' as
$$ select public.my_role() is not null $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce(public.my_role() in ('owner', 'admin'), false) $$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as
$$ select coalesce(public.my_role() = 'owner', false) $$;

-- Noms et rôles des membres inscrits, sans exposer les adresses e-mail
create or replace function public.get_profiles(ids uuid[]) returns table (user_id uuid, name text, role text)
language sql stable security definer set search_path = '' as
$$ select m.user_id, coalesce(nullif(m.display_name, ''), split_part(m.email, '@', 1)), m.role
     from public.members m
    where public.is_member() and m.user_id = any (ids) $$;

-- Identifiants des administrateurs (hors propriétaire)
create or replace function public.list_admins() returns setof uuid
language sql stable security definer set search_path = '' as
$$ select m.user_id from public.members m
    where public.is_member() and m.role = 'admin' and m.user_id is not null $$;

-- Le propriétaire désigne les administrateurs parmi les membres inscrits
create or replace function public.set_admins(ids uuid[]) returns void
language plpgsql security definer set search_path = '' as
$$ begin
  if not public.is_owner() then
    raise exception 'Réservé au propriétaire de WeeCert' using errcode = '42501';
  end if;
  update public.members m
     set role = case when m.user_id = any (coalesce(ids, '{}')) then 'admin' else 'user' end
   where m.role <> 'owner' and m.user_id is not null;
end $$;

-- Chacun peut changer son prénom affiché
create or replace function public.set_my_name(new_name text) returns void
language sql security definer set search_path = '' as
$$ update public.members m set display_name = nullif(left(btrim(new_name), 40), '')
    where m.user_id = auth.uid() $$;

-- ---------------------------------------------------------------------------
-- Inscription limitée aux adresses autorisées
-- ---------------------------------------------------------------------------
create or replace function public.check_allowlist() returns trigger
language plpgsql security definer set search_path = '' as
$$ begin
  if not exists (select 1 from public.members m where m.email = lower(btrim(new.email))) then
    raise exception 'WEECERT_NOT_ALLOWED' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.link_member() returns trigger
language plpgsql security definer set search_path = '' as
$$ begin
  update public.members m
     set user_id = new.id,
         display_name = coalesce(m.display_name, nullif(left(btrim(new.raw_user_meta_data ->> 'name'), 40), ''))
   where m.email = lower(btrim(new.email));
  return new;
end $$;

drop trigger if exists weecert_check_allowlist on auth.users;
create trigger weecert_check_allowlist before insert on auth.users
  for each row execute function public.check_allowlist();

drop trigger if exists weecert_link_member on auth.users;
create trigger weecert_link_member after insert on auth.users
  for each row execute function public.link_member();

-- Retirer quelqu'un de la liste le retire aussi du classement
create or replace function public.on_member_removed() returns trigger
language plpgsql security definer set search_path = '' as
$$ begin
  if old.user_id is not null then
    delete from public.players p where p.user_id = old.user_id;
  end if;
  return old;
end $$;

drop trigger if exists weecert_member_removed on public.members;
create trigger weecert_member_removed after delete on public.members
  for each row execute function public.on_member_removed();

-- Date de mise à jour
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as
$$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists weecert_touch on public.players;
create trigger weecert_touch before update on public.players for each row execute function public.touch_updated_at();
drop trigger if exists weecert_touch on public.user_data;
create trigger weecert_touch before update on public.user_data for each row execute function public.touch_updated_at();
drop trigger if exists weecert_touch on public.questions;
create trigger weecert_touch before update on public.questions for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Droits et règles d'accès
-- ---------------------------------------------------------------------------
alter table public.members   enable row level security;
alter table public.players   enable row level security;
alter table public.user_data enable row level security;
alter table public.questions enable row level security;

revoke all on public.members, public.players, public.user_data, public.questions from anon, authenticated;
grant select, delete on public.members to authenticated;
grant insert (email, role, display_name), update (role, display_name) on public.members to authenticated;
grant select, insert, update, delete on public.players, public.user_data, public.questions to authenticated;

revoke all on function public.my_role(), public.is_member(), public.is_admin(), public.is_owner(),
  public.get_profiles(uuid[]), public.list_admins(), public.set_admins(uuid[]), public.set_my_name(text),
  public.check_allowlist(), public.link_member(), public.on_member_removed() from public, anon;
grant execute on function public.my_role(), public.is_member(), public.is_admin(), public.is_owner(),
  public.get_profiles(uuid[]), public.list_admins(), public.set_admins(uuid[]), public.set_my_name(text) to authenticated;

-- members : chacun voit sa ligne, le propriétaire gère la liste (sauf la ligne propriétaire)
drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
  using (user_id = auth.uid() or public.is_owner());
drop policy if exists members_insert on public.members;
create policy members_insert on public.members for insert to authenticated
  with check (public.is_owner() and role in ('admin', 'user'));
drop policy if exists members_update on public.members;
create policy members_update on public.members for update to authenticated
  using (public.is_owner() and role <> 'owner')
  with check (public.is_owner() and role in ('admin', 'user'));
drop policy if exists members_delete on public.members;
create policy members_delete on public.members for delete to authenticated
  using (public.is_owner() and role <> 'owner');

-- players : lisibles par l'équipe, chacun n'écrit que sa propre ligne
drop policy if exists players_select on public.players;
create policy players_select on public.players for select to authenticated
  using (public.is_member());
drop policy if exists players_insert on public.players;
create policy players_insert on public.players for insert to authenticated
  with check (user_id = auth.uid() and public.is_member());
drop policy if exists players_update on public.players;
create policy players_update on public.players for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member());
drop policy if exists players_delete on public.players;
create policy players_delete on public.players for delete to authenticated
  using (user_id = auth.uid());

-- user_data : strictement privé
drop policy if exists user_data_all on public.user_data;
create policy user_data_all on public.user_data for all to authenticated
  using (user_id = auth.uid() and public.is_member())
  with check (user_id = auth.uid() and public.is_member());

-- questions : lues par l'équipe, modifiées par les administrateurs
drop policy if exists questions_select on public.questions;
create policy questions_select on public.questions for select to authenticated
  using (public.is_member());
drop policy if exists questions_insert on public.questions;
create policy questions_insert on public.questions for insert to authenticated
  with check (public.is_admin());
drop policy if exists questions_update on public.questions;
create policy questions_update on public.questions for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists questions_delete on public.questions;
create policy questions_delete on public.questions for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Temps réel (classement et questions)
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'players') then
    alter publication supabase_realtime add table public.players;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'questions') then
    alter publication supabase_realtime add table public.questions;
  end if;
end $$;
