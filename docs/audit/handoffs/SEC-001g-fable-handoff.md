# SEC-001g — Fable Handoff（SEC001D-03 restrictive gate + RR10/RR11，皆用測試 DB 驗證）

> Writer: Fable · Reviewer: GPT-5.6 SOL（度假中，當事人代裁決）· 日期: 2026-07-19
> 全部改動皆以本機 disposable Supabase 實測（`npm run test:rls`，**30/30 PASS**）。
> **新 ending SHA：`f0cf1b2`**

## 單元與 SHA

| Finding | 主題 | SHA |
|---|---|---|
| SEC001D-03 | RESTRICTIVE AAL2 gate（6 純醫事表） | `76ef395` |
| SEC001C-RR10 | 病患刪除 lifecycle（trigger 先 revoke） | `f0cf1b2` |
| SEC001C-RR11 | 唯一 active grant（partial unique index） | `f0cf1b2` |

## 逐條 disposition

### SEC001D-03 — AAL2 藏 permissive 可被繞過 → **FIXED（測試證明抗繞過）**
- migration 05：doctor_patients / clinical_records / soap_notes / drug_interaction_checks /
  appointments / triage_vitals 各加一條 `AS RESTRICTIVE ... TO authenticated`
  `using/with check (is_active_pro_aal2())`。restrictive 與 permissive 以 AND 合成。
- health_records / profiles（病患本人也用）**刻意不套**。
- **測試證明**：加一條無 aal2 的 rogue permissive policy 後，doctor aal1 **仍被擋**（restrictive gate 有效）；
  移除後正常。這是「AAL2 不可被 permissive 繞過」的實證。
- **未做（產品決策）**：appointments/triage 的角色範圍仍是「任一 pro + aal2」。要不要收斂成
  特定角色（如藥師不碰掛號）需你定調（同 analytics 那題）。目前 harness 已記錄現況矩陣。

### SEC001C-RR10 — active-consent constraint 與 patient 刪除衝突 → **FIXED（測試 DB 先重現再修）**
- 測試 DB **重現**：刪有 active consent 的病患 → constraint violation（與 GPT 預測一致）。
- migration 06：`before delete on auth.users` trigger 先把該病患 consent 設 revoked，
  之後 FK SET NULL 不再撞 constraint，且**保留 consent 記錄（revoked）供 audit**。
- 測試：刪病患成功 + consent 轉 revoked。

### SEC001C-RR11 — 重複 active grant 使 revoke 失效 → **PARTIAL FIXED**
- migration 06：partial unique index 禁止同 doctor/patient 有兩筆 active consent。
- 測試：第二筆 active 被擋。
- **未做**：demotion→re-promotion 完整狀態機（deprovision 已測 is_pro=false 即拒 PHI）、
  chart 刪除時 doctor_patient_id ON DELETE SET NULL 把 chart-specific consent 變 generic 的語意。

## 測試 DB 驗證（30/30 PASS，本機 Supabase PG17）
涵蓋：RR8 全表 aal2 gating、停權即時失效、跨隔離、R1 自我提權、RR2 consent PHI、
R8 single-use（含真並發雙連線）、RR5 anon 拒絕、SEC001D-03 抗繞過、RR10 刪除 lifecycle、RR11 唯一 active。
clean install（10 檔）+ replay 皆過。

## 命令與結果
| 命令 | 結果 |
|---|---|
| `npm run test:rls`（本機 Supabase） | **30 passed, 0 failed** |
| clean install（含 migration 05/06） | 全過 |
| `npx tsc --noEmit` / `npx vitest run` | 0 / 35（app 未動） |

## 剩餘（多需產品決策或部署）
- SEC001D-03 角色 CRUD 範圍（appointments/triage 收斂）→ 產品決策。
- RR11 demotion/re-promotion/chart-deletion 完整狀態機。
- SEC001D-06 confirm E2E、Dashboard 設定 → 部署時。

## Ownership released: YES
GPT 回來可直接用 `npm run test:rls` 複現全部證據。ending SHA `f0cf1b2`。
