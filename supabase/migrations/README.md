# `supabase/migrations/` — 安全性 forward migrations

15 個依序套用的 migration，把資料庫從「基礎 RLS」一步步收緊。每一支都可以重跑（`drop ... if exists`、`create or replace`），也都有 RLS 整合測試（`../tests/rls_matrix.mjs`，目前 95 條）。

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
| 09 | `policy_cleanup` | 刪掉重複和沒在用的 policy（41 → 37） |
| 10 | `profiles_exposure_fix` | 刪掉不在 repo 裡、讓任何人都能讀 profiles 的 `service_role_all` |
| 11 | `schema_drift_sync` | profiles policy 與正式庫對齊（repo 原本少了更新 policy） |
| 12 | `rate_limits` | 限流表 + `check_rate_limit()`，只開放伺服器呼叫 |
| 13 | `admin_and_demo_hardening` | 管理權要求 MFA 且排除展示帳號；資源庫只有管理員能改公開資源；8 張表加展示帳號沙盒 |
| 14 | `clinical_audit_log` | 病歷與 SOAP 筆記每次異動由 trigger 寫進 `clinical_audit_log` |
| 15 | `dispense_attribution` | 調配者與調配時間由資料庫決定，調配後不能改 |

10–15 是 2026-10-03 一次稽核的結果：用腳本比對正式庫和 repo、再用不同身分逐表實測讀改刪，找到的問題和修法都寫在各檔案開頭的註解裡。

## 套用方式（正式庫）

以 `pg` client 連 Supabase **Session pooler**（port 5432），一支一個交易：先執行 migration，再在同一個交易裡用 savepoint 模擬各種身分驗證（展示 admin、真管理員、一般使用者、展示醫師／藥師），全部通過才 commit，任何一項失敗就整支 rollback。

⚠️ **順序前提**：03–05 對 PHI 強制 MFA。套用「前」，所有非 demo 的 pro 帳號必須先 enroll + challenge MFA 取得 aal2，否則會被鎖在 PHI 外。**先綁 MFA → 再套 migration**。13 之後，管理員帳號也要有過 MFA 的登入才能管理藥物資料庫、資源庫和讀稽核紀錄。
