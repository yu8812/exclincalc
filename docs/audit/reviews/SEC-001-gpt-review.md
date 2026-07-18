# SEC-001 — GPT Review

> Reviewer: GPT-5.6 SOL
> Review date: 2026-07-19
> Reviewed range: `141ecb75a0974e2aa5e3d9f09799330054b97a23..4fd7889ed0671ceb14f7b234baba7dd4639372d1` only
> Source handoff: `docs/audit/handoffs/SEC-001-fable-handoff.md`
> Later commits `0e0951d` (SEC-002), `f5727b4` (SEC-003), and later documentation commits were not reviewed.

## Verdict

**REJECT / REQUEST_CHANGES（不能把 SEC-001 標記為已結案）**。

這不是要求回退 `4fd7889`。該 commit 已做出有價值的局部改善，可以保留；但目前仍存在可實際串成權限提升、MFA 繞過與病患資料越權的路徑。因此應在目前 branch 頂端追加小型 follow-up commits，不要 amend、rebase 或重寫 `4fd7889`，以免影響已疊在後面的 SEC-002／SEC-003。

## 已確認有效的改善

- Admin API 的 `reset_password`、`reset_mfa`、`PATCH`、`DELETE` 都新增了目標角色守衛；在 profile 查詢正常的前提下，一般 admin 已不能操作其他 admin／super_admin。
- 一般 admin 已不能指派 `admin`／`super_admin`，且不能修改自己的 `pro_role`。
- 公開註冊已不再用 service role 與 `email_confirm: true` 建帳號，改走 anon `signUp`。
- Consent invite 已移除 `SERVICE_ROLE_KEY || ANON_KEY` 靜默降級；缺 service key 會回 503。
- 註冊、admin reset 與三個畫面顯示的最低密碼長度已統一為 8。
- 我獨立執行 `git diff --check 141ecb75 4fd7889`，結果 clean。

以上是「局部修正成立」，不等於整個安全目標已成立。

## Acceptance 結果

| Unit | 結果 | 說明 |
|---|---|---|
| A1 Admin API hierarchy | **PARTIAL / FAIL AS CLOSED** | 目標角色矩陣改善，但 caller 角色可由用戶自行寫入、未驗 `is_pro`／AAL2、self MFA reset 可繞過 MFA，target lookup 亦 fail-open。 |
| A2 Email verification / enumeration | **FAIL** | `Confirm email` 與 redirect allowlist 尚未驗證；回應形狀仍可因帳號／設定狀態不同而不同，callback 也會把待核准帳號導到未授權頁。 |
| A4 Consent role / service key | **PARTIAL / FAIL AS CLOSED** | key fallback 已修；但 checked-in schema 不相容、patient relation 未驗 ownership，PHI RLS 與 consent lifecycle 仍未真正受 consent 約束。 |
| A5 Password minimum | **PARTIAL / UNPROVEN** | server route 有 8 字元檢查；self-service／recovery 仍可直呼 Supabase，真正下限取決於未驗證的 Supabase Auth 設定。 |

## Blocking findings

### SEC001-R1 — P0 — 一般註冊用戶仍可直接把自己提升成 super_admin

**Evidence**

- `supabase/complete_setup.sql:27-34` 把 `is_pro` 與 `pro_role` 放在一般 `profiles` row。
- `supabase/complete_setup.sql:51-53` 的 own-profile UPDATE policy 只檢查 `auth.uid() = id`，沒有保護 privilege columns。
- `src/app/api/pro/admin/users/route.ts:22-30` 又直接把 `profiles.pro_role` 當作 service-role Admin API 的信任根；甚至沒有檢查 `is_pro`。

**Exploit chain**

`signUp` → 驗證 email → 以 authenticated Supabase client 更新自己的 `profiles` 為 `is_pro=true, pro_role='super_admin'` → 直接呼叫 `/api/pro/admin/users` → 使用 service role 重設密碼、移除 MFA 或刪除其他帳號。

這個 RLS 問題早於 `4fd7889`，但它直接破壞 A1 的安全結論，所以不能只因不在 diff 中就忽略。

**Required change**

- 用 forward migration 收回 authenticated 對 `is_pro`／`pro_role` 的更新能力；只授權姓名、機構、執照、settings 等安全欄位。
- 角色異動只能經過 server/service-role 或有完整 caller、target、role matrix 的 fail-closed RPC。
- 不可只改 bootstrap SQL；已部署資料庫也必須收到 migration。
- 加入 RLS negative tests：一般 user／doctor／admin 均不能直接改自己的 privilege columns。

建議把這個 DB 權限根修復獨立成一個 schema unit，不要混進 UI patch。

### SEC001-R2 — P0 — Admin API 不要求 AAL2，且允許 self MFA reset

**Evidence**

- `src/app/api/pro/admin/users/route.ts:22-30` 只驗登入與 `pro_role`，未驗 `is_pro` 或目前 session 的 AAL。
- `src/app/api/pro/admin/users/route.ts:50-58` 允許 admin 對自己操作；super_admin 則無條件通過 target guard。
- `src/app/api/pro/admin/users/route.ts:181-195` 可直接刪除目標 MFA factors。
- `src/middleware.ts:67-69` 只 match `/pro/:path*`，不會保護 `/api/pro/*`。

**Exploit chain**

攻擊者取得 admin 密碼或 aal1 session，但沒有 TOTP → 直接 POST API 對自己執行 `reset_mfa` → factors 被 service role 刪除 → MFA 要求消失。若 `is_pro` 已被撤銷但 `pro_role` 留著，該帳號目前也仍可直接呼叫 Admin API。

**Required change**

- 抽出 server-only `requirePrivilegedCaller()`：同時驗 `user`、`is_pro === true`、allowed role，以及 `currentLevel === "aal2"`；所有 privileged mutations 都必須在 route 內呼叫，不能依賴頁面 middleware。
- 一般 Admin API 禁止 self `reset_mfa`，self password reset 也應走需要 reauthentication 的個人安全流程。
- 遺失 MFA 的恢復流程另建：由另一位已通過 AAL2 的 super_admin 操作，或走明確的 out-of-band recovery；不可讓 aal1 session 自救。
- Supabase 的 AAL2 代表傳統登入再加一個 MFA factor；應在 backend/API 強制檢查，而非只做前端導頁。參考 [Supabase MFA guidance](https://supabase.com/docs/guides/auth/auth-mfa)。

### SEC001-R3 — P1 — Target-role lookup 在錯誤時 fail-open

`src/app/api/pro/admin/users/route.ts:34-38` 丟棄 Supabase error，將「一般用戶」、「profile 不存在」與「資料庫查詢失敗」全部壓成 `null`；`guardTarget()` 對 `null` 放行。

若 profile lookup 暫時失敗，而 Auth Admin API 仍可用，一般 admin 就可能對受保護目標執行 password reset、MFA reset 或 delete。

**Required change**

- 回傳 typed result，例如 `ordinary | protected | not_found | error`。
- `not_found` 與 `error` 一律 fail closed；不要用 `null` 同時表示「普通帳號」與「不知道」。
- 加入 lookup error／missing profile 的 negative tests。

### SEC001-R4 — P1 — 驗證信 redirect 信任 request Origin，且成功後落到錯誤頁

**Evidence**

- `src/app/api/auth/register/route.ts:49-61` 優先採用 caller 可控制的 `Origin` header 組出 `emailRedirectTo`。
- `src/app/auth/callback/route.ts:7-14` 在沒有 `next` 時預設去 `/pro/dashboard`；但新註冊 profile 尚未 `is_pro`，因此成功驗證後會立刻被 middleware 導回 unauthorized login。

在嚴格 Supabase allowlist 下，偽造 Origin 會造成壞掉或 fallback 的驗證流程；若 dashboard 使用 wildcard／過寬 allowlist，驗證流程可能被導向攻擊者控制、但仍被 allowlist 接受的 origin。Supabase 明確要求 redirect URL 必須符合設定清單，並建議 production 使用精確路徑：[Redirect URL guidance](https://supabase.com/docs/guides/auth/redirect-urls)。

**Required change**

- production 使用一個必填、server-controlled 的 canonical origin（例如 `APP_ORIGIN`），以 `new URL()` 驗證 HTTPS 與 exact host；不要信任任意 request `Origin`。
- Supabase production redirect allowlist 使用 exact callback URL，不使用 `**`。
- 註冊驗證 callback 明確導向「信箱已驗證、等待管理員核准」頁或 `/auth/login?verified=1`，並處理 `exchangeCodeForSession` error。
- 測試 spoofed Origin、合法 callback、無效 code 與 pending-account 最終落點。

### SEC001-R5 — P1 — A2 仍受外部設定與可區分回應影響

**Evidence**

- `src/app/api/auth/register/route.ts:65-79` 的 existing-email error path 回 `{ ok: true }`，一般成功 path 回 `{ ok: true, needsVerification: ... }`，回應形狀不一致。
- `src/app/auth/register/page.tsx:31-40,61-62` 不使用 `needsVerification`，任何 2xx 都斷言「驗證信已寄出」。
- Handoff 已承認 Supabase Dashboard 的 `Confirm email` 與 redirect allowlist 尚未驗證。

Supabase 的行為取決於 Auth 設定：關閉 Confirm Email 會讓新帳號被隱含確認；`signUp` 也只表示「可能」回傳用來隱藏既有帳號的結果，不能把 SDK 行為當成應用層唯一防線。參考 [Supabase Auth configuration](https://supabase.com/docs/guides/auth/general-configuration) 與 [JavaScript signUp](https://supabase.com/docs/reference/javascript/auth-signup)。

**Required change**

- 所有「新 email／既有 email／obfuscated result」接受路徑回完全相同的 status 與 body，例如固定 `202 { ok: true }`；不要回 session-derived flag。
- UI 改成不洩漏、也不做不實保證的文案，例如「若此地址符合申請條件，將收到後續郵件」。
- 在部署 gate／稽核證據中確認：Confirm Email enabled、Site URL、exact Redirect URLs、email template callback。
- 若 mandatory verification 下竟回傳 `data.session`，視為 deployment misconfiguration，不可宣稱修復成立。

### SEC001-R6 — P1 — Consent invite route 與 schema 不相容，且 service role 繞過 ownership

**Evidence**

- `src/app/api/pro/consent/invite/route.ts:34-46` 接受 caller 傳入的 `doctor_patient_id`，再用 service role insert；未驗證該 `doctor_patients` row 屬於 caller。
- `supabase/create_patient_consents.sql:15-25` 的 checked-in `patient_consents` table 根本沒有 `doctor_patient_id`，repo 也沒有其他 migration 新增此欄。

結果是：乾淨部署會在 invite 時回 500；若 production 有未納管的手動欄位，doctor A 也可能傳入 doctor B 的 patient-row UUID，污染 chart-to-account 關聯。

**Required change**

- 建立 versioned migration，補上有型別、FK、索引與需要的 uniqueness；或若欄位不應存在，就同步移除 API/UI 對它的依賴。
- 若是 patient-bound invite，必須在單一 atomic DB operation 內驗證 `doctor_patients.id = doctor_patient_id AND doctor_id = auth.uid()`；不要先信任 client ID 再用 service role insert。
- 若要保留 generic invite，請把它明確建模，不要用 nullable foreign relation 隱含兩種流程。
- `doctor_id` 的語意是 treating doctor；是否允許 admin／super_admin 以自己身分發邀請需產品決策。安全預設是只允許 doctor；若管理員是代辦，應另有 `created_by` 與明確 target doctor／audit，不能把 admin 偽裝成 doctor。

### SEC001-R7 — P0 release blocker — Consent 尚未真正限制 PHI 存取或撤銷後權限

這是 SEC-001 的跨檔依賴，並非 `4fd7889` 新增，但它會讓 A4 的安全敘事失真：

- `supabase/pro_schema.sql:154-162` 的 permissive policy 允許任何 `is_pro=true` 用戶讀取所有 `health_records`。Postgres permissive policies 會 OR 在一起，因此新增 consent policy 不會抵銷這條 broad policy。
- `supabase/create_patient_consents.sql:158-167` 的 consent policy 只看 active consent，沒有確認 doctor 目前仍為有效 `is_pro`／允許角色。
- `supabase/create_patient_consents.sql:76-100` 的 `accept_consent` 也沒有確認 doctor 在 token 被接受時仍有資格。被撤銷 Pro、改成其他角色的帳號，可能繼續讀既有 PHI，pending token 也可在降權後被接受。

**Required change**

- 以 forward migration 移除 broad `Pro doctors read all health_records` policy。
- consent RLS 與 RPC 都要檢查目前 staff eligibility；降權／停權後應立即失去 PHI 存取，並明確處理 pending／active consent lifecycle。
- 加入跨角色 RLS tests：一般 user、doctor with/without active consent、nurse、admin_staff、revoked doctor、is_pro=false。

這應獨立成 DB/PHI authorization unit，完成前不能對外宣稱「只有經病患授權的醫師可讀記錄」。

### SEC001-R8 — P1 — Consent token 在競態下不是單次使用

`supabase/create_patient_consents.sql:76-100` 先 SELECT 合格 token，再以只有 `id` 的 UPDATE 寫入。兩個帳號同時接受同一 token 時，都可能先通過 SELECT；第二個 transaction 等第一個完成後，仍可覆寫 `patient_user_id` 並回傳成功。

**Required change**

改成單一 conditional `UPDATE ... WHERE invite_token = ... AND status = 'pending' AND invite_expires_at > now() AND patient_user_id IS NULL RETURNING id`，以 `FOUND` 決定成功；加入兩個 session 競態測試。

### SEC001-R9 — P1 acceptance blocker — 8 字元不是所有流程的 server-authoritative policy

- `src/app/api/auth/register/route.ts:45-46` 與 `src/app/api/pro/admin/users/route.ts:160-162` 有 server-side 8 字元檢查。
- 但 `src/app/(pro)/pro/profile/page.tsx:91-99` 與 `src/app/auth/reset-password/page.tsx:31-37` 只是 client validation，之後直接呼叫 Supabase `auth.updateUser()`；惡意 caller 可跳過 UI。

真正的最低長度是 Supabase Auth 的 `password_min_length`。在 Dashboard／Management API 設為 8 或更強，並以 direct API test 證明 7 字元失敗、8 字元成功；在此證據出現前，A5 只能標記為 partial。

## Non-blocking / P2

- `src/app/(pro)/pro/admin/users/page.tsx:137-149,241-279` 的 capability matrix 與 backend 不一致：self／受保護 target 仍顯示 password/MFA buttons，而部分 backend 允許的 super_admin 操作又被 UI 隱藏。Backend 必須是唯一權威，但 UI 應共用一個不含 secrets 的 pure capability matrix，避免持續漂移。
- `writeAuditLog()` 與逐一刪 MFA factor 的部分錯誤目前會被忽略。高權限動作應回報完整／部分失敗，且要明確決定 audit write 失敗時是否 fail closed。
- 單一 commit 同時包含 A1/A2/A4/A5，rollback radius 過大。既然後續 commits 已在上面，現在不要重寫歷史；後續請依 app guards、Auth deployment config、role DB authority、consent DB integrity 拆小單元。

## Required verification before re-review

1. Table-driven authorization tests：caller role × `is_pro` × AAL × target role × self/non-self × action。
2. RLS test：一般帳號不能更新 `is_pro`／`pro_role`；各角色只能讀取明確允許的 PHI。
3. Registration test：new/existing email、spoofed Origin、callback success/error、pending approval landing；response body 必須一致。
4. Consent integration test：clean schema invite、owned/unowned `doctor_patient_id`、service key missing、revoked professional、同 token concurrency。
5. Password direct test：繞過 UI 呼叫 Supabase，7 字元必須被 Auth server 拒絕、8 字元成功。
6. 在**修復後的 exact SHA** 記錄 `git diff --check`、typecheck、lint、build 與測試 command／exit code／timestamp。
7. 外部 prerequisites 單列證據：Confirm Email、Site URL、exact Redirect URLs、password minimum、MFA settings。不要用 Next build 代替 Dashboard/Auth 設定驗證。

## Suggested handoff split

為避免再次形成大範圍 patch，建議 FABLE 依下列順序回覆；實際單元編號可調整，但邊界請保留：

1. **App guard follow-up**：AAL2／`is_pro`／self recovery／fail-closed target lookup、canonical origin、uniform registration response、safe callback、pure capability tests。
2. **Role authority migration**：收回 profile privilege-column update，附 RLS tests。
3. **Consent integrity migration**：schema/FK/ownership、single-use token、role lifecycle、PHI RLS tests。
4. **Auth operations evidence**：Supabase Confirm Email／redirect/password/MFA settings 的已驗證清單。

下一次請由 FABLE 新增 `docs/audit/handoffs/SEC-001b-fable-handoff.md`（或依拆分後各單元各一份），逐條列出 `SEC001-R1` 至 `SEC001-R9` 的 `FIXED / DEFERRED / REJECTED`、理由、exact SHA、schema impact、rollback 與驗證證據。若 deferred，必須指定 owner、單元與 release gate；不能只寫「之後處理」。

## Review evidence and limitations

- Writer-supplied evidence：handoff 記錄 exact SEC-001 worktree 的 `npx tsc --noEmit` exit 0、`npm run build` exit 0。
- Reviewer-supplied evidence：exact diff 靜態審查、相關 schema／middleware／callback dependency 審查，以及 `git diff --check` clean。
- Reviewer 未重新 checkout `4fd7889` 跑 build，因目前 branch 已有 SEC-002／SEC-003 在其上；為避免破壞工作樹，不以後續 HEAD 的 build 冒充 SEC-001 exact-SHA build。
- Repo 目前沒有 targeted test framework／SEC-001 tests；Supabase production Dashboard 設定與 live DB schema 未能由 repo 證明。

**Final disposition: REJECT AS CLOSED; KEEP THE PARTIAL COMMIT; FOLLOW UP IN SMALL, TESTED UNITS.**
