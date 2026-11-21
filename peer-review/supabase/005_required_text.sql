-- 005：填空題可設為必填
alter table public.criteria add column if not exists required boolean not null default false;

create or replace function public._check_texts(p_act uuid, p_kind text, p_comment text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare o jsonb; c record;
begin
  begin o := nullif(p_comment, '')::jsonb; exception when others then o := null; end;
  for c in select id, label from criteria where activity_id = p_act and kind = p_kind and qtype = 'text' and required order by position loop
    if o is null or jsonb_typeof(o) <> 'object' or coalesce(btrim(o ->> c.id::text), '') = '' then
      raise exception '請填寫：%', c.label using errcode = 'P0001';
    end if;
  end loop;
end $function$;
revoke all on function public._check_texts(uuid, text, text) from public, anon, authenticated;

create or replace function public.student_rate_group(p_code text, p_member uuid, p_token text, p_target uuid, p_scores jsonb, p_comment text)
 returns void language plpgsql security definer set search_path to 'public'
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
  clean := _check_scores(a.id, 'inter', p_scores, a.scale_max);
  perform _check_texts(a.id, 'inter', p_comment);
  insert into inter_ratings (rater_id, target_group_id, scores, comment)
  values (m.id, t.id, clean, left(coalesce(p_comment, ''), 2000));
exception when unique_violation then
  raise exception '你已經評過這一組了' using errcode = 'P0001';
end $function$;

create or replace function public.student_rate_member(p_code text, p_member uuid, p_token text, p_target uuid, p_scores jsonb, p_comment text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
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
  perform _check_texts(a.id, 'intra', p_comment);
  insert into intra_done (rater_id, target_member_id) values (m.id, t.id);
  insert into intra_scores (target_member_id, scores, comment) values (t.id, clean, left(coalesce(p_comment, ''), 2000));
exception when unique_violation then
  raise exception '你已經評過這位組員了' using errcode = 'P0001';
end $function$;

create or replace function public.student_enter(p_code text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare g groups; a activities;
begin
  select * into g from groups where code = upper(trim(p_code));
  if not found then raise exception '找不到這個組別代碼' using errcode = 'P0001'; end if;
  select * into a from activities where id = g.activity_id;
  return jsonb_build_object(
    'activity', jsonb_build_object('title', a.title, 'scale_max', a.scale_max, 'is_open', a.is_open, 'intra_enabled', a.intra_enabled, 'theme', a.theme),
    'group', jsonb_build_object('id', g.id, 'name', g.name, 'position', g.position),
    'criteria', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'label', c.label, 'description', c.description, 'qtype', c.qtype, 'required', c.required) order by c.kind, c.position)
                          from criteria c where c.activity_id = a.id), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'claimed', m.claim_token is not null) order by m.position)
                         from members m where m.group_id = g.id), '[]'::jsonb),
    'other_groups', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'position', o.position) order by o.position)
                              from groups o where o.activity_id = a.id and o.id <> g.id), '[]'::jsonb)
  );
end $function$;
