# SEC-001f — Fable Handoff（disposable Supabase RLS 整合測試上線）

> Writer: Fable · Reviewer: GPT-5.6 SOL · 日期: 2026-07-19
> 里程碑：**先前唯一的卡點（無 disposable Postgres）已解決** —— 當事人在本機用
> Supabase CLI + Docker 起了忠實測試環境，Fable 據此建立 RLS 整合測試並全數通過。

## 新增測試資產（commit `86235e9`）

- `supabase/tests/apply_schema.mjs`：對測試 DB 套用正式 schema 路徑（clean install）+ replay。
- `supabase/tests/rls_matrix.mjs`：role × is_pro × aal × table/RPC 矩陣（模擬各角色 JWT claims）。
- `npm run test:rls`（需本機 Supabase：`supabase start`）。

## 驗證結果（對本機 Supabase Postgres 17.6，忠實 auth.uid()/auth.jwt()/roles）

### clean install + replay
- 9 個 schema 檔（complete_setup + clinic_flow + consent + migrations 01–04 + rate_limits）**clean install 全過** → 證明 SEC001D-01 順序修正成立。
- **replay 抓到真 bug**：`create_patient_consents.sql` 兩個 policy 缺 `DROP IF EXISTS`，重跑撞 "already exists"（正是 GPT SEC001D-12 所述）→ **已修**，現 replay-safe。

### RLS 矩陣（23/23 PASS）
| 領域 | 驗證 |
|---|---|
| RR8 全表 aal2 gating | doctor/nurse/pharmacist 在 aal2 允許、aal1 拒絕（doctor_patients / clinical_records / appointments / drug_interaction_checks） |
| 停權即時失效 | is_pro=false 的（前）doctor 在 aal2 仍被拒（RR6/RR13 的 deprovision 疑慮） |
| 跨隔離 | 別的 doctor 讀不到非自己的病患；無 consent 讀不到 PHI |
| R1 自我提權 | 一般用戶不可自改 pro_role/is_pro；可改安全欄位 name |
| RR2 consent PHI | doctor aal2 + active consent 可讀病患 health_records；aal1 拒絕 |
| R8 single-use | accept_consent 首次成功、同 token 第二次失敗 |
| RR5 anon 拒絕 | anon 不可執行 accept_consent（已 revoke public/anon） |

## 對 GPT findings 的影響

先前只能標「code 寫好但無 DB 可證」的項目，現有**真實 DB 證據**：
- **RR8 / SEC001D-02**：aal2 gating + deprovision 已用真實 JWT/role 驗證。
- **RR12 / SEC001D-01**：clean install 過、replay bug 已抓並修。
- **R1 / RR2 / R8 / RR5**：均有矩陣測試佐證。

## 尚未涵蓋（可在此 harness 上續建）
- **SEC001D-03**：改成 `AS RESTRICTIVE` per-table gate + 完整角色 CRUD matrix（目前是 permissive AND aal2；
  restrictive 版待寫，此 harness 可直接驗）。
- **真並發**：目前測 single-use（sequential invariant）；兩條同時 accept 的 race 需雙連線交錯（atomic UPDATE 已保證，待補顯式並發測試）。
- **RR11**：consent lifecycle 完整狀態機（demotion/deletion/duplicate active grant）。
- **RR10**：active-consent constraint 的 patient deletion preflight。

## 驗證命令
| 命令 | 結果 |
|---|---|
| `node supabase/tests/rls_matrix.mjs`（本機 Supabase） | **23 passed, 0 failed** |
| clean install（9 檔） | 全過 |
| replay（base 3 檔） | 過（修 create_patient_consents 後） |
| `npx tsc --noEmit` / `npx vitest run` | 0 / 35 passed（app 未動） |

## Ownership released: YES
建議 GPT 以此 harness 為基礎續審 SEC001D-03/RR10/RR11 的後續實作。
新 ending SHA（含 test 資產）：`86235e9`。
