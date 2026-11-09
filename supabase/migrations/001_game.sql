-- Dong Dieu: multiplayer word matching game
-- Run this file in Supabase SQL Editor. Tokens are stored as SHA-256 hashes.
create extension if not exists pgcrypto;

create table if not exists public.rooms (
  code text primary key check (code ~ '^[0-9]{6}$'),
  status text not null default 'waiting' check (status in ('waiting','playing','finished')),
  current_round integer not null default 0,
  round_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references public.rooms(code) on delete cascade,
  slot smallint not null check (slot in (1,2)),
  name text not null check (char_length(name) between 1 and 18),
  token_hash text not null,
  ready boolean not null default false,
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  unique(room_code, slot),
  unique(room_code, id)
);

create table if not exists public.rounds (
  id bigint generated always as identity primary key,
  room_code text not null references public.rooms(code) on delete cascade,
  round_number integer not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  player_1_word text,
  player_2_word text,
  is_match boolean not null default false,
  resolved boolean not null default false,
  unique(room_code, round_number)
);
create index if not exists rounds_room_idx on public.rounds(room_code, round_number);

alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.rounds enable row level security;
-- Clients use SECURITY DEFINER RPCs only. No direct table access is granted.
revoke all on public.rooms, public.players, public.rounds from anon, authenticated;

create or replace function public.create_room(p_name text, p_token uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_code text; v_player uuid;
begin
  if length(trim(p_name)) not between 1 and 18 then raise exception 'Tên phải từ 1 đến 18 ký tự.'; end if;
  for i in 1..12 loop
    v_code := lpad(floor(random()*1000000)::int::text, 6, '0');
    begin
      insert into rooms(code) values(v_code);
      exit;
    exception when unique_violation then v_code := null;
    end;
  end loop;
  if v_code is null then raise exception 'Không tạo được mã phòng, vui lòng thử lại.'; end if;
  insert into players(room_code,slot,name,token_hash) values(v_code,1,trim(p_name),encode(digest(p_token::text,'sha256'),'hex')) returning id into v_player;
  return jsonb_build_object('code',v_code,'player_id',v_player);
end; $$;

create or replace function public.join_room(p_code text, p_name text, p_token uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_room rooms%rowtype; v_player uuid;
begin
  if length(trim(p_name)) not between 1 and 18 then raise exception 'Tên phải từ 1 đến 18 ký tự.'; end if;
  select * into v_room from rooms where code=p_code for update;
  if not found then raise exception 'Không tìm thấy phòng này.'; end if;
  if v_room.status <> 'waiting' then raise exception 'Phòng đã bắt đầu hoặc đã kết thúc.'; end if;
  if exists(select 1 from players where room_code=p_code and active) then
    if exists(select 1 from players where room_code=p_code and slot=2 and active) then raise exception 'Phòng đã đủ 2 người chơi.'; end if;
  end if;
  insert into players(room_code,slot,name,token_hash) values(p_code,2,trim(p_name),encode(digest(p_token::text,'sha256'),'hex')) returning id into v_player;
  return jsonb_build_object('player_id',v_player);
end; $$;

create or replace function public.set_player_ready(p_code text,p_token uuid,p_ready boolean)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  select id into v_id from players where room_code=p_code and token_hash=encode(digest(p_token::text,'sha256'),'hex') and active;
  if v_id is null then raise exception 'Phiên người chơi không hợp lệ.'; end if;
  update players set ready=p_ready where id=v_id;
  return true;
end; $$;

create or replace function public.start_game(p_code text,p_token uuid)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare v_room rooms%rowtype; v_id uuid;
begin
  select id into v_id from players where room_code=p_code and token_hash=encode(digest(p_token::text,'sha256'),'hex') and active;
  if v_id is null then raise exception 'Phiên người chơi không hợp lệ.'; end if;
  select * into v_room from rooms where code=p_code for update;
  if v_room.status <> 'waiting' then raise exception 'Phòng không ở trạng thái chờ.'; end if;
  if (select count(*) from players where room_code=p_code and active) <> 2 then raise exception 'Cần đủ 2 người chơi.'; end if;
  if (select count(*) from players where room_code=p_code and active and ready) <> 2 then raise exception 'Cả hai người phải sẵn sàng.'; end if;
  update rooms set status='playing',current_round=1,round_started_at=now(),updated_at=now() where code=p_code;
  insert into rounds(room_code,round_number,started_at) values(p_code,1,now());
  return true;
end; $$;

create or replace function public.submit_word(p_code text,p_token uuid,p_round integer,p_word text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_player players%rowtype; v_room rooms%rowtype; v_round rounds%rowtype; v_word text; v_match boolean;
begin
  if p_word is null then raise exception 'Bạn chưa nhập từ.'; end if;
  v_word := regexp_replace(trim(normalize(p_word,NFC)), '[[:space:]]+', ' ', 'g');
  if array_length(regexp_split_to_array(v_word,' '),1) not between 2 and 3 or v_word !~ '^[[:alpha:]]+( [[:alpha:]]+){1,2}$' then raise exception 'Từ cần có 2 hoặc 3 tiếng.'; end if;
  select * into v_player from players where room_code=p_code and token_hash=encode(digest(p_token::text,'sha256'),'hex') and active;
  if not found then raise exception 'Phiên người chơi không hợp lệ.'; end if;
  select * into v_room from rooms where code=p_code for update;
  if v_room.status <> 'playing' then raise exception 'Trò chơi không diễn ra.'; end if;
  if p_round <> v_room.current_round then raise exception 'Lượt chơi đã thay đổi, vui lòng chờ lượt mới.'; end if;
  if now() > v_room.round_started_at + interval '10 seconds' then raise exception 'Đã hết thời gian lượt này.'; end if;
  select * into v_round from rounds where room_code=p_code and round_number=v_room.current_round for update;
  if v_player.slot=1 then
    if v_round.player_1_word is not null then raise exception 'Bạn đã gửi từ ở lượt này.'; end if;
    update rounds set player_1_word=v_word where id=v_round.id returning * into v_round;
  else
    if v_round.player_2_word is not null then raise exception 'Bạn đã gửi từ ở lượt này.'; end if;
    update rounds set player_2_word=v_word where id=v_round.id returning * into v_round;
  end if;
  if v_round.player_1_word is not null and v_round.player_2_word is not null then
    v_match := lower(v_round.player_1_word)=lower(v_round.player_2_word);
    update rounds set resolved=true,ended_at=now(),is_match=v_match where id=v_round.id;
    if v_match then
      update rooms set status='finished',updated_at=now() where code=p_code;
    else
      update rooms set current_round=current_round+1,round_started_at=now(),updated_at=now() where code=p_code;
      insert into rounds(room_code,round_number,started_at) values(p_code,v_room.current_round+1,now());
    end if;
  end if;
  return jsonb_build_object('accepted',true);
end; $$;

create or replace function public.finish_expired_round(p_code text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_room rooms%rowtype; v_round rounds%rowtype; v_match boolean;
begin
  select * into v_room from rooms where code=p_code for update;
  if not found or v_room.status <> 'playing' or now() < v_room.round_started_at + interval '10 seconds' then return false; end if;
  select * into v_round from rounds where room_code=p_code and round_number=v_room.current_round for update;
  if v_round.resolved then return false; end if;
  v_match := v_round.player_1_word is not null and v_round.player_2_word is not null and lower(v_round.player_1_word)=lower(v_round.player_2_word);
  update rounds set resolved=true,ended_at=now(),is_match=v_match where id=v_round.id;
  if v_match then
    update rooms set status='finished',updated_at=now() where code=p_code;
  else
    update rooms set current_round=current_round+1,round_started_at=now(),updated_at=now() where code=p_code;
    insert into rounds(room_code,round_number,started_at) values(p_code,v_room.current_round+1,now());
  end if;
  return true;
end; $$;

create or replace function public.get_room_state(p_code text,p_token uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_player players%rowtype; v_room rooms%rowtype; v_players jsonb; v_rounds jsonb;
begin
  select * into v_player from players where room_code=p_code and token_hash=encode(digest(p_token::text,'sha256'),'hex') and active;
  if not found then raise exception 'Phiên người chơi không hợp lệ.'; end if;
  select * into v_room from rooms where code=p_code;
  if not found then raise exception 'Không tìm thấy phòng.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'ready',ready,'slot',slot) order by slot),'[]'::jsonb) into v_players from players where room_code=p_code and active;
  select coalesce(jsonb_agg(jsonb_build_object('number',round_number,'resolved',resolved,'is_match',is_match,'words',case when resolved then jsonb_build_array(player_1_word,player_2_word) else null end,'submissions',jsonb_build_object((select id::text from players where room_code=p_code and slot=1),(player_1_word is not null),(select id::text from players where room_code=p_code and slot=2),(player_2_word is not null))) order by round_number),'[]'::jsonb) into v_rounds from rounds where room_code=p_code;
  return jsonb_build_object('room',jsonb_build_object('code',v_room.code,'status',v_room.status,'round',v_room.current_round,'round_started_at',v_room.round_started_at),'players',v_players,'rounds',v_rounds);
end; $$;

create or replace function public.leave_room(p_code text,p_token uuid)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  select id into v_id from players where room_code=p_code and token_hash=encode(digest(p_token::text,'sha256'),'hex');
  if v_id is not null then update players set active=false,ready=false where id=v_id; end if;
  return true;
end; $$;

create or replace function public.play_again(p_code text,p_token uuid)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare v_room rooms%rowtype; v_id uuid;
begin
  select id into v_id from players where room_code=p_code and token_hash=encode(digest(p_token::text,'sha256'),'hex') and active;
  if v_id is null then raise exception 'Phiên người chơi không hợp lệ.'; end if;
  select * into v_room from rooms where code=p_code for update;
  if v_room.status <> 'finished' then raise exception 'Ván chơi chưa kết thúc.'; end if;
  delete from rounds where room_code=p_code;
  update players set ready=false where room_code=p_code and active;
  update rooms set status='waiting',current_round=0,round_started_at=null,updated_at=now() where code=p_code;
  return true;
end; $$;

revoke all on function public.create_room(text,uuid), public.join_room(text,text,uuid), public.set_player_ready(text,uuid,boolean), public.start_game(text,uuid), public.submit_word(text,uuid,integer,text), public.finish_expired_round(text), public.get_room_state(text,uuid), public.leave_room(text,uuid), public.play_again(text,uuid) from public;
grant execute on function public.create_room(text,uuid), public.join_room(text,text,uuid), public.set_player_ready(text,uuid,boolean), public.start_game(text,uuid), public.submit_word(text,uuid,integer,text), public.finish_expired_round(text), public.get_room_state(text,uuid), public.leave_room(text,uuid), public.play_again(text,uuid) to anon, authenticated;
