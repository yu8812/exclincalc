-- ═══════════════════════════════════════════════════════════════════
-- 12：持久化限流（取代原本的 supabase/rate_limits.sql）
--
-- 程式裡的 checkRateLimit()（src/lib/rateLimit.ts）一直在呼叫 check_rate_limit，
-- 但 2026-10-03 檢查正式庫才發現這張表和函式從來沒建過 —— RPC 每次都失敗，
-- 而限流的設計是「失敗就放行」，所以 AI、註冊這些限流其實全部沒有作用。
--
-- 另外原本的寫法有個洞：check_rate_limit 是 SECURITY DEFINER，預設任何人（含 anon）都能呼叫，
-- 等於誰都可以拿別人的 bucket 名字去灌次數，把別人的 AI 額度用光，或塞一堆垃圾 bucket。
-- 這裡只開給 service_role（伺服器端），前端和匿名呼叫都會被拒。
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.rate_limits (
  bucket       text primary key,          -- 例："gemini-clinical:<userId>"、"ai-demo:day"
  count        integer not null default 0,
  window_start timestamptz not null default now()
);
alter table public.rate_limits enable row level security;
-- 不建任何 policy；表權限也收回，只有 service_role（BYPASSRLS）碰得到
revoke all on public.rate_limits from anon, authenticated;

create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

-- 原子檢查 + 遞增。回傳 true = 允許，false = 超過限制。視窗過期就重新計數。
-- 整段在同一個 upsert 裡完成，不會有兩個請求同時讀到舊值的問題。
create or replace function public.check_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.rate_limits (bucket, count, window_start)
    values (p_bucket, 1, now())
  on conflict (bucket) do update
    set count = case
          when rate_limits.window_start < now() - make_interval(secs => p_window_seconds) then 1
          else rate_limits.count + 1
        end,
        window_start = case
          when rate_limits.window_start < now() - make_interval(secs => p_window_seconds) then now()
          else rate_limits.window_start
        end
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke execute on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

select 'migration 12：限流表與 check_rate_limit 已建立（只限伺服器呼叫）' as status;
