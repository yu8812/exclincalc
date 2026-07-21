# `src/lib/` — 共用邏輯

不含 UI 的可重用邏輯與 Supabase client。

| 檔案 | 用途 |
|---|---|
| `supabase.ts` / `supabase-server.ts` | 瀏覽器端 / 伺服器端 Supabase client |
| `safeRedirect.ts` | `safeInternalPath()`：擋 open-redirect 與 `javascript:` XSS |
| `rateLimit.ts` | API 速率限制 |
| `referenceRanges.ts` | 檢驗參考區間知識庫 |
| `localAnalysis.ts` | 本地檢驗判讀 |
| `pro/` | 醫事端專屬邏輯（授權、臨床流程、藥物交互…見該資料夾 README） |
