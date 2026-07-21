# `src/lib/pro/` — 醫事端核心邏輯

Pro 端的授權、臨床流程與領域邏輯。**授權以純函式實作、可單元測試**。

| 檔案 | 用途 |
|---|---|
| `authz.ts` | 授權純函式：`checkPrivilegedCaller` / `authorizeAdminAction` / `canAssignRole` / `checkProAal2`。角色階層與 admin 動作規則的唯一真相 |
| `authz.test.ts` | 上者的 Vitest 單元測試 |
| `serverAuth.ts` | 伺服器守衛：`loadCaller` / `requirePrivileged` / `requireProAal2`（API routes 共用） |
| `clinicalFlow.ts` / `clinicalAnalysis.ts` | SOAP 流程與臨床分析 |
| `drugInteractions.ts` | 藥物交互作用規則 |
| `patientUtils.ts` | 病患資料工具 |
| `reportExport.ts` | 報告匯出 |
| `resourceUpdates.ts` | 臨床指引版本檢查 |
| `taiwanFamilyMedicine.ts` | 台灣家醫科臨床資料 |

設計：授權邏輯抽成純函式 → 好測試、好審查；DB 端另有 RLS 做同等強制（defense in depth）。
