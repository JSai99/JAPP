-- 006：報告順序（課堂上抽籤決定），學生頁的「評其他組」依此排序
alter table public.groups add column if not exists report_order int;

-- student_enter：other_groups 依 report_order 排序（未排的放最後），並回傳 report_order
-- （完整函式內容同 005，僅 group / other_groups 欄位與排序不同）
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
    'group', jsonb_build_object('id', g.id, 'name', g.name, 'position', g.position, 'report_order', g.report_order),
    'criteria', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'label', c.label, 'description', c.description, 'qtype', c.qtype, 'required', c.required) order by c.kind, c.position)
                          from criteria c where c.activity_id = a.id), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'claimed', m.claim_token is not null) order by m.position)
                         from members m where m.group_id = g.id), '[]'::jsonb),
    'other_groups', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'position', o.position, 'report_order', o.report_order)
                                               order by o.report_order nulls last, o.position)
                              from groups o where o.activity_id = a.id and o.id <> g.id), '[]'::jsonb)
  );
end $function$;
