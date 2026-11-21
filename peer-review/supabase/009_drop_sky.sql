-- 009：移除「藍天白雲」主題，已選用的活動改回素雅
update public.activities set theme = 'plain' where theme = 'sky';
alter table public.activities drop constraint if exists activities_theme_check;
alter table public.activities add constraint activities_theme_check
  check (theme in ('plain', 'candle', 'starry', 'ember', 'bubble', 'pastel', 'dawn', 'mint', 'paper'));
