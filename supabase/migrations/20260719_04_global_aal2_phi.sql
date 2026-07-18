-- ═══════════════════════════════════════════════════════════════════
-- SEC-001d RR8 — 把 AAL2 + 目前 is_pro 擴到所有病歷/臨床表
--
-- 問題：先前只有 health_records 的 consent path 要求 aal2；其他病歷表
--   （doctor_patients / clinical_records / soap_notes / drug_interaction_checks /
--    appointments / triage_vitals）只檢查 auth.uid()=doctor_id 或 is_pro，
--   aal1 session（有密碼、沒過 MFA）仍可直接用 Data API 讀寫病患 PHI；
--   被停權（is_pro=false）但 session 還在的帳號也可能保有存取。
--
-- 修法：所有臨床表的 pro 存取都要求「目前 is_pro=true 且 session 為 aal2」，
--   並依角色細分。停權後即失去存取（is_pro 檢查為即時）。
--
-- ⚠️ 套用前提：所有 pro 帳號（含 demo）必須已 enroll MFA（否則為 aal1、將失去存取）。
--    這是 RR8 的本意（沒 MFA 不能碰 PHI）。請與「demo 綁 MFA + 部署」一起規劃，
--    不要在 demo 帳號還沒綁 MFA 時就套到正在展示的環境。
-- ═══════════════════════════════════════════════════════════════════

-- helper：目前 session 為 aal2 且帳號仍為 is_pro（SECURITY DEFINER 避免遞迴）
create or replace function public.is_active_pro_aal2()
returns boolean
language sql stable security definer set search_path = public as $$
  select (auth.jwt() ->> 'aal') = 'aal2'
     and exists (select 1 from public.profiles where id = auth.uid() and is_pro = true);
$$;
revoke execute on function public.is_active_pro_aal2() from public, anon;
grant execute on function public.is_active_pro_aal2() to authenticated;

-- helper：目前 session 為 aal2 且為指定角色之一
create or replace function public.is_active_role_aal2(p_roles text[])
returns boolean
language sql stable security definer set search_path = public as $$
  select (auth.jwt() ->> 'aal') = 'aal2'
     and exists (
       select 1 from public.profiles
       where id = auth.uid() and is_pro = true and pro_role = any(p_roles)
     );
$$;
revoke execute on function public.is_active_role_aal2(text[]) from public, anon;
grant execute on function public.is_active_role_aal2(text[]) to authenticated;

-- ── doctor_patients ────────────────────────────────────────────────
drop policy if exists "Doctors manage own patients" on public.doctor_patients;
create policy "Doctors manage own patients" on public.doctor_patients
  for all using (auth.uid() = doctor_id and public.is_active_pro_aal2());

drop policy if exists "Nurses and admins read all patients" on public.doctor_patients;
create policy "Nurses and admins read all patients" on public.doctor_patients
  for select using (
    public.is_active_role_aal2(array['nurse','admin','super_admin','admin_staff'])
  );

-- ── clinical_records ───────────────────────────────────────────────
drop policy if exists "Doctors manage own clinical records" on public.clinical_records;
create policy "Doctors manage own clinical records" on public.clinical_records
  for all using (auth.uid() = doctor_id and public.is_active_pro_aal2());

drop policy if exists "Nurses read all clinical records" on public.clinical_records;
create policy "Nurses read all clinical records" on public.clinical_records
  for select using (
    public.is_active_role_aal2(array['nurse','admin','super_admin','admin_staff'])
  );

-- ── soap_notes ─────────────────────────────────────────────────────
drop policy if exists "Doctors manage own notes" on public.soap_notes;
create policy "Doctors manage own notes" on public.soap_notes
  for all using (auth.uid() = doctor_id and public.is_active_pro_aal2());

-- ── drug_interaction_checks ────────────────────────────────────────
drop policy if exists "Doctors manage own interaction logs" on public.drug_interaction_checks;
create policy "Doctors manage own interaction logs" on public.drug_interaction_checks
  for all using (auth.uid() = doctor_id and public.is_active_pro_aal2());

drop policy if exists "Pharmacists manage interaction logs" on public.drug_interaction_checks;
create policy "Pharmacists manage interaction logs" on public.drug_interaction_checks
  for all using (
    public.is_active_role_aal2(array['pharmacist','admin','super_admin'])
  );

-- ── appointments ───────────────────────────────────────────────────
drop policy if exists "Pro users manage appointments" on public.appointments;
create policy "Pro users manage appointments" on public.appointments
  for all using (public.is_active_pro_aal2());

-- ── triage_vitals ──────────────────────────────────────────────────
drop policy if exists "Pro users manage triage_vitals" on public.triage_vitals;
create policy "Pro users manage triage_vitals" on public.triage_vitals
  for all using (public.is_active_pro_aal2());

select 'SEC-001d RR8: AAL2 + is_pro 已擴到所有病歷表' as status;
