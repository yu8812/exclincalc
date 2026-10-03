-- ═══════════════════════════════════════════════════════════════════
-- 13：管理權收緊 + 展示帳號沙盒 + 修掉資源庫的公開改寫
--
-- 2026-10-03 在測試庫用「匿名 / 一般註冊用戶 / 展示 admin / 未過 MFA 的醫師」四種身分，
-- 對每張表實際試讀、改、刪（都在 rollback 的交易裡），找到下面幾個洞，正式庫的 policy 也一樣：
--
-- (1) pro_resources 的 "Pro users update cover on public resources" 是 TO public、USING (is_public)。
--     任何登入者（民眾端開放註冊）都能改掉 22 筆公開資源的標題和連結，例如換成釣魚網址；
--     migration 10 之前連 anon 都可以。新增和「管理自己的資源」也沒檢查 is_public，
--     一般用戶可以自己發佈「公開」資源給所有醫師看到。
-- (2) 管理權只看 pro_role，不看 MFA、也不排除展示帳號。展示 admin 的密碼寫在 README，
--     等於任何人都能改藥物資料庫、醫療參考值、資源庫，還能讀 audit_logs 和所有人的 profile（含真實 email）。
-- (3) 展示帳號免 MFA（migration 08）本來只為了讓審查者看虛構資料，但跟「護理師／管理員可讀全院病患」
--     的角色疊在一起後，展示帳號其實讀得到全院的病患與病歷。目前正式庫的病患資料全部屬於展示帳號，
--     所以還沒有真資料外洩，但只要有一位真的醫師開始用，就會被公開密碼看到。
-- (4) audit_logs 的 "Users insert own logs" 讓任何登入者都能寫入自己名下的稽核紀錄（可偽造），
--     而且這和 complete_setup.sql 寫的「前端不可直接寫」相反。insert_audit_log() 是沒人用的
--     SECURITY DEFINER 函式，連 anon 都能執行。
--
-- 這裡的修法：
--   * is_current_admin() 改成「admin + is_pro + 不是展示帳號 + 這次登入有過 MFA（aal2）」
--   * 藥物、參考值、資源庫的管理寫入，以及 audit_logs 的讀取，全部改用 is_current_admin()
--   * 一般 pro 使用者只能新增／修改「自己的、不公開的」資源；公開資源只有管理員能動
--   * 展示帳號沙盒：8 張含病患資料的表各加一條 RESTRICTIVE policy，
--     展示帳號只碰得到「資料擁有者也是展示帳號」的列（非展示帳號完全不受影響）
--   * audit_logs 只剩伺服器（service role）能寫；刪掉 insert_audit_log()
--
-- complete_setup.sql 與 clinic_flow.sql 同步改成一樣的定義，重跑 base 檔不會把洞開回來。
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. 管理員判斷 ───────────────────────────────────────────────────
create or replace function public.is_current_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select (auth.jwt() ->> 'aal') = 'aal2'
     and exists (
       select 1 from public.profiles
       where id = auth.uid() and is_pro = true
         and pro_role in ('admin', 'super_admin')
         and is_demo = false
     );
$$;
revoke execute on function public.is_current_admin() from public, anon;
grant execute on function public.is_current_admin() to authenticated;
-- 用到它的 policy：Admins read all profiles（profiles）、下面新建的幾條、migration 14 的 clinical_audit_log

-- ── 2. 藥物資料庫、醫療參考值：只有管理員能寫 ───────────────────────
drop policy if exists "Pro admins write medications" on public.medications;
create policy "Pro admins write medications" on public.medications
  for all to authenticated
  using (public.is_current_admin()) with check (public.is_current_admin());

drop policy if exists "Pro admins write medical_references" on public.medical_references;
create policy "Pro admins write medical_references" on public.medical_references
  for all to authenticated
  using (public.is_current_admin()) with check (public.is_current_admin());

-- ── 3. 資源庫 ───────────────────────────────────────────────────────
drop policy if exists "Pro users update cover on public resources" on public.pro_resources;
drop policy if exists "Pro users create resources" on public.pro_resources;
drop policy if exists "Creators manage own resources" on public.pro_resources;
drop policy if exists "Admins manage all resources" on public.pro_resources;
drop policy if exists "Pro users manage own private resources" on public.pro_resources;

-- 預設改成不公開：漏填 is_public 的新增不該變成公開資源
alter table public.pro_resources alter column is_public set default false;

-- 讀取不變（"Pro users read public resources"：公開的，或自己建的）
create policy "Pro users manage own private resources" on public.pro_resources
  for all to authenticated
  using (created_by = auth.uid() and public.is_active_pro_aal2())
  with check (created_by = auth.uid() and is_public = false and public.is_active_pro_aal2());

create policy "Admins manage all resources" on public.pro_resources
  for all to authenticated
  using (public.is_current_admin()) with check (public.is_current_admin());

-- ── 4. audit_logs：只有伺服器能寫，管理員能讀 ───────────────────────
drop policy if exists "Users insert own logs" on public.audit_logs;
drop policy if exists "Admins read audit logs" on public.audit_logs;
create policy "Admins read audit logs" on public.audit_logs
  for select to authenticated using (public.is_current_admin());

drop function if exists public.insert_audit_log(text, text, text, jsonb);

-- ── 5. 表權限：匿名不需要寫這幾張表，稽核紀錄也不需要讓前端寫 ───────
revoke insert, update, delete, truncate on public.medications, public.medical_references, public.pro_resources from anon;
revoke all on public.audit_logs from anon;
revoke insert, update, delete, truncate on public.audit_logs from authenticated;

-- ── 6. 展示帳號沙盒 ─────────────────────────────────────────────────
create or replace function public.is_demo_account(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_demo from public.profiles where id = p_user), false);
$$;
revoke execute on function public.is_demo_account(uuid) from public, anon;
grant execute on function public.is_demo_account(uuid) to authenticated;

-- 呼叫者不是展示帳號 → 不受限制；是展示帳號 → 資料擁有者也必須是展示帳號
create or replace function public.within_demo_sandbox(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not public.is_demo_user() or public.is_demo_account(p_owner);
$$;
revoke execute on function public.within_demo_sandbox(uuid) from public, anon;
grant execute on function public.within_demo_sandbox(uuid) to authenticated;

-- triage_vitals 沒有醫師欄位，擁有者是病患的主治醫師
create or replace function public.patient_owner(p_patient uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select doctor_id from public.doctor_patients where id = p_patient;
$$;
revoke execute on function public.patient_owner(uuid) from public, anon;
grant execute on function public.patient_owner(uuid) to authenticated;

do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('doctor_patients',         'doctor_id'),
      ('clinical_records',        'doctor_id'),
      ('soap_notes',              'doctor_id'),
      ('drug_interaction_checks', 'doctor_id'),
      ('appointments',            'doctor_id'),
      ('patient_consents',        'doctor_id'),
      ('health_records',          'user_id'),
      ('triage_vitals',           'public.patient_owner(patient_id)')
    ) as v(tbl, owner_expr)
  loop
    execute format('drop policy if exists "restrict_demo_sandbox" on public.%I', t.tbl);
    execute format(
      'create policy "restrict_demo_sandbox" on public.%I as restrictive for all to authenticated '
      || 'using (public.within_demo_sandbox(%s)) with check (public.within_demo_sandbox(%s))',
      t.tbl, t.owner_expr, t.owner_expr);
  end loop;
end $$;

select 'migration 13：管理權收緊、資源庫修補、展示帳號沙盒已套用' as status;
