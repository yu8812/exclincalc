# Security Policy

> ExClinCalc 是醫療資訊系統，處理多角色臨床資料。安全性是核心設計原則，不是可選 feature。

## Reporting Vulnerabilities

如果你發現潛在漏洞，**請不要在 GitHub 開 public issue**。

請以 email 通報：**yuyulsc881209@icloud.com**

我會在 **7 個工作天**內回應。如果問題嚴重（例如可能造成跨角色資料洩漏、繞過 RLS、繞過 TOTP），我會在 24 小時內回應並先部署修補補丁。

通報請附：

- 漏洞描述
- 重現步驟（請使用 demo 帳號，不要使用真實病患資料）
- 影響範圍評估（你認為可能影響哪些角色 / 哪些資料）
- 你的聯絡方式（如果你希望被公開致謝）

## Implemented Security Measures

ExClinCalc 在四個層級實作安全控制：

### 1. 資料庫層（核心防線）

- **PostgreSQL Row Level Security**：14 張表 × 29 條 policy
- 所有讀寫操作的 query 自動套用 RLS，即使應用層被攻破也無法跨角色讀取資料
- Policy 設計遵循「**從 `auth.uid()` 開始往下推 join**」原則
- 完整 schema：[`supabase/complete_setup.sql`](supabase/complete_setup.sql)

### 2. 認證層

- **Supabase Auth + JWT**：所有 session 使用 JWT，過期自動 refresh
- **TOTP 雙重驗證**：所有 `pro` 角色（醫師 / 護理師 / 藥師 / 行政 / 管理員）強制啟用
  - 首次登入：引導至 `/pro/security` 完成 enroll
  - 後續登入：必過 `mfa-verify` 才能進入 `/pro/*`
  - **5 次失敗鎖定 15 分鐘**（鎖定 user，不鎖 IP）
- **路由保護**：[`src/middleware.ts`](src/middleware.ts) 對所有 `/pro/*` 要求 `aal2`（已過 MFA）

### 3. 應用層

- **6 角色 RBAC**：醫師、護理師、藥師、行政、管理員、超級管理員
- **API rate limit**：Gemini 代理路由 30 req/min/IP
- **API key 隔離**：`GEMINI_API_KEY`、`SUPABASE_SERVICE_ROLE_KEY` 僅存於 Cloudflare Workers runtime secret，**永不暴露至前端**
- **CSP headers**：限制可載入的外部資源
- **HTTPS only**：透過 Cloudflare Workers 強制

### 4. 稽核層

- **`audit_logs` 表**：自動記錄登入、處方建立、SOAP 修改、藥物交互查詢、未授權嘗試等敏感操作
- 由 Supabase trigger 自動寫入，**保留 90 天**
- 管理員可在 `/pro/admin/*` 查閱

### 5. Repository 層

- **Secret Scanning + Push Protection**：GitHub 啟用，含密鑰的 commit 會被 block
- **Dependabot**：自動偵測依賴漏洞並開 PR
- **Branch Protection**：main 分支需通過 CI 才能 merge
- **`.env.local` 在 `.gitignore`**：本地密鑰不會誤 commit

## Demo 帳號政策

ExClinCalc 提供的 demo 帳號（doctor / nurse / pharmacist / admin）僅供體驗系統流程：

- **請勿輸入真實病患資料**
- 若發現 demo 帳號被惡意使用，請通報至上述 email
- demo 資料定期重置

## What's Not in Scope

- **使用者裝置安全**（瀏覽器被 malware 感染、密碼被偷）── 由 TOTP 提供二階保護，但無法 100% 防禦
- **第三方服務的漏洞**（Supabase 或 Cloudflare 自身漏洞）── 由各服務商負責
- **法規層級的合規**（如台灣個資法、HIPAA）── 此系統為**研究用途**，未經正式合規認證

## 已知 Limitations（非漏洞，但要透明）

- ExClinCalc 是**學術研究專案**，未經醫療軟體認證（如 ISO 13485、TFDA 醫材登錄）
- 不適用於實際臨床決策。所有臨床判斷應由合格醫師做成
- TOTP 沒有 backup code 機制（手機掉了需聯絡管理員重置）
- 沒有 hardware key (FIDO2) 整合
- audit_logs 90 天保留，不符合長期稽核需求（醫療法規通常要 5-7 年）

## Disclosure Policy

我採用 **coordinated disclosure**：

1. 你回報 → 我確認 + 修補
2. 修補部署上線
3. 與你協調公開時間（通常修補後 30 天）
4. 公開漏洞細節 + 致謝（如你願意）

## Acknowledgments

感謝負責任的安全研究者讓 ExClinCalc 更安全。回報過漏洞的研究者會列在這裡：

_目前無公開回報紀錄。_

---

最後更新：2026-05-08
