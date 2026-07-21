# `src/app/(pro)/` — 醫事端頁面

Route group（括號不進 URL）。所有頁面 URL 皆為 `/pro/...`，統一受 `middleware.ts` 的登入 + is_pro + MFA 閘門保護。

| 目錄 | 路由 | 角色 |
|---|---|---|
| `pro/dashboard` | 工作台 | 全體 |
| `pro/encounter` | SOAP 七步驟看診 | 醫師 |
| `pro/patients` | 病患管理（含 `[id]` 詳情、病歷） | 醫師 |
| `pro/notes` | SOAP 筆記（含 `[id]`、`new`） | 醫師 |
| `pro/nursing` | 護理分診工作台 | 護理師 |
| `pro/pharmacy` | 藥師調配工作台 | 藥師 |
| `pro/drugs` / `pro/exam` / `pro/references` | 藥物 / 檢驗 / 參考資料 | 醫事 |
| `pro/admin/*` | 帳號 / 藥物 / 記錄 / 參考值管理 | admin |
| `pro/analytics` | 使用統計 | admin |
| `pro/security` | TOTP MFA 綁定（MFA 閘門的例外入口） | 全體 |
| `pro/profile` / `pro/settings` | 個人設定 | 全體 |

`pro.css` = Pro 端中央樣式（臨床藍青 design tokens，改一處即全 27 頁換色）。
