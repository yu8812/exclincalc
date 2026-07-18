-- ═══════════════════════════════════════════════════════════════════
-- SEC-001b R1 — RLS 負向測試（在 Supabase SQL Editor 對已套用 migration 的 DB 執行）
--
-- 目的：證明一般 authenticated 用戶無法自我提權（改自己的 is_pro / pro_role）。
-- 前置：先跑 migrations/20260719_01_role_authority.sql。
-- 用法：把 <UID> 換成一個實際的一般用戶 auth uid（doctor 未開通者最佳）。
-- 預期：兩個 UPDATE 都應該 ERROR；SELECT 名字更新應成功。
-- ═══════════════════════════════════════════════════════════════════

begin;

-- 模擬該用戶的 authenticated session
set local role authenticated;
set local request.jwt.claims = '{"sub":"<UID>","role":"authenticated"}';

-- 1) 嘗試自我提權為 super_admin —— 應失敗（column privilege / trigger 擋下）
do $$
begin
  begin
    update public.profiles set pro_role = 'super_admin' where id = '<UID>';
    raise exception 'FAIL: pro_role 自我提權竟成功（應被拒）';
  exception when insufficient_privilege or raise_exception then
    raise notice 'PASS: pro_role 自我提權被拒';
  end;
end $$;

-- 2) 嘗試自我開通 is_pro —— 應失敗
do $$
begin
  begin
    update public.profiles set is_pro = true where id = '<UID>';
    raise exception 'FAIL: is_pro 自我開通竟成功（應被拒）';
  exception when insufficient_privilege or raise_exception then
    raise notice 'PASS: is_pro 自我開通被拒';
  end;
end $$;

-- 3) 更新安全欄位（name）—— 應成功
update public.profiles set name = 'RLS test name' where id = '<UID>';
-- 若上一行沒 error 即 PASS

rollback;  -- 測試不留痕跡
