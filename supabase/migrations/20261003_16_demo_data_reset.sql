-- ═══════════════════════════════════════════════════════════════════
-- 16：展示資料每天自動重置
--
-- 展示帳號的密碼是公開的，任何人都能改、刪展示資料；而且種子資料的日期固定在當初匯入那天，
-- 過了那天，藥師工作台、今日掛號這些「今天」的畫面就全是空的（2026-10-03 時正停在 4/29）。
--
-- 這裡做兩件事：
--   seed_demo_clinic(醫師)：建立一整天的門診 —— 50 位病人與掛號、分診，以及 5 位病人的 SOAP 筆記、
--                           門診病歷和處方（2 筆已調配、3 筆待調配），日期都是台灣的今天。
--                           50 位病人的內容和原本的 seed_50_patients.sql 相同；今天的看診紀錄改成
--                           挑病情對得上的病人，SOAP、處方和分診數值互相一致。
--   reset_demo_data()：刪掉展示帳號名下的所有資料，把展示帳號的顯示名稱和設定還原，再重建一天的門診。
--
-- pg_cron 每天台灣時間 00:01 執行 reset_demo_data()。
-- 只會碰展示帳號（profiles.is_demo）名下的資料；兩個函式都不開放給前端呼叫。
-- 重建時刪除、新增的病歷和 SOAP 筆記，一樣會留在 clinical_audit_log（操作者是空的，代表系統排程）。
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.seed_demo_clinic(p_doctor uuid)
returns void
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Taipei'   -- 讓 current_date 和下面的時間都以台灣時間計算
as $$
declare
  doc_id  uuid := p_doctor;
  today   date := current_date;
  p       uuid;
  v_htn   uuid;
  v_dm    uuid;
  v_cough uuid;
  v_ckd   uuid;
  v_gi    uuid;
  v_pharm uuid;
begin
  if doc_id is null then
    raise exception 'seed_demo_clinic：需要醫師的 id';
  end if;

  -- ── Group 1: 感冒 / 上呼吸道 (10) ──────────────────────────

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,nhi_number,phone)
  VALUES (doc_id,'林小明','1995-03-12','M','A123456789','0912345601') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,nhi_number,checked_in_at)
  VALUES (doc_id,p,1,today,'completed','發燒、喉嚨痛','A123456789',(today||' 08:10:00')::timestamptz);
  INSERT INTO triage_vitals (patient_id,bp_sys,bp_dia,hr,rr,temp,spo2,weight,height,created_at,used_at)
  VALUES (p,118,76,92,18,38.3,98,68,172,(today||' 08:05:00')::timestamptz,(today||' 08:12:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,nhi_number,phone)
  VALUES (doc_id,'張雅婷','2001-07-22','F','B234567890','0912345602') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,2,today,'completed','流鼻水、頭痛',(today||' 08:25:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,nhi_number,phone)
  VALUES (doc_id,'王大偉','1988-11-05','M','C345678901','0912345603') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,3,today,'completed','咳嗽、倦怠',(today||' 08:40:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,nhi_number,phone)
  VALUES (doc_id,'陳美玲','1979-06-18','F','D456789012','0912345604') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,4,today,'completed','喉嚨痛、聲音沙啞',(today||' 08:55:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,nhi_number,phone)
  VALUES (doc_id,'李建宏','2008-02-28','M','E567890123','0912345605') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,5,today,'waiting','發燒38.5、全身痠痛',(today||' 09:10:00')::timestamptz);
  INSERT INTO triage_vitals (patient_id,bp_sys,bp_dia,hr,rr,temp,spo2,weight,height,created_at)
  VALUES (p,110,70,98,20,38.5,97,55,165,(today||' 09:05:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'黃淑芬','1993-09-14','F','0912345606') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,6,today,'waiting','鼻塞、打噴嚏',(today||' 09:20:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'吳俊賢','1985-04-03','M','0912345607') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,7,today,'waiting','頭痛、全身發冷',(today||' 09:35:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'蔡佩珊','1999-12-01','F','0912345608') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,8,today,'cancelled','喉嚨不舒服',(today||' 09:50:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'許文昌','1972-08-09','M','0912345609') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,9,today,'completed','咳嗽超過一週',(today||' 09:00:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'劉靜怡','2003-05-17','F','0912345610') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,10,today,'waiting','低燒、疲倦',(today||' 10:00:00')::timestamptz);

  -- ── Group 2: 高血壓 (8) ─────────────────────────────────────

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'鄭志明','1960-03-22','M','0912345611') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,11,today,'completed','高血壓追蹤、頭暈',(today||' 08:00:00')::timestamptz);
  INSERT INTO triage_vitals (patient_id,bp_sys,bp_dia,hr,rr,temp,spo2,weight,height,created_at,used_at)
  VALUES (p,158,96,74,16,36.8,98,82,170,(today||' 07:55:00')::timestamptz,(today||' 08:02:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'謝淑華','1955-11-30','F','0912345612') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,12,today,'completed','血壓控制不佳',(today||' 08:15:00')::timestamptz);
  INSERT INTO triage_vitals (patient_id,bp_sys,bp_dia,hr,rr,temp,spo2,weight,height,created_at,used_at)
  VALUES (p,165,100,80,16,36.6,97,68,158,(today||' 08:10:00')::timestamptz,(today||' 08:18:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'洪仁傑','1963-07-14','M','0912345613') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,13,today,'waiting','高血壓、後頸僵硬',(today||' 10:10:00')::timestamptz);
  INSERT INTO triage_vitals (patient_id,bp_sys,bp_dia,hr,rr,temp,spo2,weight,height,created_at)
  VALUES (p,172,104,78,16,36.7,98,88,174,(today||' 10:05:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'葉秀蘭','1958-09-03','F','0912345614') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,14,today,'completed','長期高血壓回診',(today||' 09:30:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'蘇柏翰','1967-01-25','M','0912345615') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,15,today,'waiting','高血壓、胸悶',(today||' 10:25:00')::timestamptz);
  INSERT INTO triage_vitals (patient_id,bp_sys,bp_dia,hr,rr,temp,spo2,weight,height,created_at)
  VALUES (p,180,108,86,18,36.9,96,95,178,(today||' 10:20:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'方雅欣','1970-06-08','F','0912345616') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,16,today,'completed','高血壓追蹤',(today||' 09:00:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'廖國棟','1962-04-19','M','0912345617') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,17,today,'completed','頭痛、高血壓',(today||' 09:45:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'余淑貞','1953-12-12','F','0912345618') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,18,today,'cancelled','高血壓藥物調整',(today||' 10:00:00')::timestamptz);

  -- ── Group 3: 糖尿病 (8) ─────────────────────────────────────

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'林建國','1958-02-14','M','0912345619') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,19,today,'completed','糖尿病追蹤、血糖偏高',(today||' 08:20:00')::timestamptz);
  INSERT INTO triage_vitals (patient_id,bp_sys,bp_dia,hr,rr,temp,spo2,weight,height,created_at,used_at)
  VALUES (p,136,84,76,16,36.8,97,90,172,(today||' 08:15:00')::timestamptz,(today||' 08:22:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'陳翠玲','1961-08-07','F','0912345620') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,20,today,'completed','第二型糖尿病回診',(today||' 08:35:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'周文宏','1955-05-23','M','0912345621') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,21,today,'waiting','血糖控制不穩、多尿',(today||' 10:40:00')::timestamptz);
  INSERT INTO triage_vitals (patient_id,bp_sys,bp_dia,hr,rr,temp,spo2,weight,height,created_at)
  VALUES (p,142,88,80,16,36.9,97,85,168,(today||' 10:35:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'楊淑芳','1964-10-31','F','0912345622') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,22,today,'completed','糖尿病＋高血壓共病',(today||' 09:15:00')::timestamptz);
  INSERT INTO triage_vitals (patient_id,bp_sys,bp_dia,hr,rr,temp,spo2,weight,height,created_at,used_at)
  VALUES (p,148,92,78,16,36.7,97,72,160,(today||' 09:10:00')::timestamptz,(today||' 09:18:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'賴明哲','1950-03-05','M','0912345623') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,23,today,'waiting','糖尿病足部麻木感',(today||' 10:55:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'施麗娟','1968-12-20','F','0912345624') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,24,today,'completed','HbA1c追蹤',(today||' 09:00:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'曾建平','1957-07-17','M','0912345625') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,25,today,'completed','糖尿病、視力模糊',(today||' 09:30:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'戴美惠','1960-01-09','F','0912345626') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,26,today,'waiting','血糖高、口乾舌燥',(today||' 11:05:00')::timestamptz);

  -- ── Group 4: 慢性腎臟病 CKD (6) ────────────────────────────

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'吳金土','1948-06-11','M','0912345627') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,27,today,'completed','CKD G3a追蹤、水腫',(today||' 08:00:00')::timestamptz);
  INSERT INTO triage_vitals (patient_id,bp_sys,bp_dia,hr,rr,temp,spo2,weight,height,created_at,used_at)
  VALUES (p,152,94,72,16,36.6,96,78,166,(today||' 07:55:00')::timestamptz,(today||' 08:03:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'許桂香','1952-09-28','F','0912345628') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,28,today,'completed','腎臟病回診、倦怠感',(today||' 08:45:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'蔡坤木','1945-02-03','M','0912345629') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,29,today,'waiting','CKD G4、噁心感',(today||' 11:20:00')::timestamptz);
  INSERT INTO triage_vitals (patient_id,bp_sys,bp_dia,hr,rr,temp,spo2,weight,height,created_at)
  VALUES (p,160,98,68,18,36.5,95,70,162,(today||' 11:15:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'林素娥','1955-04-16','F','0912345630') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,30,today,'completed','腎功能追蹤、蛋白尿',(today||' 09:15:00')::timestamptz);
  INSERT INTO triage_vitals (patient_id,bp_sys,bp_dia,hr,rr,temp,spo2,weight,height,created_at,used_at)
  VALUES (p,145,90,74,16,36.7,97,62,156,(today||' 09:10:00')::timestamptz,(today||' 09:18:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'鄭仁和','1950-11-22','M','0912345631') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,31,today,'waiting','CKD＋糖尿病共病追蹤',(today||' 11:35:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'謝翠花','1958-08-30','F','0912345632') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,32,today,'completed','腎病第三期、貧血',(today||' 10:00:00')::timestamptz);

  -- ── Group 5: COVID-19 / 呼吸道感染 (5) ─────────────────────

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'陳家豪','1990-05-04','M','0912345633') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,33,today,'completed','COVID-19快篩陽性、發燒',(today||' 08:00:00')::timestamptz);
  INSERT INTO triage_vitals (patient_id,bp_sys,bp_dia,hr,rr,temp,spo2,weight,height,created_at,used_at)
  VALUES (p,116,74,102,22,39.1,94,75,178,(today||' 07:55:00')::timestamptz,(today||' 08:03:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'王宜芳','1985-10-19','F','0912345634') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,34,today,'waiting','COVID後遺症、持續咳嗽',(today||' 11:50:00')::timestamptz);
  INSERT INTO triage_vitals (patient_id,bp_sys,bp_dia,hr,rr,temp,spo2,weight,height,created_at)
  VALUES (p,112,72,88,20,37.2,96,58,163,(today||' 11:45:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'黃世傑','1978-03-28','M','0912345635') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,35,today,'completed','確診COVID、呼吸喘',(today||' 09:00:00')::timestamptz);
  INSERT INTO triage_vitals (patient_id,bp_sys,bp_dia,hr,rr,temp,spo2,weight,height,created_at,used_at)
  VALUES (p,122,78,110,24,38.8,93,80,175,(today||' 08:55:00')::timestamptz,(today||' 09:03:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'李春梅','2000-01-15','F','0912345636') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,36,today,'waiting','COVID快篩陽、頭痛',(today||' 12:00:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'吳正義','1972-07-07','M','0912345637') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,37,today,'cancelled','疑似COVID、接觸史',(today||' 10:30:00')::timestamptz);

  -- ── Group 6: 心血管 (5) ─────────────────────────────────────

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'劉明雄','1952-04-14','M','0912345638') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,38,today,'completed','胸悶、心悸',(today||' 08:30:00')::timestamptz);
  INSERT INTO triage_vitals (patient_id,bp_sys,bp_dia,hr,rr,temp,spo2,weight,height,created_at,used_at)
  VALUES (p,148,92,96,18,36.8,96,82,170,(today||' 08:25:00')::timestamptz,(today||' 08:32:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'趙麗芬','1956-12-03','F','0912345639') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,39,today,'waiting','心房顫動追蹤、喘',(today||' 12:10:00')::timestamptz);
  INSERT INTO triage_vitals (patient_id,bp_sys,bp_dia,hr,rr,temp,spo2,weight,height,created_at)
  VALUES (p,138,86,112,20,36.7,95,65,158,(today||' 12:05:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'許國誠','1948-08-22','M','0912345640') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,40,today,'completed','冠狀動脈疾病回診',(today||' 09:45:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'林秀蘭','1961-03-17','F','0912345641') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,41,today,'completed','心臟瓣膜追蹤、下肢水腫',(today||' 10:00:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'邱文彬','1955-06-29','M','0912345642') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,42,today,'waiting','心悸、頭暈',(today||' 12:20:00')::timestamptz);
  INSERT INTO triage_vitals (patient_id,bp_sys,bp_dia,hr,rr,temp,spo2,weight,height,created_at)
  VALUES (p,132,82,108,18,36.9,96,75,168,(today||' 12:15:00')::timestamptz);

  -- ── Group 7: 腸胃炎 / 消化道 (5) ───────────────────────────

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'蔡明珠','1982-11-11','F','0912345643') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,43,today,'completed','腹瀉、噁心嘔吐',(today||' 09:00:00')::timestamptz);
  INSERT INTO triage_vitals (patient_id,bp_sys,bp_dia,hr,rr,temp,spo2,weight,height,created_at,used_at)
  VALUES (p,106,68,94,18,37.8,98,54,162,(today||' 08:55:00')::timestamptz,(today||' 09:03:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'謝光明','1975-09-06','M','0912345644') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,44,today,'waiting','腹痛、食慾不振',(today||' 12:30:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'鄧淑惠','1988-02-22','F','0912345645') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,45,today,'completed','急性腸胃炎',(today||' 10:15:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'盧建文','1991-07-14','M','0912345646') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,46,today,'completed','腹瀉超過三天',(today||' 10:30:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'高玉鳳','1966-05-08','F','0912345647') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,47,today,'waiting','胃痛、反酸',(today||' 12:45:00')::timestamptz);

  -- ── Group 8: 骨骼肌肉 (3) ──────────────────────────────────

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'江文龍','1970-04-25','M','0912345648') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,48,today,'completed','下背痛、脊椎退化',(today||' 11:00:00')::timestamptz);
  INSERT INTO triage_vitals (patient_id,bp_sys,bp_dia,hr,rr,temp,spo2,weight,height,created_at,used_at)
  VALUES (p,124,80,70,16,36.6,99,88,176,(today||' 10:55:00')::timestamptz,(today||' 11:02:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'徐淑惠','1965-10-12','F','0912345649') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,49,today,'waiting','膝關節痛、骨質疏鬆',(today||' 12:55:00')::timestamptz);
  INSERT INTO triage_vitals (patient_id,bp_sys,bp_dia,hr,rr,temp,spo2,weight,height,created_at)
  VALUES (p,128,82,72,16,36.5,99,60,155,(today||' 12:50:00')::timestamptz);

  INSERT INTO doctor_patients (doctor_id,full_name,date_of_birth,sex,phone)
  VALUES (doc_id,'柯明仁','1958-01-30','M','0912345650') RETURNING id INTO p;
  INSERT INTO appointments (doctor_id,patient_id,queue_number,visit_date,status,chief_complaint,checked_in_at)
  VALUES (doc_id,p,50,today,'waiting','肩頸疼痛、肌腱炎',(today||' 13:05:00')::timestamptz);

  -- ════ 今天的看診紀錄：挑病情對得上的病人，SOAP、處方和分診數值互相一致 ════
  select id into v_htn   from public.doctor_patients where doctor_id = doc_id and phone = '0912345611';  -- 鄭志明 1960 M，高血壓
  select id into v_dm    from public.doctor_patients where doctor_id = doc_id and phone = '0912345619';  -- 林建國 1958 M，糖尿病
  select id into v_cough from public.doctor_patients where doctor_id = doc_id and phone = '0912345609';  -- 許文昌 1972 M，咳嗽
  select id into v_ckd   from public.doctor_patients where doctor_id = doc_id and phone = '0912345627';  -- 吳金土 1948 M，CKD
  select id into v_gi    from public.doctor_patients where doctor_id = doc_id and phone = '0912345643';  -- 蔡明珠 1982 F，腸胃炎

  -- 展示藥師（沒有的話，已調配的紀錄就不填調配者）
  select id into v_pharm from public.profiles where is_demo and pro_role = 'pharmacist' order by created_at limit 1;

  -- ── SOAP 筆記 5 則（數值和上面的分診一致）──────────────────────
  insert into public.soap_notes (doctor_id, patient_id, title, subjective, objective, assessment, plan, draft, created_at, updated_at) values
    (doc_id, v_htn, '高血壓追蹤門診',
     '頭暈、後頸僵硬約三天，無胸悶、無視力異常。已服用 Norvasc 5mg QD 半年。家中自測血壓近期常在 150/95 上下。',
     'BP 158/96 mmHg, HR 74, T 36.8℃, SpO2 98%。BMI 28.4。心音規則無雜音，兩肺清，下肢無水腫。',
     '原發性高血壓，控制不佳（I10）。',
     '加 Diovan 80mg QD；Norvasc 5mg QD 繼續。每天早晚各量一次血壓並記錄。兩週後回診，若仍 ≥140/90 mmHg 再調整。', false,
     (today || ' 08:30:00')::timestamptz, (today || ' 08:30:00')::timestamptz),
    (doc_id, v_dm, '糖尿病回診',
     '糖尿病 8 年，近 3 個月飯後血糖常超過 200 mg/dL，HbA1c 由半年前 7.2% 升到 8.4%。否認多尿、多飲，體重穩定。',
     'BP 136/84 mmHg, HR 76。BMI 30.4。眼底檢查未見明顯出血，下肢觸覺正常。',
     '第 2 型糖尿病，控制不佳（E11.9）。',
     'Metformin 1000mg BID 繼續；加 Jardiance 10mg QD（注意 eGFR、多喝水）。飲食衛教。3 個月後追蹤 HbA1c。', false,
     (today || ' 09:00:00')::timestamptz, (today || ' 09:00:00')::timestamptz),
    (doc_id, v_cough, '咳嗽超過一週',
     '咳嗽約兩週、夜咳明顯，無發燒、無喘鳴，否認體重減輕。COVID 快篩陰性。最近季節變化大。',
     'BP 122/78 mmHg, HR 92, T 37.4℃, SpO2 96%。兩側散在 rhonchi，喉嚨輕度紅腫。',
     '急性支氣管炎（J20.9）；咳嗽變異型氣喘待觀察。',
     'Augmentin 625mg TID × 5 天；Mucosolvan 30mg TID。一週後仍咳的話安排胸部 X 光。', true,
     (today || ' 09:30:00')::timestamptz, (today || ' 09:30:00')::timestamptz),
    (doc_id, v_ckd, 'CKD G3a 追蹤',
     'CKD G3a 兩年，近一週腳踝水腫、夜尿增加。否認呼吸喘、無胸痛。已戒菸酒。',
     'BP 152/94 mmHg, HR 72。下肢凹陷性水腫 2+，兩側肺底清。',
     '慢性腎臟病第 3a 期（N18.30），體液滯留變明顯；需評估是否進展到 G3b。',
     '抽血追蹤 Cr、eGFR、UACR、電解質；加 Lasix 20mg QD 兩週；嚴格限鹽（每天 <5g）。3 週後回診。', false,
     (today || ' 10:00:00')::timestamptz, (today || ' 10:00:00')::timestamptz),
    (doc_id, v_gi, '急性腸胃炎',
     '腹瀉一天約 8 次、持續 2 天，伴噁心。否認血便。前一晚全家三人一起外食。',
     'BP 106/68 mmHg, HR 94, T 37.8℃。腹軟、輕度壓痛、無反彈痛。皮膚彈性稍差，黏膜微乾。',
     '急性腸胃炎（A09），疑似食物中毒，輕度脫水。',
     'Smecta 3g TID；少量多次補充水分和電解質。若血便、發燒 >38.5℃ 或腹痛加劇立即回診。', false,
     (today || ' 10:30:00')::timestamptz, (today || ' 10:30:00')::timestamptz);

  -- ── 門診病歷 5 筆（藥師工作台的處方從這裡來）：前 2 筆已調配，後 3 筆待調配 ──
  insert into public.clinical_records
    (doctor_id, patient_id, visit_date, chief_complaint, subjective, objective, assessment, plan,
     icd10_codes, prescriptions, dispensed_at, dispensed_by, created_at) values
    (doc_id, v_htn, today, '高血壓追蹤、頭暈',
     '頭暈、後頸僵硬約三天；家中自測血壓常在 150/95 上下。',
     '{"vitals": {"sbp": "158", "dbp": "96", "hr": "74", "rr": "16", "temp": "36.8", "spo2": "98", "weight": "82", "height": "170"}, "bmi": "28.4"}',
     '原發性高血壓 (I10) [主診斷]',
     E'處方：Norvasc 5mg QD、Diovan 80mg QD\n衛教：每天早晚量血壓並記錄\n兩週後回診',
     array['I10'],
     '[{"drug": "Norvasc", "generic": "Amlodipine", "dose": "5mg", "frequency": "QD", "route": "PO", "days": 28, "note": "早餐後"},
       {"drug": "Diovan", "generic": "Valsartan", "dose": "80mg", "frequency": "QD", "route": "PO", "days": 14, "note": "新加的藥，起身放慢"}]',
     (today || ' 08:52:00')::timestamptz, v_pharm, (today || ' 08:35:00')::timestamptz),
    (doc_id, v_dm, today, '糖尿病追蹤、血糖偏高',
     '近 3 個月飯後血糖常超過 200 mg/dL；HbA1c 8.4%。',
     '{"vitals": {"sbp": "136", "dbp": "84", "hr": "76", "rr": "16", "temp": "36.8", "spo2": "97", "weight": "90", "height": "172"}, "bmi": "30.4"}',
     '第 2 型糖尿病 (E11.9) [主診斷]',
     E'處方：Metformin 1000mg BID、Jardiance 10mg QD\n衛教：飲食控制、多喝水\n3 個月後追蹤 HbA1c',
     array['E11.9'],
     '[{"drug": "Metformin", "generic": "Metformin HCl", "dose": "1000mg", "frequency": "BID", "route": "PO", "days": 30, "note": "飯後立即"},
       {"drug": "Jardiance", "generic": "Empagliflozin", "dose": "10mg", "frequency": "QD", "route": "PO", "days": 30, "note": "早餐後，多喝水"}]',
     (today || ' 09:24:00')::timestamptz, v_pharm, (today || ' 09:05:00')::timestamptz),
    (doc_id, v_cough, today, '咳嗽超過一週',
     '咳嗽約兩週、夜咳明顯，無發燒；COVID 快篩陰性。',
     '{"vitals": {"sbp": "122", "dbp": "78", "hr": "92", "rr": "18", "temp": "37.4", "spo2": "96"}}',
     '急性支氣管炎 (J20.9) [主診斷]',
     E'處方：Augmentin 625mg TID、Mucosolvan 30mg TID\n一週後仍咳安排胸部 X 光',
     array['J20.9'],
     '[{"drug": "Augmentin", "generic": "Amoxicillin/Clavulanate", "dose": "625mg", "frequency": "TID", "route": "PO", "days": 5, "note": "飯後，吃完整個療程"},
       {"drug": "Mucosolvan", "generic": "Ambroxol", "dose": "30mg", "frequency": "TID", "route": "PO", "days": 5, "note": "化痰"}]',
     null, null, (today || ' 09:35:00')::timestamptz),
    (doc_id, v_ckd, today, 'CKD G3a 追蹤、水腫',
     '近一週腳踝水腫、夜尿增加；否認呼吸喘。',
     '{"vitals": {"sbp": "152", "dbp": "94", "hr": "72", "rr": "16", "temp": "36.6", "spo2": "96", "weight": "78", "height": "166"}, "bmi": "28.3"}',
     '慢性腎臟病第 3 期 (N18.30) [主診斷]',
     E'處方：Lasix 20mg QD\n衛教：嚴格限鹽（每天 <5g）\n抽血追蹤 Cr、eGFR、UACR、電解質；3 週後回診',
     array['N18.30'],
     '[{"drug": "Lasix", "generic": "Furosemide", "dose": "20mg", "frequency": "QD", "route": "PO", "days": 14, "note": "早上吃，避免夜尿"}]',
     null, null, (today || ' 10:05:00')::timestamptz),
    (doc_id, v_gi, today, '腹瀉、噁心嘔吐',
     '腹瀉一天約 8 次、持續 2 天，伴噁心；否認血便。',
     '{"vitals": {"sbp": "106", "dbp": "68", "hr": "94", "rr": "18", "temp": "37.8", "spo2": "98", "weight": "54", "height": "162"}, "bmi": "20.6"}',
     '急性腸胃炎 (A09) [主診斷]',
     E'處方：Smecta 3g TID\n衛教：少量多次補充水分和電解質；血便或高燒立即回診',
     array['A09'],
     '[{"drug": "Smecta", "generic": "Diosmectite", "dose": "3g", "frequency": "TID", "route": "PO", "days": 3, "note": "和其他藥間隔 2 小時"}]',
     null, null, (today || ' 10:35:00')::timestamptz);

  -- ── 藥物交互作用查詢 6 筆（讓 /pro/drugs 有歷史紀錄）──────────────
  insert into public.drug_interaction_checks (doctor_id, patient_id, drug_list, result, severity, created_at) values
    (doc_id, v_htn, array['Norvasc', 'Diovan'],          '可以一起使用；剛開始合併時注意姿勢性低血壓。',                'none',            (today || ' 08:32:00')::timestamptz),
    (doc_id, v_dm,  array['Metformin', 'Jardiance'],     '可以一起使用；注意脫水和低血糖。',                            'minor',           (today || ' 09:03:00')::timestamptz),
    (doc_id, v_ckd, array['Lasix', 'Norvasc'],           '合併使用注意低血壓和電解質失衡。',                            'moderate',        (today || ' 10:02:00')::timestamptz),
    (doc_id, null,  array['Warfarin', 'Aspirin'],        '出血風險明顯增加，需要密切監測 INR。',                        'major',           (today || ' 11:00:00')::timestamptz),
    (doc_id, null,  array['Sildenafil', 'Nitroglycerin'],'禁止併用：可能造成嚴重低血壓。',                              'contraindicated', (today || ' 11:05:00')::timestamptz),
    (doc_id, null,  array['Simvastatin', 'Amiodarone'],  'Amiodarone 抑制 CYP3A4，增加橫紋肌溶解風險；Simvastatin 每天不超過 20mg。', 'major', (today || ' 11:10:00')::timestamptz);

end;
$$;

create or replace function public.reset_demo_data()
returns void
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Taipei'
as $$
declare
  v_demo   uuid[];
  v_doctor uuid;
begin
  select array_agg(id) into v_demo from public.profiles where is_demo;
  select id into v_doctor from public.profiles where is_demo and pro_role = 'doctor' order by created_at limit 1;
  if v_doctor is null then
    raise notice 'reset_demo_data：沒有展示用的醫師帳號，略過';
    return;
  end if;

  -- 只刪展示帳號名下的資料。刪病人時，病歷和分診會連帶刪掉；
  -- 掛號、SOAP、交互查詢、同意書只會把病人欄位清空，所以要先依擁有者刪
  delete from public.clinical_records        where doctor_id = any(v_demo);
  delete from public.soap_notes              where doctor_id = any(v_demo);
  delete from public.drug_interaction_checks where doctor_id = any(v_demo);
  delete from public.appointments            where doctor_id = any(v_demo);
  delete from public.patient_consents        where doctor_id = any(v_demo);
  delete from public.doctor_patients         where doctor_id = any(v_demo);
  delete from public.pro_resources           where created_by = any(v_demo);

  -- 訪客可能改過展示帳號的名字或設定
  update public.profiles p
     set name = split_part(u.email, '@', 1), institution = null, license_number = null, settings = '{}'::jsonb
    from auth.users u
   where u.id = p.id and p.is_demo;

  perform public.seed_demo_clinic(v_doctor);
end;
$$;

revoke execute on function public.seed_demo_clinic(uuid) from public, anon, authenticated;
revoke execute on function public.reset_demo_data() from public, anon, authenticated;

-- ── 每天台灣時間 00:01（UTC 16:01）重置 ─────────────────────────────
-- Supabase 上就算加了 if not exists，已經存在時再 create 一次也會報錯（dependent privileges exist），
-- 所以先查有沒有裝，這支 migration 才能安全重跑
do $ext$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    create extension pg_cron with schema pg_catalog;
  end if;
end
$ext$;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
select cron.schedule('reset-demo-data', '1 16 * * *', $cron$select public.reset_demo_data()$cron$);

select 'migration 16：展示資料每天自動重置已設定' as status;
