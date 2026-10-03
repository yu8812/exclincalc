# `supabase/` — 資料庫 schema、RLS、migration、測試

醫事端與民眾端**共用**的 Supabase PostgreSQL 定義。安全性以此處為準。

| 內容 | 用途 |
|---|---|
| `complete_setup.sql` | 基礎 schema：10 張資料表 + 基礎 RLS policy |
| `clinic_flow.sql` | 診所流程擴充（處方欄位等） |
| `create_patient_consents.sql` | 病患同意書表 |
| `create_reference_pdf_links.sql` | 指引 PDF 版本追蹤表（正式庫目前沒有建）|
| `seed_*.sql` | 選用示範資料（藥物、病患、今日工作量…） |
| `migrations/` | **15 個安全 forward migration**（RLS、MFA、角色矩陣、稽核、限流）— 見該資料夾 README |
| `tests/` | RLS 整合測試（95 條，跑在一次性的本機 Supabase）— 見該資料夾 README |

⚠️ `pro_schema.sql` 與 `scripts/run-schema.mjs` 已 DEPRECATED（會撤銷 migration 04，勿執行）。正式 schema = `complete_setup.sql` + `migrations/`。

限流表原本是獨立的 `rate_limits.sql`，2026-10 併進 `migrations/20261003_12_rate_limits.sql`（那時才發現正式庫從來沒建過這張表）。
