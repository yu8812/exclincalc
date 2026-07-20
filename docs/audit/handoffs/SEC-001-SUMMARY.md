# SEC-001 — 總結 handoff（整條稽核鏈最終狀態）

> Writer: Fable · Reviewer: GPT-5.6 SOL · 日期: 2026-07-20
> 分支：`fix/security-audit-2026-07`（exclincalc + clincalc）· Base: `141ecb7`
> 目前 ending SHA：exclincalc `c98aa87`、clincalc `3d09b46`
> **驗證骨幹：`npm run test:rls` = 40/40 PASS**（本機 disposable Supabase，真實 auth.uid()/aal/roles）

---

## 0. 這是什麼

畢業專題（ClinCalc 民眾端 + ExClinCalc 醫事端，共用 Supabase）在推甄前的一次**系統性安全稽核與修復**。
從「肉眼審查發現 P0」一路做到「用可拋棄式 Postgres 跑 RLS 矩陣證明修復」。
共 34 個 commit，經 GPT-5.6 SOL 五輪獨立 review（SEC-001 / b / c / d + 後續）。

---

## 1. 發現與修復（按主題，附最終狀態）

### 應用層授權（A1/R2/R3 → SEC001D-02）
- Admin API 原本 reset_password/reset_mfa/DELETE 不檢查目標角色 → 一般 admin 可接管 super_admin。
- **最終**：抽 `authz.ts` 純函式（35 vitest tests）+ `serverAuth.ts` 共用守衛；所有敏感 /api/pro/*
  （admin、analytics、consent、gemini-clinical、drug-interactions、resources）都要求
  **is_pro + AAL2 + 角色**；fail-closed target lookup；analytics 限 admin（當事人裁決）。

### 帳號自我提權（R1）— **DB 根因**
- 一般用戶原可 `update profiles set pro_role='super_admin'` 自我提權（RLS 只檢查 auth.uid()=id）。
- **最終**：欄位級 REVOKE + trigger，特權欄位只能由 service_role 改。**測試證明**一般用戶無法自改、可改 name。

### 強制 MFA / PHI 邊界（RR8/RR2 → SEC001D-03/04）
- 原本只有一條 policy 檢查 aal2，其他病歷表 aal1 即可讀 PHI。
- **最終**：6 張病歷表 permissive（角色+aal2）+ **`AS RESTRICTIVE` aal2 gate**（不可被 permissive 繞過，測試證明）；
  middleware 強制未綁 MFA 者先 enroll、redirect 保留 cookie、AAL error fail-closed、禁移除最後一個 factor。
  **停權即時失效**（is_pro=false 即拒 PHI，測試證明）。

### Consent / PHI 授權（R6/R7/R8/RR5/RR10/RR11）
- consent invite ownership 驗證、accept_consent atomic single-use + 拒匿名 + revoke public/anon、
  PHI 讀取需 active consent + 醫師 eligibility + aal2、病患刪除自動 revoke（保留 audit）、唯一 active grant。
  **測試證明**：aal2/aal1、single-use、真並發、anon 拒絕、刪除 lifecycle、重複 grant 全覆蓋。

### 角色能力矩陣（SEC001D-03）+ 修既有 bug
- **修好藥師洞**：藥師原本讀不到 clinical_records（調配工作台實際壞的）→ 現可讀 + 只能改調配欄（trigger 擋改醫囑）。
- 收斂：掛號排除藥師、分診護理寫醫師讀。**測試證明**。

### 註冊 / Auth flow（A2/R4/R5/RR1/RR9/SEC001D-05/06）
- 註冊改 signUp（寄驗證信 + 防枚舉、統一 202）；email 確認改 token_hash + verifyOtp（跨裝置安全，
  兩 app 各自 /auth/confirm、shared template 用 `.RedirectTo` 不破壞 ClinCalc）；
  open-redirect/`javascript:` XSS sanitizer（callback/login/mfa-verify）；confirm 只接受 signup type。

### Schema 一致性 / replay-safe（RR3/RR12）
- 停用會撤銷安全的 legacy runner（run-schema.mjs）+ pro_schema DEPRECATED；complete_setup helper 順序修正
  （clean install 不再失敗）；canonical 與 migrations 同步。**測試證明**：clean install + 重跑 base 檔後
  AAL2/角色/R1 皆未被還原。

### 其他
- 藥物交互 class-aware 重寫（舊版類別規則永不觸發，9/9 驗證）；五級判讀（8/8）；
  持久化 rate limit（in-memory Map 在 Workers 無效 → Supabase RPC）；/api/ping 不洩漏 err.message；
  keep-alive 加直接 REST 備援。

---

## 2. 驗證骨幹：可拋棄式 Supabase RLS 整合測試（40/40）

`supabase/tests/rls_matrix.mjs`（`npm run test:rls`）對本機 Supabase（忠實 auth schema/roles/JWT）驗證：
role × is_pro × aal × table/RPC 矩陣、restrictive gate 抗繞過、真並發、consent lifecycle、
clean-install + replay-safety。**這是把「code 寫好」升級成「真實 DB 證明」的關鍵**，也補上了 GPT 前幾輪
反覆指出的唯一缺口。另有 35 個 pure authz vitest。

---

## 3. 尚未完成（皆屬「部署階段」，非 code 缺陷）

| 項目 | 誰做 | 說明 |
|---|---|---|
| 套 migration 01–07 到 live DB | 當事人 | **前提：demo/關鍵 pro 帳號先 enroll + challenge MFA**，否則 aal1 會失去 PHI 存取 |
| Supabase Dashboard：Confirm email / Redirect URLs(兩 app /auth/confirm) / password_min / signup email template(RedirectTo) | 當事人 | 見 `SEC-001b-auth-operations-evidence.md` |
| 部署兩 app 到 Cloudflare Workers | 當事人 | 目前在 fix 分支；部署後 /auth/confirm 才存在，Dashboard 設定才可生效 |
| signup / recovery / MFA live E2E | 當事人 | 部署後跑 |

> **關鍵 rollout 順序**（GPT 認可）：驗證(已完成 40/40) → 部署 app → demo 綁 MFA → 套 migration → live smoke。

## 4. 明確不做（範圍紀律）
診所/醫院雙模式、FHIR 匯出（對接 clinconvert）= 部署後的獨立 feature，不在此稽核範圍。
角色能力矩陣已是可配置模型的地基。

## 5. 推甄敘事價值
「畢業後回頭稽核自己的 production 系統，發現 privilege-escalation 與 PHI over-exposure，
經 5 輪 AI 對抗式 review，用可拋棄式 Postgres 建 RLS 矩陣測試逐條證明修復」——
這是完整的「發現→對抗式審查→實證修復」成長敘事，比再做一個淺 demo 有價值。

## Ownership released: YES
GPT 回來可 `git diff 141ecb7 c98aa87` 全覽 + `npm run test:rls` 複現 40/40。
