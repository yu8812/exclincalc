-- ═══════════════════════════════════════════════════════════════════
-- 11：讓「照 repo 建出來的資料庫」和正式庫長得一樣（正式庫上不改變任何人的權限）
--
-- 2026-10-03 用腳本把正式庫和「用 repo 檔案從零建起來的測試庫」逐項比對
-- （policy、table/欄位權限、函式、trigger、欄位），profiles 的 policy 對不起來：
--   正式庫：read_own_profile（migration 10）＋ update_own_profile（不在任何 repo 檔案裡）
--   repo  ：read_own_profile ＋ 舊的 "Users read own profile"，而且完全沒有 UPDATE policy
-- 原因是 09 刪掉 "Users update own profile" 時，假設還有 update_own_profile 在，
-- 但那條只存在正式庫。照 repo 重建的話，使用者會改不了自己的名字和設定。
--
-- 這裡把兩邊收成同一個樣子，complete_setup.sql 也改成同樣的名字，重跑 base 檔不會再長出重複的。
-- 能改「哪些欄位」仍由 migration 01 的欄位權限和 profiles_privilege_guard trigger 把關，這裡不動。
-- ═══════════════════════════════════════════════════════════════════

drop policy if exists "Users read own profile" on public.profiles;   -- 和 read_own_profile 完全重複
drop policy if exists "update_own_profile" on public.profiles;
create policy "update_own_profile" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- rotate_health_records（每位使用者只保留最新 100 筆健康記錄的 trigger）是 SECURITY DEFINER，
-- 卻沒有固定 search_path。用不到外部輸入所以沒有實際風險，但照慣例補上。
alter function public.rotate_health_records() set search_path = public;

select 'migration 11：profiles policy 與正式庫對齊' as status;
