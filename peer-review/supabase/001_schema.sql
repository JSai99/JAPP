-- 互評工具資料庫結構（Supabase / Postgres）
-- 學生端沒有任何資料表權限，只能透過下方的 student_* 函式讀寫；
-- 老師端需登入，且 email 必須列在 teachers 表中（teachers 的內容不放進 repo）。

create extension if not exists pgcrypto;

-- ── 老師名單 ─────────────────────────────────────────
create table public.teachers (
  email text primary key
);
alter table public.teachers enable row level security;

create or replace function public.is_teacher() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from teachers where email = lower(auth.jwt() ->> 'email'));
$$;

-- ── 互評活動（例：資料探勘 期中報告）─────────────────
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  scale_max int not null default 10 check (scale_max between 3 and 100),
  bonus_max numeric not null default 3 check (bonus_max >= 0),
  is_open boolean not null default false,
  intra_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- 評分面向：kind = inter（組間）或 intra（組內）；is_text = 填空題
create table public.criteria (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  kind text not null check (kind in ('inter','intra')),
  position int not null default 0,
  label text not null,
  description text not null default '',
  is_text boolean not null default false
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  position int not null default 0,
  name text not null,
  code text not null unique
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  position int not null default 0,
  name text not null,
  student_no text not null default '',
  claim_token text            -- 第一次在某支手機選這個名字時綁定，防止別人冒用
);

-- 組間評分：一位學生 × 一個其他組，一筆
create table public.inter_ratings (
  id uuid primary key default gen_random_uuid(),
  rater_id uuid not null references public.members(id) on delete cascade,
  target_group_id uuid not null references public.groups(id) on delete cascade,
  scores jsonb not null,      -- { criterion_id: 分數 }
  comment text not null default '',
  created_at timestamptz not null default now(),
  unique (rater_id, target_group_id)
);

-- 組內評分：一位學生 × 一位同組組員，一筆
create table public.intra_ratings (
  id uuid primary key default gen_random_uuid(),
  rater_id uuid not null references public.members(id) on delete cascade,
  target_member_id uuid not null references public.members(id) on delete cascade,
  scores jsonb not null,
  comment text not null default '',
  created_at timestamptz not null default now(),
  unique (rater_id, target_member_id),
  check (rater_id <> target_member_id)
);

create index on public.criteria (activity_id);
create index on public.groups (activity_id);
create index on public.members (group_id);
create index on public.inter_ratings (target_group_id);
create index on public.inter_ratings (rater_id);
create index on public.intra_ratings (target_member_id);
create index on public.intra_ratings (rater_id);

-- ── RLS：只有老師能直接讀寫資料表 ───────────────────
do $$
declare t text;
begin
  foreach t in array array['activities','criteria','groups','members','inter_ratings','intra_ratings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy teacher_all on public.%I for all to authenticated using (public.is_teacher()) with check (public.is_teacher())', t);
  end loop;
end $$;

-- ── 學生端函式 ───────────────────────────────────────
-- 內部：用代碼找組，並確認名字屬於該組、裝置綁定相符
create or replace function public._student_member(p_code text, p_member uuid, p_token text)
returns public.members
language plpgsql security definer set search_path = public as $$
declare g groups; m members;
begin
  select * into g from groups where code = upper(trim(p_code));
  if not found then raise exception '找不到這個組別代碼' using errcode = 'P0001'; end if;
  select * into m from members where id = p_member and group_id = g.id;
  if not found then raise exception '名單中沒有這位組員' using errcode = 'P0001'; end if;
  if p_token is null or length(p_token) < 16 then raise exception '裝置識別碼無效' using errcode = 'P0001'; end if;
  if m.claim_token is null then
    update members set claim_token = p_token where id = m.id;
    m.claim_token := p_token;
  elsif m.claim_token <> p_token then
    raise exception '這個名字已經在另一支手機上使用。若是你本人，請找老師重設。' using errcode = 'P0001';
  end if;
  return m;
end $$;

-- 輸入組別代碼：回傳活動、面向、自己組員、其他組別（不含任何分數）
create or replace function public.student_enter(p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare g groups; a activities;
begin
  select * into g from groups where code = upper(trim(p_code));
  if not found then raise exception '找不到這個組別代碼' using errcode = 'P0001'; end if;
  select * into a from activities where id = g.activity_id;
  return jsonb_build_object(
    'activity', jsonb_build_object('title', a.title, 'scale_max', a.scale_max, 'is_open', a.is_open, 'intra_enabled', a.intra_enabled),
    'group', jsonb_build_object('id', g.id, 'name', g.name),
    'criteria', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'label', c.label, 'description', c.description, 'is_text', c.is_text) order by c.kind, c.position)
                          from criteria c where c.activity_id = a.id), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'claimed', m.claim_token is not null) order by m.position)
                         from members m where m.group_id = g.id), '[]'::jsonb),
    'other_groups', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) order by o.position)
                              from groups o where o.activity_id = a.id and o.id <> g.id), '[]'::jsonb)
  );
end $$;

-- 選定自己的名字：綁定裝置，回傳已經送出過的對象
create or replace function public.student_claim(p_code text, p_member uuid, p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare m members;
begin
  m := _student_member(p_code, p_member, p_token);
  return jsonb_build_object(
    'inter_done', coalesce((select jsonb_agg(target_group_id) from inter_ratings where rater_id = m.id), '[]'::jsonb),
    'intra_done', coalesce((select jsonb_agg(target_member_id) from intra_ratings where rater_id = m.id), '[]'::jsonb)
  );
end $$;

-- 內部：檢查分數物件是否完整、在範圍內
create or replace function public._check_scores(p_activity uuid, p_kind text, p_scores jsonb, p_scale int)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c record; v numeric; clean jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(p_scores) <> 'object' then raise exception '分數格式錯誤' using errcode = 'P0001'; end if;
  for c in select id, label from criteria where activity_id = p_activity and kind = p_kind and not is_text loop
    if not (p_scores ? c.id::text) then raise exception '「%」還沒評分', c.label using errcode = 'P0001'; end if;
    begin
      v := (p_scores ->> c.id::text)::numeric;
    exception when others then
      raise exception '「%」的分數格式錯誤', c.label using errcode = 'P0001';
    end;
    if v is null or v <> trunc(v) or v < 1 or v > p_scale then
      raise exception '「%」的分數必須是 1 到 % 的整數', c.label, p_scale using errcode = 'P0001';
    end if;
    clean := clean || jsonb_build_object(c.id::text, v::int);
  end loop;
  return clean;
end $$;

-- 送出組間評分（一次一組；送出後不可修改）
create or replace function public.student_rate_group(p_code text, p_member uuid, p_token text,
                                                     p_target uuid, p_scores jsonb, p_comment text)
returns void
language plpgsql security definer set search_path = public as $$
declare m members; g groups; a activities; t groups; clean jsonb;
begin
  m := _student_member(p_code, p_member, p_token);
  select * into g from groups where id = m.group_id;
  select * into a from activities where id = g.activity_id;
  if not a.is_open then raise exception '老師尚未開放評分，或評分已結束' using errcode = 'P0001'; end if;
  select * into t from groups where id = p_target and activity_id = a.id;
  if not found then raise exception '找不到要評分的組別' using errcode = 'P0001'; end if;
  if t.id = g.id then raise exception '不能評自己的組' using errcode = 'P0001'; end if;
  clean := _check_scores(a.id, 'inter', p_scores, a.scale_max);
  insert into inter_ratings (rater_id, target_group_id, scores, comment)
  values (m.id, t.id, clean, left(coalesce(p_comment, ''), 2000));
exception when unique_violation then
  raise exception '你已經評過這一組了' using errcode = 'P0001';
end $$;

-- 送出組內評分（一次一位組員；送出後不可修改）
create or replace function public.student_rate_member(p_code text, p_member uuid, p_token text,
                                                      p_target uuid, p_scores jsonb, p_comment text)
returns void
language plpgsql security definer set search_path = public as $$
declare m members; a activities; t members; clean jsonb;
begin
  m := _student_member(p_code, p_member, p_token);
  select a2.* into a from activities a2 join groups g on g.activity_id = a2.id where g.id = m.group_id;
  if not a.is_open then raise exception '老師尚未開放評分，或評分已結束' using errcode = 'P0001'; end if;
  if not a.intra_enabled then raise exception '這次活動沒有組內互評' using errcode = 'P0001'; end if;
  select * into t from members where id = p_target and group_id = m.group_id;
  if not found then raise exception '只能評自己組內的組員' using errcode = 'P0001'; end if;
  if t.id = m.id then raise exception '不能評自己' using errcode = 'P0001'; end if;
  clean := _check_scores(a.id, 'intra', p_scores, a.scale_max);
  insert into intra_ratings (rater_id, target_member_id, scores, comment)
  values (m.id, t.id, clean, left(coalesce(p_comment, ''), 2000));
exception when unique_violation then
  raise exception '你已經評過這位組員了' using errcode = 'P0001';
end $$;

-- ── 權限 ─────────────────────────────────────────────
revoke all on function public._student_member(text, uuid, text) from public, anon, authenticated;
revoke all on function public._check_scores(uuid, text, jsonb, int) from public, anon, authenticated;
revoke all on function public.is_teacher() from public, anon;
grant execute on function public.is_teacher() to authenticated;
grant execute on function public.student_enter(text) to anon, authenticated;
grant execute on function public.student_claim(text, uuid, text) to anon, authenticated;
grant execute on function public.student_rate_group(text, uuid, text, uuid, jsonb, text) to anon, authenticated;
grant execute on function public.student_rate_member(text, uuid, text, uuid, jsonb, text) to anon, authenticated;
