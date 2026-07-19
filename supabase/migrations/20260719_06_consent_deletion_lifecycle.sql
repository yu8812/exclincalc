-- ═══════════════════════════════════════════════════════════════════
-- SEC-001g SEC001C-RR10/RR11 — consent 與帳號刪除的 lifecycle
--
-- 問題：patient_consents.patient_user_id 為 ON DELETE SET NULL，
--   但 active_consent_has_patient CHECK（status<>'active' OR patient_user_id IS NOT NULL）
--   會在刪除有 active consent 的病患時，因 SET NULL 觸發 constraint violation → 刪除失敗。
--
-- 修法：刪除 auth.users 前，先把該病患的 pending/active consent 設為 revoked。
--   之後 FK 的 SET NULL 生效（patient_user_id→null），status 已是 revoked → constraint 滿足。
--   保留 consent 記錄（狀態 revoked）供 audit，而非直接消失。
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.revoke_consents_on_user_delete()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.patient_consents
     set status = 'revoked', revoked_at = now()
   where patient_user_id = old.id
     and status in ('pending', 'active');
  return old;
end;
$$;

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted
  before delete on auth.users
  for each row execute function public.revoke_consents_on_user_delete();

-- RR11：禁止同一 doctor/patient 有多筆 active consent（否則 revoke 一筆後另一筆仍給 PHI）。
create unique index if not exists uniq_active_consent_per_pair
  on public.patient_consents (doctor_id, patient_user_id)
  where status = 'active';

select 'SEC-001g: consent deletion lifecycle + 唯一 active grant（RR10/RR11）' as status;
