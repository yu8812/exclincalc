# SEC-001e — Fable Handoff（回應 SEC-001d re-review：SEC001D-01～06）

> Writer: Fable · Reviewer: GPT-5.6 SOL · 日期: 2026-07-19
> 前提：保留既有 commits，不 amend/rebase。**migration 04 與 Dashboard 皆未套用**（依指示）。
> **Review range：ExClinCalc `git diff d02856d 946adc9`；ClinCalc `git diff e657aee 3d09b46`**
> 新 ending SHA：ExClinCalc `946adc9`、ClinCalc `3d09b46`

## 單元與 SHA

| Finding | 主題 | SHA |
|---|---|---|
| SEC001D-01 | canonical rollback 修復 | `62b4b81` |
| SEC001D-02 | consent/敏感 API 補 AAL2 + inventory | `13d0566` |
| SEC001D-04/05/06 | middleware cookie/fail-closed + redirect sanitizer + confirm single-type | `946adc9` |
| SEC001D-05/06 (ClinCalc) | callback require-code/safe-next + login sanitize + confirm | `3d09b46` |

## 逐條 disposition

### SEC001D-01 — 正式 runner 撤銷 migration 04 + clean install 失敗 — **FIXED (code) / DEFERRED (replay test)**
- complete_setup：helper 移到「Admins read all profiles」policy 之前 → clean install 不再因 function 未建而失敗。
- `scripts/run-schema.mjs`：**停用**（exit 1 + 指向正確路徑），不再自動執行 pro_schema.sql。
- `pro_schema.sql`：加 DEPRECATED banner；4 個 owner policy 同步為 `... and public.is_active_pro_aal2()`，manual 重跑也不降權。
- README：migration chain 補 04（含 MFA 前置警告）+ 標明 pro_schema/run-schema DEPRECATED。
- **DEFERRED**：disposable-DB clean-install/replay + `pg_policies/pg_proc` catalog assertions（需 Postgres，本機無）。

### SEC001D-02 — AAL1 可用 consent token API + inventory 不完整 — **FIXED**
- consent invite POST/GET、gemini-clinical、drug-interactions、resources GET/PATCH 全接上
  `requireProAal2()`（PATCH 用 `requirePrivileged()`）。
- admin/users 移除重複 loadCaller/requirePrivileged，改用共用 `src/lib/pro/serverAuth.ts`。
- 新增 `docs/audit/api-authz-inventory.md`（完整 /api/pro 授權表）。

### SEC001D-03 — RESTRICTIVE policy + 角色/資料範圍 — **PARTIAL / DEFERRED（含產品決策）**
- 已補：所有 PHI table 有 AAL2（permissive）+ 目前 is_pro/角色檢查（migration 04 + canonical）。
- **未做（DEFERRED）**：改成 `AS RESTRICTIVE` per-table AAL2 gate（Supabase 官方建議的合成方式）、
  完整 doctor/nurse/pharmacist/admin_staff/admin CRUD matrix、appointments/triage 不再默認全 pro `FOR ALL`。
- **產品決策**：analytics 現用 `requireProAal2`（任一 pro）但 UI 只在 admin 顯示 → 要限 admin(`requirePrivileged`)
  還是開放全 pro？需當事人定調（見 inventory 文件）。此決策前先加 AAL2 擋 aal1。

### SEC001D-04 — middleware/session lifecycle 未 fail closed — **PARTIAL FIXED**
- FIXED：所有 redirect 保留 Supabase set-cookie（`redirectWith`）；AAL 查詢 error/null → fail closed 導回登入。
- **DEFERRED**：`/pro/security` 移除最後一個 verified factor 應阻擋或成功後即 `refreshSession()`/sign-out
  （目前依賴 middleware 於下次請求偵測 aal1 導回綁定；JWT aal 降級有 refresh lag，屬窄窗）。

### SEC001D-05 — auth redirects open redirect / recovery — **FIXED (code) / DEFERRED (Dashboard)**
- 新增 `safeInternalPath()`（兩 app），套用於 ClinCalc callback、Ex/Clin login、Ex mfa-verify。
- ClinCalc callback：require code + 檢查 exchange error + safe next + fail closed（原本接受 raw next、忽略 error）。
- **DEFERRED**：recovery callback URL 加入 Dashboard allowlist（部署時做）；ClinCalc login 顯示 confirm 錯誤（UX 小項）。

### SEC001D-06 — confirm type brute-force — **FIXED**
- 兩 app confirm route 改**單次 verify**、type 只允許 `email`/`signup`（不接受 recovery/invite/email_change hash）。
- **DEFERRED**：部署後 E2E 證明 hosted 版實際吃哪個 type；localhost origin 文件策略（canonicalOrigin 拒 http）。

## 執行過的命令與結果

| 命令 | 結果 |
|---|---|
| Ex `git diff --check d02856d 946adc9` | 只在 **GPT 自己的 review markdown** 報 trailing-whitespace；**product code 乾淨** |
| Clin `git diff --check e657aee 3d09b46` | **CLEAN** |
| Ex `npx tsc --noEmit` | **exit 0** |
| Ex `npx vitest run` | **exit 0 — 35 tests** |
| Ex `npm run build` | **exit 0 — Compiled 45s** |
| Clin `npx tsc --noEmit` | **exit 0** |
| Clin `next build --webpack` | **exit 0 — Compiled 38.2s** |
| Disposable-DB RLS/AAL/replay/concurrency | **未執行（本機無 psql/CLI/pg）** |

## 誠實限制
- 仍**無 disposable Postgres**：SEC001D-03 的 restrictive-policy 轉換與 role-CRUD matrix、
  以及 RR10/RR11/RR13 的 lifecycle/constraint/併發，都需要 Supabase-faithful 測試環境才能驗證關閉。
- migration 04 / Dashboard **依指示未套用**。

## Ownership released: YES
請 GPT re-review 上述兩個 range。
