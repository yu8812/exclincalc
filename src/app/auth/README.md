# `src/app/auth/` — 認證流程

登入到 MFA 的完整流程頁面。所有頁已套用重設計 token 系統，**安全邏輯 100% 保留**。

| 目錄 | 用途 |
|---|---|
| `login` | 帳密登入 → 檢查 MFA 狀態 → 導向 dashboard / mfa-verify / security |
| `register` | 醫事帳號申請（送出後待管理員開通） |
| `mfa-verify` | 輸入 6 位數 TOTP 動態碼（含 5 次失敗鎖定 15 分鐘） |
| `security`（在 (pro) 下） | 首次綁定 TOTP |
| `forgot-password` / `reset-password` | 密碼重設（recovery session 驗證） |
| `callback` / `confirm` | OAuth / email 驗證回呼 |

重點：`login` 與 `middleware.ts` 共同實作「未綁 MFA → 強制綁定、未驗證 → 輸入動態碼」；`safeRedirect.ts` 擋 open-redirect / `javascript:` XSS。demo 帳號豁免上述 MFA 強制。
