/**
 * ⚠️ DEPRECATED（SEC001D-01）
 *
 * 此腳本原本以 Management API 執行 supabase/pro_schema.sql。但 pro_schema.sql 與
 * complete_setup.sql 是重複的 schema 來源，重跑會把 migration 04 的 AAL2 policy
 * 撤銷回不安全版本。為避免 replay 造成降權，本腳本已停用。
 *
 * 正式（且唯一）的 schema 路徑：
 *   1) supabase/complete_setup.sql
 *   2) supabase/clinic_flow.sql
 *   3) supabase/create_patient_consents.sql
 *   4) supabase/create_reference_pdf_links.sql
 *   5) supabase/migrations/20260719_01_role_authority.sql
 *      supabase/migrations/20260719_02_consent_integrity.sql
 *      supabase/migrations/20260719_03_phi_aal2_consent_hardening.sql
 *      supabase/migrations/20260719_04_global_aal2_phi.sql   （套用前提：pro 帳號先綁 MFA）
 *      supabase/rate_limits.sql
 *
 * 詳見 README 的資料庫初始化章節。
 */

console.error(
  "run-schema.mjs 已停用（SEC001D-01）。\n" +
  "請改用 complete_setup.sql + clinic_flow.sql + create_patient_consents.sql +\n" +
  "create_reference_pdf_links.sql + migrations/*，不要再執行 pro_schema.sql\n" +
  "（會撤銷 migration 04 的安全 policy）。詳見 README。"
);
process.exit(1);
