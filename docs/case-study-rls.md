# 案例研究：為什麼把權限做在資料庫層，而不是應用層

> ExClinCalc Pro 的一個核心設計決策，以及它的取捨與驗證。

## 一句話

醫療資料的授權，我沒有寫在後端 API 裡，而是下沉到 PostgreSQL 的 **Row Level Security（RLS）**——**42 條 policy、15 張表、6 種角色**。理由只有一句：**後端程式一定會有漏洞，但資料庫在每一筆查詢前都會強制檢查權限。**

---

## 1. 問題

一個診所系統有六種角色（醫師、護理師、藥師、行政、管理員、超級管理員），每種角色能看/能改的資料都不同。最直覺的做法是在後端 API 裡寫權限判斷：

```ts
// 常見但脆弱的做法
if (user.role !== "doctor") return res.status(403);
const records = await db.query("select * from health_records where ...");
```

這種做法的問題是：**權限檢查與資料存取是「分開」的兩件事。** 只要有一條 API 忘了加檢查、或檢查寫錯、或有人繞過 API 直接打資料庫，資料就洩了。醫療場景下，一次跨病患的資料外洩不只是 bug，是法律與倫理事件。

## 2. 決策：把權限下沉到資料庫

我改用 PostgreSQL 的 Row Level Security：權限規則直接綁在**資料表**上，PostgreSQL 在執行**每一筆** SELECT / INSERT / UPDATE / DELETE 之前，都會先用當前使用者的身分（`auth.uid()`）與 MFA 等級（`auth.jwt() ->> 'aal'`）比對 policy，不符就當作那一列不存在。

```sql
-- 權限直接綁在資料上，不依賴應用層
create policy "consented_doctor_read_records"
  on public.health_records for select
  using (
    (auth.jwt() ->> 'aal') = 'aal2'          -- 必須通過 MFA
    and exists (                              -- 且病患已授權此醫師
      select 1 from public.patient_consents pc
      where pc.doctor_id = auth.uid()
        and pc.patient_user_id = health_records.user_id
        and pc.status = 'active'
    )
  );
```

**核心價值：安全性不再依賴「每條 API 都記得檢查」。** 瀏覽器本來就會直接打 Supabase 的 API，所以就算前端或某條 API 有漏洞，攻擊者拿到的仍只是他角色被允許的資料。例外是伺服器上的 service role key：它可以繞過 RLS，所以用到它的幾支管理 API 都要自己先檢查角色和 MFA。

## 3. 三個做深的地方

1. **PERMISSIVE + RESTRICTIVE 組合強制 MFA**
   PostgreSQL 一般 policy 是 OR 疊加（任一符合即放行）。我另外用 **restrictive** policy 把「必須通過 MFA（AAL2）」以 **AND** 套在 6 張純醫事表上——這樣不管 permissive policy 怎麼寫，**都繞不過 MFA**。

   ```sql
   create policy "restrict_aal2_pro" on public.<table>
     as restrictive for all to authenticated
     using (public.is_active_pro_aal2());
   ```

2. **欄位級授權防自我提權**
   `revoke update on profiles` 後只選擇性 re-grant 非特權欄位；`is_pro` / `pro_role` 使用者無法自己改，另有 trigger 二次防守。所以沒有人能把自己升級成 admin。

3. **SECURITY DEFINER helper 解遞迴**
   「admin 能讀所有 profiles」這條 policy 若直接查 profiles 判斷 admin，會造成 policy 自我參照的無限遞迴。我用 `security definer` 的 helper function（`is_current_admin()`）+ `set search_path` 打破遞迴，同時把 execute 權限鎖到 authenticated。

## 4. 取捨（誠實說代價）

RLS 不是免費的：

- **不好測試**——policy 寫錯不會編譯失敗、也不一定 runtime 報錯，可能只是「安靜地放行了不該放行的資料」。這是最危險的失敗模式。
- **心智負擔**——每加一張表都要想「六種角色各自的 policy 怎麼寫」，容易遺漏或不一致。
- **除錯較難**——「查不到資料」可能是沒資料、也可能是 policy 擋掉，要分辨。

## 5. 怎麼確定它是對的：可驗證的安全

為了對付「安靜地放行」這個失敗模式，我在一次性的 Postgres 上，**模擬各角色的 session** 跑 **RLS 整合測試**（目前 109 條，每次 push 都在 GitHub Actions 上重跑）：設定 `request.jwt.claims` 的 uid 與 aal → 呼叫查詢 → 斷言放行/拒絕是否符合預期 → rollback。

| 情境 | 預期 |
|---|---|
| 醫師無 MFA(aal1) 讀 PHI | 拒絕 |
| 醫師有 MFA(aal2) 讀已授權病患 | 放行 |
| 藥師試圖竄改診斷 | 被 trigger 擋 |
| 匿名存取 | 拒絕 |
| 使用者自我提權 is_pro | 被欄位授權擋 |

migration 每一支都可以重跑，測試也會檢查「重跑 base schema 之後，安全狀態有沒有被還原」。

## 6. 測試全過，還是有洞（2026 年 10 月）

2026 年 10 月我換了兩種方法重新檢查，原本 40 條測試全過的資料庫，還是找到三個問題：

1. **有一條 policy 根本不在 repo 裡。** 寫腳本把正式庫和「用 repo 檔案從零建起來的資料庫」逐項比對，發現正式庫多了一條 `service_role_all`（`TO public USING (true)`），等於任何人拿公開的 anon key 就能讀所有使用者的 profile。測試是對 repo 建出來的資料庫跑的，當然測不到。
2. **資源庫可以被任何登入者改寫。** 用匿名、一般註冊用戶、展示 admin、沒過 MFA 的醫師四種身分，對每張表實際試讀、改、刪，發現一條「讓使用者更新公開資源封面」的 policy 其實沒限制欄位，任何登入者都能把資源的連結換掉。原本的測試只測了「該擋的有沒有擋」，沒有人想到要測這條。
3. **展示帳號的 MFA 豁免和「全院可讀」的角色疊在一起。** 展示 admin 的密碼是公開的，它雖然只是為了讓審查者看虛構資料而免 MFA，卻因為 admin 角色可以讀全院資料，連帶讀得到所有人的 profile 和稽核紀錄。

修法是 migration 10–15，順便把那兩個檢查方法留下來：比對腳本用來抓正式庫和版控之間的漂移，逐表實測的結果寫成新的測試（40 → 95 條；之後加上展示資料重置和藥師工作台的測試，現在是 109 條）。修之前先確認新測試在舊版本上會失敗（22 條失敗），修完才全過。

## 7. 我從中看到的研究問題

我用 42 條 policy 把權限放在資料庫層，但整個過程**沒有系統化的方法**——每張表的 policy 都是手工推導、靠測試補網，而上一節說明了測試網本身也會漏。這讓我想問：

> **能不能從業務需求（角色 × 資料 × 操作）推導出 RLS policy 草稿，並驗證它的完整性、一致性，以及正式環境和版控之間有沒有漂移？**

這是我想在碩士階段深入的方向：把「多租戶醫療系統的權限」從一門手工藝，變成一套可驗證的方法。

---

*相關檔案：`supabase/migrations/`（15 個安全 migration）、`supabase/tests/rls_matrix.mjs`（RLS 整合測試）、`docs/permission-matrix.md`（權限矩陣，附錄由 `scripts/dump-policies.mjs` 從正式庫產生）、`docs/THREAT_MODEL.md`（威脅模型）。*
