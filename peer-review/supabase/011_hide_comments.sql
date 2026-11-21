-- 011：老師可隱藏個別文字回饋（公布前先過目）。存被隱藏的題目 id；舊格式的單一評語用 '_'
alter table public.inter_ratings add column if not exists hidden_texts text[] not null default '{}';
alter table public.intra_scores add column if not exists hidden_texts text[] not null default '{}';
