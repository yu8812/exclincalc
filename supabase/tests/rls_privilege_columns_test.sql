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
  v_role_before text;
  v_role_after text;
begin
  select pro_role into v_role_before from public.profiles where id = v_uid;

  -- 測試 1：自我提權 pro_role → 應被擋（error 或 0 rows 都算被擋，之後再 reload 確認）
  v_blocked := false;
  begin
    update public.profiles set pro_role = 'super_admin' where id = v_uid;
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'SECURITY FAIL: pro_role 自我提權未被 error 擋下';
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

  -- 正向對照：安全欄位 name 應可更新（證明不是全面拒絕、測試 setup 正確）
  begin
    update public.profiles set name = 'RLS positive control' where id = v_uid;
  exception when others then
    raise exception 'SETUP ERROR: 連安全欄位 name 都不能更新，測試環境有問題（非安全結論）';
  end;

  -- Reload 確認：pro_role 沒有被改動
  select pro_role into v_role_after from public.profiles where id = v_uid;
  if v_role_after is distinct from v_role_before then
    raise exception 'SECURITY FAIL: reload 後 pro_role 竟被改變 (% -> %)', v_role_before, v_role_after;
  end if;
end $$;

-- 只有兩個測試都 PASS 才會執行到這行（否則上面已 raise 紅色錯誤中止）
select 'ALL PASS - 自我提權已被擋 (pro_role + is_pro 皆無法自改)' as result;

rollback;
