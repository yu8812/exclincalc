-- ═══════════════════════════════════════════════════════════════════
-- SEC-001b R6/R7/R8 — Consent Integrity Migration（需套用到已部署 DB）
-- ═══════════════════════════════════════════════════════════════════

-- R6 — patient_consents 補上 doctor_patient_id（invite route 會寫入此欄，
--      原 checked-in schema 沒有此欄 → 乾淨部署會在 invite 時 500）。
--      nullable：允許 generic invite；有值時由 API 驗證 ownership。
alter table public.patient_consents
  add column if not exists doctor_patient_id uuid
  references public.doctor_patients(id) on delete set null;

create index if not exists idx_consents_doctor_patient
  on public.patient_consents (doctor_patient_id);

-- R7 — 移除「任何 is_pro 可讀全部 health_records」的過寬 policy。
--      permissive policy 會 OR 疊加，此條存在時 consent policy 形同虛設。
--      admin 分析走 service role（繞過 RLS），不受影響。
drop policy if exists "Pro doctors read all health_records" on public.health_records;

-- R7 — consent 讀取 policy 增加「醫師目前仍為有效醫事人員」條件：
--      降權 / 撤銷 is_pro / 改成非臨床角色後，立即失去 PHI 存取。
drop policy if exists "consented_doctor_read_records" on public.health_records;
create policy "consented_doctor_read_records"
  on public.health_records for select
  using (
    exists (
      select 1
      from public.patient_consents pc
      join public.profiles p on p.id = pc.doctor_id
      where pc.doctor_id = auth.uid()
        and pc.patient_user_id = health_records.user_id
        and pc.status = 'active'
        and p.is_pro = true
        and p.pro_role in ('doctor', 'admin', 'super_admin')
    )
  );

-- R8 — accept_consent 改為單一 atomic conditional UPDATE，避免 SELECT-then-UPDATE 競態
--      造成同一 token 被兩個帳號接受。
create or replace function accept_consent(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
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

select 'R6/R7/R8 consent integrity migration applied' as status;
