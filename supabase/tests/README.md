# `supabase/tests/` — RLS 整合測試

在一次性的本機 Supabase 上，模擬各角色的 session 直接對資料庫驗證 RLS policy 有沒有照預期放行或拒絕。純函式的單元測試擋不住 policy 寫錯，這裡才是安全性真正的驗收。

| 檔案 | 用途 |
|---|---|
| `apply_schema.mjs` | 依序套用 base schema + 全部 migrations 到測試 DB（清單 = `SCHEMA_FILES`） |
| `rls_matrix.mjs` | 109 條整合測試：`npm run test:rls` |

⚠️ `rls_matrix.mjs` 一開始會 **drop 整個 `public` schema** 再重建，預設連 `127.0.0.1:54322`（`supabase start` 的本機 DB）。不要把正式庫的連線字串傳給它。

涵蓋情境：
- 醫師／護理師／藥師 × aal1（拒）／aal2（允）、停權即時失效、防自我提權、consent 與 PHI、同意書單次使用與並發、匿名拒絕、刪除生命週期、唯一授權、角色矩陣（藥師不能改診斷）
- 病歷稽核：UPDATE／DELETE 會留下前後內容；有沒有 request header 都能寫入；稽核寫不進去時原本的修改也會失敗；只有通過 MFA 的真管理員讀得到；誰都不能直接寫、改、刪
- 調配：dispensed_by 被蓋成操作者本人、時間用資料庫的、調配後不能改
- 資源庫、藥物資料庫、audit_logs 的寫入權；展示帳號沙盒；`check_rate_limit` 不能被前端呼叫
- 展示資料重置：只動展示帳號的資料、跑兩次結果一樣、前端不能呼叫、排程有建立
- 藥師工作台：`pharmacy_queue()` 只回姓名、性別、生日；沒過 MFA、不是藥師、匿名都拿不到；藥師仍讀不到整張病人表
- replay：重跑 base 檔後，上面這些安全狀態不會被還原

模擬手法：`set local role authenticated` + `set_config('request.jwt.claims', ...)` 設定 uid / aal → 執行查詢 → 斷言 → rollback。需要檢查 trigger 寫進去的內容時，在同一個交易裡 `reset role` 回 postgres 看，最後一樣 rollback。

GitHub Actions（`.github/workflows/ci.yml`）每次 push 都會起一個乾淨的本機 Supabase 跑這 109 條。
