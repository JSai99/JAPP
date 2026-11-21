-- 010：組間評分逐組開放
-- 老師在每組開始報告時按「開放」，學生才能評那一組；開放後一直可評到活動結束。
-- 晚到的同學（第一次選名字的時間晚於某組開放時間）不評那一組，避免評到沒看到的報告。
-- 老師可對個別同學開「補評」（例：公假、手機出狀況），不受上述限制。
alter table public.activities add column if not exists inter_paced boolean not null default false;
alter table public.groups add column if not exists inter_opened_at timestamptz;
alter table public.members add column if not exists arrived_at timestamptz;
alter table public.members add column if not exists makeup boolean not null default false;

-- 第一次綁定時記下到場時間；老師重設綁定也不會改掉它
create or replace function public._student_member(p_code text, p_member uuid, p_token text)
 returns members
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare g groups; m members;
begin
  select * into g from groups where code = upper(trim(p_code));
  if not found then raise exception '找不到這個組別代碼' using errcode = 'P0001'; end if;
  select * into m from members where id = p_member and group_id = g.id;
  if not found then raise exception '名單中沒有這位組員' using errcode = 'P0001'; end if;
  if p_token is null or length(p_token) < 16 then raise exception '裝置識別碼無效' using errcode = 'P0001'; end if;
  if m.claim_token is null then
    if exists (select 1 from members x join groups y on y.id = x.group_id
               where y.activity_id = g.activity_id and x.claim_token = p_token and x.id <> m.id) then
      raise exception '這支手機已經選過其他名字，一支手機只能代表一位同學。若選錯了，請找老師重設。' using errcode = 'P0001';
    end if;
    update members set claim_token = p_token, arrived_at = coalesce(arrived_at, now()) where id = m.id
      returning * into m;
  elsif m.claim_token <> p_token then
    raise exception '這個名字已經在另一支手機上使用。若是你本人，請找老師重設。' using errcode = 'P0001';
  end if;
  return m;
end $function$;

create or replace function public.student_enter(p_code text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare g groups; a activities;
begin
  select * into g from groups where code = upper(trim(p_code));
  if not found then raise exception '找不到這個組別代碼' using errcode = 'P0001'; end if;
  select * into a from activities where id = g.activity_id;
  return jsonb_build_object(
    'activity', jsonb_build_object('title', a.title, 'scale_max', a.scale_max, 'is_open', a.is_open, 'intra_enabled', a.intra_enabled, 'theme', a.theme, 'inter_paced', a.inter_paced),
    'group', jsonb_build_object('id', g.id, 'name', g.name, 'position', g.position, 'report_order', g.report_order),
    'criteria', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'label', c.label, 'description', c.description, 'qtype', c.qtype, 'required', c.required) order by c.kind, c.position)
                          from criteria c where c.activity_id = a.id), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'claimed', m.claim_token is not null) order by m.position)
                         from members m where m.group_id = g.id), '[]'::jsonb),
    'other_groups', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'position', o.position, 'report_order', o.report_order, 'opened_at', o.inter_opened_at)
                                               order by o.report_order nulls last, o.position)
                              from groups o where o.activity_id = a.id and o.id <> g.id), '[]'::jsonb)
  );
end $function$;

create or replace function public.student_claim(p_code text, p_member uuid, p_token text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare m members;
begin
  m := _student_member(p_code, p_member, p_token);
  return jsonb_build_object(
    'inter_done', coalesce((select jsonb_agg(target_group_id) from inter_ratings where rater_id = m.id), '[]'::jsonb),
    'intra_done', coalesce((select jsonb_agg(target_member_id) from intra_done where rater_id = m.id), '[]'::jsonb),
    'pick_done', coalesce((select jsonb_agg(criterion_id) from pick_done where rater_id = m.id), '[]'::jsonb),
    'arrived_at', m.arrived_at,
    'makeup', m.makeup
  );
end $function$;

create or replace function public.student_rate_group(p_code text, p_member uuid, p_token text, p_target uuid, p_scores jsonb, p_comment text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare m members; g groups; a activities; t groups; clean jsonb;
begin
  m := _student_member(p_code, p_member, p_token);
  select * into g from groups where id = m.group_id;
  select * into a from activities where id = g.activity_id;
  if not a.is_open then raise exception '老師尚未開放評分，或評分已結束' using errcode = 'P0001'; end if;
  select * into t from groups where id = p_target and activity_id = a.id;
  if not found then raise exception '找不到要評分的組別' using errcode = 'P0001'; end if;
  if t.id = g.id then raise exception '不能評自己的組' using errcode = 'P0001'; end if;
  if a.inter_paced and not m.makeup then
    if t.inter_opened_at is null then raise exception '這組還沒開始報告，報告時老師會開放評分' using errcode = 'P0001'; end if;
    if m.arrived_at is not null and m.arrived_at > t.inter_opened_at then
      raise exception '你進來時這組已經開始報告，這組不用評' using errcode = 'P0001';
    end if;
  end if;
  clean := _check_scores(a.id, 'inter', p_scores, a.scale_max);
  perform _check_texts(a.id, 'inter', p_comment);
  insert into inter_ratings (rater_id, target_group_id, scores, comment)
  values (m.id, t.id, clean, left(coalesce(p_comment, ''), 2000));
exception when unique_violation then
  raise exception '你已經評過這一組了' using errcode = 'P0001';
end $function$;
