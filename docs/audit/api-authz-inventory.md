# /api/pro 授權 inventory（SEC001D-02）

依資料敏感度與副作用決定守衛。共用守衛：`src/lib/pro/serverAuth.ts`
- `requireProAal2()`：任一 pro 角色 + 目前 is_pro + AAL2
- `requirePrivileged()`：admin/super_admin + is_pro + AAL2

| Route | 方法 | 敏感度 | 守衛 | 狀態 |
|---|---|---|---|---|
| `/api/pro/admin/users` | GET/POST/PATCH/DELETE | 帳號/角色/MFA 管理 | requirePrivileged + target guard | ✅ |
| `/api/pro/admin` (data CRUD) | POST/PUT/DELETE | medications/references 寫入 | requirePrivileged | ✅ |
| `/api/pro/analytics` | GET | 跨病患聚合(service role) | **requirePrivileged**(決策:限 admin) | ✅ |
| `/api/pro/consent/invite` | POST/GET | 病患授權 bearer token | requireProAal2 + CONSENT_ROLES + ownership | ✅ |
| `/api/pro/gemini-clinical` | POST | patient context→第三方 AI | requireProAal2 + rate limit | ✅ |
| `/api/pro/drug-interactions` | POST | 處方分析→第三方 AI | requireProAal2 | ✅ |
| `/api/pro/resources/check-updates` | GET | 參考資料讀取 | requireProAal2 | ✅ |
| `/api/pro/resources/check-updates` | PATCH | 參考資料寫入 | requirePrivileged | ✅ |
| `/api/ping` | GET | 健康檢查(公開) | 無(僅唯讀 public 表) | ✅ 設計如此 |
| `/api/auth/register` | POST | 公開註冊 | 無(rate limit + signUp) | ✅ 設計如此 |

## 決策紀錄（SEC001D-03）
- **analytics = admin only（requirePrivileged）** — 當事人 2026-07-19 裁決：平台級監督資料，
  且 UI 本就只在 admin 區顯示，依最小權限限 admin。

## 下一輪（需測試 DB）
- 改成 Supabase 建議的 `AS RESTRICTIVE` per-table AAL2 gate + 完整角色 CRUD matrix（SEC001D-03 深層）。
- consent-specific ownership / role policy 的 DB invariant（RR11）。
