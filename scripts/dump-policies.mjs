// 重新產生 docs/permission-matrix.md 最後的「附錄：正式庫 policy 全表」。
// 只做唯讀查詢（整個連線設成 read-only），不會改到資料庫。
//
// 用法：DATABASE_URL='postgresql://…' node scripts/dump-policies.mjs
//   連線字串用 Supabase 的 Session pooler（port 5432）。
//   沒設 DATABASE_URL 時，會從 .env.database 讀（不要放 .env.local：OpenNext 會把它打包進 worker）。
import pg from "pg";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const DOC = "docs/permission-matrix.md";
const BEGIN = "<!-- 以下由 scripts/dump-policies.mjs 產生，請勿手改 -->";
const END = "<!-- 產生結束 -->";

function connectionUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (!existsSync(".env.database")) return null;
  const line = readFileSync(".env.database", "utf8").split(/\r?\n/).find((l) => /^DATABASE_UR[LI]\s*=/i.test(l));
  return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : null;
}

const url = connectionUrl();
if (!url) {
  console.error("找不到 DATABASE_URL");
  process.exit(1);
}
// 密碼裡有特殊字元時 URL 解析會失敗，所以自己拆
const m = url.match(/^postgres(?:ql)?:\/\/([^:@]+):(.*)@([^:@/]+):(\d+)\/([^?]+)/);
if (!m) {
  console.error("DATABASE_URL 格式看不懂");
  process.exit(1);
}
const c = new pg.Client({
  user: m[1], password: m[2], host: m[3], port: Number(m[4]), database: m[5],
  ssl: { rejectUnauthorized: false },
});
await c.connect();
await c.query("set default_transaction_read_only = on");

const { rows: tables } = await c.query(`
  select c.relname as name, c.relrowsecurity as rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
   order by 1`);
const { rows: policies } = await c.query(`
  select tablename, policyname, permissive, cmd, roles::text as roles, qual, with_check
    from pg_policies where schemaname = 'public'
   order by tablename, permissive desc, policyname`);
await c.end();

const squash = (s) => (s ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
const cell = (s) => (s ? `\`${squash(s)}\`` : "—");
const restrictive = policies.filter((p) => p.permissive === "RESTRICTIVE").length;

const out = [BEGIN, ""];
out.push(`產生時間：${new Date().toISOString().slice(0, 10)}・資料表 ${tables.length} 張（RLS 全部開啟：${tables.every((t) => t.rls) ? "是" : "否"}）・policy ${policies.length} 條（其中 RESTRICTIVE ${restrictive} 條）`, "");
for (const t of tables) {
  const ps = policies.filter((p) => p.tablename === t.name);
  out.push(`### ${t.name}（${ps.length} 條${t.rls ? "" : "，RLS 未開啟"}）`, "");
  if (!ps.length) {
    out.push("沒有任何 policy：除了 service role，誰都碰不到。", "");
    continue;
  }
  out.push("| policy | 類型 | 指令 | 對象 | USING | WITH CHECK |", "|---|---|---|---|---|---|");
  for (const p of ps) {
    out.push(`| ${squash(p.policyname)} | ${p.permissive === "RESTRICTIVE" ? "**restrictive**" : "permissive"} | ${p.cmd} | ${p.roles.replace(/[{}]/g, "")} | ${cell(p.qual)} | ${cell(p.with_check)} |`);
  }
  out.push("");
}
out.push(END);

const doc = readFileSync(DOC, "utf8").replace(/\r\n/g, "\n");
const start = doc.indexOf(BEGIN);
const end = doc.indexOf(END);
if (start < 0 || end < 0) {
  console.error(`${DOC} 裡找不到產生區塊的標記`);
  process.exit(1);
}
writeFileSync(DOC, doc.slice(0, start) + out.join("\n") + doc.slice(end + END.length));
console.log(`已更新 ${DOC}：${tables.length} 張表、${policies.length} 條 policy`);
