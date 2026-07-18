# SEC-001b — Fable Handoff（回應 SEC-001 GPT review）

> Writer: Fable · Reviewer: GPT-5.6 SOL · 日期: 2026-07-19
> 前提：保留 `4fd7889`（未 amend/rebase）。以下皆為其上（HEAD `baccac8` 之後）的 follow-up commits。

## 單元與 SHA

| Unit | 主題 | Commit SHA | 對應 findings |
|---|---|---|---|
| Unit 1 | App guards | `2f376b7` | R2, R3, R4, R5（+ 測試框架） |
| Unit 2 | Role authority migration | `028a5b6` | R1 |
| Unit 3 | Consent integrity migration | `68e90c0` | R6, R7, R8 |
| Unit 4 | Auth operations evidence | 本次 docs commit | R5(config), R9, R4(allowlist) |

Review 範圍建議：`git diff baccac8 68e90c0`（app + migrations），Unit 4 為 evidence 清單文件。

> **更新 2026-07-19（apply-to-live 進度）**
> - 兩個 forward migration **已套用到已部署 DB**：
>   - `20260719_01_role_authority.sql`（R1）— 首次因線上 `profiles` 缺 `avatar_url` 而 42703 失敗；
>     已改為動態欄位授權（fix commit `7bd2dc4`，補上 clincalc 的 gender/date_of_birth）後**重跑成功**。
>   - `20260719_02_consent_integrity.sql`（R6/R7/R8）— 套用成功。
> - **R1 已於 live DB 驗證**：`rls_privilege_columns_test.sql`（修正版 `b06vuyx2a` 系）以一般用戶執行 → **ALL PASS**
>   （pro_role / is_pro 自我提權皆被擋）。原測試邏輯有假 PASS bug，已修正並重測。
> - 仍 DEFERRED（Owner=當事人，未做）：Confirm Email / Site URL / 精確 Redirect URLs / password_min_length + direct test / 跨角色·併發整合測試。見 `SEC-001b-auth-operations-evidence.md`。
> - 另：GPT availability review 指出 `/api/ping` 洩漏 raw err.message → 已修（不對匿名回傳詳情）。

## 逐條 disposition（R1–R9）

### R1 — 一般用戶可自我提權 pro_role — **FIXED (code) / DEFERRED (apply-to-live)**
- 檔案：`supabase/migrations/20260719_01_role_authority.sql`（Unit 2 `028a5b6`）
- 作法：欄位級 `revoke update ... grant update(安全欄位)` + `enforce_profile_privilege_columns` trigger（非 service_role 改 is_pro/pro_role 即 raise）+ own-profile policy 補 `with check`。
- 驗證：附 `supabase/tests/rls_privilege_columns_test.sql`（自我提權應被拒）。
- **DEFERRED 部分**：migration 必須套用到**已部署 DB**（Owner：當事人；gate：跑 migration + RLS 負向測試通過後才可標 A1 verified）。程式端無法自證 live DB 狀態。

### R2 — Admin API 未要求 AAL2、允許 self MFA reset — **FIXED**
- 檔案：`src/lib/pro/authz.ts` + `src/app/api/pro/admin/users/route.ts`（Unit 1 `2f376b7`）
- 作法：`checkPrivilegedCaller` 強制 user + `is_pro===true` + admin/super_admin + `currentLevel==='aal2'`，所有 mutation 與 GET 都在 route 內呼叫（不依賴只 match `/pro/*` 的 middleware）。self `reset_mfa`/`reset_password` 一律拒絕（走個人安全流程）。
- 驗證：vitest 29 tests（含 aal1 拒絕、self MFA 拒絕）。

### R3 — target-role lookup fail-open — **FIXED**
- `classifyTarget` 回 typed `ordinary|admin|super_admin|not_found|error`；`authorizeAdminAction` 對 `error`→503、`not_found`→404 一律 fail closed。不再用 null 混淆語意。
- 驗證：vitest 覆蓋 error/not_found × 四種 action。

### R4 — 驗證信 redirect 信任 request Origin + callback 落錯頁 — **FIXED (code) / DEFERRED (allowlist)**
- `register/route.ts`：改用 server 端 `canonicalOrigin()`（`APP_ORIGIN` 或已知正式站，驗 https；不採用 request Origin）。
- `auth/callback/route.ts`：處理 `exchangeCodeForSession` 錯誤→導回 login?error；`next` 只允許站內相對路徑（擋 open redirect）；pending（未 is_pro）帳號導向 `login?verified=1`，不落 `/pro/dashboard`。
- **DEFERRED**：Supabase Redirect URL 精確 allowlist（Owner；見 Unit 4 evidence）。

### R5 — 回應可區分 + 依賴外部設定 — **FIXED (code) / DEFERRED (Confirm Email 證據)**
- `register/route.ts`：所有帳號存在性相關路徑一律 `202 {ok:true}`，移除 `needsVerification` session flag。
- `register/page.tsx`：文案改為不保證、不洩漏（「若…符合申請條件，將收到…」）。
- **DEFERRED**：Confirm Email = ON 等 Auth 設定證據（Owner；Unit 4）。

### R6 — consent route 與 schema 不相容 + service role 繞過 ownership — **FIXED (code) / DEFERRED (apply-to-live)**
- `migrations/20260719_02_consent_integrity.sql`：`patient_consents` 補 `doctor_patient_id` + FK + index。
- `consent/invite/route.ts`：有 `doctor_patient_id` 時，先以 service client 驗 `doctor_patients.id=? AND doctor_id=caller`，非本人病歷回 403；不再盲信 client ID。
- **DEFERRED**：migration 套用到 live DB（Owner）。

### R7 — consent 未真正限制 PHI + 撤銷後仍可讀 — **FIXED (code) / DEFERRED (apply-to-live)**
- 同一 migration：`drop policy "Pro doctors read all health_records"`（過寬、OR 疊加使 consent 失效）；consent 讀取 policy 加 `join profiles ... is_pro AND pro_role in (clinical roles)` → 降權/撤銷後即失去 PHI 存取。
- 影響確認：admin analytics 走 service role（繞 RLS）不受影響；`patients/[id]` 頁只在有 active consent 時查、由 consent policy 允許，屬正確收斂非破壞。
- **DEFERRED**：apply-to-live + 跨角色 RLS tests（Owner；需 live DB）。

### R8 — consent token 競態非單次 — **FIXED (code) / DEFERRED (apply-to-live)**
- `accept_consent` 改單一 `update ... where token AND status='pending' AND ... AND patient_user_id is null returning id`，以是否 returning 判定成功。
- **DEFERRED**：apply-to-live + 併發測試（Owner）。

### R9 — 8 字元非全流程 server-authoritative — **DEFERRED (Owner config)**
- server route（register、admin reset）已有 8 字元檢查；但 profile/reset-password 走 client 呼叫 Supabase `updateUser`，權威下限是 Supabase Auth 的 `password_min_length`。
- **DEFERRED**：Dashboard 設 8 + direct API test（7 拒 / 8 過），見 Unit 4 evidence。此證據出現前 A5 維持 partial。

### P2 / Non-blocking
- Admin UI capability matrix 與 backend 漂移 → **DEFERRED (P2)**：backend 已是唯一權威（fail-closed）；UI 純顯示，後續抽共用 capability matrix。
- audit write / 逐一刪 MFA factor 失敗 → **部分 FIXED**：`writeAuditLog` 失敗改為記 error（不再靜默）；`reset_mfa` 部分失敗回 500 並列出 failed factors。audit 失敗採 log-but-proceed（可用性優先），此決策記錄在此供 reviewer 確認。

## 執行過的命令與結果（在 Unit1–3 疊加後、exact HEAD `68e90c0`）

| 命令 | 結果 | 時間(UTC) |
|---|---|---|
| `git diff --check baccac8 68e90c0` | **CLEAN** | 2026-07-18T18:11Z |
| `npx tsc --noEmit` | **exit 0** | 2026-07-18 |
| `npx vitest run` | **exit 0** — 1 file, **29 tests passed** | 2026-07-18 |
| `npm run build`（Turbopack） | **exit 0** — `✓ Compiled successfully in 23.1s` | 2026-07-18 |

## Schema / API / Env 影響

- **Schema：YES** — 兩個 forward migration（role authority、consent integrity）。**必須套用到已部署 DB**；未套用前 R1/R6/R7/R8 在 production 尚未生效。
- **API：行為層級** — Admin API 現要求 AAL2 + is_pro；register 回 `202`（原 200 + needsVerification）；consent invite 對非本人病歷回 403。
- **Env：新增選用 `APP_ORIGIN`**（未設則用已知正式站；不再使用 request Origin，亦不再用 `NEXT_PUBLIC_SITE_URL`）。

## 尚未處理 / DEFERRED（含 owner 與 gate）

| 項目 | Owner | Release gate |
|---|---|---|
| 套用兩個 migration 到 live DB | 當事人 | 跑 migration + RLS 負向測試 + consent 跨角色測試通過 |
| Supabase Confirm Email / Site URL / 精確 Redirect URLs | 當事人 | Unit 4 evidence 全部打勾 |
| `password_min_length=8` + direct API test | 當事人 | R9 7-拒/8-過 證據 |
| 跨角色 / 併發 RLS 整合測試（需 live DB） | 當事人（可由 Fable 提供腳本） | 測試通過紀錄 |

## Ownership released: YES

請 GPT re-review `git diff baccac8 68e90c0` 與本 handoff，更新 `docs/audit/reviews/` 內對應 review。
Fable 對 GPT 後續意見續以 ACCEPT / REJECT / NEEDS_DECISION 回覆。
