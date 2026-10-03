-- ═══════════════════════════════════════════════════════════════════
-- 17：藥師工作台看得到病人是誰
--
-- migration 07 讓藥師可以讀 clinical_records（調配要看處方），但刻意不讓藥師讀 doctor_patients
-- （病人資料表裡有身分證、健保卡號、電話）。藥師工作台卻是用「處方 join 病人」的方式拿姓名，
-- join 不到就顯示「未知病患」—— 所以從 07 之後，藥師一直看不到藥要交給誰。
-- （之前的截圖是用管理員帳號拍的，管理員讀得到病人表，才沒發現。2026-10-03 用展示藥師重拍時發現。）
--
-- 修法不是把整張病人表開給藥師，而是用一個函式只回傳調配需要的：
-- 處方內容，加上病人的姓名、性別、生日（交藥時核對身分用）。
-- 呼叫的人必須是藥師或管理員、這次登入有過 MFA（展示帳號照 08 免 MFA），展示帳號沙盒（13）一樣適用。
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.pharmacy_queue(p_visit_date date)
returns table (
  id                 uuid,
  visit_date         date,
  chief_complaint    text,
  assessment         text,
  prescriptions      jsonb,
  dispensed_at       timestamptz,
  patient_name       text,
  patient_sex        text,
  patient_birth_date date
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.visit_date, r.chief_complaint, r.assessment, r.prescriptions, r.dispensed_at,
         p.full_name, p.sex, p.date_of_birth
    from public.clinical_records r
    left join public.doctor_patients p on p.id = r.patient_id
   where public.is_active_role_aal2(array['pharmacist', 'admin', 'super_admin'])
     and public.within_demo_sandbox(r.doctor_id)
     and r.visit_date = p_visit_date
     and r.prescriptions is not null
     and r.prescriptions <> '[]'::jsonb
   order by r.created_at desc;
$$;

revoke execute on function public.pharmacy_queue(date) from public, anon;
grant execute on function public.pharmacy_queue(date) to authenticated;

select 'migration 17：藥師工作台改用 pharmacy_queue()，看得到病人姓名' as status;
