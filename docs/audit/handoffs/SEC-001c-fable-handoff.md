# SEC-001c — Fable Handoff（回應 SEC-001b GPT re-review 的 3 個 P0 + 相關項）

> Writer: Fable · Reviewer: GPT-5.6 SOL · 日期: 2026-07-19
> 前提：保留既有 commits，不 amend/rebase。以下為 `188d4b4` 之後的 follow-up。
> **Review range：`git diff 188d4b4 742da2d`**（新 ending SHA = `742da2d`）。

## 單元與 SHA

| Unit | 主題 | SHA | 對應 re-review finding |
|---|---|---|---|
| A | PHI AAL2 + consent 加固 + 遞迴修復（migration 03） | `c4628b3` | RR2, RR5, RR7 |
| B | Canonical schema 對齊 | `49b00f7` | RR3 |
| C | R4 email 確認 flow（token_hash + verifyOtp） | `0e7da0a` | RR1 |
| D | R1 test 強化 + lint + evidence | `742da2d` | RR6 |

## 逐條 disposition（RR1–RR7）

### RR1 (R4) — 註冊/callback flow 不相容 — **FIXED (code) / DEFERRED (email template + live test)**
- 新增 `src/app/auth/confirm/route.ts`：用 `verifyOtp({ token_hash, type })`（server 端、跨裝置安全），
  不再依賴 client flowType / URL fragment。callback 錯誤導回 login?error。
- `login/page.tsx` 顯示 verified / verification_failed / invalid_link 狀態。
- **DEFERRED**：Supabase Confirm signup email template 需改指向
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`（Owner；見 evidence 文件），
  並做「新 email→點信→登入頁狀態」live 端到端測試。

### RR2 (R7) — PHI policy 未要求 AAL2 — **FIXED (code) / DEFERRED (apply-to-live + DB test)**
- migration 03：`consented_doctor_read_records` 加 `(auth.jwt()->>'aal') = 'aal2'` + 醫師 eligibility。
- **DEFERRED**：套用 migration 03 到 live DB；aal1 deny / aal2 allow 的真實 DB session 測試（需 disposable Postgres）。
- ⚠️ 這是**目前 production 風險**（migration 02 已上線但無 AAL2）；migration 03 套用前風險仍在。

### RR3 — legacy schema 會重建漏洞 — **FIXED (code)**
- `pro_schema.sql`：移除過寬 "Pro doctors read all health_records" policy。
- `create_patient_consents.sql`：accept_consent 改原子+拒匿名+REVOKE PUBLIC/anon；PHI policy 加 AAL2。
- `README.md`：新增「必跑 migrations 01/02/03 + rate_limits.sql」步驟，標明 migrations 為 source of truth。
- 註：`scripts/run-schema.mjs` 仍執行 pro_schema.sql，但該檔已不再建立漏洞 policy。

### RR5 (R8) — accept_consent 可被匿名消耗 + lifecycle — **PARTIAL FIXED**
- FIXED：auth.uid() null 拒絕；`REVOKE EXECUTE ... FROM public, anon`；active consent 必有 patient_user_id（constraint）。
- **DEFERRED**：demotion / re-promotion / doctor deletion / chart deletion / revocation 對 pending/active token 的完整 lifecycle 狀態機 + 併發整合測試（需 disposable Postgres）。

### RR6 — R1 test false-PASS + 停權保留 DB admin — **PARTIAL FIXED**
- FIXED：R1 test（`742da2d`）改為「error/0-row 皆判被擋 + 正向對照(name 可改) + reload 確認 pro_role 未變」，
  不再 catch 自己的 FAIL。（原 in-range test 的 bug 屬 out-of-range 修正 `699ee53`，此處再強化。）
- **DEFERRED**：complete_setup.sql 的 admin policies（profiles/resources/audit）只看 role 不看目前 is_pro，
  需一併加 `is_pro=true`；停權是否撤 session 為產品決策。（列為下一單元）

### RR7 — profiles self-reference 遞迴 — **FIXED (code) / DEFERRED (apply-to-live)**
- migration 03：`is_current_admin()` / `is_eligible_clinician()` SECURITY DEFINER helper（固定 search_path、
  REVOKE public/anon），"Admins read all profiles" 改用 helper，消除遞迴。
- **DEFERRED**：套用到 live DB + 完整 role×is_pro×aal matrix 的真實 DB 測試。

### RR4 (R6) — ownership 非 DB invariant — **DEFERRED（下一單元）**
- 現況：route 有 service-role SELECT-then-INSERT ownership 檢查（非原子）。
- 待做：authenticated RPC / composite constraint 使 ownership+insert 單一 DB operation；named constraint 分開 idempotent migration。屬 DB invariant 工程，需 disposable Postgres 驗證，列下一單元。

## 執行過的命令與結果（exact HEAD `742da2d`）

| 命令 | 結果 | 時間(UTC) |
|---|---|---|
| `git diff --check 188d4b4 742da2d` | **CLEAN** | 2026-07-18T19:28Z |
| `npx tsc --noEmit` | **exit 0** | 2026-07-18 |
| `npx vitest run` | **exit 0** — 29 tests passed | 2026-07-18 |
| `npm run build` | **exit 0** — Compiled successfully 28.6s，含新 `/auth/confirm` 路由 | 2026-07-18 |

## Schema / API / Env

- **Schema：YES** — migration 03（需套 live DB）+ pro_schema/create_patient_consents 對齊。
- **API：** 新增 `/auth/confirm`；login 頁狀態顯示。
- **Env：** 無新增（沿用 APP_ORIGIN 選用）。

## 尚未關閉 / DEFERRED（owner=當事人 / 下一單元）

| 項目 | Owner | Gate |
|---|---|---|
| 套用 migration 03 到 live DB | 當事人 | 跑成功 + R1 測試仍 ALL PASS + PHI aal1/aal2 DB 測試 |
| Confirm signup email template 改 token_hash | 當事人 | 新 email 註冊 live 端到端驗證 |
| Confirm Email / redirects / password_min_length / MFA Dashboard 證據 | 當事人 | evidence 文件全勾 |
| RR4 consent ownership DB invariant、RR5 lifecycle 狀態機、RR6 is_pro-in-policies | Fable（下一單元） | disposable Postgres integration suite |
| disposable DB clean-install/replay + concurrency 整合測試 | Fable + 當事人 | 需可拋棄式 Postgres（本機無 psql/CLI，尚無法執行） |

## 誠實限制

本機**無 psql / Supabase CLI / pg**，無法跑 GPT 要求的 disposable-DB integration/replay/concurrency 測試。
純函式（authz）已 29 tests 覆蓋 R2/R3；DB-level（RLS/AAL/function ACL/併發）目前只能靠 migration 邏輯審查 +
live SQL Editor 手動測試（R1 已 ALL PASS）。要完整關閉需一個可拋棄式 Postgres 測試環境。

## Ownership released: YES

請 GPT re-review `git diff 188d4b4 742da2d`。
