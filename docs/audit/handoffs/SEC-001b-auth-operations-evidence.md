# SEC-001b Unit 4 — Auth Operations Evidence（需在 Supabase Dashboard 驗證）

> 這些是程式碼無法自我證明、必須以 Dashboard/Auth 設定佐證的前置條件。
> Owner：當事人（需登入 Supabase Dashboard）。Release gate：下列全部打勾並貼上證據前，
> A2 與 A5 不得標記為 verified。**不可用 Next build 代替這些設定驗證。**

## 待驗證清單

- [ ] **Confirm Email = ON**（Authentication → Providers → Email）
      證據：截圖 or 設定值。關閉時新帳號會被隱含確認 → A2 失效。

- [ ] **Site URL**（Authentication → URL Configuration）
      因兩 app 共用且模板改用 {{ .RedirectTo }}，Site URL 只當 fallback。
      建議設民眾端（公開主站）：`https://clincalc.ro883c.workers.dev`
      （實際落點由各 app signup 帶的 emailRedirectTo 決定，不靠 Site URL）

- [ ] **Redirect URLs = 兩個 app 的精確 /auth/confirm**（不可用 `**` wildcard；共用 Auth 專案）
      值（各一條）：
      - `https://exclincalc.ro883c.workers.dev/auth/confirm`
      - `https://clincalc.ro883c.workers.dev/auth/confirm`
      （本機測試可另加 `http://localhost:3001/auth/confirm`、`http://localhost:3000/auth/confirm`）
      對應 R4/RR9：兩 app 各自 signup 帶回自己的 /auth/confirm，模板用 {{ .RedirectTo }}。

- [ ] **Password 最小長度 = 8（或更強）**（Authentication → Policies / Password）
      對應 R9。**並用 direct API test 證明**（繞過 UI）：
      - 7 字元 `signUp`/`updateUser` → 應被 Auth server 拒絕
      - 8 字元 → 成功
      證據：兩次 API 呼叫的 request/response（可用 curl 或 REST）。

- [ ] **Confirm signup email template 用 {{ .RedirectTo }}（R4/RR9 前提）**
      位置：Authentication → Emails → Templates → Confirm sign up
      **整段換成** `supabase/email-templates/confirm-signup.html` 的內容（已設計好版面）。
      關鍵連結：`{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email`
      原因：兩 app 共用同一 Auth 專案；用 .RedirectTo（非寫死 .SiteURL）才能讓
      ClinCalc 註冊回民眾端、ExClinCalc 註冊回醫事端。
      驗證（兩條都要）：
      - ClinCalc 新 email 註冊 → 點信 → 落到 ClinCalc `/dashboard`
      - ExClinCalc 新 email 註冊 → 點信 → 落到 ExClinCalc `/auth/login?verified=1`（待管理員開通）
      註：若顯示驗證失敗，把模板與註冊的 `type=email` 改成 `type=signup`。

- [ ] **MFA / TOTP enrollment 設定**符合預期（所有 pro 角色強制）
      對應 R2：AAL2 現由後端 API 強制檢查（見 authz.checkPrivilegedCaller），
      但 Dashboard 的 MFA 開關仍需確認為啟用。

## R9 direct password test 範例（擇一）

```bash
# 需替換 <PROJECT>, <ANON_KEY>
# 7 字元 — 預期失敗
curl -s -X POST "https://<PROJECT>.supabase.co/auth/v1/signup" \
  -H "apikey: <ANON_KEY>" -H "Content-Type: application/json" \
  -d '{"email":"pwtest7@example.com","password":"Ab1!567"}'
# 8 字元 — 預期成功
curl -s -X POST "https://<PROJECT>.supabase.co/auth/v1/signup" \
  -H "apikey: <ANON_KEY>" -H "Content-Type: application/json" \
  -d '{"email":"pwtest8@example.com","password":"Ab1!5678"}'
```

## 完成後

把每項的證據（截圖/回應）貼回本檔或附連結，並在 SEC-001b handoff 的 R5/R9 列
把狀態從 DEFERRED 改為 FIXED（附證據）。
