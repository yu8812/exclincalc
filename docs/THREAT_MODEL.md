# ExClinCalc 威脅模型（STRIDE）

> 初版 2026-05-15・最後更新 2026-10-03
> 範圍：ExClinCalc 醫事端，以及和 ClinCalc 民眾端共用的 Supabase 資料庫。公開展示站：exclincalc.yuyulsc881209.workers.dev
> 方法：[Microsoft STRIDE](https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats)

這份文件整理這個系統會遇到哪些威脅、現在實際擋得住哪些、還缺什麼。「現有防禦」欄只寫已經做出來、對得到程式碼或測試的東西；還沒做的直接寫「未實作」。數字以 2026-10-03 對正式資料庫的實查為準。

---

## 〇、系統概況

- **6 個角色**：醫師、護理師、藥師、行政、管理員、超級管理員（`profiles.pro_role`）
- **15 張資料表、42 條 RLS policy**（明細見 [`permission-matrix.md`](permission-matrix.md)）
- **兩步驟驗證（TOTP）**：醫事端帳號一律要綁，沒綁的會被導去綁定；資料庫對病人資料要求這次登入有過 MFA（`aal2`）。四個公開展示帳號例外，但只碰得到展示資料（見 E6）
- **稽核**：管理員對帳號的操作記在 `audit_logs`；病歷（`clinical_records`）和 SOAP 筆記（`soap_notes`）的每次新增、修改、刪除，由資料庫 trigger 記在 `clinical_audit_log`
- **流程**：掛號 → 分診 → 看診（SOAP）→ 開處方 → 藥師調配；開藥時有 12 組常見的藥物交互作用規則即時提醒
- **測試**：RLS 整合測試 95 條（`supabase/tests/rls_matrix.mjs`），模擬不同角色和 MFA 狀態直接對資料庫驗證；單元測試 50 條（vitest）

---

## 一、系統範圍與信任邊界

```
┌──────────────────────────────────────────────────────────────┐
│ 邊界 1：使用者的瀏覽器（醫師／護理師／藥師／行政／管理員）        │
└───────────────┬──────────────────────────────────────────────┘
                │ HTTPS
                ▼
┌──────────────────────────────────────────────────────────────┐
│ 邊界 2：Cloudflare Workers（Next.js）                          │
│  ・頁面 middleware：沒登入、不是 pro、沒過 MFA 都進不了 /pro      │
│  ・每個 API route 自己檢查身分和 MFA（middleware 不管 /api）     │
│  ・持有 service role key（帳號管理、統計、限流會用到）            │
│  ・代為呼叫 Gemini（AI 輔助）                                   │
└───────────────┬──────────────────────────────────────────────┘
                │ 多數查詢帶使用者自己的 JWT；少數管理功能用 service role
                ▼
┌──────────────────────────────────────────────────────────────┐
│ 邊界 3：Supabase（PostgreSQL + Auth）                          │
│  ・15 張表、42 條 RLS policy，病人資料要求 aal2                  │
│  ・trigger：病歷稽核、調配蓋章、角色欄位保護、藥師只能改調配欄     │
└──────────────────────────────────────────────────────────────┘
```

瀏覽器也會**直接**用公開的 anon key 加上使用者的 JWT 打 Supabase 的 REST API（supabase-js），完全不經過 Workers。所以真正的權限邊界在資料庫：前端和 Workers 的檢查都可能被繞過，RLS 不會。

RLS 擋得住的是「只拿到某個使用者的登入憑證，或只有公開 anon key」的攻擊者。它擋不住拿到 service role key 的人 —— 這把 key 放在 Workers 的環境變數裡，Workers 或部署帳號被攻破，就等於資料庫全開（見 E4）。

---

## 二、要保護的東西

| # | 資產 | 機密性 | 完整性 | 可用性 | 為什麼重要 |
|---|---|---|---|---|---|
| 1 | **病人個資**（姓名、身分證、生日、電話、健保卡號）| 高 | 高 | 中 | 個資法責任 |
| 2 | **病歷與 SOAP 筆記** | 高 | 高 | 高 | 醫療責任 |
| 3 | **處方**（存在 `clinical_records.prescriptions`）| 高 | 高 | 高 | 用藥安全 |
| 4 | **稽核紀錄** | 中 | 高 | 中 | 出事時的證據 |
| 5 | **帳號、密碼、TOTP** | 高 | 高 | 中 | 一切授權的基礎 |
| 6 | **角色與權限設定** | 中 | 高 | 低 | 決定誰能看什麼 |
| 7 | **藥物資料庫與交互作用規則** | 低（公開知識）| 高 | 中 | 錯了會誤導用藥 |
| 8 | **展示帳號**（帳密公開在 README）| 低 | 低 | 低 | 讓審查者不用註冊就能試用 |

資產 1、2、3 最重要，下面的分析以它們為主。

---

## 三、STRIDE 逐項

> 共 30 條：S1–S4、T1–T6、R1–R3、I1–I7、D1–D4、E1–E6。I7（送給 AI 的資料）和 E6（公開的展示帳號）是 2026-10-03 新增的。

### S — 假冒身分

| ID | 情境 | 資產 | 現有防禦 | 殘餘風險 |
|---|---|---|---|---|
| S1 | 偷到醫師密碼後冒充登入 | 1, 2, 3 | 醫事端強制 TOTP；資料庫對病人資料要求 aal2，只有密碼讀不到；Supabase Auth 內建登入頻率限制 | **中** —— 手機和密碼一起被拿走就擋不住；沒有連續失敗鎖定 |
| S2 | 偽造 JWT 對資料庫下查詢 | 1, 2, 3 | JWT 由 Supabase Auth 簽發，資料庫端驗證簽章 | **低** —— 需要簽章金鑰 |
| S3 | 拿到別人沒登出的 session | 1, 2, 3 | 存取憑證一小時過期，靠 refresh token 續期；可以登出撤銷 | **中** —— 沒有設定 session 最長存活時間，也沒有閒置自動登出 |
| S4 | 釣魚網站騙走帳密 | 5, 1–3 | 沒有特別的防禦 | **高** —— TOTP 碼也可能被即時轉送，要 WebAuthn 才擋得住 |

未實作：WebAuthn／Passkey、異常登入偵測、登入通知、閒置自動登出。

---

### T — 竄改

| ID | 情境 | 資產 | 現有防禦 | 殘餘風險 |
|---|---|---|---|---|
| T1 | 醫師事後改自己的病歷來掩蓋失誤 | 2, 4 | `clinical_audit_log` 由 trigger 記錄 `clinical_records`、`soap_notes` 每次 INSERT／UPDATE／DELETE 的前後內容、操作者、當下角色、IP、瀏覽器；稽核寫不進去時，原本的修改也會一起失敗 | **中** —— 醫師仍然改得了，只是改了會留紀錄；SOAP 筆記也能刪除（刪除會留下原內容）|
| T2 | 護理師偷改診斷或處方 | 2, 3 | 護理師對 `clinical_records` 只有 SELECT policy，沒有任何寫入 policy | **低** |
| T3 | SQL injection | 1–7 | 前端經 supabase-js → PostgREST，查詢都是參數化的；程式裡沒有自己拼 SQL 字串 | **低** |
| T4 | 繞過網站，直接打 Supabase REST API 改資料 | 1–7 | RLS 在資料庫層生效，不管請求從哪裡來 | **低** —— 前提是 policy 寫對（見 E3）|
| T5 | 竄改稽核紀錄 | 4 | `audit_logs` 只有伺服器（service role）能寫入；`clinical_audit_log` 只能由 trigger 寫入；兩張表都沒有 UPDATE／DELETE policy，一般使用者改不了也刪不了 | **中** —— 有 service role key 或資料庫密碼的人仍然改得了，這不是密碼學上的防竄改。2026-10 以前 `audit_logs` 允許登入者寫入自己名下的紀錄，已移除 |
| T6 | 竄改藥物交互作用規則或藥物資料 | 7 | 12 組交互作用規則寫在程式碼（`src/lib/pro/drugInteractions.ts`），要改得經過 git 和部署；資料庫裡的藥物資料庫和參考值只有通過 MFA 的管理員能改，展示帳號不行 | **中** —— 管理員帳號被冒用就擋不住；藥物資料的修改沒有稽核紀錄 |

未實作：病歷雜湊鏈或可信時間戳記、重大修改需要兩人覆核。

---

### R — 否認

| ID | 情境 | 資產 | 現有防禦 | 殘餘風險 |
|---|---|---|---|---|
| R1 | 醫師否認開過某張處方 | 3, 4 | 處方存在 `clinical_records`，新增和每次修改都記在 `clinical_audit_log`（操作者、時間、IP、瀏覽器、前後內容）；帳號有 TOTP | **低** |
| R2 | 藥師調配後否認是自己做的 | 3, 4 | `dispensed_by` 由資料庫強制為操作者本人，調配時間用資料庫的時間，調配後兩者都不能再改；前端按「完成調配」前有確認視窗，列出病人和藥品 | **低** —— 證明的是「哪個帳號在什麼時候按的」，不是電子簽章 |
| R3 | 管理員否認看過某位病人的病歷 | 1, 2, 4 | **未實作**：SELECT 稽核列為待辦，原因是效能成本 | **中** |

---

### I — 資訊外洩

| ID | 情境 | 資產 | 現有防禦 | 殘餘風險 |
|---|---|---|---|---|
| I1 | 護理師看不是自己照顧的病人 | 1, 2 | 沒有限制：診所模式下護理師、行政、管理員可以讀全院病人（仍要求 aal2） | **中** —— 沒有科別或照護關係的概念，讀取也沒有稽核（見 R3）|
| I2 | 多間診所共用資料庫時互相看到資料 | 1–7 | **未實作**：資料表沒有 `clinic_id`，整個資料庫視為同一間診所 | **高**（真的多診所共用時）—— 要加租戶欄位並改寫 policy |
| I3 | 資料庫備份外流 | 1–7 | 資料庫由 Supabase 託管（靜態加密）；repo 裡沒有資料庫備份檔 | **中** —— 取決於 Supabase |
| I4 | 網路監聽 | 1, 2 | 全程 HTTPS（Cloudflare 和 Supabase 都強制）；回應帶 HSTS | **低** |
| I5 | 錯誤訊息洩漏 SQL 或病人資料 | 1–7 | 一般 API 回固定的錯誤代碼；少數管理 API 會把資料庫錯誤訊息原樣回給管理員 | **低** |
| I6 | 螢幕被旁人看到 | 1, 2 | 沒有防禦 | **中** —— 沒有閒置鎖定 |
| I7 | 送去 AI（Gemini）的內容外流或被拿去訓練 | 1, 2 | 醫事端送出的病人背景只有年齡、性別、慢性病、過敏，加上檢驗數值和醫師輸入的文字，不送姓名、生日、身分證；民眾端的指標判讀只送「正常／偏高／偏低」的結果；AI 請求都要登入並有頻率限制 | **高** —— 醫師輸入的自由文字可能含個資；民眾端的拍照辨識會把整張報告照片送出；展示站若使用 Gemini 免費額度，依 Google 條款送出的內容可能被用來改進服務，所以展示站不該輸入真實病人資料 |

未實作：病人層級的加密、送給 AI 前遮罩自由文字裡的個資。

---

### D — 阻斷服務

| ID | 情境 | 資產 | 現有防禦 | 殘餘風險 |
|---|---|---|---|---|
| D1 | DDoS 讓診所用不了系統 | 2, 3 | Cloudflare 的 DDoS 防護 | **低** |
| D2 | 暴力嘗試登入、把正常使用者擋在外面 | 5 | Supabase Auth 的頻率限制；沒有帳號鎖定，所以也不會被惡意鎖死；管理員可以重設密碼和 TOTP | **中** |
| D3 | 灌爆稽核表或 AI 額度 | 4 | 使用者不能直接寫稽核表；AI 依使用者限流（醫事端每分鐘 30 次），展示帳號共用每分鐘 10 次、每天 100 次；限流計數存在資料庫，所有 Worker 共用 | **中** —— 醫師大量修改自己的病歷，`clinical_audit_log` 仍會一直長大，沒有上限 |
| D4 | Supabase 服務中斷 | 全部 | 沒有備援；免費專案閒置會被暫停，靠 GitHub Actions 定期喚醒 | **高** —— 中斷時系統完全停擺；這是展示與研究用的系統，不適合直接上線 |

---

### E — 權限提升

| ID | 情境 | 資產 | 現有防禦 | 殘餘風險 |
|---|---|---|---|---|
| E1 | 護理師直接呼叫只有醫師能用的功能 | 1–7 | 資料庫（RLS）和每個 API route 各自檢查角色，不靠隱藏按鈕 | **低** |
| E2 | 改前端的角色狀態讓自己變管理員 | 1–7 | 前端的角色只用來決定畫面；`pro_role`、`is_pro` 使用者改不了（欄位權限 + trigger，migration 01）| **低** |
| E3 | RLS policy 寫錯造成越權 | 1–7 | 95 條 RLS 整合測試模擬各角色和 MFA 狀態；2026-10 起另外用腳本比對正式庫和 repo 的 policy，並逐表實測讀、改、刪 | **中** —— 測試沒有涵蓋每一條 policy 的每種組合；2026-10 的實測就找到資源庫可以被任何登入者改寫（已修，見版本紀錄）|
| E4 | service role key 外洩（可以繞過 RLS）| 全部 | key 只放在 Cloudflare Workers 的加密環境變數，不在前端程式碼，也不在 git 歷史裡（已掃描）；用到它的 API（帳號管理、統計、藥物資料庫管理、病患授權邀請）都先在伺服器端檢查登入者的角色和 MFA，限流模組只用它來計數 | **中** —— Workers 或部署帳號被攻破就等於拿到 key |
| E5 | 社交工程：騙管理員重設密碼或改角色 | 5, 6 | 這些操作要管理員通過 MFA，每次都記在 `audit_logs`；一般管理員不能動其他管理員和超級管理員 | **中** —— 被操作的人不會收到通知 |
| E6 | 用公開的展示帳號（帳密寫在 README）存取或修改真實資料 | 1–7 | 展示帳號免 MFA，但每張含病人資料的表都有 RESTRICTIVE policy，展示帳號只碰得到展示帳號擁有的資料；展示用 admin 不能做任何管理操作、不能改藥物資料庫和資源庫、讀不到稽核紀錄和其他人的 profile | **低** —— 展示資料本身任何人都能改，沒有自動還原 |

---

## 四、風險排序

| 威脅 | 等級 | 下一步 |
|---|---|---|
| S4 釣魚 | **高** | WebAuthn／Passkey |
| I7 送給 AI 的資料 | **高** | 改用不拿資料訓練的付費方案或自架模型；送出前遮罩自由文字 |
| D4 服務中斷 | **高** | 真要上線才需要的備援 |
| I2 多診所隔離 | **高**（多診所時）| 加 `clinic_id` 並改寫 policy |
| R3 讀取沒有稽核 | 中 | 先從高敏感病人開始記錄讀取 |
| I1 護理師可讀全院 | 中 | 照護關係或科別 |
| E4 service role key | 中 | 縮小用到 service role 的範圍 |
| S3 session 太長 | 中 | 閒置登出、session 時限 |

高風險裡有幾項不是改程式就能解決的：WebAuthn 要使用者配合，備援要花錢，AI 的資料政策取決於供應商方案。

---

## 五、這個系統不處理的事

下面這些需要組織或資源，不是寫程式能解決的：

| 項目 | 原因 |
|---|---|
| HIPAA／個資法的合規認證 | 需要認證機構、法務和持續稽核 |
| IRB 倫理審查 | 需要醫院或研究機構支持，本系統沒有對接 |
| 真實病人資料 | 同上；展示站只放虛構資料 |
| HSM 硬體金鑰 | 成本和維運團隊；目前用 Supabase 管理的金鑰 |
| 第三方滲透測試 | 需要付費的專業單位，目前沒有做 |
| 保險與責任歸屬 | 法律問題，不在技術範圍 |

所以它的定位是研究用的原型和工程展示，不是可以直接上線的產品。

---

## 六、怎麼驗證

- `npm run test:rls`：95 條 RLS 整合測試，跑在本機的一次性 Supabase。**這支會清空 `public` schema，不要指向正式庫。**
- `npm test`：50 條單元測試（授權判斷、列印報告跳脫、送給 AI 的資料過濾）。
- 正式庫目前的 policy 清單：[`permission-matrix.md`](permission-matrix.md)。

---

## 七、參考資料

- [Microsoft Threat Modeling Tool / STRIDE](https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats)
- [OWASP Threat Modeling Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html)
- [PostgreSQL Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Supabase Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [RFC 6238: TOTP](https://datatracker.ietf.org/doc/html/rfc6238)
- [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms)
- [HIPAA Security Rule（美國）](https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/index.html)
- [個人資料保護法（台灣）](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=I0050021)

---

## 八、版本紀錄

| 日期 | 變動 | 作者 |
|---|---|---|
| 2026-05-15 | 初版（敘事寫 24 個威脅、6 個 STRIDE 類別、6 條對外敘事）| Chia-Yu Chiang + Claude（Day 2 of clinconvert 5 day upgrade）|
| 2026-08-10 | 校準：STRIDE 表格實際列舉為 **28 條**（S1-4·T1-6·R1-3·I1-6·D1-4·E1-5），修正對外敘事數字 24→28（初版敘事誤植）；同步表數/policy 至線上現況 **13 表 / 37 policy**（見 `permission-matrix.md`）；更新 demo 網址。| Chia-Yu Chiang + Claude |
| 2026-10-03 | 逐列對照程式碼和正式庫校正。拿掉沒有實作的防禦：護理師依科別限制（I1）、`clinic_id` 多租戶隔離（I2）、登入失敗鎖定（S1、D2）、閒置鎖定（I6）、稽核表寫入限流（D3）、操作通知（E5）；修正「Workers 被攻破 RLS 仍有效」的說法（Workers 持有 service role key）。T1、R1 補上新建的 `clinical_audit_log`，R2 改為資料庫蓋章，R3 標為未實作，T5 說明兩張稽核表各自的寫入限制。新增 I7（送給 AI 的資料）和 E6（公開的展示帳號），共 30 條。數字更新為 15 表／42 policy。移除面試用的敘事段落。| Chia-Yu Chiang + Claude |

---

## 九、待辦

- [ ] 讀取稽核（R3），先從高敏感病人開始
- [ ] 閒置自動登出、session 最長時限（S3、I6）
- [ ] 送給 AI 前遮罩自由文字裡的個資（I7）
- [ ] 每一列威脅對應到具體的測試名稱
- [ ] 跑一次 OWASP ZAP 之類的自動掃描，結果附在附錄
