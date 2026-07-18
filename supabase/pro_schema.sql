-- ═══════════════════════════════════════════════════════════
-- ⚠️ DEPRECATED / LEGACY（SEC001D-01）
-- 本檔已被 complete_setup.sql + migrations/* 取代，**請勿再單獨執行**。
-- run-schema.mjs 已停用。此處 owner policies 已同步為 AAL2 強化版
-- （參照 complete_setup 定義的 helper），僅為避免萬一被手動重跑時降權；
-- 正式 schema 來源請以 complete_setup.sql + migrations 為準。
--
-- ClinCalc Pro — 完整資料庫結構（legacy）
-- 所有語句使用 IF NOT EXISTS / DROP IF EXISTS
-- ═══════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────
-- 1. 擴展 profiles 表（Pro 用戶欄位）
-- ───────────────────────────────────────────────────────────

alter table profiles
  add column if not exists is_pro          boolean default false,
  add column if not exists pro_role        text default 'doctor',
  add column if not exists institution     text,
  add column if not exists license_number  text;

-- 角色約束（六種角色）
alter table profiles drop constraint if exists profiles_pro_role_check;
alter table profiles add constraint profiles_pro_role_check
  check (pro_role in ('doctor', 'admin', 'super_admin', 'pharmacist', 'nurse', 'admin_staff'));


-- ───────────────────────────────────────────────────────────
-- 2. 病患資料表（醫師管理）
-- ───────────────────────────────────────────────────────────

create table if not exists doctor_patients (
  id                 uuid default gen_random_uuid() primary key,
  doctor_id          uuid references auth.users(id) on delete cascade not null,
  full_name          text not null,
  date_of_birth      date,
  sex                text check (sex in ('M', 'F', 'Other')),
  id_number          text,                          -- 身分證字號
  nhi_number         text,                          -- 健保卡號（與身分證相同時可留空）
  phone              text,
  email              text,
  blood_type         text check (blood_type in ('A+','A-','B+','B-','AB+','AB-','O+','O-','')),
  allergies          text[] default '{}',           -- 過敏原清單
  chronic_conditions text[] default '{}',           -- 慢性疾病清單
  notes              text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

alter table doctor_patients enable row level security;

drop policy if exists "Doctors manage own patients" on doctor_patients;
create policy "Doctors manage own patients" on doctor_patients
  for all using (auth.uid() = doctor_id and public.is_active_pro_aal2());


-- ───────────────────────────────────────────────────────────
-- 3. 臨床記錄（SOAP 格式門診病歷）
-- ───────────────────────────────────────────────────────────

create table if not exists clinical_records (
  id                  uuid default gen_random_uuid() primary key,
  patient_id          uuid references doctor_patients(id) on delete cascade,  -- nullable：匿名診療
  doctor_id           uuid references auth.users(id) on delete cascade not null,
  visit_date          date not null default current_date,
  chief_complaint     text,                         -- 主訴
  subjective          text,                         -- 問診記錄
  objective           jsonb default '{}',           -- 生命徵象、PE、檢驗
  assessment          text,                         -- 診斷
  plan                text,                         -- 處方、衛教、轉介
  icd10_codes         text[] default '{}',          -- ICD-10 代碼陣列
  ai_analysis         text,                         -- AI 分析結果
  diagnosis_accuracy  text check (diagnosis_accuracy in ('correct', 'partial', 'incorrect')),  -- E 指標回饋
  created_at          timestamptz default now()
);

alter table clinical_records enable row level security;

drop policy if exists "Doctors manage own clinical records" on clinical_records;
create policy "Doctors manage own clinical records" on clinical_records
  for all using (auth.uid() = doctor_id and public.is_active_pro_aal2());


-- ───────────────────────────────────────────────────────────
-- 4. SOAP 草稿
-- ───────────────────────────────────────────────────────────

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


-- ───────────────────────────────────────────────────────────
-- 5. 藥物交互作用記錄
-- ───────────────────────────────────────────────────────────

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


-- ───────────────────────────────────────────────────────────
-- 6. 跨表讀寫授權（medications / medical_references / health_records）
-- ───────────────────────────────────────────────────────────

-- admin/super_admin 可寫入藥物資料庫
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

-- admin/super_admin 可寫入醫療參考值
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

-- ⚠️ 已移除「Pro 用戶可讀取所有健康記錄」的過寬 policy（SEC-001b R7 / GPT RR3）。
-- 這條會讓任何 is_pro 用戶讀取全部病患 PHI，且 permissive policy 會 OR 疊加、
-- 使 consent policy 形同虛設。PHI 讀取權限一律改由
--   supabase/migrations/20260719_02_consent_integrity.sql（consent-scoped）
--   supabase/migrations/20260719_03_phi_aal2_consent_hardening.sql（+ AAL2 + eligibility）
-- 定義。admin 分析請走 service role（繞過 RLS）而非過寬 RLS policy。
drop policy if exists "Pro doctors read all health_records" on health_records;


-- ───────────────────────────────────────────────────────────
-- 7. 臨床參考資料庫（書籍、指引、文章、網站、影音）
-- ───────────────────────────────────────────────────────────

create table if not exists pro_resources (
  id          uuid default gen_random_uuid() primary key,
  title       text not null,
  author      text,
  year        text,
  category    text not null default '書籍',    -- 書籍 / 指引 / 文章 / 網站 / 影音
  cover_url   text,                            -- 封面圖片 URL
  url         text,                            -- 外部連結
  description text,
  source      text,                            -- 來源：NEJM / WHO / 衛福部…
  tags        text[] default '{}',
  is_public   boolean default true,            -- false = 個人書籤
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz default now()
);

alter table pro_resources enable row level security;

-- 所有 Pro 用戶可讀公開資源，或讀自己建立的
drop policy if exists "Pro users read public resources" on pro_resources;
create policy "Pro users read public resources" on pro_resources
  for select using (is_public = true or auth.uid() = created_by);

-- 所有 Pro 用戶可新增（created_by 必須是自己）
drop policy if exists "Pro users create resources" on pro_resources;
create policy "Pro users create resources" on pro_resources
  for insert with check (auth.uid() = created_by);

-- 建立者可修改/刪除自己的資源
drop policy if exists "Creators manage own resources" on pro_resources;
create policy "Creators manage own resources" on pro_resources
  for all using (auth.uid() = created_by);

-- admin/super_admin 可管理所有資源（含系統預載 created_by = NULL）
drop policy if exists "Admins manage all resources" on pro_resources;
create policy "Admins manage all resources" on pro_resources
  for all using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.pro_role in ('admin', 'super_admin')
    )
  );

-- 所有 Pro 用戶可更新公開資源的封面（修復圖片失效）
drop policy if exists "Pro users update cover on public resources" on pro_resources;
create policy "Pro users update cover on public resources" on pro_resources
  for update using (is_public = true)
  with check (is_public = true);


-- ═══════════════════════════════════════════════════════════
-- 初始設置（第一次部署時執行）
-- ═══════════════════════════════════════════════════════════
--
-- 指派超級管理員：
--   UPDATE profiles SET is_pro = true, pro_role = 'super_admin'
--     WHERE id = (SELECT id FROM auth.users WHERE email = 'your-admin@example.com');
--
-- 指派管理員：
--   UPDATE profiles SET is_pro = true, pro_role = 'admin'
--     WHERE id = (SELECT id FROM auth.users WHERE email = 'your@email.com');
--
-- ═══════════════════════════════════════════════════════════
