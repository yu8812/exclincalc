# `supabase/migrations/` — 安全性 forward migrations

8 個依序套用的 migration，把資料庫從「基礎 RLS」推進到「稽核級安全」。全部經 40+ 條 RLS 整合測試驗證、replay-safe（含 `drop ... if exists`）。

| # | 檔案 | 主題 |
|---|---|---|
| 01 | `role_authority` | 角色權限授權 + 欄位級 REVOKE + 防自我提權 trigger |
| 02 | `consent_integrity` | 同意書欄位 / policy / atomic token |
| 03 | `phi_aal2_consent_hardening` | PHI 讀取要求 AAL2 + 拒匿名 + 反遞迴 helper |
| 04 | `global_aal2_phi` | 全 PHI 表 AAL2（`is_active_pro_aal2` / `is_active_role_aal2`） |
| 05 | `restrictive_aal2_gate` | 6 張純醫事表加 **RESTRICTIVE** AAL2 閘門（與 permissive 做 AND） |
| 06 | `consent_deletion_lifecycle` | 同意書刪除生命週期 + 單一有效授權唯一索引 |
| 07 | `role_capability_matrix` | 藥師只能配藥、護理師寫 / 醫師讀 triage |
| 08 | `demo_aal2_exemption` | demo 帳號豁免 AAL2（僅合成資料） |

## 套用方式（線上 production）
以 `pg` client 連 Supabase **Session pooler**（port 5432）、**逐檔包 transaction**（失敗即 rollback）套用。

⚠️ **順序前提**：03–05 對 PHI 強制 MFA。套用「前」，所有非 demo 的 pro 帳號必須先 enroll + challenge MFA 取得 aal2，否則會被鎖在 PHI 外。**先綁 MFA → 再套 migration**。
