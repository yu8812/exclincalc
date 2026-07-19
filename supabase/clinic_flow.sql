-- ═══════════════════════════════════════════════════════════
-- ExClinCalc — 診所完整流程擴充
-- 執行時機：pro_schema.sql 之後
-- 內容：掛號系統、分診生命徵象、處方 JSONB、稽核日誌
-- ═══════════════════════════════════════════════════════════

-- ── 1. 掛號系統 appointments ──────────────────────────────
create table if not exists appointments (
  id               uuid default gen_random_uuid() primary key,
  doctor_id        uuid references auth.users(id) on delete cascade not null,
  patient_id       uuid references doctor_patients(id) on delete set null,
  queue_number     integer,                -- 號碼牌
  visit_date       date not null default current_date,
  nhi_number       text,                  -- 健保卡號（可模擬）
  chief_complaint  text,                  -- 主訴
  notes            text,
  status           text default 'waiting'
    check (status in ('waiting','in_progress','completed','cancelled')),
  checked_in_at    timestamptz default now(),
  completed_at     timestamptz,
  created_at       timestamptz default now()
);

alter table appointments enable row level security;

-- RR8 + 角色矩陣：掛號由 doctor/nurse/admin_staff/admin 管（排除藥師），需 AAL2
drop policy if exists "Pro users manage appointments" on appointments;
create policy "Pro users manage appointments" on appointments
  for all using (public.is_active_role_aal2(array['doctor','nurse','admin_staff','admin','super_admin']));

-- 自動產生今日流水號
create or replace function next_queue_number(p_doctor_id uuid, p_date date)
returns integer language plpgsql security definer as $$
declare v integer;
begin
  select coalesce(max(queue_number), 0) + 1
    into v
    from appointments
   where doctor_id = p_doctor_id
     and visit_date = p_date;
  return v;
end; $$;


-- ── 2. 分診生命徵象 triage_vitals ─────────────────────────
create table if not exists triage_vitals (
  id               uuid default gen_random_uuid() primary key,
  patient_id       uuid references doctor_patients(id) on delete cascade,
  nurse_id         uuid references auth.users(id) on delete set null,
  appointment_id   uuid references appointments(id) on delete set null,
  bp_sys           integer,
  bp_dia           integer,
  hr               integer,
  rr               integer,
  temp             numeric(4,1),
  spo2             integer,
  weight           numeric(5,1),
  height           numeric(5,1),
  pain_scale       integer check (pain_scale between 0 and 10),
  note             text,
  used_at          timestamptz,          -- 醫師已調用此筆紀錄的時間
  created_at       timestamptz default now()
);

alter table triage_vitals enable row level security;

-- RR8 + 角色矩陣：護理可寫、醫師只讀（排除藥師/行政寫），需 AAL2
drop policy if exists "Pro users manage triage_vitals" on triage_vitals;
drop policy if exists "Nurses manage triage_vitals" on triage_vitals;
create policy "Nurses manage triage_vitals" on triage_vitals
  for all using (public.is_active_role_aal2(array['nurse','admin','super_admin']));
drop policy if exists "Doctors read triage_vitals" on triage_vitals;
create policy "Doctors read triage_vitals" on triage_vitals
  for select using (public.is_active_role_aal2(array['doctor']));


-- ── 3. 擴充 clinical_records：結構化處方欄位 ──────────────
alter table clinical_records
  add column if not exists prescriptions jsonb default '[]',
  add column if not exists appointment_id uuid references appointments(id) on delete set null,
  add column if not exists dispensed_at   timestamptz,
  add column if not exists dispensed_by   uuid references auth.users(id) on delete set null;


-- ── 4. 擴充 audit_logs（原表已存在，補充診所流程所需欄位）──
-- 原表使用 actor_id，此處補充 resource_type / resource_id 欄位
alter table audit_logs
  add column if not exists resource_type text,
  add column if not exists resource_id   text;

-- 允許登入用戶插入自己的稽核記錄（使用原表的 actor_id 欄位）
drop policy if exists "Users insert own logs" on audit_logs;
create policy "Users insert own logs" on audit_logs
  for insert with check (auth.uid() = actor_id);


-- ── 5. 稽核日誌 RPC（SECURITY DEFINER 繞過 RLS）────────────
create or replace function insert_audit_log(
  p_action        text,
  p_resource_type text,
  p_resource_id   text default null,
  p_details       jsonb default '{}'
) returns void language plpgsql security definer as $$
begin
  insert into audit_logs(actor_id, action, resource_type, resource_id, details)
  values (auth.uid(), p_action, p_resource_type, p_resource_id, p_details);
end; $$;
