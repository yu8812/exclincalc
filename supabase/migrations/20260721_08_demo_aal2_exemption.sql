-- ============================================================
-- 08: demo 帳號豁免 AAL2（MFA）
-- 理由：demo 帳號僅含合成資料、不含真實 PHI，對其強制 MFA 保護不到
--       任何真東西，反而擋住作品集審查者。真實帳號仍全面強制 AAL2。
-- 安全性：is_demo 為新欄位，不在 migration 01 的 profiles 欄位 grant 白名單內，
--         故 authenticated 無法自行 UPDATE（沿用 01 的整表 revoke + 選擇性 grant 模型）。
-- ============================================================

-- 1) is_demo 欄位
alter table public.profiles add column if not exists is_demo boolean not null default false;

-- 2) 標記 demo 帳號
update public.profiles set is_demo = true
where email in (
  'demo-admin@example.com', 'demo-doctor@example.com',
  'demo-pharmacist@example.com', 'demo-nurse@example.com'
);

-- 3) helper：目前使用者是否為 demo 帳號
create or replace function public.is_demo_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_demo = true);
$$;
revoke execute on function public.is_demo_user() from public, anon;
grant execute on function public.is_demo_user() to authenticated;

-- 4) 重定義 AAL2 helpers：session 為 aal2 「或」帳號為 demo，皆視為滿足
create or replace function public.is_active_pro_aal2()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_pro = true
      and ((auth.jwt() ->> 'aal') = 'aal2' or is_demo = true)
  );
$$;
revoke execute on function public.is_active_pro_aal2() from public, anon;
grant execute on function public.is_active_pro_aal2() to authenticated;

create or replace function public.is_active_role_aal2(p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_pro = true and pro_role = any(p_roles)
      and ((auth.jwt() ->> 'aal') = 'aal2' or is_demo = true)
  );
$$;
revoke execute on function public.is_active_role_aal2(text[]) from public, anon;
grant execute on function public.is_active_role_aal2(text[]) to authenticated;

-- 5) health_records 讀取 policy（migration 03 內嵌 aal2 檢查）：demo 也豁免（仍需 consent）
drop policy if exists "consented_doctor_read_records" on public.health_records;
create policy "consented_doctor_read_records"
  on public.health_records for select
  using (
    ((auth.jwt() ->> 'aal') = 'aal2' or public.is_demo_user())
    and exists (
      select 1 from public.patient_consents pc
      where pc.doctor_id = auth.uid()
        and pc.patient_user_id = health_records.user_id
        and pc.status = 'active'
        and public.is_eligible_clinician(pc.doctor_id)
    )
  );

select 'SEC-001 migration 08: demo 帳號 AAL2 豁免已套用' as status;
