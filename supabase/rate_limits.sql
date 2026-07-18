-- 持久化速率限制（跨 Cloudflare Workers isolate 有效）
--
-- 為什麼需要：原本各 API route 用 in-memory Map 計數，但部署在 Cloudflare Workers
-- 時每個 isolate 記憶體獨立且隨時重置、跨節點不共享 → 限流形同虛設。
-- 改用共用 Postgres 表 + 原子 RPC，計數對所有 isolate 一致。
--
-- 兩個子系統共用同一份 Supabase，此表兩邊皆可用。

create table if not exists rate_limits (
  bucket       text primary key,          -- 例："gemini:<userId>"、"register:<ip>"
  count        integer not null default 0,
  window_start timestamptz not null default now()
);

alter table rate_limits enable row level security;
-- 僅 service_role 可存取（一般用戶不得讀寫）。不建立任何 anon/authenticated policy → 預設全拒。

-- 原子檢查 + 遞增。回傳 true = 允許，false = 超過限制。
-- 視窗過期時自動重置計數。整段在單一 upsert 內完成，避免競態。
create or replace function check_rate_limit(
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
  insert into rate_limits(bucket, count, window_start)
    values (p_bucket, 1, now())
  on conflict (bucket) do update
    set count = case
          when rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
          then 1
          else rate_limits.count + 1
        end,
        window_start = case
          when rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
          then now()
          else rate_limits.window_start
        end
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

-- 清理舊 bucket（可選，交給排程或手動；避免表無限成長）
create index if not exists rate_limits_window_idx on rate_limits(window_start);
