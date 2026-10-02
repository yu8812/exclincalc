-- ============================================================
-- 10: 修補 profiles 公開外洩（CRITICAL，2026-10-03 自我稽核發現）
--
-- 問題：線上存在一條「不在版控」的 policy：
--     service_role_all  ON profiles  FOR ALL  TO public  USING (true) WITH CHECK (true)
--   它綁的是 public（含未登入的 anon），permissive policy 以 OR 疊加，因此：
--   1. 未登入者用前端公開的 anon key 即可讀取全部使用者 email / 姓名 / 生日 / 執照號（已實測：HTTP 200，8 筆）
--   2. anon / authenticated 具 profiles 的 INSERT、DELETE 權限 → 可刪除全部 profile
--   3. profiles_privilege_guard 只攔 UPDATE 不攔 INSERT → 可「刪掉自己的 profile 再 INSERT 一筆 super_admin」自我提權
--   service_role 本身具 BYPASSRLS，這條 policy 從來就不需要；判斷為某次在後台手動建立。
--
-- 修法：
--   (a) 刪除 service_role_all
--   (b) 線上另有一條也不在版控、但正確且必要的 read_own_profile → 收進版控，讓 fresh install 與線上一致
--   (c) 縱深防禦：profiles 只能由 signup trigger（handle_new_user，SECURITY DEFINER）與 service role 建立/刪除，
--       收回 anon / authenticated 的 INSERT、DELETE；anon 不需要 profiles 的任何權限。
--
-- 不受影響（已逐一核對）：註冊建檔（SECURITY DEFINER trigger）、使用者改自己的姓名/性別/生日（UPDATE + 欄位 grant）、
--   管理 API（service role）、middleware / loadCaller 讀自己的 profile（read_own_profile）。
-- ============================================================

-- (a)
drop policy if exists "service_role_all" on public.profiles;

-- (b)
drop policy if exists "read_own_profile" on public.profiles;
create policy "read_own_profile" on public.profiles
  for select to authenticated
  using (auth.uid() = id);

-- (c)
revoke insert, delete on public.profiles from authenticated;
revoke all on public.profiles from anon;

select 'migration 10: profiles 公開外洩已修補' as status;
