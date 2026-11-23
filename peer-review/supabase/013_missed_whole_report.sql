-- 013：逐組開放的「晚到跳過」改為只跳過整場報告都錯過的組
-- 以前：老師開放某組之後才選名字，就跳過那組。結果第一組剛開放時還在掃 QR 的同學，少了第一組。
-- 現在：一組的報告到「下一組開放」時才算結束；只有在那之後才選名字，才跳過這組。
--       還沒有下一組開放（這組還在報告中），進來的同學都可以評。

create or replace function public._group_ended_at(p_group uuid)
 returns timestamptz
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select min(o.inter_opened_at) from groups t join groups o on o.activity_id = t.activity_id
  where t.id = p_group and t.inter_opened_at is not null and o.inter_opened_at > t.inter_opened_at
$function$;
revoke execute on function public._group_ended_at(uuid) from public, anon, authenticated;

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
    'other_groups', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'position', o.position, 'report_order', o.report_order,
                                                                  'opened_at', o.inter_opened_at, 'ended_at', _group_ended_at(o.id))
                                               order by o.report_order nulls last, o.position)
                              from groups o where o.activity_id = a.id and o.id <> g.id), '[]'::jsonb)
  );
end $function$;

create or replace function public.student_rate_group(p_code text, p_member uuid, p_token text, p_target uuid, p_scores jsonb, p_comment text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare m members; g groups; a activities; t groups; clean jsonb; ended timestamptz;
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
    ended := _group_ended_at(t.id);
    if m.arrived_at is not null and ended is not null and m.arrived_at > ended then
      raise exception '你進來時這組已經報告完了，這組不用評' using errcode = 'P0001';
    end if;
  end if;
  clean := _check_scores(a.id, 'inter', p_scores, a.scale_max);
  perform _check_texts(a.id, 'inter', p_comment);
  insert into inter_ratings (rater_id, target_group_id, scores, comment)
  values (m.id, t.id, clean, left(coalesce(p_comment, ''), 2000));
exception when unique_violation then
  raise exception '你已經評過這一組了' using errcode = 'P0001';
end $function$;
