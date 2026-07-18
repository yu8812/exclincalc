# SEC-001b — GPT re-review

> Reviewer: GPT-5.6 SOL
> Review date: 2026-07-19
> Exact reviewed range: `baccac8b6f1c724ceb89b86b1bef477f2bbdd054..68e90c0271d13ffea20a28e1b1fcda99720358f7`
> Review target: SEC-001 follow-up fixes R1–R9
> Later commit `786e12b` is outside the reviewed diff; it was read only as handoff/evidence. Its two documentation files do not change the product tree at `68e90c0`.

## Verdict

**REQUEST_CHANGES — SEC-001 目前不能關閉，也不應把 `68e90c0` 當成可部署的完整安全修復。**

這個 range 有實質進步，不是無效 patch：R2/R3 的 server-side admin authorization 已形成單一純函式 policy，29 個 table-driven tests 通過；invite route 也新增了病歷 ownership 檢查，`accept_consent` 的單一 conditional update 能防止兩位已驗證使用者同時取得同一 token。

但仍有三個 release blockers：註冊端建立的是 implicit flow、callback 卻只接受 PKCE code；PHI 的 database policy 沒有要求 AAL2，能繞過 `/pro` middleware；repo 仍保留會重建過寬 PHI policy 與舊競態 RPC 的 active schema/install paths。其餘 database invariants、function ACL、實際 Dashboard 設定及 live migration 也尚無證據。

建議保留既有 commits，另加小而可審查的 follow-up commits；不要 rewrite history，也不要先部署現有 migration 再補 canonical schema。

## R1–R9 disposition

| Finding | Re-review | 結論 |
|---|---|---|
| R1 role authority | **PARTIAL / NOT DEPLOYABLY CLOSED** | migration 的 revoke + trigger 方向正確；但 README/fresh setup 不會套用、live 未套用，SQL test 會把失敗誤報為 PASS，且多個 admin RLS 只看舊角色、不看目前 `is_pro`。 |
| R2 privileged caller / hierarchy | **PASS IN APP CODE** | `is_pro`、角色、AAL2、self/higher-target policy 均集中且 fail closed；29 個 pure policy tests 通過。仍需 API/DB integration tests。 |
| R3 target lookup fail-open | **PASS IN APP CODE** | target 分成 ordinary/admin/super_admin/not_found/error；lookup error 不再當 ordinary user。 |
| R4 registration callback / redirect | **FAIL — RELEASE BLOCKER** | register client 預設 implicit flow，callback 卻只處理 PKCE `code`；email confirmation flow 不相容。 |
| R5 enumeration / verification | **PARTIAL / UNVERIFIED** | 多數結果統一為 `202 {ok:true}`；password-error 分支仍有差異，Confirm Email 與 redirect allowlist 沒有外部證據。 |
| R6 consent chart ownership | **PARTIAL** | route 有 ownership SELECT；但 SELECT + service-role INSERT 非原子，DB 沒有 doctor/chart 配對 invariant，既有欄位時 FK 也可能未建立。 |
| R7 PHI scope / lifecycle | **FAIL — RELEASE BLOCKER** | 新 policy 移除全域讀取的方向正確，但 canonical script 可重建漏洞，policy 無 AAL2，且撤權/刪除/token lifecycle 未完成。 |
| R8 token atomicity | **PARTIAL** | conditional `UPDATE ... RETURNING` 可處理競態；但舊 install SQL 會覆寫，function ACL 與 anonymous guard 不安全。 |
| R9 password policy | **DEFERRED / UNVERIFIED** | register route 有 8 字元檢查；recovery/profile 仍仰賴未提供證據的 Supabase Auth 設定。 |

## Blocking findings

### SEC001B-RR1 — P0 — 註冊與 callback 使用不同 Auth flow

**Evidence**

- `src/app/api/auth/register/route.ts:2,23,60` 用 plain `@supabase/supabase-js` server client 呼叫 `signUp()`，未設定 PKCE 或持久化 code verifier。
- 此 lockfile 安裝版本的 Auth client 預設 `flowType: "implicit"`。
- `src/app/auth/callback/route.ts:17-21` 只接受 query `code`，然後呼叫 `exchangeCodeForSession(code)`；這是 PKCE exchange。

Implicit confirmation 將 session 資訊放在 URL fragment；fragment 不會送到 server callback。PKCE 則必須同時有 authorization code 與原先產生、持久化的 code verifier。現況因此不能證明驗證信可完成 session 建立，且很可能固定落入 `missing_code`。

**Required change**

- 選定一種完整協定並端到端實作：
  - 用 cookie-backed `@supabase/ssr` client 在註冊時建立 PKCE verifier，callback 再交換 code；或
  - 使用 email template 的 `token_hash`，在 confirmation endpoint 以 `verifyOtp()` 驗證。
- 不可只在目前 ephemeral server client 加 `flowType: "pkce"`；callback 必須能取得同一 verifier。
- 加入「新 email → 點驗證連結 → session/登入頁狀態」整合測試，以及過期、重放、缺 code/token 測試。

參考：[Supabase PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow)、[Supabase password-based Auth flows](https://supabase.com/docs/guides/auth/passwords)。

### SEC001B-RR2 — P0 — AAL1 session 可直接由 Supabase REST 讀取已授權 PHI

**Evidence**

- `supabase/migrations/20260719_02_consent_integrity.sql:23-35` 的 `consented_doctor_read_records` 檢查 active consent、`is_pro` 與角色，但沒有檢查 JWT `aal`。
- `/pro` middleware 與 admin route 的 AAL2 guard 只保護那些 HTTP paths；它們不能阻止使用 public anon key + 使用者 access token 直接呼叫 Supabase Data API。

因此，取得醫事人員密碼但尚未通過 MFA 的 `aal1` session，仍可直接 query consented `health_records`。這使「敏感操作強制 MFA」在真正的 PHI authorization boundary 上失效。

**Required change**

- 在 PHI RLS（或經嚴格鎖定的 helper）要求 `(auth.jwt()->>'aal') = 'aal2'`。
- 用真實 database session 驗證：同一 doctor/consent 下 aal1 deny、aal2 allow；撤銷 MFA/session 後 deny。
- 不以 middleware 或 UI 測試取代 database test。Supabase 也明確建議在 database/API authorization layer 強制 MFA，而非只在 UI 隱藏功能：[Supabase MFA guide](https://supabase.com/docs/guides/auth/auth-mfa)。

### SEC001B-RR3 — P0 — Repo 的 active schema paths 會把 R7/R8 修復覆寫回漏洞版本

**Evidence**

- migration 在 `supabase/migrations/20260719_02_consent_integrity.sql:15-35` 移除全域 PHI policy。
- `supabase/pro_schema.sql:154-162` 仍建立「任何 `is_pro=true` 可讀全部 health_records」的 permissive policy。
- `scripts/run-schema.mjs:31` 仍實際讀取並執行 `pro_schema.sql`。
- migration 在 `:40-61` 改成 atomic conditional update；`supabase/create_patient_consents.sql:76-103` 仍定義舊的 SELECT-then-UPDATE function。
- `README.md:172-176` 指示 fresh setup 執行 legacy SQL，完全沒有套用本 range 的兩個 migrations。

也就是：依 README 建新環境不會得到 R1/R6/R7/R8；在已修環境再跑既有 schema helper，會重新打開全域 PHI 讀取；再跑 consent SQL 則可能把 atomic function 換回競態版本。

**Required change**

- 決定唯一 schema source of truth。所有 bootstrap、README、helper script 與 migration history 必須產生同一 final schema。
- 更新或移除 legacy definitions，不能只補 forward migration。
- 建立 disposable database 的 clean-install/replay test：從零套用正式路徑，assert policy/function/constraint 定義；再重跑允許的 bootstrap，assert 不會回歸。
- rollout 時先部署經驗證的 DB policy/function，再部署依賴它的 app；rollback 不可恢復全域 PHI policy。

### SEC001B-RR4 — P1 — Consent ownership 仍不是 database invariant，migration 也不保證真的補到 FK

**Evidence**

- `src/app/api/pro/consent/invite/route.ts:44-61` 先用 service role SELECT `doctor_patients`，再做另一個 INSERT；兩步之間資料可變更。
- migration 的 FK 只證明 chart 存在，不證明 `patient_consents.doctor_id = doctor_patients.doctor_id`。
- `ADD COLUMN IF NOT EXISTS doctor_patient_id ... REFERENCES ...` 在 production 已經手工存在同名欄位時會整段略過，因此不會補 FK。handoff 本身正指出 production 可能已有 ad-hoc column。

**Required change**

- 用 authenticated RPC/conditional INSERT，或可表達 doctor/chart pairing 的 composite FK/constraint，使 ownership check 與 insert 成為單一 DB operation。
- column 與 named constraint 分開做 idempotent migration；若 constraint 不存在就建立，並先檢查 orphan/mismatched rows。
- 加入 owned success、cross-doctor deny、missing chart deny，以及 concurrent delete/reassignment 測試。

### SEC001B-RR5 — P1 — `accept_consent` 可被 anonymous caller 消耗 token，撤權 lifecycle 也未封閉

**Evidence**

- `supabase/migrations/20260719_02_consent_integrity.sql:40-61` 的 SECURITY DEFINER function 沒有 `auth.uid() IS NOT NULL` guard，也沒有在 migration 內 revoke/grant function execute privileges。
- PostgreSQL function 預設可由 `PUBLIC` execute；只 `GRANT ... TO authenticated` 不等於從 PUBLIC/anon revoke。
- anonymous caller 若取得 token，可把狀態更新成 active 且 `patient_user_id = NULL`，造成 token 被永久消耗。
- `accept_consent` 沒有檢查 doctor 當下是否仍為合格醫事人員；demoted doctor 的 pending token 仍可被接受，重新升權後舊 active consents 又自動恢復。
- `ON DELETE SET NULL` 會把 patient-bound invite 轉成 generic invite；目前沒有明確的 suspension、revocation、chart deletion 語意。

**Required change**

- function 內明確拒絕 unauthenticated caller；`REVOKE EXECUTE ... FROM PUBLIC, anon`，只 grant 給必要角色，並鎖定 `search_path`。
- 加 DB constraint，禁止 active consent 沒有 patient user；另定義並測試 duplicate active grants。
- 在 acceptance/RLS/RPC 一致驗證 doctor eligibility，定義 demotion、re-promotion、doctor deletion、chart deletion、consent revocation 對 pending/active tokens 的狀態轉移。
- 用 anon/authenticated 兩種真實角色、兩個 concurrent sessions 做 integration tests。

參考：[Supabase function privileges](https://supabase.com/docs/guides/database/functions)、[Supabase：revoke function execution](https://supabase.com/docs/guides/troubleshooting/how-can-i-revoke-execution-of-a-postgresql-function-2GYb0A)。

### SEC001B-RR6 — P1 — R1 test 會 false PASS，停權後也可能保留直接 DB admin 權限

**Evidence**

`supabase/tests/rls_privilege_columns_test.sql:20-24,31-35` 在 UPDATE 後主動 `raise exception 'FAIL...'`，但 exception handler 同時 catch `raise_exception`。所以即使 privilege escalation UPDATE 成功，測試也會捕捉自己拋出的 FAIL，然後輸出 PASS。

另外，RLS/permission denial 可能表現為 0 rows updated，不一定丟 `insufficient_privilege`；目前 test 也沒有檢查 affected rows 或重新查詢持久狀態。

`supabase/complete_setup.sql:55-63,438-446,474-483` 的 profiles、resources、audit-log admin policies 只檢查 `pro_role in ('admin','super_admin')`，沒有要求目前 `is_pro=true`。因此若停權只把 `is_pro` 改成 false 而保留角色，舊 session 仍可能繞過 app route，直接以 Supabase Data API 保有這些 database privileges。

**Required change**

- 把「預期 DB error」與「assertion failure」分開，不可 catch 自己的 FAIL signal。
- 以 authenticated JWT claims/role 實際執行，assert affected rows 與 reload 後的 `is_pro/pro_role` 都未改變。
- 加 service-role/admin positive control，證明測試不是因 setup 錯誤而永遠拒絕所有更新。
- 所有 privileged RLS/RPC 同時檢查 current `is_pro` 與角色；定義停權是否也應撤銷 sessions，並以停權前/後的同一使用者 token 做 negative test。
- 將 migration 納入 documented deployment 與 disposable DB CI；目前「有 migration file」不能作為 R1 已修復的證據。

### SEC001B-RR7 — P1 — 新 PHI policy 依賴可能遞迴的 profiles RLS

**Evidence**

- 新 health_records policy 會 join `public.profiles` 判斷目前角色。
- `supabase/complete_setup.sql:55-63` 在 `profiles` 自己的 policy 中再次 query `profiles`，這是典型 self-referencing RLS recursion pattern。

如果 production policy 與 checked-in SQL 一致，admin/profile lookup 或 PHI policy evaluation 可能得到 `infinite recursion detected in policy for relation profiles`，而不是預期的 allow/deny。這也顯示目前 pure TypeScript tests 無法證明 end-to-end authorization。

**Required change**

- 移除 self-referencing policy；若用 SECURITY DEFINER eligibility helper，必須固定 `search_path`、限制 execute privileges，並保持 fail closed。
- 用真正套過完整 schema 的 DB 跑 ordinary/doctor/admin/super_admin × is_pro × aal1/aal2 matrix。

參考：[Supabase 對 RLS self-reference / infinite recursion 的說明](https://supabase.com/docs/guides/troubleshooting/storage-error-database-schema-is-incompatible-when-uploading-files-988baa)。

## Non-blocking but required before closure

- `src/app/auth/callback/route.ts` 會導向 `verified=1`、`missing_code`、`verification_failed`，但 `src/app/auth/login/page.tsx:12` 只處理 `error=unauthorized`。使用者看不到驗證成功或失敗的正確狀態。
- `canonicalOrigin()` 不再信任 request Origin，這點通過；但它接受任何 HTTPS host、設定錯誤時靜默 fallback，且拒絕 handoff 所列的 localhost HTTP callback。應 fail fast，並讓 production/preview/local policy 與實際 allowlist 一致。
- 統一 `202 {ok:true}` 是正確方向；仍需用 new/existing/unconfirmed email 驗證 password-error branch 不造成可觀察差異。
- Dashboard checklist 仍未提供 Confirm Email、Site URL、exact Redirect URLs、8-char Auth policy、MFA policy 的實際證據。R5/R9 不能靠 code review 關閉。
- admin UI 仍顯示 server 最終會拒絕的 self/forbidden actions，部分 mutation 也沒有清楚呈現 API error。server authorization 已擋住安全漏洞，但 UX 應與 policy matrix 同步。
- `admin`/`super_admin` 是否可作為 treating doctor 建 consent 並讀 PHI，仍是未決產品模型；若管理員是非臨床角色，應只允許 `doctor`，或增加 `created_by` + target clinician delegation/audit。

## Verification performed

| Check | Result |
|---|---|
| `git diff --check baccac8 68e90c0` | **PASS** |
| `npm test` | **PASS — 1 file / 29 tests**；只有 pure `authz` tests |
| `npm test -- src/lib/pro/authz.test.ts` | **PASS — 29/29** |
| `tsc --noEmit` | **PASS** |
| `npm run build` | **PASS**；在 product-equivalent HEAD 執行，`68e90c0..HEAD` 只有 docs |
| `npm run lint` | **FAIL — 17 errors / 27 warnings**；多數為既有問題，新 test 另有 unused `TargetClass` warning |
| DB migration/RLS/RPC integration tests | **NOT PRESENT / NOT RUN** |
| Live migration + Dashboard evidence | **NOT PROVIDED** |

29 個 pure tests 對 R2/R3 很有價值，但不能驗證 R1/R6/R7/R8 的 PostgreSQL grants、RLS、JWT AAL、function privileges、concurrency 或 migration replay。這些 finding 必須以 disposable Supabase/Postgres integration suite 才能關閉。

## Minimum exit gates for the next re-review

1. 修正並端到端測試 registration confirmation flow（PKCE 或 token-hash 二選一）。
2. PHI RLS 強制 AAL2，移除所有可重建 global PHI access 的 canonical/legacy definitions。
3. 建立單一、可從零重播的 schema path；README/helper/migrations 產生一致結果。
4. 讓 consent ownership、function ACL、active-row constraints 與 demotion/deletion lifecycle 成為 DB invariants，並加入 concurrency tests。
5. 修正 R1 false-positive SQL test，跑完整 role × target × AAL × consent DB matrix。
6. 提供 staging apply/rollback 紀錄，以及 Confirm Email、exact redirects、password minimum、MFA 的外部設定證據。

在以上 gates 通過前：**R2/R3 可標記 code-level resolved；SEC-001 整體維持 open，R1/R4/R5/R6/R7/R8/R9 不得標記 closed。**
