# `src/app/api/` — 伺服器端 API Routes

所有需要 service role、Gemini 金鑰或跨使用者操作的邏輯都在這；**金鑰只存在伺服器端，前端看不到**。

| 路由 | 功能 |
|---|---|
| `auth/register` | 醫事帳號申請（含防帳號枚舉、`APP_ORIGIN` 精確導向） |
| `pro/admin/users` | 帳號管理 CRUD（授權於 `lib/pro/authz.ts` + RLS 雙層把關） |
| `pro/analytics` | 平台統計（需 is_pro） |
| `pro/consent/invite` | 產生病患同意書一次性權杖 |
| `pro/drug-interactions` | 多藥物交互分析 |
| `pro/gemini-clinical` | Gemini 臨床輔助代理（含速率限制） |
| `pro/resources/check-updates` | 檢查臨床指引是否有新版 |
| `ping` | Supabase 健康檢查（keep-alive 用） |

每個 route 先驗證身分/角色（`serverAuth.ts`）才執行；DB 存取仍受 RLS 二次把關。
