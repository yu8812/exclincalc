# SEC-001d — GPT re-review

> Reviewer: GPT-5.6 SOL  
> Review date: 2026-07-19  
> ExClinCalc exact range: `742da2d0b4f2c97f99ce50b6ee7f8131175f607b..d02856d6d1b092fe98cc5eb6009476981c8263e5`  
> ClinCalc commits: `c3a52c5cc47da13da30fcdbd452ddd379716bfcc` and `e657aee9e21d91fcc83154b5c965dbdea9f09917`  
> Source handoff: `docs/audit/handoffs/SEC-001d-fable-handoff.md`

## Verdict

**REQUEST_CHANGES — RR8 與 RR9 都只能算部分修正；`d02856d` 不可標成可部署完成版，SEC-001 仍須保持 OPEN。**

同意 handoff 的兩個操作提醒：

1. **現在不要把 migration 04 套到 live。** 除了 demo/pro 帳號尚未 enroll + challenge MFA，現有 canonical schema 仍能把 AAL2 policy 覆蓋回不安全版本。
2. **現在不要套 RR9 Dashboard 設定。** 兩個 app 尚未一起部署、recovery callback allowlist 也不完整；先開 Confirm Email 會破壞現有註冊／復原流程。

本 range 確實有進展：AAL2 helper、admin data guard、analytics 的 AAL2 check、未 enroll 使用者導向 security、兩 app 各自的 signup redirect、shared template 的 `.RedirectTo` 方向都正確；35 個 pure authz tests 與兩個 app 的 Webpack build 也通過。但目前仍有可重現的 schema rollback、未受 AAL2 保護的 consent token API、MFA session lifecycle 缺口，以及 RR9 redirect/recovery 安全問題。

## RR8–RR13 disposition

| Finding | Re-review | 結論 |
|---|---|---|
| RR8 global MFA/current entitlement | **PARTIAL / REQUEST_CHANGES** | helper 與兩支 API guard 正確；consent API、其他 sensitive API、canonical policy、middleware cookie／error path 與 self-unenroll 仍有缺口。 |
| RR9 shared Auth routing | **PARTIAL / REQUEST_CHANGES** | per-app `.RedirectTo` happy path 接受；token type fallback、recovery allowlist、Clin callback、unsafe post-login redirects 與 E2E 未完成。 |
| RR10 active constraint preflight | **OPEN / DEFERRED** | handoff 誠實標示 deferred；本 range 沒有 remediation、preflight 或 deletion integration test，不能關閉。 |
| RR11 consent lifecycle/invariant | **OPEN / DEFERRED** | handoff 誠實標示 deferred；另外 consent invite/list 本身仍漏 AAL2。 |
| RR12 replay-safe schema | **FAIL / REQUEST_CHANGES** | `complete_setup.sql` clean install 會失敗，active `pro_schema.sql` runner 會撤銷 migration 04；不是 replay-safe。 |
| RR13 resource/audit/test hardening | **OPEN / DEFERRED** | handoff 誠實標示 deferred；resource PATCH 仍只看 role，未看 current `is_pro`/AAL2。 |

## Blocking findings

### SEC001D-01 — P0 release blocker — 正式 schema runner 會撤銷 migration 04；clean install 也會先失敗

**Evidence**

- `supabase/pro_schema.sql:48-50,75-77,100-102,121-123` 仍 drop/recreate 四個 owner policies，條件只有 `auth.uid() = doctor_id`，沒有 current `is_pro` 或 AAL2。
- `scripts/run-schema.mjs:31` 仍把該檔當成可執行 schema 來源。migration 04 套用後只要重跑這支 helper，aal1 或已 demote 的帳號就重新取得 doctor-owned patients、clinical records、SOAP notes 與 drug logs。
- `supabase/complete_setup.sql:56-58` 先建立呼叫 `public.is_current_admin()` 的 policy，但函式到 `:95-102` 才建立。全新 DB 在 CREATE POLICY 時無法解析尚不存在的 function；只有先跑過 migration 03 的環境可能看似成功。
- `README.md:182-188` 的必跑 migration chain 停在 03，未列 migration 04；同時宣稱 legacy files 已同步為安全定義，與 `pro_schema.sql` 現況矛盾。

**Impact**

RR12 的「canonical 對齊」不成立；目前沒有一條既能 clean-install、又能 replay 且不會降低權限的正式路徑。這不是純文件問題，repo 內有 active runner 可直接重建舊 policy。

**Required change**

- 先同步／停用所有 legacy runner，修正 helper/function 建立順序，並把 migration 04 及 coupled rollout warning 寫進正式 README。
- clean install 後重跑所有允許的 setup paths；assert `pg_policies`、function ACL 與 constraints 的最終狀態完全一致。
- 在這些條件通過前，不得 apply migration 04 或把 RR12 列為 fixed。

### SEC001D-02 — P1 high — AAL1 仍可建立與讀取 consent bearer tokens；API inventory 不完整

**Evidence**

- `src/app/api/pro/consent/invite/route.ts:19-31` 的 POST 只檢查登入、`is_pro` 與 role，沒有 AAL2；之後使用 service-role 查 ownership 並在 `:58-68` 建立、回傳 bearer invite token。
- 同檔 GET `:72-81` 只檢查登入，回傳 `invite_token`、`patient_user_id` 等資料；`supabase/create_patient_consents.sql:36-38` 的 doctor SELECT policy 也只有 `doctor_id = auth.uid()`。
- middleware matcher 只有 `/pro/:path*`，不會保護 `/api/pro/*`。因此偷到醫事人員密碼而取得 aal1 session 的人仍能直接呼叫這兩條路徑。
- `gemini-clinical/route.ts:28-33,56-83` 也只檢查 `is_pro`，卻接收 patient context、labs、symptoms、SOAP 並送第三方 AI；`drug-interactions/route.ts:10-15` 同樣沒有 AAL2。`resources/check-updates/route.ts:91-104` 的 PATCH 只查 role，連 current `is_pro` 都未檢查（亦屬 RR13）。

**Required change**

- consent POST/GET 接上共用 AAL2 guard，再套 consent-specific role/ownership policy。
- 建立完整 `/api/pro` inventory，以資料敏感度與 side effect 決定 `requireProAal2` 或 `requirePrivileged`；不能只列 service-role routes。
- `admin/users` 已有正確 guard，但仍複製一份 `loadCaller/requirePrivileged`；改用 shared module 以避免下一次漂移。

### SEC001D-03 — P1 high — AAL2 被寫在 permissive policy 內，且角色／資料範圍仍過寬

**Evidence**

- migration 04 的新 policies 都是預設 `PERMISSIVE`。PostgreSQL 會以 OR 合併 permissive policies；任何 stale/manual/legacy policy 都能繞過嵌在其中的 AAL2 條件。前述 `pro_schema.sql` 已證明這是可實際發生的 overwrite vector。
- `20260719_04_global_aal2_phi.sql:43-71` 的 doctor owner policies 呼叫不檢查角色的 `is_active_pro_aal2()`。nurse、pharmacist、admin_staff 仍可用自己的 UID 建立並管理 `doctor_id=self` 的 doctor rows。
- interaction policy `:73-77` 讓 pharmacist/admin/super_admin `FOR ALL` 整張表；appointments 與 triage `:80-87` 讓任何 active Pro + AAL2 全表讀寫。AAL2 只證明驗證強度，不代表資料或角色授權。
- Analytics UI 只在 admin section 顯示（`src/components/pro/ProSidebar.tsx:37-42,144-150`），API 卻在 `analytics/route.ts:7` 使用任意角色可過的 `requireProAal2()`，再以 service role 讀全站 user/patient/sex/diagnosis aggregates。

Supabase 的 MFA guide 對「所有使用者強制 MFA」明確要求 `AS RESTRICTIVE`，並說這可在其他 policies 存在時仍限制所有 commands：[Supabase MFA database enforcement](https://supabase.com/docs/guides/auth/auth-mfa#database)。

**Required change**

- 每張 PHI table 使用獨立的 `AS RESTRICTIVE ... TO authenticated` AAL2 + current-entitlement gate，並明確提供 `USING`/`WITH CHECK`；ownership/role policies 再以 permissive rules 表達細部授權。
- 定義 doctor/nurse/pharmacist/admin_staff/admin 的 CRUD matrix；owner policy 必須檢查所需 role，appointments/triage 不應默認所有 Pro 全表 `FOR ALL`。
- Analytics 若確為 admin 功能，改用 `requirePrivileged()`；若要開放，需先更新正式權限模型並縮減回傳資料。

`FOR ALL USING (...)` 未另外寫 `WITH CHECK` 本身不是此次 finding；PostgreSQL 會在省略時沿用 `USING`。問題是 policy composition 與角色/row scope。

### SEC001D-04 — P1 high — Mandatory MFA 的 middleware/session lifecycle 尚未 fail closed

**Evidence**

- `src/middleware.ts:11-24` 把 Supabase 刷新的 cookies 寫進 `res`，但所有 redirect 在 `:36,49,63,71` 都回傳新的 `NextResponse.redirect()`，沒有把 `res.cookies` 複製過去。token refresh 發生時，browser 可能拿不到新 cookie，形成登入/MFA loop 或 server/browser session 不一致。Supabase SSR 指引要求 refreshed token 同時寫回 response cookies：[Supabase SSR client](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs)。
- `getAuthenticatorAssuranceLevel()` 的 error 未處理；`aal` 為 null/undefined 時兩個 redirect 分支都不成立，最後 `return res`，即 fail-open page rendering。DB/API 若完整防護可以縮小影響，但目前 SEC001D-02 所列 API 尚未完整防護。
- `src/app/(pro)/pro/security/page.tsx:80-85` 允許 active Pro 移除最後一個 verified factor，成功後只 reload factors，沒有 `refreshSession()`、sign-out 或 mandatory re-enroll。
- Supabase 明確說明：unenroll 後，JWT 要等 refresh interval 才從 aal2 降為 aal1；若要立即降級必須手動 `refreshSession()`：[Supabase MFA unenroll](https://supabase.com/docs/guides/auth/auth-mfa#add-unenroll-flow)。migration 04 又只讀 JWT `aal`，所以使用者移除最後一個 factor 後仍會暫時保有 PHI access。

**Required change**

- redirect response 必須保留 Supabase set-cookie；AAL lookup error/null 應導向可重試的安全錯誤／MFA path，而不是當成通過。
- 強制 MFA 模式下禁止移除最後一個 verified factor，或 unenroll 成功後立即 refresh/sign-out 並導向 mandatory enrollment。
- enrollment 完成不等於 aal2；deploy runbook 必須要求每個 demo/key account 再做 challenge，取得新的 aal2 session。

### SEC001D-05 — P1 high — RR9 的 Dashboard allowlist 指示會破壞 recovery；既有 auth redirects 仍有 open redirect/XSS

**Evidence**

- `docs/audit/handoffs/SEC-001b-auth-operations-evidence.md:17-22` 現在只列兩個 `/auth/confirm` production URLs。
- 但兩個 app 的 `src/app/auth/forgot-password/page.tsx:19-20` 都仍送出 `.../auth/callback?next=/auth/reset-password`。若 callback 不在 shared Supabase project 的 allowlist，Supabase 會 fallback/misroute；Site URL 又建議設為 ClinCalc，Ex recovery 特別容易被導到錯 app。
- ClinCalc `src/app/auth/callback/route.ts:6-14` 接受 raw `next`、沒有 code 也 redirect、忽略 exchange error，最後直接組 `${origin}${next}`；`?next=@evil.example` 會成為外站 URL。
- Ex login `src/app/auth/login/page.tsx:39,43,57`、Ex MFA continuation `src/app/auth/mfa-verify/page.tsx:107-108`、Clin login `src/app/auth/login/page.tsx:18-20,33` 都把 user-controlled redirect/next 傳給 `router.push`。Next.js 官方明確警告不可信的 `javascript:` URL 會在頁面 context 執行，形成 XSS：[Next.js useRouter security](https://nextjs.org/docs/app/api-reference/functions/use-router#userouter)。

後兩項主要是既有問題，不是本 range 新增；但 RR9 正在修改並準備部署同一組 auth flows，因此會阻擋安全稽核 closure。

**Required change**

- allowlist 同時保留兩個 `/auth/confirm` 與兩個實際 emitted recovery callback URLs（含 query 或經驗證的精確安全 pattern），再分別 E2E。
- 抽成一個 shared same-origin internal-path sanitizer，套用在 callback、login、MFA continuation；Clin callback 必須 require code、檢查 exchange error 並 fail closed。
- Clin reset page加 session preflight；expired/cross-device PKCE link 不應先顯示可用的 reset form。

### SEC001D-06 — P1 reliability/security — confirm route 的 type brute-force 不是可證明的相容修正

**Evidence**

- Ex `src/app/auth/confirm/route.ts:21,29-37` 與 Clin `:18,26-34` cast query-string type，依序嘗試 `[supplied type, signup, email]`。
- 對 signup template 而言，現在的 Supabase 文件與 repo template 都明確使用 `type=email`；沒有官方或整合測試證據支持「錯誤 type 的 verify 不會消耗／影響 token」是穩定 contract。[Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- 這也使 signup-only endpoint 可接受 recovery/invite/email-change hash 並建立錯誤 landing/session semantics。持有 hash 本身已有 authority，所以不是獨立 privilege escalation，但屬敏感 auth-flow confusion。
- Clin confirm 會送出 `invalid_link`/`verification_failed`（`:21-22,36-37`），Clin login 卻只讀 `next`（login `:18-20`），使用者看不到錯誤。
- evidence 提議 localhost confirm URL，但 Ex `canonicalOrigin()`（register route `:8-17`）拒絕所有非 HTTPS origin並 fallback production，文件中的 Ex localhost E2E 實際不可走。

**Required change**

- 專用 signup endpoint 只接受/normalize 已部署 template 的精確 type，並只呼叫一次 verify。若 hosted version 真需要第二種 type，先以實際 project E2E 證明並明確 allowlist，不能 brute-force。
- Clin 顯示 confirmation error；修正文檔與 Ex local/dev origin 策略（只在 non-production 允許 loopback HTTP，或明說 E2E 必須跑 deployed preview）。

## Lower-severity observations

- `analytics/route.ts` 忽略每一個 Supabase query 的 `{ error }`。query error 通常不會 throw，外層 catch 抓不到，最後可能回 200 + 零值/空陣列；應 fail closed 或標示 partial data。
- Direct token-hash GET 仍有郵件 link scanner/prefetch 消耗一次性 token 的風險；Supabase 建議 OTP 或 user-click interstitial。可列後續 hardening，不是此次主 blocker。
- `.github/workflows/keep-alive.yml` 改用 anon key 對 public REST endpoint 的方向可接受；2026-07-19 的 Supabase 官方文件仍說 Free project 會依 7 日低活動判斷，daily DB request 合理且不需付費。它是備援，不應被描述成 availability guarantee。

## Accepted portions

- `is_active_pro_aal2()` 會同時檢查 JWT exact `aal2` 與 current `profiles.is_pro=true`；role helper 另查 current role。
- `admin/route.ts` 已要求 admin/super_admin + current is_pro + AAL2；analytics 至少已補 AAL2 並移除 anon fallback。
- `clinic_flow.sql` 的 appointments/triage AAL2 definitions 與 migration 04 一致（角色 scope 仍需另修）。
- 兩個 app signup 各自帶自己的 `/auth/confirm`，shared confirmation template 使用 `.RedirectTo`；這是共用 Auth project 的正確架構方向。
- migration 04 尚未 apply、Dashboard 尚未變更：這個操作決策正確。

## Verification performed

| Check | Result |
|---|---|
| Ex `git diff --check 742da2d d02856d` | **PASS** |
| Clin `git diff --check b86da21 e657aee` | **PASS** |
| Ex `npm test` | **PASS — 1 file / 35 tests**；仍只有 pure authz，無 DB/auth-flow integration |
| Ex `npm run build -- --webpack` | **PASS**（Next 16.2.1，42 routes） |
| Clin `npm run build -- --webpack` | **PASS**（Next 16.2.4，22 routes） |
| Targeted ESLint（兩 repo changed TS/TSX） | **PASS with 0 errors**；Clin register 有 1 個既有 unused `router` warning |
| Disposable Supabase clean-install/replay/RLS/concurrency | **NOT AVAILABLE / NOT RUN** |
| Signup/recovery/MFA live E2E | **NOT RUN / Dashboard not applied** |

Clin 的預設 Turbopack build 在此 Windows 環境因 native SWC binary 無法載入而停；改用 repo 已記錄的 Webpack path 後完整 build 通過，判定為本機 toolchain 問題，不是本 diff regression。

## Zero-cost exit gate and rollout order

1. 先修 SEC001D-01～06；不要碰 live migration 04 或 Dashboard。
2. 建立免費的 disposable Supabase：首選 local Supabase CLI + Docker；若本機無法跑且尚有 free slot，再用第二個 Free project。單純 vanilla Postgres 不足以忠實模擬 Supabase roles、`auth.uid()`、`auth.jwt()` 與 Auth/MFA。
3. 跑 clean install + replay + catalog assertions，再跑 role × is_pro × aal × table/API matrix、consent concurrency/replay 與 demotion tests。
4. 部署兩個 app，確認 `/auth/confirm`、safe callback、MFA enrollment/challenge/recovery 都可用。
5. Dashboard 加四條 production auth URLs、套 `.RedirectTo` template、開 Confirm Email；跑 Clin signup、Ex signup、Clin recovery、Ex recovery、invalid/expired/hostile redirect E2E。
6. 讓 4 個 demo 與關鍵管理帳號先 enroll，接著實際 challenge 取得 fresh aal2 session；TOTP secret 不得進 repo。
7. 最後才 apply migration 04，立即跑 aal1-deny / aal2-allow / demoted-deny smoke matrix。準備 emergency rollback，但要明寫 rollback 會暫時恢復較弱的 PHI policies。

在上述 gates 完成前：**RR8/RR9/RR12 不得標 fixed；RR10/RR11/RR13 維持 open；SEC-001 維持 open。**
