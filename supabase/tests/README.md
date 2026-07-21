# `supabase/tests/` — RLS 整合測試

在一次性 Postgres（Docker / 本機 Supabase）上，模擬各角色 session 直接驗證 RLS policy 是否如預期放行 / 拒絕。**這是安全性的真正驗收**——純函式單測擋不住 policy 寫錯。

| 檔案 | 用途 |
|---|---|
| `apply_schema.mjs` | 依序套用 schema + migrations 到測試 DB |
| `rls_matrix.mjs` | 40+ 條整合測試：`npm run test:rls` |

涵蓋情境：doctor/nurse/pharmacist × aal1(拒)/aal2(允)、deprovision、防自我提權、consent PHI、同意書單次使用、並發、匿名拒絕、刪除生命週期、唯一授權、角色矩陣（藥師無法竄改診斷）、replay 安全。

模擬手法：`set local role authenticated` + `set_config('request.jwt.claims', ...)` 設定 uid / aal → 呼叫 policy → 斷言 → rollback。
