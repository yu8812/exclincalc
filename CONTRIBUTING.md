# Contributing to ExClinCalc

歡迎貢獻！本專案是醫療資訊系統的研究實作，所有合理的改進都歡迎。

## 在貢獻之前

- 本專案是銘傳大學生物醫學工程學系專題研究的延伸
- 處理多角色臨床資料 → **任何 PR 都會嚴格審查安全性**
- 目前由作者一人維護
- 重大改動請先開 issue 討論

## 怎麼貢獻

### 報告 bug

1. 確認 issue 還沒被回報過（搜尋現有 issues）
2. 開新 issue，使用 bug template
3. 提供：
   - 重現步驟（**請使用 demo 帳號，不要用真實病患資料**）
   - 期待行為 vs 實際行為
   - 角色（哪個 role 在哪個頁面遇到？）
   - 瀏覽器 / OS 環境
   - Console / network 錯誤訊息

### 提出新功能

1. 開新 issue，使用 feature request template
2. 說明：
   - 解決什麼臨床痛點
   - 影響哪些角色
   - 是否需要新的 RLS policy（如有，請描述權限矩陣）
   - 是否涉及 audit_logs 變動

### 提交 Pull Request

1. Fork repo
2. Create branch：`git checkout -b feature/your-feature` 或 `fix/your-fix`
3. 修改 + 測試
4. Commit 訊息建議用 [Conventional Commits](https://www.conventionalcommits.org/)：
   - `feat(soap): 加入新主訴模板`
   - `fix(rls): 修正 nurse 角色查詢病患的 policy`
   - `security(totp): 加強失敗鎖定邏輯`
5. Push 到你的 fork
6. 開 PR 到 main

PR 描述請包含：

- 解決的問題（連結到 issue 編號）
- 主要改動點
- **是否涉及 RLS / TOTP / RBAC 變動**（必填）
- **是否涉及 audit_logs 寫入點**（必填）
- 測試方式
- 截圖（如為 UI 改動）

## 安全相關 PR 的特殊要求

涉及以下變動的 PR 會被特別嚴格 review：

### RLS Policy 變動

需附上：
- **變動前 vs 變動後** 的 policy SQL
- **權限矩陣**（哪個角色可以對哪張表做什麼操作）
- **跨角色測試**：用 4 個不同 role 的 demo 帳號驗證

### 新增 / 修改 audit_logs

需附上：
- **記錄什麼欄位**（誰、何時、何操作、影響什麼資料）
- **trigger 條件**（什麼情況下會寫入）
- **保留期限**（90 天還是更長）

### TOTP / Auth 變動

需附上：
- **變動的 flow 圖**
- **失敗模式分析**（如何 graceful degrade）
- **是否影響 5 次失敗鎖定機制**

## 開發環境

### 前置需求

- Node.js 22+
- 一個 Supabase 專案（免費 tier 即可，但需 PostgreSQL 14+ 才有完整 RLS 功能）
- 一個 Google AI Studio API Key

### 本地啟動

```bash
git clone https://github.com/RO883C/exclincalc.git
cd exclincalc
npm install
cp .env.local.example .env.local  # 填入你的 keys

# 初始化資料庫（依序）
# 在 Supabase SQL Editor 跑 supabase/ 內所有 SQL 檔

# 啟動
npm run dev                          # macOS/Linux
npx next dev --webpack -p 3001       # Windows
```

詳細設定見 [README.md](README.md#本地開發)。

## 程式碼風格

- **TypeScript strict mode**：所有新檔案必須通過型別檢查
- **ESLint**：commit 前跑 `npm run lint`
- **Prettier**：commit 前跑 `npm run format`
- **檔案命名**：
  - React component: `PascalCase.tsx`
  - utility: `camelCase.ts`
  - API route: 依 Next.js App Router 規範
  - SQL migration: `NNNN_descriptive_name.sql`

## 測試

```bash
# 單元測試
npm test

# RLS 測試（需要 4 個 demo 帳號的 credentials）
npm run test:rls

# E2E 測試（如有 Playwright setup）
npm run test:e2e
```

**RLS 變動的 PR**：必須跑 RLS 測試套件。

## 安全性貢獻

請看 [SECURITY.md](SECURITY.md)。**漏洞請以 email 通報，不要開 public issue**。

## 不接受的貢獻

- **直接改動現有 RLS policy 而沒有提權限矩陣**
- **改動 TOTP 邏輯讓 MFA 變更弱**
- **移除 audit_logs 寫入**
- **加入會繞過現有權限的「shortcut」API**
- **把臨床資料寫入 client-side localStorage 不加密**
- **加入會跨角色洩漏資料的 features**

## 行為準則

簡單規則：

- 互相尊重
- 對事不對人
- 不接受任何形式的歧視或騷擾
- 出現衝突時 → 我來協調

## 授權

提交 PR 即同意你的貢獻以 MIT License 發佈。

---

## 聯絡

有問題 / 想討論：

📧 yuyulsc881209@icloud.com
🌐 [GitHub: @RO883C](https://github.com/RO883C)

謝謝你考慮貢獻！
