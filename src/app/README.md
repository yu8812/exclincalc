# `src/app/` — App Router

Next.js 16 App Router。路由即資料夾。

| 目錄 | 對應 | 說明 |
|---|---|---|
| `(pro)/` | `/pro/*` | 醫事端所有頁面（route group，不影響 URL） |
| `api/` | `/api/*` | 伺服器端 API routes（授權後才碰 service role / Gemini） |
| `auth/` | `/auth/*` | 登入、註冊、MFA 驗證、密碼重設、email 確認 |
| `layout.tsx` | — | 根 layout，掛 `data-app="pro"` 供主題切換 |
| `globals.css` | — | 全站 design tokens（Clin- 四主題共用檔） |

`(pro)` 外層有 `layout.tsx` 組出 sidebar + topbar；所有 `/pro/*` 都受 `middleware.ts` 保護。
