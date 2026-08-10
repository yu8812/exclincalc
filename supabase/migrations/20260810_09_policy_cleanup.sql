-- ============================================================
-- 09: RLS policy 冗餘清理（不改變任何實際存取權限）
-- 背景：權限矩陣核對時發現兩處冗餘（見 docs/permission-matrix.md 觀察）。
--   (1) profiles 有 3 條完全同義的 UPDATE policy（auth.uid()=id）→ 留 1 刪 2
--   (2) medications / medical_references 各有 1 條 legacy 寫入 policy，
--       以民眾端 `role` 欄位（非 pro_role）判定 → 實務上不命中、且語意混亂 → 刪除
-- 安全性：已核對「僅靠 legacy role-based policy 才有寫入權」的帳號數 = 0，故刪除不影響任何人。
-- 效果：policy 總數 41 → 37。所有對外引用數字需同步更新為 37。
-- ============================================================

-- (1) profiles 重複 UPDATE policy：保留 update_own_profile，刪除另兩條同義
drop policy if exists "Users update own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;

-- (2) medications / medical_references：刪除 legacy role-based 寫入 policy
--     （正確的 pro_role-based "Pro admins write ..." 保留）
drop policy if exists "Doctors can write medications" on public.medications;
drop policy if exists "Doctors can write medical_references" on public.medical_references;

select 'SEC-001 migration 09: policy 冗餘清理完成（41 → 37）' as status;
