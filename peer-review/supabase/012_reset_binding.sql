-- 012：老師按「重設」後要真的解除綁定
-- 以前評分、投票時若發現名字沒綁定，會順手重新綁回這支手機，導致重設無效。
-- 現在只有「選名字」(student_claim) 會綁定；其他動作遇到已被重設的名字會回報錯誤，前端改回選名字頁。
create or replace function public._student_member(p_code text, p_member uuid, p_token text, p_bind boolean)
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
    if not p_bind then raise exception '老師已重設你的名字，請重新選擇' using errcode = 'P0001'; end if;
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

-- 評分、投票用的三參數版本：只驗證，不綁定
create or replace function public._student_member(p_code text, p_member uuid, p_token text)
 returns members
 language sql
 security definer
 set search_path to 'public'
as $function$ select public._student_member(p_code, p_member, p_token, false) $function$;

create or replace function public.student_claim(p_code text, p_member uuid, p_token text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare m members;
begin
  m := _student_member(p_code, p_member, p_token, true);
  return jsonb_build_object(
    'inter_done', coalesce((select jsonb_agg(target_group_id) from inter_ratings where rater_id = m.id), '[]'::jsonb),
    'intra_done', coalesce((select jsonb_agg(target_member_id) from intra_done where rater_id = m.id), '[]'::jsonb),
    'pick_done', coalesce((select jsonb_agg(criterion_id) from pick_done where rater_id = m.id), '[]'::jsonb),
    'arrived_at', m.arrived_at,
    'makeup', m.makeup
  );
end $function$;

-- 內部函式，學生端不能直接呼叫
revoke execute on function public._student_member(text, uuid, text, boolean) from public, anon, authenticated;
