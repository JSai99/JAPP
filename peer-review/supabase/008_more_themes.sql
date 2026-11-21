-- 008：加入四款靜態背景主題（藍天白雲、晨曦、薄荷、紙張）
alter table public.activities drop constraint if exists activities_theme_check;
alter table public.activities add constraint activities_theme_check
  check (theme in ('plain', 'candle', 'starry', 'ember', 'bubble', 'pastel', 'sky', 'dawn', 'mint', 'paper'));
