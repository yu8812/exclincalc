# SEC-001 — Fable Handoff

> Writer: Fable (Claude) · Reviewer: GPT-5.6 SOL (read-only) · 產生日期: 2026-07-19

## 範圍與 SHA

| 項目 | 值 |
|---|---|
| Repo | `D:\Clin\exclincalc\exclincalc` |
| Branch | `fix/security-audit-2026-07` |
| **Base SHA** | `141ecb75a0974e2aa5e3d9f09799330054b97a23` |
| **Commit SHA (SEC-001)** | `4fd7889` |
| Review diff 指令 | `git diff 141ecb7 4fd7889`（或 `git show 4fd7889`） |

> 注意：本分支在 `4fd7889` 之上還有兩個**獨立單元**已提交，不屬於 SEC-001：
> - `0e0951d` — 藥物交互 class-aware 重寫（規劃為 **SEC-002**）
> - `f5727b4` — 持久化速率限制 + rate_limits.sql（規劃為 **SEC-003**，含 schema 變更）
> GPT 審查 SEC-001 時請只看 `4fd7889` 的 diff。

## 修改檔案（7）

| 檔案 | 對應風險 |
|---|---|
| `src/app/api/pro/admin/users/route.ts` | A1 權限提升鏈 |
| `src/app/(pro)/pro/admin/users/page.tsx` | A1 前端與後端守衛一致 |
| `src/app/api/auth/register/route.ts` | A2 註冊 email 驗證 + 防枚舉 |
| `src/app/auth/register/page.tsx` | A2 成功畫面文案 |
| `src/app/api/pro/consent/invite/route.ts` | A4 consent 邀請授權 |
| `src/app/(pro)/pro/profile/page.tsx` | A5 密碼下限 |
| `src/app/auth/reset-password/page.tsx` | A5 密碼下限 |

## 每項修改：目的與 Acceptance Criteria

### A1 — Admin API 集中授權守衛
**目的**：原本「super_admin 不可被 admin 修改」的保護只寫在 PATCH；`POST reset_password`、`POST reset_mfa`、`DELETE` 都未檢查目標角色 → 一般 admin 可重設 super_admin 密碼、拆其 MFA、刪其帳號（完整權限提升鏈）。
**修法**：抽 `getCaller()` / `fetchTargetRole()` / `guardTarget()`，四個進入點全套用。
**Acceptance Criteria**：
- [ ] admin 對 super_admin 執行 reset_password / reset_mfa / DELETE / PATCH → 403。
- [ ] admin 對其他 admin（非自己）執行破壞性操作 → 403。
- [ ] 任何人 PATCH 自己的 `pro_role` → 403「無法修改自己的角色」。
- [ ] admin 指派 `admin` 或 `super_admin` 角色 → 403（僅 super_admin 可）。
- [ ] super_admin 仍可對任何人操作（自我刪除除外，維持既有 400）。
- [ ] 前端下拉選單：非 super_admin 看不到 admin / super_admin 選項（與後端一致）。

### A2 — 註冊 email 驗證 + 防帳號枚舉
**目的**：原 `admin.auth.admin.createUser({ email_confirm: true })` 用 service role 免驗證建帳號；錯誤訊息「此 email 已被註冊」洩漏帳號存在（enumeration）。
**修法**：改用 anon `supabase.auth.signUp`（寄驗證信；Supabase 對已存在 email 回混淆結果）。密碼下限統一 8。
**Acceptance Criteria**：
- [ ] 新 email 註冊 → 收到驗證信，未驗證前無法登入（**前提：Supabase 開 Confirm email**）。
- [ ] 已存在 email 註冊 → 回傳通用成功（不回「已註冊」），不洩漏存在性。
- [ ] 密碼 < 8 → 400。
- [ ] 無效 email 格式 → 400。

### A4 — Consent 邀請授權收緊 + 移除 anon 降級
**目的**：`SERVICE_ROLE_KEY || ANON_KEY` fallback 會在缺 key 時默默用 anon key；且只檢查 `is_pro`，護理師/行政都能發病患授權邀請。
**修法**：缺 service key 直接 503；限 `pro_role in (doctor, admin, super_admin)`。
**Acceptance Criteria**：
- [ ] 護理師 / 行政呼叫 → 403。
- [ ] 缺 `SUPABASE_SERVICE_ROLE_KEY` → 503（不再用 anon key 靜默執行）。
- [ ] doctor / admin / super_admin 正常取得邀請連結。

### A5 — 密碼政策一致化
**目的**：admin 重設密碼下限 6、註冊要求 8，不一致且偏弱。
**修法**：admin/users、pro/profile、auth/reset-password 前端下限統一 8（後端 admin route 亦強制 8）。
**Acceptance Criteria**：
- [ ] 上述三處輸入 < 8 字元 → 阻擋並提示「至少 8 字元」。

## 執行過的命令與結果（隔離於 SEC-001 commit `4fd7889` 上執行）

| 命令 | 結果 |
|---|---|
| `git diff --check 4fd7889^ 4fd7889` | **CLEAN**（無空白/衝突標記錯誤） |
| `npx tsc --noEmit` | **exit 0** |
| `npm run build`（Turbopack） | **exit 0** — `✓ Compiled successfully in 26.9s`，全路由正常 |
| targeted tests | **未執行 — 專案目前無測試框架**（見下「尚未處理的風險」）。SEC-001 為授權/驗證流程，需 live Supabase session + MFA 情境才能端到端跑；本次以 tsc + build + 逐路徑 code review 驗證，未執行 runtime 授權測試。 |

## 尚未處理的風險 / 依賴

1. **A2 需 Supabase Dashboard 開啟「Confirm email」**，否則 signUp 仍會建立已驗證帳號、修復不生效。同時需設定 Redirect URLs 白名單。（屬 production DB / dashboard 操作，本單元不執行，僅告知。）
2. **無自動化測試**：Acceptance Criteria 目前靠人工/review 驗證。建議後續（獨立單元）以 vitest 對 `guardTarget` 純函式做單元測試（可不需 DB）。
3. **guardTarget 的 self 操作**：admin 對「自己」做 reset_password / reset_mfa 未被阻擋（僅阻擋改自己角色），此為刻意設計（自助情境），請 reviewer 確認是否符合預期。
4. A1 收緊了「admin 提升他人為 admin」的能力（原本允許），符合 IM.md/THREAT_MODEL 文件模型，但屬**行為變更**，請確認無既有流程依賴。

## Schema / API / Env 影響

- **Schema 變更：NO**（SEC-001 不含任何 SQL；rate_limits.sql 屬 SEC-003）。
- **API 變更：行為層級**（無 endpoint 簽名變動）：
  - consent invite 新增 `503 SERVICE_UNAVAILABLE`、`403 FORBIDDEN`（角色不足）。
  - admin users route 破壞性操作對受保護目標回 403。
  - register 回應新增 `needsVerification` 布林欄位；不再回「已註冊」明示訊息。
- **Env 變更：NO 必要新增**。register route 參照 **選用** 的 `NEXT_PUBLIC_SITE_URL`（僅作 emailRedirect 的 fallback，未設也可運作）。

## Ownership released: YES

Fable 釋出 SEC-001 write ownership。請 GPT review `4fd7889` diff 與本 handoff，將審查寫入
`docs/audit/reviews/SEC-001-gpt-review.md`。Fable 收到後逐條回覆 ACCEPT / REJECT / NEEDS_DECISION。
