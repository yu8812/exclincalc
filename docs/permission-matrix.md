# 權限矩陣（RLS Capability Matrix）

> **由線上 production 資料庫的實際 RLS policy 直接生成**（非憑印象），核對日期見文末。
> 面試被追問「哪個角色能對哪張表做什麼」時，直接遞這份。

## 核對到的事實

- **RLS policy 總數：37 條**（線上 `pg_policies` 實數）
- **受 RLS 保護的資料表：13 張**（全部 13 張都有 policy）
- **角色（pro_role）：6 種** — doctor / nurse / pharmacist / admin_staff / admin / super_admin

## 全域機制（先讀這個，矩陣才看得懂）

1. **MFA 閘門（RESTRICTIVE）**：6 張純醫事表（appointments、clinical_records、doctor_patients、drug_interaction_checks、soap_notes、triage_vitals）各有一條 `restrict_aal2_pro` **RESTRICTIVE** policy = `is_active_pro_aal2()`。RESTRICTIVE 與其他 policy 做 **AND**，所以**這 6 張表的任何操作都必須先通過 MFA（AAL2）**，無法被任何 permissive policy 繞過。
2. **自持有（ownership）**：`auth.uid() = doctor_id / user_id / created_by` — 只能碰自己的資料列。
3. **同意書（consent）**：醫師讀病患 `health_records` 需 `patient_consents` 有 active 授權。
4. **Demo 豁免**：`is_demo=true` 帳號在 AAL2 檢查處視為通過（僅合成資料）。

---

## 矩陣（✓=可, ✕=不可, 條件見註）

### A. 純醫事表（皆需 MFA/AAL2）

| 資料表 | doctor | nurse | pharmacist | admin_staff | admin | super_admin |
|---|---|---|---|---|---|---|
| **appointments** | ✓ ALL | ✓ ALL | ✕ | ✓ ALL | ✓ ALL | ✓ ALL |
| **soap_notes** | ✓ ALL（自己的）| ✕ | ✕ | ✕ | ✕ | ✕ |
| **clinical_records** | ✓ ALL（自己的）| ✓ 讀 | ✓ 讀 + 改（僅配藥）| ✓ 讀 | ✓ 讀 | ✓ 讀 |
| **doctor_patients** | ✓ ALL（自己的）| ✓ 讀 | ✕ | ✓ 讀 | ✓ 讀 | ✓ 讀 |
| **triage_vitals** | ✓ 讀 | ✓ ALL | ✕ | ✕ | ✓ ALL | ✓ ALL |
| **drug_interaction_checks** | ✓ ALL（自己的）| ✕ | ✓ ALL | ✕ | ✓ ALL | ✓ ALL |

> **角色分工重點**：護理師寫 triage、醫師只讀 triage；藥師對 clinical_records 只能「讀 + 改（配藥）」不能新增/刪除；appointments 排除藥師。

### B. 共用 / 民眾相關表

| 資料表 | 誰可讀 | 誰可寫 |
|---|---|---|
| **health_records** | 本人（`user_id`）；醫師需 **active 同意書 + MFA/demo** | 本人 |
| **patient_consents** | 該醫師（自己被授權的）、該病患（自己給的）| 由 `accept_consent()` SECURITY DEFINER 函式寫入 |
| **medications** | 任何人（`true`）| pro admin / super_admin |
| **medical_references** | 任何人 | pro admin / super_admin |
| **pro_resources** | pro 使用者讀 public 或自己的 | 建立者管自己的；admin 管全部 |
| **audit_logs** | admin / super_admin | 使用者只能寫自己的（`actor_id`）|
| **profiles** | 本人；admin 讀全部（`is_current_admin()`）| 本人改自己；`service_role` 全權 |

---

## 冗餘清理紀錄（migration 09，2026-08）

核對過程曾發現兩處冗餘，已於 **migration 09** 清理，**不影響任何實際存取權限**（僅去重）：

1. ~~profiles 有 3 條完全同義的 UPDATE policy~~ → 已保留 1 刪 2。
2. ~~medications / medical_references 各有 1 條 legacy（用 `role` 而非 `pro_role`）寫入 policy~~ → 已刪除（核對過 0 帳號依賴）。

**結果：policy 總數 41 → 37**（本文件已為清理後的 37）。所有對外引用一律用 **37**。

---

*生成方式：直接查詢線上 `pg_policies`（`schemaname='public'`）。核對日期：2026-08。若日後 migration 有變動，重新查一次即可。*
