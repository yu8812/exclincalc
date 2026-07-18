-- ═══════════════════════════════════════════════════════════════════
-- ClinCalc 完整資料庫設定檔
-- 執行環境：Supabase SQL Editor（Dashboard → SQL Editor → New query）
-- 安全可重複執行：所有語句使用 IF NOT EXISTS / DROP IF EXISTS
--
-- 執行順序：直接執行本檔案即可，無需分開執行其他 .sql 檔案
-- ═══════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────
-- 0. 輔助函式：自動更新 updated_at
-- ───────────────────────────────────────────────────────────────────

create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ───────────────────────────────────────────────────────────────────
-- 1. profiles — 用戶個人資料（Supabase Auth 延伸）
-- ───────────────────────────────────────────────────────────────────

create table if not exists profiles (
  id            uuid references auth.users(id) on delete cascade primary key,
  email         text,
  name          text,
  avatar_url    text,
  is_pro        boolean default false,
  pro_role      text default 'doctor'
                  check (pro_role in ('doctor','admin','super_admin','pharmacist','nurse','admin_staff')),
  institution   text,
  license_number text,
  settings      jsonb default '{}',   -- 同步自 localStorage 的 UI 設定
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- 若 profiles 表已存在，補充 settings 欄位
alter table profiles add column if not exists settings jsonb default '{}';

alter table profiles enable row level security;

drop policy if exists "Users read own profile" on profiles;
create policy "Users read own profile" on profiles
  for select using (auth.uid() = id);

drop policy if exists "Users update own profile" on profiles;
create policy "Users update own profile" on profiles
  for update using (auth.uid() = id);

-- 「Admins read all profiles」policy 移至 helper 定義之後（見 1b 區塊末），
-- 避免 clean install 時 CREATE POLICY 參照尚未建立的 is_current_admin()（SEC001D-01）。

-- trigger: updated_at
drop trigger if exists profiles_updated_at on profiles;
create trigger profiles_updated_at
  before update on profiles
  for each row execute function update_updated_at_column();

-- ───────────────────────────────────────────────────────────────────
-- 1a. 自動建立 profile（用戶註冊時觸發）
-- ───────────────────────────────────────────────────────────────────

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- ───────────────────────────────────────────────────────────────────
-- 1b. 授權 helper（SECURITY DEFINER，避免 policy 內 self-join profiles 造成遞迴；
--     與 migrations 03/04 同定義，確保 fresh install 與 migration 產出一致的安全狀態）
-- ───────────────────────────────────────────────────────────────────

create or replace function public.is_current_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles
                where id = auth.uid() and is_pro = true
                  and pro_role in ('admin','super_admin'));
$$;
revoke execute on function public.is_current_admin() from public, anon;
grant execute on function public.is_current_admin() to authenticated;

create or replace function public.is_eligible_clinician(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles
                where id = p_uid and is_pro = true
                  and pro_role in ('doctor','admin','super_admin'));
$$;
revoke execute on function public.is_eligible_clinician(uuid) from public, anon;
grant execute on function public.is_eligible_clinician(uuid) to authenticated;

create or replace function public.is_active_pro_aal2()
returns boolean language sql stable security definer set search_path = public as $$
  select (auth.jwt() ->> 'aal') = 'aal2'
     and exists(select 1 from public.profiles where id = auth.uid() and is_pro = true);
$$;
revoke execute on function public.is_active_pro_aal2() from public, anon;
grant execute on function public.is_active_pro_aal2() to authenticated;

create or replace function public.is_active_role_aal2(p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select (auth.jwt() ->> 'aal') = 'aal2'
     and exists(select 1 from public.profiles
                where id = auth.uid() and is_pro = true and pro_role = any(p_roles));
$$;
revoke execute on function public.is_active_role_aal2(text[]) from public, anon;
grant execute on function public.is_active_role_aal2(text[]) to authenticated;

-- profiles admin 讀取（helper 已定義，避免遞迴，SEC001D-01：置於 helper 之後）
drop policy if exists "Admins read all profiles" on public.profiles;
create policy "Admins read all profiles" on public.profiles
  for select using (public.is_current_admin());


-- ───────────────────────────────────────────────────────────────────
-- 2. health_records — 民眾健康記錄
-- ───────────────────────────────────────────────────────────────────

create table if not exists health_records (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  type        text not null check (type in ('manual', 'scan')),
  data        jsonb default '{}',
  ai_analysis text,
  created_at  timestamptz default now()
);

alter table health_records enable row level security;

drop policy if exists "Users can manage own records" on health_records;
create policy "Users can manage own records" on health_records
  for all using (auth.uid() = user_id);

-- health_records: 醫師只能看被連結的病患（doctor_patients 關聯）
-- 目前病患-醫師連結尚未實作，此 policy 暫不開放，避免隱私洩漏
-- drop policy if exists "Pro doctors read linked patients records" on health_records;
-- create policy "Pro doctors read linked patients records" on health_records
--   for select using (
--     exists (
--       select 1 from doctor_patients dp
--       where dp.doctor_id = auth.uid()
--         and dp.patient_id = health_records.user_id
--     )
--   );

create index if not exists health_records_user_id_idx     on health_records(user_id);
create index if not exists health_records_created_at_idx  on health_records(created_at desc);

-- Per-user record FIFO: auto-delete oldest when > 100 records
create or replace function rotate_health_records()
returns trigger as $$
declare
  excess int;
begin
  select greatest(0, count(*) - 99) into excess
  from health_records where user_id = NEW.user_id;

  if excess > 0 then
    delete from health_records
    where id in (
      select id from health_records
      where user_id = NEW.user_id
      order by created_at asc
      limit excess
    );
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists enforce_health_records_limit on health_records;
drop trigger if exists rotate_health_records_trigger on health_records;
create trigger rotate_health_records_trigger
  before insert on health_records
  for each row execute function rotate_health_records();


-- ───────────────────────────────────────────────────────────────────
-- 3. medications — 藥物資料庫
-- ───────────────────────────────────────────────────────────────────

create table if not exists medications (
  id                   uuid default gen_random_uuid() primary key,
  name_zh              text not null,
  name_en              text not null,
  generic_name         text,
  category             text not null,
  uses_zh              text not null,
  uses_en              text,
  side_effects_zh      text,
  common_dosage        text,
  warnings_zh          text,
  interactions         text[],
  prescription_required boolean default true,
  source               text default 'manual',
  updated_at           timestamptz default now()
);

alter table medications enable row level security;

drop policy if exists "Anyone can read medications" on medications;
create policy "Anyone can read medications" on medications
  for select using (true);

drop policy if exists "Pro admins write medications" on medications;
create policy "Pro admins write medications" on medications
  for all using (
    exists (
      select 1 from profiles
      where id = auth.uid()
        and is_pro = true
        and pro_role in ('admin', 'super_admin')
    )
  );

create index if not exists medications_name_zh_idx   on medications using gin(to_tsvector('simple', name_zh));
create index if not exists medications_category_idx  on medications(category);
create index if not exists medications_rx_idx        on medications(prescription_required);


-- ───────────────────────────────────────────────────────────────────
-- 4. medical_references — 醫療參考值資料庫
-- ───────────────────────────────────────────────────────────────────

create table if not exists medical_references (
  id              uuid default gen_random_uuid() primary key,
  key             text unique not null,
  label_zh        text not null,
  label_en        text not null,
  unit            text not null,
  explanation_zh  text not null,
  normal_general  jsonb,
  normal_male     jsonb,
  normal_female   jsonb,
  warning_high    numeric,
  warning_low     numeric,
  category        text not null,
  source          text,
  updated_at      timestamptz default now()
);

alter table medical_references enable row level security;

drop policy if exists "Anyone can read references" on medical_references;
create policy "Anyone can read references" on medical_references
  for select using (true);

drop policy if exists "Pro admins write medical_references" on medical_references;
create policy "Pro admins write medical_references" on medical_references
  for all using (
    exists (
      select 1 from profiles
      where id = auth.uid()
        and is_pro = true
        and pro_role in ('admin', 'super_admin')
    )
  );


-- ───────────────────────────────────────────────────────────────────
-- 5. doctor_patients — 醫師管理的病患
-- ───────────────────────────────────────────────────────────────────

create table if not exists doctor_patients (
  id                 uuid default gen_random_uuid() primary key,
  doctor_id          uuid references auth.users(id) on delete cascade not null,
  full_name          text not null,
  date_of_birth      date,
  sex                text check (sex in ('M', 'F', 'Other')),
  id_number          text,
  nhi_number         text,
  phone              text,
  email              text,
  blood_type         text check (blood_type in ('A+','A-','B+','B-','AB+','AB-','O+','O-','')),
  allergies          text[] default '{}',
  chronic_conditions text[] default '{}',
  notes              text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

alter table doctor_patients enable row level security;

-- 醫師管理自己的病患（RR8：需 is_pro + AAL2；停權/未過 MFA 即失去存取）
drop policy if exists "Doctors manage own patients" on doctor_patients;
create policy "Doctors manage own patients" on doctor_patients
  for all using (auth.uid() = doctor_id and public.is_active_pro_aal2());

-- 護理師 / 行政 / 管理員可讀取所有病患（護理工作台需要；需 AAL2）
drop policy if exists "Nurses and admins read all patients" on doctor_patients;
create policy "Nurses and admins read all patients" on doctor_patients
  for select using (
    public.is_active_role_aal2(array['nurse','admin','super_admin','admin_staff'])
  );

-- trigger: updated_at
drop trigger if exists doctor_patients_updated_at on doctor_patients;
create trigger doctor_patients_updated_at
  before update on doctor_patients
  for each row execute function update_updated_at_column();

create index if not exists doctor_patients_doctor_id_idx  on doctor_patients(doctor_id);
create index if not exists doctor_patients_name_idx       on doctor_patients(full_name);


-- ───────────────────────────────────────────────────────────────────
-- 6. clinical_records — SOAP 門診病歷
-- ───────────────────────────────────────────────────────────────────

create table if not exists clinical_records (
  id                  uuid default gen_random_uuid() primary key,
  patient_id          uuid references doctor_patients(id) on delete cascade,
  doctor_id           uuid references auth.users(id) on delete cascade not null,
  visit_date          date not null default current_date,
  chief_complaint     text,
  subjective          text,
  objective           jsonb default '{}',
  assessment          text,
  plan                text,
  icd10_codes         text[] default '{}',
  ai_analysis         text,
  diagnosis_accuracy  text check (diagnosis_accuracy in ('correct', 'partial', 'incorrect')),
  created_at          timestamptz default now()
);

alter table clinical_records enable row level security;

drop policy if exists "Doctors manage own clinical records" on clinical_records;
create policy "Doctors manage own clinical records" on clinical_records
  for all using (auth.uid() = doctor_id and public.is_active_pro_aal2());

-- 護理師可讀取所有臨床記錄（查看病歷；需 AAL2）
drop policy if exists "Nurses read all clinical records" on clinical_records;
create policy "Nurses read all clinical records" on clinical_records
  for select using (
    public.is_active_role_aal2(array['nurse','admin','super_admin','admin_staff'])
  );

create index if not exists clinical_records_patient_id_idx   on clinical_records(patient_id, visit_date desc);
create index if not exists clinical_records_doctor_id_idx    on clinical_records(doctor_id);
create index if not exists clinical_records_visit_date_idx   on clinical_records(visit_date desc);
create index if not exists clinical_records_accuracy_idx     on clinical_records(diagnosis_accuracy)
  where diagnosis_accuracy is not null;


-- ───────────────────────────────────────────────────────────────────
-- 7. soap_notes — SOAP 草稿
-- ───────────────────────────────────────────────────────────────────

create table if not exists soap_notes (
  id          uuid default gen_random_uuid() primary key,
  doctor_id   uuid references auth.users(id) on delete cascade not null,
  patient_id  uuid references doctor_patients(id) on delete set null,
  title       text,
  subjective  text,
  objective   text,
  assessment  text,
  plan        text,
  draft       boolean default true,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table soap_notes enable row level security;

drop policy if exists "Doctors manage own notes" on soap_notes;
create policy "Doctors manage own notes" on soap_notes
  for all using (auth.uid() = doctor_id and public.is_active_pro_aal2());

drop trigger if exists soap_notes_updated_at on soap_notes;
create trigger soap_notes_updated_at
  before update on soap_notes
  for each row execute function update_updated_at_column();

create index if not exists soap_notes_doctor_id_idx   on soap_notes(doctor_id);
create index if not exists soap_notes_patient_id_idx  on soap_notes(patient_id);


-- ───────────────────────────────────────────────────────────────────
-- 8. drug_interaction_checks — 藥物交互作用查詢記錄
-- ───────────────────────────────────────────────────────────────────

create table if not exists drug_interaction_checks (
  id         uuid default gen_random_uuid() primary key,
  doctor_id  uuid references auth.users(id) on delete cascade not null,
  patient_id uuid references doctor_patients(id) on delete set null,
  drug_list  text[] not null,
  result     text,
  severity   text check (severity in ('none','minor','moderate','major','contraindicated')),
  created_at timestamptz default now()
);

alter table drug_interaction_checks enable row level security;

drop policy if exists "Doctors manage own interaction logs" on drug_interaction_checks;
create policy "Doctors manage own interaction logs" on drug_interaction_checks
  for all using (auth.uid() = doctor_id and public.is_active_pro_aal2());

-- 藥師也可以記錄交互作用查詢（需 AAL2）
drop policy if exists "Pharmacists manage interaction logs" on drug_interaction_checks;
create policy "Pharmacists manage interaction logs" on drug_interaction_checks
  for all using (
    public.is_active_role_aal2(array['pharmacist','admin','super_admin'])
  );

create index if not exists drug_checks_doctor_id_idx on drug_interaction_checks(doctor_id);


-- ───────────────────────────────────────────────────────────────────
-- 9. pro_resources — 臨床參考資料庫（書籍、指引、文章）
-- ───────────────────────────────────────────────────────────────────

create table if not exists pro_resources (
  id          uuid default gen_random_uuid() primary key,
  title       text not null,
  author      text,
  year        text,
  category    text not null default '書籍',
  cover_url   text,
  url         text,
  description text,
  source      text,
  tags        text[] default '{}',
  is_public   boolean default true,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz default now()
);

alter table pro_resources enable row level security;

drop policy if exists "Pro users read public resources" on pro_resources;
create policy "Pro users read public resources" on pro_resources
  for select using (is_public = true or auth.uid() = created_by);

drop policy if exists "Pro users create resources" on pro_resources;
create policy "Pro users create resources" on pro_resources
  for insert with check (auth.uid() = created_by);

drop policy if exists "Creators manage own resources" on pro_resources;
create policy "Creators manage own resources" on pro_resources
  for all using (auth.uid() = created_by);

drop policy if exists "Admins manage all resources" on pro_resources;
create policy "Admins manage all resources" on pro_resources
  for all using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.pro_role in ('admin', 'super_admin')
    )
  );

drop policy if exists "Pro users update cover on public resources" on pro_resources;
create policy "Pro users update cover on public resources" on pro_resources
  for update using (is_public = true)
  with check (is_public = true);

create index if not exists pro_resources_category_idx on pro_resources(category);
create index if not exists pro_resources_tags_idx     on pro_resources using gin(tags);


-- ───────────────────────────────────────────────────────────────────
-- 10. audit_logs — 管理員操作稽核記錄
-- ───────────────────────────────────────────────────────────────────

create table if not exists audit_logs (
  id          uuid default gen_random_uuid() primary key,
  actor_id    uuid references auth.users(id) on delete set null,
  actor_email text,
  action      text not null,        -- 'role_change' | 'delete_user' | 'reset_password' | 'toggle_pro'
  target_id   uuid,                 -- affected user id
  target_email text,
  details     jsonb default '{}',   -- e.g. { from: 'doctor', to: 'admin' }
  created_at  timestamptz default now()
);

alter table audit_logs enable row level security;

-- 只有 admin/super_admin 可讀取稽核記錄
drop policy if exists "Admins read audit logs" on audit_logs;
create policy "Admins read audit logs" on audit_logs
  for select using (
    exists (
      select 1 from profiles
      where id = auth.uid()
        and pro_role in ('admin', 'super_admin')
    )
  );

-- 伺服器端（service role）負責寫入，前端不可直接寫
-- 注意：insert 透過 API route 使用 service role key 完成

create index if not exists audit_logs_actor_idx  on audit_logs(actor_id);
create index if not exists audit_logs_time_idx   on audit_logs(created_at desc);


-- ═══════════════════════════════════════════════════════════════════
-- 初始化設定（第一次部署後手動執行）
-- ═══════════════════════════════════════════════════════════════════
--
-- 1. 指派超級管理員（換成你自己的 email）：
--    UPDATE profiles SET is_pro = true, pro_role = 'super_admin'
--      WHERE email = 'your@email.com';
--
-- 2. 接著執行種子資料：
--    → supabase/seed_medications.sql
--    → supabase/seed_resources.sql
--
-- ═══════════════════════════════════════════════════════════════════
