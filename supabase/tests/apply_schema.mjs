// 對測試 DB 套用正式 schema 路徑（clean install）。驗證 SEC001D-01 順序 + RR12 replay。
// 用法：node supabase/tests/apply_schema.mjs [DB_URL]
import { readFileSync } from "node:fs";
import pg from "pg";

const DB_URL = process.argv[2] || process.env.TEST_DB_URL
  || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// 正式（唯一）schema 路徑，與 README 一致
export const SCHEMA_FILES = [
  "supabase/complete_setup.sql",
  "supabase/clinic_flow.sql",
  "supabase/create_patient_consents.sql",
  "supabase/create_reference_pdf_links.sql",
  "supabase/migrations/20260719_01_role_authority.sql",
  "supabase/migrations/20260719_02_consent_integrity.sql",
  "supabase/migrations/20260719_03_phi_aal2_consent_hardening.sql",
  "supabase/migrations/20260719_04_global_aal2_phi.sql",
  "supabase/migrations/20260719_05_restrictive_aal2_gate.sql",
  "supabase/migrations/20260719_06_consent_deletion_lifecycle.sql",
  "supabase/migrations/20260719_07_role_capability_matrix.sql",
  "supabase/migrations/20260721_08_demo_aal2_exemption.sql",
  "supabase/migrations/20260810_09_policy_cleanup.sql",
  "supabase/migrations/20261003_10_profiles_exposure_fix.sql",
  "supabase/migrations/20261003_11_schema_drift_sync.sql",
  "supabase/migrations/20261003_12_rate_limits.sql",
  "supabase/migrations/20261003_13_admin_and_demo_hardening.sql",
  "supabase/migrations/20261003_14_clinical_audit_log.sql",
  "supabase/migrations/20261003_15_dispense_attribution.sql",
  "supabase/migrations/20261003_16_demo_data_reset.sql",
  "supabase/migrations/20261003_17_pharmacy_queue.sql",
];

export async function applyAll(client, files = SCHEMA_FILES) {
  for (const f of files) {
    const sql = readFileSync(f, "utf8");
    try {
      await client.query(sql);
      console.log(`  ✓ ${f}`);
    } catch (e) {
      console.error(`  ✗ ${f}\n    ${e.message}`);
      throw e;
    }
  }
}

export function makeClient() {
  return new pg.Client(DB_URL);
}
export { DB_URL };
