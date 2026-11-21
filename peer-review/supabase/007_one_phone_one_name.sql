-- 007：一支手機在同一個活動只能綁一個名字（不能換代碼或換名字幫別人評）
create or replace function public._student_member(p_code text, p_member uuid, p_token text)
 returns members language plpgsql security definer set search_path to 'public'
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
    update members set claim_token = p_token where id = m.id;
    m.claim_token := p_token;
  elsif m.claim_token <> p_token then
    raise exception '這個名字已經在另一支手機上使用。若是你本人，請找老師重設。' using errcode = 'P0001';
  end if;
  return m;
end $function$;
