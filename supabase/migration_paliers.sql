-- ============================================================
-- BattleQuizz — Migration : paliers, bonus sans-faute, classement enrichi
-- À coller dans Supabase → SQL Editor → New query → Run
-- (à faire APRÈS le schema.sql initial, une seule fois)
-- ============================================================

-- Chaque question appartient à un "palier" (groupe de questions).
-- Palier 1 = questions 1 à N, Palier 2 = questions suivantes, etc.
alter table questions add column if not exists palier int not null default 1;

-- Compteur de sans-faute par joueur (nombre de paliers réussis sans erreur)
alter table scores add column if not exists sans_faute_count int not null default 0;

-- Historique des paliers terminés (déclenche l'écran "Bravo aux sans-faute" sur l'overlay)
create table if not exists palier_events (
  id bigint generated always as identity primary key,
  session_id bigint not null references sessions(id) on delete cascade,
  palier int not null,
  sans_faute_players jsonb not null default '[]',
  bonus_points int not null default 0,
  created_at timestamptz not null default now()
);
alter table palier_events enable row level security;

create policy "public read palier_events" on palier_events for select using (true);

alter publication supabase_realtime add table palier_events;

-- ============================================================
-- Fonction : vérifie si un palier vient de se terminer (toutes ses
-- questions sont clôturées), et si oui calcule les joueurs sans-faute
-- + attribue le bonus de points. Idempotente (ne redéclenche pas deux
-- fois pour le même palier).
-- ============================================================
create or replace function check_palier_completion(p_question_id bigint, p_bonus_points int default 4)
returns void
language plpgsql
security definer
as $$
declare
  v_session_id bigint;
  v_palier int;
  v_total_questions int;
  v_closed_questions int;
  v_players jsonb;
begin
  select session_id, palier into v_session_id, v_palier from questions where id = p_question_id;

  select count(*) into v_total_questions from questions where session_id = v_session_id and palier = v_palier;
  select count(*) into v_closed_questions from questions where session_id = v_session_id and palier = v_palier and status = 'closed';

  if v_closed_questions < v_total_questions then
    return; -- palier pas encore terminé
  end if;

  if exists (select 1 from palier_events where session_id = v_session_id and palier = v_palier) then
    return; -- déjà traité
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('tiktok_username', p.tiktok_username, 'display_name', p.display_name)), '[]')
  into v_players
  from (
    select a.player_id
    from answers a
    join questions q on q.id = a.question_id
    where q.session_id = v_session_id and q.palier = v_palier
    group by a.player_id
    having count(*) = v_total_questions
       and count(*) filter (where a.is_correct) = v_total_questions
  ) sf
  join players p on p.id = sf.player_id;

  insert into palier_events (session_id, palier, sans_faute_players, bonus_points)
  values (v_session_id, v_palier, v_players, p_bonus_points);

  update scores s
  set total_points = s.total_points + p_bonus_points,
      sans_faute_count = s.sans_faute_count + 1,
      updated_at = now()
  from (
    select (elem->>'tiktok_username') as tiktok_username
    from jsonb_array_elements(v_players) elem
  ) sfp
  join players p on p.tiktok_username = sfp.tiktok_username
  where s.session_id = v_session_id and s.player_id = p.id;
end;
$$;

-- ============================================================
-- Fonction : classement enrichi (ajoute sans_faute_count).
-- Remplace l'ancienne version (obligé de la supprimer d'abord car le
-- type de retour change).
-- ============================================================
drop function if exists get_leaderboard(bigint, int);

create or replace function get_leaderboard(p_session_id bigint, p_limit int default 100)
returns table(tiktok_username text, display_name text, avatar_url text, total_points int, correct_answers int, sans_faute_count int)
language sql
stable
as $$
  select p.tiktok_username, p.display_name, p.avatar_url, s.total_points, s.correct_answers, s.sans_faute_count
  from scores s
  join players p on p.id = s.player_id
  where s.session_id = p_session_id
  order by s.total_points desc, s.correct_answers desc
  limit p_limit;
$$;

-- ============================================================
-- Fonction : nombre de joueurs distincts ayant participé à la session
-- ============================================================
create or replace function get_session_player_count(p_session_id bigint)
returns int
language sql
stable
as $$
  select count(distinct player_id)::int from scores where session_id = p_session_id;
$$;
