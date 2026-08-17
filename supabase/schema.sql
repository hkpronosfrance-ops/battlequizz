-- ============================================================
-- BattleQuizz — Schéma Supabase (Postgres)
-- À coller entièrement dans Supabase → SQL Editor → New query → Run
-- ============================================================

create table sessions (
  id bigint generated always as identity primary key,
  tiktok_username text not null,
  title text,
  status text not null default 'draft' check (status in ('draft','live','ended')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create table questions (
  id bigint generated always as identity primary key,
  session_id bigint not null references sessions(id) on delete cascade,
  position int not null default 0,
  question_text text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  correct_option text not null check (correct_option in ('A','B','C','D')),
  duration_seconds int not null default 15,
  points_reward int not null default 2,
  status text not null default 'pending' check (status in ('pending','active','closed')),
  started_at timestamptz,
  closed_at timestamptz
);

create table players (
  id bigint generated always as identity primary key,
  tiktok_user_id text not null unique,
  tiktok_username text not null,
  display_name text,
  avatar_url text,
  first_seen timestamptz not null default now()
);

create table answers (
  id bigint generated always as identity primary key,
  question_id bigint not null references questions(id) on delete cascade,
  player_id bigint not null references players(id) on delete cascade,
  chosen_option text not null check (chosen_option in ('A','B','C','D')),
  is_correct boolean not null default false,
  points_earned int not null default 0,
  answered_at timestamptz not null default now(),
  unique (question_id, player_id)
);

create table scores (
  id bigint generated always as identity primary key,
  session_id bigint not null references sessions(id) on delete cascade,
  player_id bigint not null references players(id) on delete cascade,
  total_points int not null default 0,
  correct_answers int not null default 0,
  updated_at timestamptz not null default now(),
  unique (session_id, player_id)
);

-- Table pour déclencher la lecture audio (voix IA) côté overlay via Realtime
create table voice_events (
  id bigint generated always as identity primary key,
  session_id bigint not null references sessions(id) on delete cascade,
  audio_url text not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Row Level Security : lecture publique partout (nécessaire pour
-- l'overlay et l'admin), écriture restreinte.
-- ============================================================
alter table sessions enable row level security;
alter table questions enable row level security;
alter table players enable row level security;
alter table answers enable row level security;
alter table scores enable row level security;
alter table voice_events enable row level security;

create policy "public read sessions" on sessions for select using (true);
create policy "public read questions" on questions for select using (true);
create policy "public read players" on players for select using (true);
create policy "public read answers" on answers for select using (true);
create policy "public read scores" on scores for select using (true);
create policy "public read voice_events" on voice_events for select using (true);

-- Écriture sur sessions/questions : réservée aux utilisateurs connectés (toi, via l'admin)
create policy "admin write sessions" on sessions for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "admin write questions" on questions for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- players/answers/scores/voice_events : écrits uniquement par le bot (clé service_role,
-- qui contourne RLS automatiquement) → aucune policy d'écriture publique nécessaire.

-- ============================================================
-- Active le Realtime (pour que l'overlay reçoive les mises à jour en direct)
-- ============================================================
alter publication supabase_realtime add table questions;
alter publication supabase_realtime add table answers;
alter publication supabase_realtime add table scores;
alter publication supabase_realtime add table voice_events;

-- ============================================================
-- Fonction : clôture une question, calcule les points, met à jour le classement.
-- Idempotente (si déjà clôturée, ne recompte pas les points).
-- Appelée par le bot via supabase.rpc('close_question', { p_question_id }).
-- ============================================================
create or replace function close_question(p_question_id bigint)
returns table(chosen_option text, votes bigint)
language plpgsql
security definer
as $$
declare
  v_correct text;
  v_session_id bigint;
  v_status text;
  v_points int;
begin
  select q.correct_option, q.session_id, q.status, q.points_reward
    into v_correct, v_session_id, v_status, v_points
  from questions q where q.id = p_question_id;

  if v_status = 'closed' then
    return query
      select a.chosen_option, count(*) from answers a
      where a.question_id = p_question_id group by a.chosen_option;
    return;
  end if;

  update answers a
  set is_correct = (a.chosen_option = v_correct),
      points_earned = case when a.chosen_option = v_correct then v_points else 0 end
  where a.question_id = p_question_id;

  insert into scores (session_id, player_id, total_points, correct_answers)
  select v_session_id, a.player_id, sum(a.points_earned), sum((a.is_correct)::int)
  from answers a
  where a.question_id = p_question_id
  group by a.player_id
  on conflict (session_id, player_id) do update
    set total_points = scores.total_points + excluded.total_points,
        correct_answers = scores.correct_answers + excluded.correct_answers,
        updated_at = now();

  update questions set status = 'closed', closed_at = now() where id = p_question_id;

  return query
    select a.chosen_option, count(*) from answers a
    where a.question_id = p_question_id group by a.chosen_option;
end;
$$;

-- ============================================================
-- Fonction : classement d'une session (pratique pour l'admin et l'overlay)
-- ============================================================
create or replace function get_leaderboard(p_session_id bigint, p_limit int default 25)
returns table(tiktok_username text, display_name text, avatar_url text, total_points int, correct_answers int)
language sql
stable
as $$
  select p.tiktok_username, p.display_name, p.avatar_url, s.total_points, s.correct_answers
  from scores s
  join players p on p.id = s.player_id
  where s.session_id = p_session_id
  order by s.total_points desc, s.correct_answers desc
  limit p_limit;
$$;
