-- 002：組內互評真正匿名、新增票選題、預設 5 點量尺
-- （不刪任何資料表：舊的 intra_ratings 改名保留，避免破壞性操作）

-- 1) 題型：score 分數 / text 填空 / pick 票選
alter table public.criteria add column qtype text not null default 'score' check (qtype in ('score','text','pick'));
update public.criteria set qtype = 'text' where is_text;

-- 2) 預設 5 點量尺；組內加分依據（pick = 依「最力推」得票，score = 依組員評分平均）
alter table public.activities alter column scale_max set default 5;
alter table public.activities add column bonus_basis text not null default 'pick' check (bonus_basis in ('pick','score'));

-- 3) 組內互評匿名：分數表不記錄評分者；另一張表只記「誰評過誰」用來防重複
alter table public.intra_ratings rename to intra_ratings_v1;
create table public.intra_scores (
  id uuid primary key default gen_random_uuid(),
  target_member_id uuid not null references public.members(id) on delete cascade,
  scores jsonb not null,
  comment text not null default ''
);
create table public.intra_done (
  rater_id uuid not null references public.members(id) on delete cascade,
  target_member_id uuid not null references public.members(id) on delete cascade,
  primary key (rater_id, target_member_id),
  check (rater_id <> target_member_id)
);
create index on public.intra_scores (target_member_id);

-- 4) 票選題：票本身只記投票者的組別；另記「誰答過哪一題」
create table public.pick_votes (
  id uuid primary key default gen_random_uuid(),
  criterion_id uuid not null references public.criteria(id) on delete cascade,
  voter_group_id uuid not null references public.groups(id) on delete cascade,
  target_group_id uuid references public.groups(id) on delete cascade,
  target_member_id uuid references public.members(id) on delete cascade,
  check ((target_group_id is null) <> (target_member_id is null))
);
create table public.pick_done (
  rater_id uuid not null references public.members(id) on delete cascade,
  criterion_id uuid not null references public.criteria(id) on delete cascade,
  primary key (rater_id, criterion_id)
);
create index on public.pick_votes (criterion_id);

do $$
declare t text;
begin
  foreach t in array array['intra_scores','intra_done','pick_votes','pick_done'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy teacher_all on public.%I for all to authenticated using (public.is_teacher()) with check (public.is_teacher())', t);
  end loop;
end $$;

-- 5) 函式更新
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
    'criteria', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'label', c.label, 'description', c.description, 'qtype', c.qtype) order by c.kind, c.position)
                          from criteria c where c.activity_id = a.id), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'claimed', m.claim_token is not null) order by m.position)
                         from members m where m.group_id = g.id), '[]'::jsonb),
    'other_groups', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) order by o.position)
                              from groups o where o.activity_id = a.id and o.id <> g.id), '[]'::jsonb)
  );
end $$;

create or replace function public.student_claim(p_code text, p_member uuid, p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare m members;
begin
  m := _student_member(p_code, p_member, p_token);
  return jsonb_build_object(
    'inter_done', coalesce((select jsonb_agg(target_group_id) from inter_ratings where rater_id = m.id), '[]'::jsonb),
    'intra_done', coalesce((select jsonb_agg(target_member_id) from intra_done where rater_id = m.id), '[]'::jsonb),
    'pick_done', coalesce((select jsonb_agg(criterion_id) from pick_done where rater_id = m.id), '[]'::jsonb)
  );
end $$;

create or replace function public._check_scores(p_activity uuid, p_kind text, p_scores jsonb, p_scale int)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c record; v numeric; clean jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(p_scores) <> 'object' then raise exception '分數格式錯誤' using errcode = 'P0001'; end if;
  for c in select id, label from criteria where activity_id = p_activity and kind = p_kind and qtype = 'score' loop
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
  insert into intra_done (rater_id, target_member_id) values (m.id, t.id);
  insert into intra_scores (target_member_id, scores, comment) values (t.id, clean, left(coalesce(p_comment, ''), 2000));
exception when unique_violation then
  raise exception '你已經評過這位組員了' using errcode = 'P0001';
end $$;

create or replace function public.student_pick(p_code text, p_member uuid, p_token text, p_criterion uuid, p_target uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare m members; a activities; c criteria;
begin
  m := _student_member(p_code, p_member, p_token);
  select a2.* into a from activities a2 join groups g on g.activity_id = a2.id where g.id = m.group_id;
  if not a.is_open then raise exception '老師尚未開放評分，或評分已結束' using errcode = 'P0001'; end if;
  select * into c from criteria where id = p_criterion and activity_id = a.id and qtype = 'pick';
  if not found then raise exception '找不到這個題目' using errcode = 'P0001'; end if;
  if c.kind = 'inter' then
    if not exists (select 1 from groups where id = p_target and activity_id = a.id and id <> m.group_id) then
      raise exception '只能選其他組' using errcode = 'P0001'; end if;
    insert into pick_done (rater_id, criterion_id) values (m.id, c.id);
    insert into pick_votes (criterion_id, voter_group_id, target_group_id) values (c.id, m.group_id, p_target);
  else
    if not a.intra_enabled then raise exception '這次活動沒有組內互評' using errcode = 'P0001'; end if;
    if not exists (select 1 from members where id = p_target and group_id = m.group_id and id <> m.id) then
      raise exception '只能選自己組內的其他組員' using errcode = 'P0001'; end if;
    insert into pick_done (rater_id, criterion_id) values (m.id, c.id);
    insert into pick_votes (criterion_id, voter_group_id, target_member_id) values (c.id, m.group_id, p_target);
  end if;
exception when unique_violation then
  raise exception '你已經回答過這一題了' using errcode = 'P0001';
end $$;

revoke all on function public._check_scores(uuid, text, jsonb, int) from public, anon, authenticated;
grant execute on function public.student_pick(text, uuid, text, uuid, uuid) to anon, authenticated;
