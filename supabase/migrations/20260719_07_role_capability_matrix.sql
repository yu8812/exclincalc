-- ═══════════════════════════════════════════════════════════════════
-- SEC-001g SEC001D-03 — 角色 → 能力矩陣（診所模式）
-- 依各工作台實際需求，把「任一 pro」收斂為最小權限；並修藥師讀不到處方的洞。
-- 前提：restrictive AAL2 gate（migration 05）仍在，本檔只調整「哪個角色」。
-- ═══════════════════════════════════════════════════════════════════

-- ── 藥師：可讀 clinical_records（調配需看處方），只能改「調配欄」──────────
drop policy if exists "Pharmacists read clinical records" on public.clinical_records;
create policy "Pharmacists read clinical records" on public.clinical_records
  for select using (public.is_active_role_aal2(array['pharmacist']));

drop policy if exists "Pharmacists dispense clinical records" on public.clinical_records;
create policy "Pharmacists dispense clinical records" on public.clinical_records
  for update using (public.is_active_role_aal2(array['pharmacist']))
             with check (public.is_active_role_aal2(array['pharmacist']));

-- trigger：藥師（非該病歷 owner）只能改 dispensed_at / dispensed_by，
-- 不得竄改主訴/病歷內容/處方（醫囑）。
create or replace function public.enforce_pharmacist_dispense_only()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.doctor_id <> auth.uid()
     and exists (select 1 from public.profiles where id = auth.uid() and is_pro = true and pro_role = 'pharmacist')
  then
    if new.chief_complaint  is distinct from old.chief_complaint
       or new.subjective    is distinct from old.subjective
       or new.objective     is distinct from old.objective
       or new.assessment    is distinct from old.assessment
       or new.plan          is distinct from old.plan
       or new.prescriptions is distinct from old.prescriptions
       or new.icd10_codes   is distinct from old.icd10_codes
       or new.diagnosis_accuracy is distinct from old.diagnosis_accuracy
    then
      raise exception 'pharmacist may only update dispensing fields (dispensed_at/dispensed_by)';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists clinical_records_pharmacist_guard on public.clinical_records;
create trigger clinical_records_pharmacist_guard
  before update on public.clinical_records
  for each row execute function public.enforce_pharmacist_dispense_only();

-- ── appointments：排除藥師（掛號由 doctor/nurse/admin_staff/admin 管）────────
drop policy if exists "Pro users manage appointments" on public.appointments;
create policy "Pro users manage appointments" on public.appointments
  for all using (public.is_active_role_aal2(array['doctor','nurse','admin_staff','admin','super_admin']));

-- ── triage_vitals：護理可寫，醫師只讀（排除藥師/行政寫）────────────────────
drop policy if exists "Pro users manage triage_vitals" on public.triage_vitals;
drop policy if exists "Nurses manage triage_vitals" on public.triage_vitals;
create policy "Nurses manage triage_vitals" on public.triage_vitals
  for all using (public.is_active_role_aal2(array['nurse','admin','super_admin']));
drop policy if exists "Doctors read triage_vitals" on public.triage_vitals;
create policy "Doctors read triage_vitals" on public.triage_vitals
  for select using (public.is_active_role_aal2(array['doctor']));

select 'SEC-001g: 角色能力矩陣（診所模式）已套用' as status;
