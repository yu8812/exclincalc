# `scripts/` — 維運腳本

| 腳本 | 用途 |
|---|---|
| `sync-references.mjs` | 把 `src/lib/referenceRanges.ts` 的參考值同步到 `medical_references`（GitHub Actions 手動觸發）|
| `check-versions.mjs` | 檢查 KDIGO／ADA／ACC-AHA 等指引有沒有新版（需要 `reference_pdf_links` 表）|
| `change-password.mjs` | 用 service role 重設某個帳號的密碼：`node scripts/change-password.mjs <email> <新密碼>`。不會留 audit_logs，平常請用管理頁 |
| `dump-policies.mjs` | 從正式庫產生 `docs/permission-matrix.md` 的 policy 全表（`npm run docs:policies`，唯讀）|
| `schema-drift.mjs` | 比對正式庫和 repo 建出來的資料庫（`npm run check:drift`；會清空本機資料庫）|
| `exposure-scan.mjs` | 用四種身分對每張表實測讀、改、刪（`npm run check:exposure`；會清空本機資料庫）|

連正式庫的腳本從 `.env.database` 讀 `DATABASE_URL`（不要放 `.env.local`，OpenNext 會把它打包進 worker）。

⚠️ `run-schema.mjs` 已 DEPRECATED（會撤銷 migration 04 的安全設定，勿執行）。正式 schema 來源見 `supabase/` 與 `supabase/migrations/`。

2026-10-03 刪掉了三支早期的一次性腳本（`create-test-user`、`delete-test-user`、`fix-test-user`）：裡面寫死了測試帳號的帳密和 UID，萬一誤跑會建出一個密碼公開的管理員帳號。
