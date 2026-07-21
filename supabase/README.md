# `supabase/` — 資料庫 schema、RLS、migration、測試

醫事端與民眾端**共用**的 Supabase PostgreSQL 定義。安全性以此處為準。

| 內容 | 用途 |
|---|---|
| `complete_setup.sql` | 基礎 schema：資料表 + 基礎 RLS policy |
| `clinic_flow.sql` | 診所流程擴充（處方欄位等） |
| `create_patient_consents.sql` | 病患同意書表 |
| `rate_limits.sql` | 持久化限流表 + RPC |
| `seed_*.sql` | 選用示範資料（藥物、病患、今日工作量…） |
| `migrations/` | **8 個安全 forward migration**（RLS / MFA / 角色矩陣）— 見該資料夾 README |
| `tests/` | RLS 整合測試（一次性 Postgres）— 見該資料夾 README |

⚠️ `pro_schema.sql` 與 `scripts/run-schema.mjs` 已 DEPRECATED（會撤銷 migration 04，勿執行）。正式 schema = `complete_setup.sql` + `migrations/`。
