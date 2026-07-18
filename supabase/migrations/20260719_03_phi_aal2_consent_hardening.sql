-- ═══════════════════════════════════════════════════════════════════
-- SEC-001c（回應 GPT re-review）— PHI AAL2 + consent 加固 + 遞迴修復
-- 需套用到已部署 DB。修復目前 production 風險（migration 02 已上線）。
--
-- RR2：consented PHI policy 未檢查 AAL → aal1 clinician 可直接用 Data API 讀 PHI。
-- RR5：accept_consent 未拒絕匿名、未 revoke PUBLIC/anon execute。
-- RR7：profiles 的 "Admins read all profiles" 自我 join profiles → RLS 遞迴風險。
-- 共用手法：SECURITY DEFINER helper（owner=postgres，繞過 RLS）避免遞迴，固定 search_path。
-- ═══════════════════════════════════════════════════════════════════

-- 1) 資格判斷 helper（避免在 policy 內 self-join profiles 造成遞迴）--------
create or replace function public.is_eligible_clinician(p_uid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.profiles
    where id = p_uid and is_pro = true
      and pro_role in ('doctor', 'admin', 'super_admin')
  );
$$;
revoke execute on function public.is_eligible_clinician(uuid) from public, anon;
grant execute on function public.is_eligible_clinician(uuid) to authenticated;

create or replace function public.is_current_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid() and is_pro = true
      and pro_role in ('admin', 'super_admin')
  );
$$;
revoke execute on function public.is_current_admin() from public, anon;
grant execute on function public.is_current_admin() to authenticated;

-- 2) RR2：PHI 讀取要求 AAL2 + 醫師目前仍有資格 ------------------------
drop policy if exists "consented_doctor_read_records" on public.health_records;
create policy "consented_doctor_read_records"
  on public.health_records for select
  using (
    (auth.jwt() ->> 'aal') = 'aal2'
    and exists (
      select 1 from public.patient_consents pc
      where pc.doctor_id = auth.uid()
        and pc.patient_user_id = health_records.user_id
        and pc.status = 'active'
        and public.is_eligible_clinician(pc.doctor_id)
    )
  );

-- 3) RR7：Admins read all profiles 改用 helper（消除 self-reference 遞迴）--
drop policy if exists "Admins read all profiles" on public.profiles;
create policy "Admins read all profiles" on public.profiles
  for select using (public.is_current_admin());

-- 4) RR5：accept_consent 加固（拒匿名 + eligibility 隱含於 authenticated + 鎖 execute）
create or replace function public.accept_consent(p_token text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  update public.patient_consents
     set patient_user_id = auth.uid(),
         status          = 'active',
         granted_at      = now()
   where invite_token      = p_token
     and status            = 'pending'
     and invite_expires_at > now()
     and patient_user_id is null
  returning id into v_id;

  return v_id is not null;
end;
$$;
revoke execute on function public.accept_consent(text) from public, anon;
grant execute on function public.accept_consent(text) to authenticated;

-- 5) RR5 invariant：active consent 一定要有 patient_user_id ---------------
alter table public.patient_consents drop constraint if exists active_consent_has_patient;
alter table public.patient_consents add constraint active_consent_has_patient
  check (status <> 'active' or patient_user_id is not null);

select 'SEC-001c: PHI AAL2 + consent hardening + recursion fix applied' as status;
