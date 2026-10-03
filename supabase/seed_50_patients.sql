-- ============================================================
-- seed_50_patients.sql — 一整天的示範門診（選用）
--
-- 建立：50 位病人與今天的掛號、分診；其中 5 位有 SOAP 筆記、門診病歷和處方
--       （2 筆已調配、3 筆待調配），日期是台灣的今天。
-- 內容寫在 migrations/20261003_16_demo_data_reset.sql 的 seed_demo_clinic()，
-- 所以要在 migrations 全部跑完之後才能跑。
--
-- ⚠️ 全部是虛構資料：姓名是常見名字，身分證字號和電話是依序編出來的假號碼，
--    這個檔案和整個 repo 都沒有任何真實病人資料。
--
-- 用法：把下面的 email 換成你自己的醫師帳號，在 Supabase SQL editor 執行。
-- 正式站的展示帳號不用手動跑：pg_cron 每天台灣時間 00:01 會自動重建（reset_demo_data()）。
-- ============================================================

select public.seed_demo_clinic(
  (select id from auth.users where email = 'YOUR_DOCTOR_EMAIL@example.com')
);
