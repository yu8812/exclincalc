-- ═══════════════════════════════════════════════════════════════════
-- SEC-001b R1 — RLS 負向測試（在 Supabase SQL Editor 對已套用 migration 的 DB 執行）
--
-- 目的：證明一般 authenticated 用戶無法自我提權（改自己的 is_pro / pro_role）。
-- 前置：先跑 migrations/20260719_01_role_authority.sql。
--
-- 判讀（清楚可見，不靠 notice）：
--   ✅ 安全正常 → 結果會出現一行：ALL PASS ...
--   ❌ 安全破洞 → 跳出紅色錯誤：SECURITY FAIL: ...（提權沒被擋，請回報）
--   測試最後 rollback，不改動任何資料。
--
-- 註：<UID> 已填為一般用戶 william881207063@gmail.com（is_pro=false）。
--     若要測其他帳號，替換下方 v_uid 與 request.jwt.claims 的 sub 即可。
-- ═══════════════════════════════════════════════════════════════════

begin;

-- 模擬該用戶的 authenticated session
set local role authenticated;
set local request.jwt.claims = '{"sub":"42bdd433-3123-40be-b19c-f5189706da72","role":"authenticated"}';

do $$
declare
  v_uid uuid := '42bdd433-3123-40be-b19c-f5189706da72';
  v_blocked boolean;
begin
  -- 測試 1：自我提權 pro_role → 應被擋
  v_blocked := false;
  begin
    update public.profiles set pro_role = 'super_admin' where id = v_uid;
  exception when others then
    v_blocked := true;   -- 有 error = 被擋，符合預期
  end;
  if not v_blocked then
    raise exception 'SECURITY FAIL: pro_role 自我提權未被擋（可提權成 super_admin）';
  end if;

  -- 測試 2：自我開通 is_pro → 應被擋
  v_blocked := false;
  begin
    update public.profiles set is_pro = true where id = v_uid;
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'SECURITY FAIL: is_pro 自我開通未被擋';
  end if;
end $$;

-- 只有兩個測試都 PASS 才會執行到這行（否則上面已 raise 紅色錯誤中止）
select 'ALL PASS - 自我提權已被擋 (pro_role + is_pro 皆無法自改)' as result;

rollback;
