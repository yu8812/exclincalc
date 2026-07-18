# SEC-001d — Fable Handoff（回應 SEC-001c re-review：RR8 全域 MFA + RR9 共用 Auth）

> Writer: Fable · Reviewer: GPT-5.6 SOL · 日期: 2026-07-19
> 前提：保留既有 commits，不 amend/rebase。
> **Review range：`git diff 742da2d d02856d`**（742da2d = 上次 GPT re-review 的 ending SHA；新 ending = `d02856d`）
> 涉及第二個 repo：ClinCalc（RR9 需跨 app）。

## 單元與 SHA

| Unit | 主題 | SHA | finding |
|---|---|---|---|
| RR9-a | ExClinCalc signup 用 RedirectTo + email 模板 | `117560e` | RR9 |
| RR9-b | ClinCalc /auth/confirm + register 帶自己的 confirm | `c3a52c5`(clincalc) | RR9 |
| RR9-c | /auth/confirm 自動試 signup/email type | `3f9024b` / `e657aee`(clincalc) | RR9 穩健化 |
| RR8-A | migration 04：全病歷表 AAL2 + is_pro RLS | `437cfdd` | RR8 (DB) |
| RR8-B | app 層 AAL2 守衛 + 強制 MFA enrollment | `3e3025c` | RR8 (app/middleware) |
| RR8-C | canonical schema 對齊（replay-safe） | `d02856d` | RR8 / RR12 |

## 逐條 disposition

### RR8 — MFA 只保護一條 policy → **FIXED (code) / DEFERRED (apply-to-live + MFA 前置)**
三層都補上：
- **DB（migration 04 + canonical）**：doctor_patients / clinical_records / soap_notes /
  drug_interaction_checks / appointments / triage_vitals 全部要求 `is_active_pro_aal2()`
  （aal2 + 目前 is_pro）；nurse/pharmacist read 用 `is_active_role_aal2()`。停權(is_pro=false)
  或未過 MFA(aal1) 即失去存取。
- **app（serverAuth）**：`requireProAal2` / `requirePrivileged` 共用守衛；analytics（+移除 anon fallback）、
  admin data CRUD 都改用；不再只靠 middleware（middleware 不保護 /api/pro/*）。
- **middleware**：未 enroll MFA 的 pro user（nextLevel=aal1）強制導向 /pro/security 綁定，不能直接用 Pro 功能。
- **測試**：`checkProAal2` 純函式 + 6 新測試（authz 共 35 passed）。
- **⚠️ 套用前提**：migration 04 套用後，pro 帳號（含 demo）**必須先綁 MFA**，否則 aal1 會失去所有病歷存取。
  故 04 的套用要與「demo 綁 MFA + 部署」一起，**不像 03 可即刻套**。
- **DEFERRED**：真實 DB 的 doctor/nurse/pharmacist/admin × active/demoted × aal1/aal2 matrix 測試（需 disposable Postgres，本機無）。

### RR9 — 共用 Auth 模板把 ClinCalc 導向 ExClinCalc → **FIXED (code) / DEFERRED (Dashboard + E2E)**
- 兩 app 各有 `/auth/confirm`（token_hash + verifyOtp）；register 帶各自的 emailRedirectTo。
- email 模板改用 `{{ .RedirectTo }}`（`supabase/email-templates/confirm-signup.html`），不寫死 SiteURL。
- confirm route 穩健化：自動試 signup / email token type。
- **DEFERRED（且與部署耦合）**：Dashboard（Confirm email / Redirect URLs 兩 app / Site URL / 模板）+
  ClinCalc signup / ExClinCalc signup / recovery 的 E2E。**注意：這些 Dashboard 設定要在 app 部署上線後才做**
  （/auth/confirm 未部署前，開 Confirm email 會擋住線上註冊——已實測踩到，見下）。

### RR12 — replay-safe schema → **PARTIAL FIXED**
- FIXED：complete_setup 定義 helper + 病歷/profiles policy 已同步為安全定義；clinic_flow 同步；
  重跑 base schema 不再重建過寬/遞迴 policy。
- **DEFERRED**：正式的 disposable-DB clean-install/replay + `pg_policies/pg_proc` catalog assertions（需 Postgres）。

### RR10（active constraint preflight）/ RR11（consent lifecycle/duplicate/ownership invariant）/ RR13（resource/audit admin policies 尚未查 is_pro；R1 test fixture/SQLSTATE 再強化）
→ **DEFERRED（下一單元 / 需 Postgres）**。RR13 的 pro_resources / audit_logs admin policy 仍只看 role，
  屬較低敏感度，列入下一輪；R1 test 進一步強化與 consent lifecycle 狀態機需 disposable Postgres。

## 執行過的命令與結果（exact HEAD `d02856d`）

| 命令 | 結果 |
|---|---|
| `git diff --check 742da2d d02856d` | **CLEAN** |
| `npx tsc --noEmit` | **exit 0** |
| `npx vitest run` | **exit 0 — 35 tests passed** |
| `npm run build`（ExClinCalc, Turbopack） | **exit 0 — Compiled 25.0s** |
| ClinCalc `next build --webpack` | **exit 0**（RR9 confirm 路由） |
| Disposable-DB RLS/AAL/concurrency integration | **未執行（本機無 psql/Supabase CLI/pg）** |

## Schema / API / Env

- **Schema：YES** — migration 04（需套 live，且前置 MFA）+ complete_setup/clinic_flow 對齊。
- **API：** analytics/admin data 需 AAL2；middleware 強制 MFA enrollment。
- **Env：** 無新增。

## 誠實限制（重要）

- 本機**無 disposable Postgres**，GPT 要求的「role×is_pro×aal matrix / 併發 / replay catalog」整合測試**無法執行**。
  純函式（authz）已 35 tests；DB 層靠 migration 邏輯審查 + 一致化 canonical + live R1 手測（先前 ALL PASS）。
  要完整關閉 SEC-001，需一個可拋棄式 Postgres/Supabase 分支測試環境。
- migration 04 與 RR9 Dashboard 設定**都與「部署 + demo 綁 MFA」耦合**，不宜在展示環境即刻套用。

## Ownership released: YES
請 GPT re-review `git diff 742da2d d02856d`（含 ClinCalc `c3a52c5`/`e657aee`）。
