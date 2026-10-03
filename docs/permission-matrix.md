# 權限矩陣（RLS）

> 最後核對：2026-10-03，對象是正式資料庫。
> 上半部的矩陣是把 policy 整理成「哪個角色能對哪張表做什麼」，主要的格子都有 `supabase/tests/rls_matrix.mjs` 的測試對應；
> 最後的附錄是用 `scripts/dump-policies.mjs` 直接從正式庫撈出來的完整 policy，不要手改，重跑腳本就會更新。

## 數字

- **資料表 15 張**，RLS 全部開啟
- **RLS policy 42 條**，其中 RESTRICTIVE 14 條（6 條 MFA 閘門 + 8 條展示帳號沙盒）
- **角色 6 種**：doctor（醫師）／nurse（護理師）／pharmacist（藥師）／admin_staff（行政）／admin（管理員）／super_admin（超級管理員）

## 先看這幾個共通規則

1. **MFA 閘門（RESTRICTIVE）**：6 張純醫事表（appointments、clinical_records、doctor_patients、drug_interaction_checks、soap_notes、triage_vitals）各有一條 `restrict_aal2_pro`，要求這次登入有過 MFA（aal2）而且是 pro 帳號。RESTRICTIVE 會和其他 policy 做 AND，所以其他 policy 寫得再寬，也繞不過它。
2. **展示帳號沙盒（RESTRICTIVE）**：8 張含病人資料的表（上面 6 張，加上 health_records、patient_consents）各有一條 `restrict_demo_sandbox`。展示帳號只碰得到「擁有者也是展示帳號」的資料列；不是展示帳號的人完全不受影響。
3. **展示帳號免 MFA**：`is_demo = true` 的帳號在 MFA 檢查處視為通過，搭配第 2 點只看得到虛構資料。
4. **擁有者**：`auth.uid() = doctor_id / user_id / created_by`，只能碰自己的資料列。
5. **同意書**：醫師讀病人的 `health_records`，要有一份 active 的 `patient_consents`。
6. **管理員**（`is_current_admin()`）：admin 或 super_admin、is_pro、**不是展示帳號**、而且這次登入有過 MFA。
7. **伺服器端（service role）不受 RLS 限制**：帳號管理、統計、藥物資料庫管理、病患授權邀請這幾支 API 會用到，它們在程式裡先檢查角色和 MFA。

---

## 矩陣（✓ 可以，✕ 不行）

### A. 純醫事表（都要先過 MFA）

| 資料表 | doctor | nurse | pharmacist | admin_staff | admin | super_admin |
|---|---|---|---|---|---|---|
| **appointments** | ✓ 全部 | ✓ 全部 | ✕ | ✓ 全部 | ✓ 全部 | ✓ 全部 |
| **soap_notes** | ✓ 全部（自己的）| ✕ | ✕ | ✕ | ✕ | ✕ |
| **clinical_records** | ✓ 全部（自己的）| ✓ 讀 | ✓ 讀＋只能改調配欄 | ✓ 讀 | ✓ 讀 | ✓ 讀 |
| **doctor_patients** | ✓ 全部（自己的）| ✓ 讀 | ✕ | ✓ 讀 | ✓ 讀 | ✓ 讀 |
| **triage_vitals** | ✓ 讀 | ✓ 全部 | ✕ | ✕ | ✓ 全部 | ✓ 全部 |
| **drug_interaction_checks** | ✓ 全部（自己的）| ✕ | ✓ 全部 | ✕ | ✓ 全部 | ✓ 全部 |

- 藥師對 clinical_records 只能改 `dispensed_at`／`dispensed_by`，改其他欄位會被 trigger 擋下（migration 07）；這兩個欄位的值也由資料庫決定（migration 15）。
- 藥師讀不到 doctor_patients（裡面有身分證、電話）；藥師工作台改用 `pharmacy_queue()` 取得當天處方，加上病人的姓名、性別、生日（migration 17）。
- clinical_records、soap_notes 每次新增、修改、刪除都會由 trigger 寫一筆 `clinical_audit_log`（migration 14）。

### B. 共用表

| 資料表 | 誰能讀 | 誰能寫 |
|---|---|---|
| **health_records** | 本人；醫師要有 active 同意書且過 MFA（展示帳號只看得到展示帳號的紀錄）| 本人 |
| **patient_consents** | 該醫師、該病人 | 經 `accept_consent()`、`revoke_consent()` 等函式；邀請由伺服器建立 |
| **medications** | 任何人 | 管理員（實際的管理頁經伺服器 API 寫入）|
| **medical_references** | 任何人 | 管理員（同上）|
| **pro_resources** | 公開的，或自己建的 | 過 MFA 的 pro 使用者只能管自己的**不公開**資源；公開資源只有管理員能動 |
| **profiles** | 本人；管理員讀全部 | 本人改自己允許的欄位（名字、設定等），角色和 is_pro 改不了 |
| **audit_logs** | 管理員 | 只有伺服器（帳號管理 API）|
| **clinical_audit_log** | 管理員 | 只有 trigger，誰都不能直接寫、改、刪 |
| **rate_limits** | 沒有 policy，只有伺服器 | 只有伺服器（`check_rate_limit()`）|

repo 裡另外有 `reference_pdf_links`（指引 PDF 版本追蹤），正式庫目前沒有建這張表。

---

## policy 數量的變化

| 時間 | 數量 | 原因 |
|---|---|---|
| 2026-08 | 41 → 37 | migration 09：刪掉重複的 profiles 更新 policy 和兩條沒在用的舊寫入 policy |
| 2026-10-03 | 37 → 36 | migration 10：刪掉不在 repo 裡、讓任何人都能讀 profiles 的 `service_role_all` |
| 2026-10-03 | 36 → 42 | migration 11–15：profiles 對齊（11）、資源庫與管理權重寫並加 8 條展示帳號沙盒（13）、新增 clinical_audit_log 的讀取 policy（14）|

---

## 正式庫和 repo 的已知差異

`npm run check:drift`（`scripts/schema-drift.mjs`）會把正式庫和「用 repo 檔案從零建起來的資料庫」逐項比對。2026-10-03 比對後只剩下面這些，都確認過可以接受：

- `reference_pdf_links`：只在 repo（正式庫沒建，見 README 的 check-versions workflow）
- `profiles` 的 `date_of_birth`、`gender`、`language`、`role` 欄位只在正式庫：民眾端 ClinCalc 用的欄位，定義不在這個 repo；`avatar_url` 只在 repo
- `profiles.pro_role` 的預設值：repo 是 `doctor`，正式庫沒有預設值（新帳號一律由管理員指派角色，不影響權限）
- `rls_auto_enable()`：Supabase 自己建的 event trigger，新表會自動開 RLS
- `rotate_health_records()`：兩邊只差在註解

---

## 附錄：正式庫 policy 全表

<!-- 以下由 scripts/dump-policies.mjs 產生，請勿手改 -->

產生時間：2026-10-03・資料表 15 張（RLS 全部開啟：是）・policy 42 條（其中 RESTRICTIVE 14 條）

### appointments（3 條）

| policy | 類型 | 指令 | 對象 | USING | WITH CHECK |
|---|---|---|---|---|---|
| restrict_aal2_pro | **restrictive** | ALL | authenticated | `is_active_pro_aal2()` | `is_active_pro_aal2()` |
| restrict_demo_sandbox | **restrictive** | ALL | authenticated | `within_demo_sandbox(doctor_id)` | `within_demo_sandbox(doctor_id)` |
| Pro users manage appointments | permissive | ALL | public | `is_active_role_aal2(ARRAY['doctor'::text, 'nurse'::text, 'admin_staff'::text, 'admin'::text, 'super_admin'::text])` | — |

### audit_logs（1 條）

| policy | 類型 | 指令 | 對象 | USING | WITH CHECK |
|---|---|---|---|---|---|
| Admins read audit logs | permissive | SELECT | authenticated | `is_current_admin()` | — |

### clinical_audit_log（1 條）

| policy | 類型 | 指令 | 對象 | USING | WITH CHECK |
|---|---|---|---|---|---|
| Admins read clinical audit log | permissive | SELECT | authenticated | `is_current_admin()` | — |

### clinical_records（6 條）

| policy | 類型 | 指令 | 對象 | USING | WITH CHECK |
|---|---|---|---|---|---|
| restrict_aal2_pro | **restrictive** | ALL | authenticated | `is_active_pro_aal2()` | `is_active_pro_aal2()` |
| restrict_demo_sandbox | **restrictive** | ALL | authenticated | `within_demo_sandbox(doctor_id)` | `within_demo_sandbox(doctor_id)` |
| Doctors manage own clinical records | permissive | ALL | public | `((auth.uid() = doctor_id) AND is_active_pro_aal2())` | — |
| Nurses read all clinical records | permissive | SELECT | public | `is_active_role_aal2(ARRAY['nurse'::text, 'admin'::text, 'super_admin'::text, 'admin_staff'::text])` | — |
| Pharmacists dispense clinical records | permissive | UPDATE | public | `is_active_role_aal2(ARRAY['pharmacist'::text])` | `is_active_role_aal2(ARRAY['pharmacist'::text])` |
| Pharmacists read clinical records | permissive | SELECT | public | `is_active_role_aal2(ARRAY['pharmacist'::text])` | — |

### doctor_patients（4 條）

| policy | 類型 | 指令 | 對象 | USING | WITH CHECK |
|---|---|---|---|---|---|
| restrict_aal2_pro | **restrictive** | ALL | authenticated | `is_active_pro_aal2()` | `is_active_pro_aal2()` |
| restrict_demo_sandbox | **restrictive** | ALL | authenticated | `within_demo_sandbox(doctor_id)` | `within_demo_sandbox(doctor_id)` |
| Doctors manage own patients | permissive | ALL | public | `((auth.uid() = doctor_id) AND is_active_pro_aal2())` | — |
| Nurses and admins read all patients | permissive | SELECT | public | `is_active_role_aal2(ARRAY['nurse'::text, 'admin'::text, 'super_admin'::text, 'admin_staff'::text])` | — |

### drug_interaction_checks（4 條）

| policy | 類型 | 指令 | 對象 | USING | WITH CHECK |
|---|---|---|---|---|---|
| restrict_aal2_pro | **restrictive** | ALL | authenticated | `is_active_pro_aal2()` | `is_active_pro_aal2()` |
| restrict_demo_sandbox | **restrictive** | ALL | authenticated | `within_demo_sandbox(doctor_id)` | `within_demo_sandbox(doctor_id)` |
| Doctors manage own interaction logs | permissive | ALL | public | `((auth.uid() = doctor_id) AND is_active_pro_aal2())` | — |
| Pharmacists manage interaction logs | permissive | ALL | public | `is_active_role_aal2(ARRAY['pharmacist'::text, 'admin'::text, 'super_admin'::text])` | — |

### health_records（3 條）

| policy | 類型 | 指令 | 對象 | USING | WITH CHECK |
|---|---|---|---|---|---|
| restrict_demo_sandbox | **restrictive** | ALL | authenticated | `within_demo_sandbox(user_id)` | `within_demo_sandbox(user_id)` |
| Users can manage own records | permissive | ALL | public | `(auth.uid() = user_id)` | — |
| consented_doctor_read_records | permissive | SELECT | public | `((((auth.jwt() ->> 'aal'::text) = 'aal2'::text) OR is_demo_user()) AND (EXISTS ( SELECT 1 FROM patient_consents pc WHERE ((pc.doctor_id = auth.uid()) AND (pc.patient_user_id = health_records.user_id) AND (pc.status = 'active'::text) AND is_eligible_clinician(pc.doctor_id)))))` | — |

### medical_references（2 條）

| policy | 類型 | 指令 | 對象 | USING | WITH CHECK |
|---|---|---|---|---|---|
| Anyone can read references | permissive | SELECT | public | `true` | — |
| Pro admins write medical_references | permissive | ALL | authenticated | `is_current_admin()` | `is_current_admin()` |

### medications（2 條）

| policy | 類型 | 指令 | 對象 | USING | WITH CHECK |
|---|---|---|---|---|---|
| Anyone can read medications | permissive | SELECT | public | `true` | — |
| Pro admins write medications | permissive | ALL | authenticated | `is_current_admin()` | `is_current_admin()` |

### patient_consents（3 條）

| policy | 類型 | 指令 | 對象 | USING | WITH CHECK |
|---|---|---|---|---|---|
| restrict_demo_sandbox | **restrictive** | ALL | authenticated | `within_demo_sandbox(doctor_id)` | `within_demo_sandbox(doctor_id)` |
| doctor_view_own_consents | permissive | SELECT | public | `(doctor_id = auth.uid())` | — |
| patient_view_own_consents | permissive | SELECT | public | `(patient_user_id = auth.uid())` | — |

### pro_resources（3 條）

| policy | 類型 | 指令 | 對象 | USING | WITH CHECK |
|---|---|---|---|---|---|
| Admins manage all resources | permissive | ALL | authenticated | `is_current_admin()` | `is_current_admin()` |
| Pro users manage own private resources | permissive | ALL | authenticated | `((created_by = auth.uid()) AND is_active_pro_aal2())` | `((created_by = auth.uid()) AND (is_public = false) AND is_active_pro_aal2())` |
| Pro users read public resources | permissive | SELECT | public | `((is_public = true) OR (auth.uid() = created_by))` | — |

### profiles（3 條）

| policy | 類型 | 指令 | 對象 | USING | WITH CHECK |
|---|---|---|---|---|---|
| Admins read all profiles | permissive | SELECT | public | `is_current_admin()` | — |
| read_own_profile | permissive | SELECT | authenticated | `(auth.uid() = id)` | — |
| update_own_profile | permissive | UPDATE | authenticated | `(auth.uid() = id)` | `(auth.uid() = id)` |

### rate_limits（0 條）

沒有任何 policy：除了 service role，誰都碰不到。

### soap_notes（3 條）

| policy | 類型 | 指令 | 對象 | USING | WITH CHECK |
|---|---|---|---|---|---|
| restrict_aal2_pro | **restrictive** | ALL | authenticated | `is_active_pro_aal2()` | `is_active_pro_aal2()` |
| restrict_demo_sandbox | **restrictive** | ALL | authenticated | `within_demo_sandbox(doctor_id)` | `within_demo_sandbox(doctor_id)` |
| Doctors manage own notes | permissive | ALL | public | `((auth.uid() = doctor_id) AND is_active_pro_aal2())` | — |

### triage_vitals（4 條）

| policy | 類型 | 指令 | 對象 | USING | WITH CHECK |
|---|---|---|---|---|---|
| restrict_aal2_pro | **restrictive** | ALL | authenticated | `is_active_pro_aal2()` | `is_active_pro_aal2()` |
| restrict_demo_sandbox | **restrictive** | ALL | authenticated | `within_demo_sandbox(patient_owner(patient_id))` | `within_demo_sandbox(patient_owner(patient_id))` |
| Doctors read triage_vitals | permissive | SELECT | public | `is_active_role_aal2(ARRAY['doctor'::text])` | — |
| Nurses manage triage_vitals | permissive | ALL | public | `is_active_role_aal2(ARRAY['nurse'::text, 'admin'::text, 'super_admin'::text])` | — |

<!-- 產生結束 -->
