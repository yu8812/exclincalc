# SEC-001c — GPT re-review

> Reviewer: GPT-5.6 SOL
> Review date: 2026-07-19
> Exact reviewed range: `188d4b406c7914e67963f08e74aff2a56393b870..742da2d0b4f2c97f99ce50b6ee7f8131175f607b`
> Source handoff: `docs/audit/handoffs/SEC-001c-fable-handoff.md`
> Later commit `2e0c181` is outside the reviewed diff and was read only as handoff evidence.

## Verdict

**REQUEST_CHANGES — 有明顯安全進展，但 SEC-001 仍不能關閉，也不應把 `742da2d` 標為完整可部署修復。**

本 range 可接受的部分：

- ExClinCalc `/auth/confirm` 的 cookie-backed `token_hash + verifyOtp` 實作符合 Supabase SSR 模式。
- `health_records` 的 consent path 已加入 AAL2 與 current clinician eligibility。
- `accept_consent` 已拒絕匿名、使用 atomic conditional update，並 revoke `PUBLIC/anon` execute。
- migration 03 目前版本的 profiles admin policy 已改用 SECURITY DEFINER helper，消除直接 self-reference。
- `pro_schema.sql` 不再重建「任何 Pro 讀全部 health_records」policy；legacy consent function 也不再換回 SELECT-then-UPDATE。

但仍有兩個 release blockers：MFA/AAL2 只保護單一 `health_records` consent path，其他臨床 PHI tables 與部分 service-role APIs 仍可由 aal1 session 使用；兩個 app 共用同一 Supabase Auth project，新的 `.SiteURL` signup template 卻固定導向 ExClinCalc，會破壞 ClinCalc 的註冊落點。Consent deletion/lifecycle/duplicate grants、schema replay 與 R1 test 也尚未達到可關閉標準。

## RR1–RR7 disposition

| Finding | Re-review | 結論 |
|---|---|---|
| RR1 Auth confirmation flow | **PARTIAL / CODE-LEVEL ACCEPTED** | ExClinCalc confirm route 正確；Dashboard 全未驗證，且 shared Auth template 會把 ClinCalc signup 導向 ExClinCalc。 |
| RR2 consented PHI AAL2 | **PASS FOR THIS POLICY / FAIL AS GLOBAL MFA BOUNDARY** | `health_records` policy 正確加 AAL2；其他醫療資料表及 APIs 仍可 aal1 直連。 |
| RR3 canonical schema overwrite | **PARTIAL** | 原先兩個危險定義已修；但 base schema replay 仍會重建 profiles recursion，整體安裝路徑不是單一、可安全重播的 source of truth。 |
| RR4 consent ownership invariant | **DEFERRED / OPEN** | 本 range 沒有修；仍是 service-role SELECT 再 INSERT，沒有 doctor/chart DB invariant。 |
| RR5 consent ACL/lifecycle | **PARTIAL** | anonymous consumption 已修；demotion、re-promotion、deletion、duplicate grant 與 pending token lifecycle 未修。 |
| RR6 R1 test + deprovision | **PARTIAL** | 原本 catch 自己 FAIL 的 bug 已消失；測試仍可能因 fixture 不存在或無關 error 假綠，多個 DB policies 也仍忽略 `is_pro=false`。 |
| RR7 profiles recursion | **PASS IN MIGRATION 03 / NOT REPLAY-SAFE** | migration 03 helper 正確；重跑 README 仍列為完整 schema 的 `complete_setup.sql` 會換回 self-referencing policy。 |

## Blocking findings

### SEC001C-RR8 — P0 — MFA 只補一條 policy，其他臨床 PHI 與 privileged API 仍可用 aal1

**Evidence**

- `supabase/migrations/20260719_03_phi_aal2_consent_hardening.sql:37-48` 只在 consented `health_records` SELECT policy 要求 JWT `aal2`。
- `supabase/complete_setup.sql:266-267,314-315,357-358,386-387` 與 `supabase/pro_schema.sql:49-50,76-77,101-102,122-123` 對 `doctor_patients`、`clinical_records`、`soap_notes`、`drug_interaction_checks` 只檢查 `auth.uid() = doctor_id`，既不檢查 `is_pro`，也不檢查 AAL2。
- `supabase/clinic_flow.sql:27-30,69-72` 讓任何 `is_pro=true` session 管理全部 appointments 與 triage vitals，沒有 AAL2 或精確角色限制。
- `src/middleware.ts:56-62` 只在使用者已具有可升級到 aal2 的 factor 時 challenge；尚未 enroll MFA 的 pro user，其 `nextLevel` 可維持 aal1 而通過一般 `/pro` routes。
- middleware 不保護 `/api/pro/*`。例如 `src/app/api/pro/admin/route.ts:14-20` 只檢查 is_pro/role，接著以 service role 修改資料；`src/app/api/pro/analytics/route.ts:6-16` 也沒有 AAL2，並以 service role 查詢跨病患資料。

因此，取得醫師密碼的攻擊者即使沒有第二因素，仍可直接拿 aal1 access token query doctor patients、SOAP、clinical records、appointments 與 vitals。被設為 `is_pro=false` 但 session 尚有效的 doctor，也仍可由 ownership policies 讀寫自己的病患資料。這與「醫事端強制 MFA／停權立即失效」的安全主張不一致。

**Required change**

- 先列出 PHI/privileged table 與 API inventory，不只修 `health_records`。
- 醫療專用 tables 加 restrictive AAL2 gate，再由既有 ownership/role policies 決定細部權限；所有 policies 同時檢查 current entitlement。
- 所有使用 service role 的 privileged routes 使用同一 server-side `requireAal2`/role policy，不能依賴 middleware。
- 未 enroll MFA 的 pro user 應只能進 enrollment/recovery 流程，不能直接使用一般 Pro 功能。
- 用 doctor/nurse/pharmacist/admin × active/demoted × aal1/aal2 的真實 JWT/Data API matrix 驗證。

Supabase 官方也建議以 database/API authorization（必要時 restrictive policy）強制 MFA，而非只在 UI/middleware 控制：[Supabase MFA guide](https://supabase.com/docs/guides/auth/auth-mfa)。

### SEC001C-RR9 — P1 — 共用 Auth project 的單一 signup template 會把 ClinCalc 使用者導向 ExClinCalc

**Evidence**

- 兩個 app 的 `.env.local` 指向同一 project：`wdebvwpnefzbtphvrlil.supabase.co`，因此 Confirm Signup template 與 Site URL 是共享設定。
- evidence 要求把 project-level template 固定為 `{{ .SiteURL }}/auth/confirm?...`，Site URL 又指定 ExClinCalc：`docs/audit/handoffs/SEC-001b-auth-operations-evidence.md:12-18,26-31`。
- ExClinCalc registration 仍傳 `emailRedirectTo=/auth/callback`（`src/app/api/auth/register/route.ts:60`），但 `.SiteURL` template 不使用這個 `.RedirectTo`。
- ClinCalc registration 也傳自己的 `/auth/callback`（另一 repo `src/app/auth/register/page.tsx:28-34`），且 ClinCalc 沒有 `/auth/confirm` route。

套用 handoff 指示後，ClinCalc 使用者點驗證信會在 ExClinCalc 建立 session，並看到「等待醫師權限」落點，而非回到民眾端。這不一定洩漏 PHI，但會破壞雙產品的帳號邊界與核心註冊 UX；目前不能以一次 ExClinCalc live test 代表兩個 app 都正確。

**Required change**

- 保留 `/auth/callback` 給 password-recovery PKCE；signup token-hash 使用獨立 `/auth/confirm`。
- 兩個 app 都提供相容的 confirm endpoint，signup 傳入各自 allowlisted redirect；shared template 使用 `{{ .RedirectTo }}` 而非固定 `.SiteURL`，或設計一個明確的共用 broker。
- 分別跑 ClinCalc signup、ExClinCalc signup、ExClinCalc pending approval、password recovery 四條 E2E。
- canonical README 必須記錄 Auth template/allowlist；目前只有 audit evidence，且所有 checkbox 均未完成。

Supabase 官方明確說明：呼叫端使用 `redirectTo` 時，email template 應考慮以 `{{ .RedirectTo }}` 取代 `{{ .SiteURL }}`：[Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)、[Email template variables](https://supabase.com/docs/guides/auth/auth-email-templates)。

### SEC001C-RR10 — P1 — 新 active constraint 與既有 `ON DELETE SET NULL` 衝突，migration 也缺 preflight

**Evidence**

- `supabase/create_patient_consents.sql:18` 定義 `patient_user_id ... ON DELETE SET NULL`。
- migration 03 `:84-86` 新增 `status <> 'active' OR patient_user_id IS NOT NULL`。
- migration 沒先檢查或修復既有 `active + NULL patient_user_id` rows；先前匿名消耗漏洞正可能產生這種資料。

結果：若既有壞 row 存在，新增 CHECK 會失敗；即使 migration 成功，之後刪除仍有 active consent 的 Auth user 時，FK 想 SET NULL，CHECK 又會拒絕，導致刪除流程失敗。

**Required change**

- migration 先做可見的 preflight/assertion，提供 remediation 與 rollback plan。
- 明確選擇 patient deletion 語意：先 revoke 再清空、cascade consent，或刻意 RESTRICT 並由應用程式處理；不要同時宣稱 SET NULL 與 active-not-null。
- 用有/無 active consent 的 patient deletion integration tests 驗證。

PostgreSQL 的 referential action 結果仍必須符合其他 constraints：[PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)。

### SEC001C-RR11 — P1 — Consent lifecycle、duplicate revoke bypass 與 ownership invariant 仍未封閉

**Evidence**

- migration 03 的 `accept_consent` 只驗證 patient 已登入；註解所稱「eligibility 隱含於 authenticated」不成立，因為需驗證的是邀請 doctor 當下資格。
- `get_consent_by_token` 仍只以 pending/expiry 判 valid；demoted doctor 的 pending token 仍可被接受。
- `doctor_view_own_consents` 只看 doctor UID；停權後仍可讀 token、patient UUID 與 consent metadata。
- schema 沒有 active grant uniqueness；同一 doctor/patient 可有兩筆 active rows。`revoke_consent(id)` 只撤一筆，但 PHI policy 以任何 active row 的 `EXISTS` 判定，因此另一筆會讓「撤銷」看似成功、實際仍可讀。
- invite route 仍是 service-role ownership SELECT 後再 INSERT；FK 不保證 consent doctor 與 chart doctor 相同，existing ad-hoc column 也可能完全沒有 FK。
- `doctor_patient_id ON DELETE SET NULL` 會把 chart-specific active consent 靜默變成 generic consent，PHI grant 不隨 chart 刪除而終止。

**Required change**

- 在 DB 內原子驗證 ownership + insert，並建立 named/composite invariant。
- 定義 pending/active/revoked/expired 在 doctor demotion/re-promotion、doctor deletion、patient deletion、chart deletion 下的完整狀態轉移。
- 定義唯一 active grant 語意，清理 duplicates，確保一次 revoke 真正移除該 authorization path。
- 加 two-session accept、duplicate/revoke、demotion/reactivation、chart deletion tests。

### SEC001C-RR12 — P1 — Canonical schema 只修了內容，仍不是可安全重播的單一來源

**Evidence**

- 原始兩個高風險 overwrite vectors 已修：`pro_schema.sql` 不再建立 global PHI policy；`create_patient_consents.sql` 的 accept function 已 atomic/ACL hardened。這部分接受。
- 但 `supabase/complete_setup.sql:51-63` 仍會建立 self-referencing `Admins read all profiles`。README `:130,172-188,264` 同時把它稱為完整 RLS/bootstrap，又把 migrations 稱為 source of truth。重跑 base file 會覆寫 migration 03 的 recursion fix。
- `create_patient_consents.sql:36-43` 對兩個 policies 使用 unconditional `CREATE POLICY`，第二次執行會在到達後面的安全 definitions 前中止。
- `scripts/run-schema.mjs` 只執行 `pro_schema.sql`，沒有執行 authoritative migration chain。
- 沒有 disposable DB clean-install、replay 與 `pg_policies/pg_proc/constraints` catalog assertions。

**Required change**

- 提供一個正式、可執行的 bootstrap/migration command；其他 SQL 明確標 legacy/generated，或同步成不會回歸的 idempotent definitions。
- `complete_setup.sql` 必須不能重建 recursive/stale admin policies；consent policies 先 DROP IF EXISTS。
- clean install 後重跑所有允許的 setup paths，assert final schema 完全相同。
- schema rollout 應在單一 transaction 或可證明不會留下 migration 02 暫時回歸狀態的流程中完成。

### SEC001C-RR13 — P1/P2 — R1 test 仍可能假綠，停權 policies 也尚未修

**Evidence**

- 新 test 不再 catch 自己拋出的 FAIL，這項修正通過。
- 但 hard-coded UID row 若不存在：protected-column UPDATE 仍會因 column privilege 丟 error，positive `name` UPDATE 則可 0-row 無 error；before/after 都是 NULL，最後仍輸出 ALL PASS。
- `WHEN OTHERS` 把任何無關的 schema、permission、trigger 或 recursion error 都當成「安全阻擋」，沒有檢查預期 SQLSTATE。
- positive control 不 assert affected row = 1，也不 reload name；只 reload `pro_role`，沒有 reload `is_pro`。
- 沒有 service-role/admin positive control 證明合法特權變更仍可運作。
- test 將真實樣式 email 與固定 UUID 寫入 public repo，降低可攜性，也是不必要的個資暴露。
- `complete_setup.sql:438-446,474-483` 與 `pro_schema.sql:201-209` 的 resource/audit admin policies 仍只看 role，不看目前 `is_pro`；RR6 的主要停權問題仍存在。

**Required change**

- 建立測試 fixture，或明確 assert UID row 存在；每個 positive/negative operation 都檢查 row count 與 reload state。
- 只接受預期的 SQLSTATE/trigger error；其他錯誤標為 SETUP ERROR。
- 覆蓋 `pro_role` 與 `is_pro`，並加 privileged positive path。
- 移除 repo 中的實際 email/固定 production UID，改用參數或 disposable fixture。
- 所有 privileged policies 統一使用 current entitlement helper；停權後以舊 token 做 negative test。

## Lower-severity observations

- `verified=1` 可自行加在 URL 上，只會偽造成功提示，不會授權，屬 P2 UX。
- Direct GET token-hash endpoint 可能被企業／醫院郵件 link scanner 預先存取並消耗 token。Supabase 官方建議對 prefetch 情境使用 OTP 或先到中介頁再由使用者按確認：[Email prefetching](https://supabase.com/docs/guides/auth/auth-email-templates)。
- `/auth/confirm` 沒有新增單元或整合測試；目前只能由 build 證明可編譯，不能證明 cookie/session/email flow。
- `SECURITY DEFINER SET search_path=public` 已達前次最低要求；長期可依 Supabase 建議改為空 search path 並完整 schema qualification。

## Verification performed

| Check | Result |
|---|---|
| `git diff --check 188d4b4 742da2d` | **PASS** |
| `npm test` | **PASS — 1 file / 29 tests**；仍只有 pure authz tests |
| `tsc --noEmit` | **PASS**（與 build 分開執行） |
| `npm run build` | **PASS** — compiled in 26.3s，包含 `/auth/confirm` |
| Targeted ESLint（3 個 changed TS files） | **PASS** |
| Full `npm run lint` | **FAIL — 17 errors / 26 warnings**；本 range 移除 1 個 warning，主要 errors 為既有頁面問題 |
| Disposable DB clean-install/replay/RLS/concurrency | **NOT AVAILABLE / NOT RUN** |
| migration 03 apply-to-live + Auth Dashboard/E2E evidence | **NOT PROVIDED** |

`742da2d..HEAD` 只有 SEC-001c handoff 文件，因此上述 build/test 對應相同產品程式碼。

## Minimum exit gates

1. 把 AAL2/current-entitlement 擴到所有 PHI tables 與 service-role privileged APIs，並強制未 enroll pro user 先完成 MFA。
2. 解決 shared Supabase Auth template：兩 app 都有正確 confirm flow，並完成 signup + recovery E2E。
3. 修正 consent patient/chart deletion、duplicate/revoke、doctor lifecycle 與 atomic ownership invariant。
4. 建立唯一、replay-safe schema path 及 disposable DB catalog/RLS/concurrency tests。
5. 修正 R1 fixture/row-count/SQLSTATE/positive-control，並讓所有 privileged policies 尊重 `is_pro=false`。
6. migration 03 經 preflight 後套 live；附 aal1 deny/aal2 allow、Dashboard config 與 email template 的實際證據。

在以上 gates 通過前：**RR1/RR2/RR3/RR5/RR6/RR7 只能標 partial/code-level；RR4 仍 open；SEC-001 維持 open。**
