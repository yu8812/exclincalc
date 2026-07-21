# `src/` — ExClinCalc Pro 原始碼

醫事端前端與伺服器邏輯的根目錄。

| 子目錄 / 檔案 | 用途 |
|---|---|
| `app/` | Next.js App Router：所有頁面、API routes、auth 流程 |
| `lib/` | 共用邏輯：Supabase client、授權、臨床流程、藥物交互… |
| `components/` | 跨頁共用的 React UI 元件 |
| `middleware.ts` | `/pro/*` 路由的認證閘門：未登入 / 非 is_pro / 未過 MFA 一律攔截 |

安全原則：前端只是入口，**真正的權限在 DB 層（RLS）**。middleware 是第一道、RLS 是最後一道防線。
