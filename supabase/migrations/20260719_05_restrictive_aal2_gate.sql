-- ═══════════════════════════════════════════════════════════════════
-- SEC-001g SEC001D-03 — 每張純醫事 PHI 表加 RESTRICTIVE AAL2 gate
--
-- PostgreSQL 的 permissive policies 以 OR 合成；AAL2 若只寫在某條 permissive policy 內，
-- 另一條（stale/legacy/手動）permissive policy 就能繞過它。
-- RESTRICTIVE policy 會與 permissive 的 OR 結果再做 AND，因此加一條 restrictive 的
-- 「必須 aal2 + is_pro」gate，可保證任何 permissive policy 都無法讓 aal1 通過。
--
-- 只套用於「純醫事」表（病患本人不會直接操作）：
--   doctor_patients / clinical_records / soap_notes / drug_interaction_checks /
--   appointments / triage_vitals
-- 不套 health_records / profiles（病患本人也用，套 pro-only gate 會擋到病患自己）。
-- ═══════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array[
    'doctor_patients','clinical_records','soap_notes',
    'drug_interaction_checks','appointments','triage_vitals'
  ] loop
    execute format('drop policy if exists "restrict_aal2_pro" on public.%I', t);
    execute format(
      'create policy "restrict_aal2_pro" on public.%I as restrictive for all to authenticated '
      || 'using (public.is_active_pro_aal2()) with check (public.is_active_pro_aal2())', t);
  end loop;
end $$;

select 'SEC-001g: restrictive AAL2 gate 已套用於 6 張純醫事表' as status;
