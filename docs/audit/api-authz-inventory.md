# /api/pro 授權 inventory（SEC001D-02）

依資料敏感度與副作用決定守衛。共用守衛：`src/lib/pro/serverAuth.ts`
- `requireProAal2()`：任一 pro 角色 + 目前 is_pro + AAL2
- `requirePrivileged()`：admin/super_admin + is_pro + AAL2

| Route | 方法 | 敏感度 | 守衛 | 狀態 |
|---|---|---|---|---|
| `/api/pro/admin/users` | GET/POST/PATCH/DELETE | 帳號/角色/MFA 管理 | requirePrivileged + target guard | ✅ |
| `/api/pro/admin` (data CRUD) | POST/PUT/DELETE | medications/references 寫入 | requirePrivileged | ✅ |
| `/api/pro/analytics` | GET | 跨病患聚合(service role) | requireProAal2 ⚠️見下 | ✅(AAL2) |
| `/api/pro/consent/invite` | POST/GET | 病患授權 bearer token | requireProAal2 + CONSENT_ROLES + ownership | ✅ |
| `/api/pro/gemini-clinical` | POST | patient context→第三方 AI | requireProAal2 + rate limit | ✅ |
| `/api/pro/drug-interactions` | POST | 處方分析→第三方 AI | requireProAal2 | ✅ |
| `/api/pro/resources/check-updates` | GET | 參考資料讀取 | requireProAal2 | ✅ |
| `/api/pro/resources/check-updates` | PATCH | 參考資料寫入 | requirePrivileged | ✅ |
| `/api/ping` | GET | 健康檢查(公開) | 無(僅唯讀 public 表) | ✅ 設計如此 |
| `/api/auth/register` | POST | 公開註冊 | 無(rate limit + signUp) | ✅ 設計如此 |

## 待決 / 下一輪（GPT SEC001D-03）
- **analytics 用 requireProAal2（任一 pro）但 UI 只在 admin 顯示**：GPT 認為應改 requirePrivileged
  或明確更新權限模型 + 縮減回傳資料。**決策題**：analytics 要限 admin 還是開放全 pro？
  → 目前先加 AAL2 擋住 aal1；role 範圍待產品決策後收斂。
- consent-specific ownership / role policy 的 DB invariant（RR11）仍 open。
