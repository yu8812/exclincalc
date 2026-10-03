-- ═══════════════════════════════════════════════════════════
-- 臨床指引 PDF 連結與版本追蹤表
-- 最後更新：2026-04-20
--
-- 用途：
--   1. 儲存各指引的 PDF 下載連結（每年更新時新增）
--   2. 記錄版本偵測腳本掃描到的最新版本
--   3. 標記「待醫師審查」的新版本，避免未經確認就上線
--
-- 工作流程：
--   GitHub Actions (每月 1 日) → check-versions.mjs 掃描
--   → 發現新版本 → 插入一筆 status='update_available'
--   → 管理員登入 ExClinCalc 審查 → 確認後改 status='applied'
--   → 手動更新 sync-references.mjs 和 seed_resources.sql
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS reference_pdf_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,                    -- 指引名稱（可對應 pro_resources.title）
  publisher       text NOT NULL,                    -- 發布機構
  year            text NOT NULL,                    -- 版本年份（如 '2026'）
  edition         text,                             -- 版次（如 '24th Edition'，書籍用）
  pdf_url         text,                             -- 直接 PDF 下載 URL（若有）
  source_url      text NOT NULL,                    -- 官方頁面 URL（人工確認用）
  check_url       text,                             -- 版本偵測掃描的 URL（可與 source_url 不同）
  version_keyword text,                             -- 用於判斷版本的關鍵字（如 '2026 GOLD'）
  notes           text,                             -- 備註（台灣版、中文摘要、簡版等）
  status          text NOT NULL DEFAULT 'current'   -- current | update_available | reviewing | applied
                  CHECK (status IN ('current','update_available','reviewing','applied')),
  detected_at     timestamptz DEFAULT now(),        -- 本筆記錄建立時間
  reviewed_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at     timestamptz,
  created_at      timestamptz DEFAULT now()
);

-- 索引：讓管理員查看待處理項目更快
CREATE INDEX IF NOT EXISTS idx_ref_pdf_status ON reference_pdf_links (status, detected_at DESC);

-- RLS：僅 Pro 用戶可查看（管理員可寫）
ALTER TABLE reference_pdf_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pro_users_read_ref_pdfs" ON reference_pdf_links;
CREATE POLICY "pro_users_read_ref_pdfs"
  ON reference_pdf_links FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_pro = true
    )
  );

-- 寫入只限通過 MFA 的真管理員（與 migration 13 的 is_current_admin 一致，展示帳號不行）
DROP POLICY IF EXISTS "admins_manage_ref_pdfs" ON reference_pdf_links;
CREATE POLICY "admins_manage_ref_pdfs"
  ON reference_pdf_links FOR ALL TO authenticated
  USING (public.is_current_admin())
  WITH CHECK (public.is_current_admin());

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON reference_pdf_links FROM anon;

-- ═══════════════════════════════════════════════════════════
-- 種子資料：已知 PDF 連結（2026-04-20 版本）
-- ═══════════════════════════════════════════════════════════

INSERT INTO reference_pdf_links
  (title, publisher, year, pdf_url, source_url, check_url, version_keyword, notes, status)
VALUES

-- 糖尿病
(
  'Standards of Care in Diabetes',
  'American Diabetes Association (ADA)',
  '2026',
  'https://diabetesjournals.org/care/issue/49/Supplement_1',
  'https://professional.diabetes.org/standards-of-care',
  'https://professional.diabetes.org/standards-of-care',
  'Standards of Care in Diabetes',
  '每年1月發布，Supplement 1；2026版 = Diabetes Care Vol.49 Suppl.1',
  'current'
),
(
  '台灣糖尿病臨床照護指引',
  '台灣糖尿病學會 (TDS)',
  '2022',
  NULL,
  'https://www.endo-dm.org.tw/dia/DMCARE/2022/index.htm',
  'https://www.endo-dm.org.tw/dia/DMCARE/',
  '台灣糖尿病臨床照護指引',
  '2022版目前最新；下次更新留意 TDS 官網首頁公告',
  'current'
),
(
  '台灣糖尿病腎臟病臨床照護指引',
  '台灣糖尿病學會・台灣腎臟醫學會',
  '2024',
  NULL,
  'https://www.endo-dm.org.tw',
  'https://www.endo-dm.org.tw',
  '糖尿病腎臟病指引',
  'TDS/TSN 聯合指引；留意 endo-dm.org.tw 公告',
  'current'
),

-- 高血壓
(
  '2022 台灣高血壓治療指引',
  '台灣高血壓學會 (TSH)',
  '2022',
  NULL,
  'https://www.tsh.org.tw',
  'https://www.tsh.org.tw',
  '高血壓治療指引',
  '留意 TSH 官網是否釋出 2024/2025 版',
  'current'
),
(
  '2023 ESH Guidelines for Arterial Hypertension',
  'European Society of Hypertension (ESH)',
  '2023',
  'https://academic.oup.com/eurheartj/article/44/28/2665/7199303',
  'https://www.eshonline.org/guidelines/2023-guidelines/',
  'https://www.eshonline.org/guidelines/',
  'ESH Guidelines',
  '2023為最新版；每4-5年更新',
  'current'
),

-- 血脂 / 心血管
(
  '台灣血脂異常臨床治療指引',
  '台灣動脈硬化暨血管疾病學會 (TAS)',
  '2023',
  NULL,
  'https://www.ths.org.tw',
  'https://www.ths.org.tw',
  '血脂異常治療指引',
  '留意 TAS 官網公告',
  'current'
),
(
  '台灣心臟學會 ASCVD 預防指引',
  '台灣心臟學會 (TSOC)',
  '2024',
  NULL,
  'https://www.tsoc.org.tw',
  'https://www.tsoc.org.tw',
  'ASCVD 預防指引',
  '留意 TSOC 官網公告',
  'current'
),
(
  '2023 ACC/AHA Heart Failure Guideline',
  'American College of Cardiology / AHA',
  '2023',
  'https://doi.org/10.1016/j.jacc.2021.12.012',
  'https://professional.heart.org/en/guidelines-and-statements',
  'https://professional.heart.org/en/guidelines-and-statements',
  'Heart Failure Guideline',
  '2023為最新；ACC/AHA 心衰指引通常5年更新',
  'current'
),

-- 腎臟
(
  '台灣腎臟醫學會 CKD 臨床照護共識',
  '台灣腎臟醫學會 (TSN)',
  '2025',
  NULL,
  'https://www.tsn.org.tw',
  'https://www.tsn.org.tw',
  'CKD 臨床照護共識',
  '2025版最新；留意 TSN 官網',
  'current'
),
(
  'KDIGO 2024 CKD Guideline',
  'Kidney Disease: Improving Global Outcomes (KDIGO)',
  '2024',
  'https://kdigo.org/wp-content/uploads/2024/03/KDIGO-2024-CKD-Guideline.pdf',
  'https://kdigo.org/guidelines/ckd-evaluation-management/',
  'https://kdigo.org/guidelines/ckd-evaluation-management/',
  'KDIGO CKD',
  '2024版提供直接 PDF 下載',
  'current'
),

-- 呼吸系統
(
  'GINA Strategy for Asthma',
  'Global Initiative for Asthma (GINA)',
  '2025',
  'https://ginasthma.org/wp-content/uploads/2025/05/GINA-2025-Strategy-Report.pdf',
  'https://ginasthma.org/2025-gina-strategy-report/',
  'https://ginasthma.org/',
  'GINA Strategy Report',
  '每年5月更新；PDF 連結格式固定，年份替換即可',
  'current'
),
(
  'GOLD Report for COPD',
  'Global Initiative for COPD (GOLD)',
  '2026',
  'https://goldcopd.org/wp-content/uploads/2025/11/GOLD-2026-Report.pdf',
  'https://goldcopd.org/2026-gold-report-and-pocket-guide/',
  'https://goldcopd.org/',
  'GOLD Report',
  '每年11月更新（下一年版本）；2026版於2025年11月發布',
  'current'
),

-- 感染症
(
  'Sanford Guide to Antimicrobial Therapy',
  'Antimicrobial Therapy, Inc.',
  '2026',
  NULL,
  'https://www.sanfordguide.com/products/antimicrobial/print/pocket',
  'https://www.sanfordguide.com',
  'Sanford Guide',
  '印刷版每年更新；線上版訂閱制。PDF 無公開下載',
  'current'
),

-- 預防醫學
(
  'USPSTF Preventive Services Recommendations',
  'US Preventive Services Task Force',
  '2024',
  NULL,
  'https://www.uspreventiveservicestaskforce.org/uspstf/recommendation-topics',
  'https://www.uspreventiveservicestaskforce.org/uspstf/recommendation-topics',
  'USPSTF Recommendations',
  '單項建議各自更新，非整本；網站為最新清單',
  'current'
),
(
  '台灣成人預防保健服務',
  '衛生福利部國民健康署 (HPA)',
  '2024',
  NULL,
  'https://www.hpa.gov.tw/Pages/Detail.aspx?nodeid=189',
  'https://www.hpa.gov.tw/Pages/Detail.aspx?nodeid=189',
  '成人預防保健',
  '跟隨健保政策更新，留意衛福部公告',
  'current'
),

-- WHO
(
  'WHO Model List of Essential Medicines',
  'World Health Organization (WHO)',
  '2025',
  'https://www.who.int/publications/i/item/B09474',
  'https://www.who.int/groups/expert-committee-on-selection-and-use-of-essential-medicines/essential-medicines-lists',
  'https://www.who.int/groups/expert-committee-on-selection-and-use-of-essential-medicines/essential-medicines-lists',
  'Essential Medicines List',
  '24th Edition 2025；每2年更新；有直接 PDF 下載',
  'current'
),

-- 教科書（版次更新較不頻繁）
(
  'Harrison''s Principles of Internal Medicine',
  'McGraw-Hill / AccessMedicine',
  '2025',
  NULL,
  'https://accessmedicine.mhmedical.com/book.aspx?bookid=3095',
  'https://accessmedicine.mhmedical.com/',
  'Harrison''s 22nd',
  '22nd Edition 2025；下版估計2029-2030',
  'current'
),
(
  'Current Medical Diagnosis & Treatment (CMDT)',
  'McGraw-Hill / Lange',
  '2026',
  NULL,
  'https://accessmedicine.mhmedical.com/book.aspx?bookid=3594',
  'https://accessmedicine.mhmedical.com/',
  'CMDT 2026',
  '65th Edition 2026；每年更新',
  'current'
),
(
  '台灣健保藥品給付規定',
  '衛生福利部中央健康保險署 (NHIA)',
  '2024',
  NULL,
  'https://www.nhi.gov.tw/Content_List.aspx?n=238533FCBA5B1A95',
  'https://www.nhi.gov.tw/Content_List.aspx?n=238533FCBA5B1A95',
  '藥品給付規定',
  '隨時更新（非年度版本）；直接查官網最準確',
  'current'
);

-- 確認筆數
SELECT status, COUNT(*) FROM reference_pdf_links GROUP BY status;
