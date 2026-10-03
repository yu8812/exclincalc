-- ═══════════════════════════════════════════════════════════════════
-- 14：病歷異動稽核（THREAT_MODEL 的 T1、R1、T5）
--
-- 之前 THREAT_MODEL 寫「稽核 log 記錄每次 UPDATE」，實際上病歷和 SOAP 筆記完全沒有稽核。
-- 這裡補上：clinical_records、soap_notes 每一次新增／修改／刪除，都由資料庫 trigger
-- 寫一筆到 clinical_audit_log，內容包括改之前和改之後的整筆資料、操作者、當下角色、IP、瀏覽器。
--
-- 設計上的取捨：
--   * 另開新表，不動既有的 audit_logs（那張是管理員帳號操作在用，欄位不同）。
--   * 資料只能從 trigger 進來：沒有任何 INSERT／UPDATE／DELETE policy，表權限也只給 SELECT。
--   * 稽核寫入失敗，原本的寫入就一起失敗（fail-closed）——寧可存不進去，也不要留下沒紀錄的修改。
--   * 拿不到 request header 時（伺服器端、SQL editor、測試）ip / user_agent 存 null，不報錯。
--   * IP 是從 header 取的，只能當參考：cf-connecting-ip 由 Cloudflare 填，比較可信；
--     x-forwarded-for 第一段可能被客戶端自己塞值。
--   * 內容完全沒變的 UPDATE（例如自動存檔送了一樣的東西）不記，只差 updated_at 也算沒變。
--   * 讀取只開給通過 MFA 的真管理員（is_current_admin()，migration 13）。交辦文件原本建議用
--     is_active_role_aal2，但那個函式對展示帳號免 MFA，會讓公開密碼的展示 admin 看到 IP，所以不用。
--   * 沒有保留期限，也沒有自動清除；要清只能由資料庫管理者手動做。
--   * 沒有記錄「誰讀了病歷」（SELECT 稽核），那要另外的機制，成本也高，列為待辦。
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.clinical_audit_log (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  table_name  text not null,
  row_id      uuid,
  action      text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor_id    uuid,   -- auth.uid()；伺服器端（service role）或 SQL editor 操作時是 null
  actor_role  text,   -- 當下的 pro_role（doctor / pharmacist …），不是 pro 使用者就是 null
  jwt_role    text,   -- authenticated / service_role；SQL editor 是 null
  old_row     jsonb,  -- UPDATE、DELETE 才有
  new_row     jsonb,  -- INSERT、UPDATE 才有
  ip          text,
  user_agent  text
);

create index if not exists clinical_audit_log_row_idx   on public.clinical_audit_log (table_name, row_id, occurred_at desc);
create index if not exists clinical_audit_log_actor_idx on public.clinical_audit_log (actor_id, occurred_at desc);

alter table public.clinical_audit_log enable row level security;
revoke all on public.clinical_audit_log from anon, authenticated;
grant select on public.clinical_audit_log to authenticated;

drop policy if exists "Admins read clinical audit log" on public.clinical_audit_log;
create policy "Admins read clinical audit log" on public.clinical_audit_log
  for select to authenticated using (public.is_current_admin());

-- ── request header（PostgREST 會把整包 header 以 JSON 放在 request.headers）───
create or replace function public.audit_request_header(p_name text)
returns text language plpgsql stable set search_path = public as $$
declare
  h jsonb;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;   -- header 不是合法 JSON，也不能讓病歷寫入失敗
  end;
  return nullif(h ->> lower(p_name), '');
end;
$$;

create or replace function public.audit_client_ip()
returns text language sql stable set search_path = public as $$
  select coalesce(
    public.audit_request_header('cf-connecting-ip'),
    nullif(btrim(split_part(public.audit_request_header('x-forwarded-for'), ',', 1)), ''),
    public.audit_request_header('x-real-ip')
  );
$$;

-- ── trigger ─────────────────────────────────────────────────────────
create or replace function public.log_clinical_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_role  text;
begin
  if tg_op = 'UPDATE' and (to_jsonb(old) - 'updated_at') = (to_jsonb(new) - 'updated_at') then
    return null;
  end if;

  if v_actor is not null then
    select pro_role into v_role from public.profiles where id = v_actor;
  end if;

  insert into public.clinical_audit_log
    (table_name, row_id, action, actor_id, actor_role, jwt_role, old_row, new_row, ip, user_agent)
  values (
    tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    tg_op,
    v_actor,
    v_role,
    auth.jwt() ->> 'role',
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    public.audit_client_ip(),
    public.audit_request_header('user-agent')
  );
  return null;   -- AFTER trigger，回傳值不影響原本的寫入
end;
$$;

-- 這三個函式只給 trigger 內部用，不開放成 API
revoke execute on function public.log_clinical_change() from public, anon, authenticated;
revoke execute on function public.audit_request_header(text) from public, anon, authenticated;
revoke execute on function public.audit_client_ip() from public, anon, authenticated;

drop trigger if exists clinical_records_audit on public.clinical_records;
create trigger clinical_records_audit
  after insert or update or delete on public.clinical_records
  for each row execute function public.log_clinical_change();

drop trigger if exists soap_notes_audit on public.soap_notes;
create trigger soap_notes_audit
  after insert or update or delete on public.soap_notes
  for each row execute function public.log_clinical_change();

select 'migration 14：clinical_records / soap_notes 異動稽核已啟用' as status;
