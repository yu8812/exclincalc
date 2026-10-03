// 比對「正式庫」和「用 repo 檔案從零建起來的本機資料庫」差在哪裡：
// policy、table / 欄位權限、函式（含 SECURITY DEFINER 與 search_path）、trigger、資料表、欄位。
//
// 為什麼需要：RLS 測試是對 repo 建出來的資料庫跑的，只存在正式庫的 policy 測不到。
// 2026-10-03 就是用這個方法找到 service_role_all（任何人都能讀 profiles），見 migration 10、11。
//
// 用法：DATABASE_URL='postgresql://…正式庫…' node scripts/schema-drift.mjs
//   沒設 DATABASE_URL 時，會從 .env.local 讀 DATABASE_URL。
//   本機資料庫預設 127.0.0.1:54322（supabase start），可用 LOCAL_DB_URL 覆寫。
//
// ⚠️ 本機資料庫的 public schema 會被整個清掉重建；正式庫只做唯讀查詢。
import pg from "pg";
import { readFileSync, existsSync } from "node:fs";
import { applyAll, SCHEMA_FILES } from "../supabase/tests/apply_schema.mjs";

const LOCAL_URL = process.env.LOCAL_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!/@(127\.0\.0\.1|localhost):/.test(LOCAL_URL)) {
  console.error("LOCAL_DB_URL 必須是本機資料庫（會被清空），拒絕執行。");
  process.exit(1);
}

function liveClient() {
  let url = process.env.DATABASE_URL;
  if (!url && existsSync(".env.local")) {
    const line = readFileSync(".env.local", "utf8").split(/\r?\n/).find((l) => /^DATABASE_UR[LI]\s*=/i.test(l));
    if (line) url = line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
  }
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
  return new pg.Client({
    user: m[1], password: m[2], host: m[3], port: Number(m[4]), database: m[5],
    ssl: { rejectUnauthorized: false },
  });
}

const QUERIES = {
  policies: `select tablename||' :: '||policyname as k,
               permissive||' '||cmd||' to '||roles::text||' USING('||coalesce(qual,'')||') CHECK('||coalesce(with_check,'')||')' as v
             from pg_policies where schemaname='public'`,
  grants: `select table_name||' :: '||grantee as k, string_agg(privilege_type, ',' order by privilege_type) as v
           from information_schema.role_table_grants
           where table_schema='public' and grantee in ('anon','authenticated') group by table_name, grantee`,
  colgrants: `select table_name||'.'||column_name||' :: '||grantee as k, string_agg(privilege_type, ',' order by privilege_type) as v
              from information_schema.column_privileges
              where table_schema='public' and table_name='profiles' and grantee in ('anon','authenticated')
              group by table_name, column_name, grantee`,
  functions: `select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as k,
                case when p.prosecdef then 'DEFINER' else 'invoker' end||' cfg='||coalesce(array_to_string(p.proconfig,','),'-')
                ||' acl='||coalesce(p.proacl::text,'(default)')||' body='||md5(p.prosrc) as v
              from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`,
  triggers: `select event_object_table||' :: '||trigger_name as k,
               action_timing||' '||string_agg(event_manipulation, ',' order by event_manipulation)||' '||max(action_statement) as v
             from information_schema.triggers where trigger_schema='public' group by event_object_table, trigger_name, action_timing`,
  tables: `select c.relname as k, 'rls='||c.relrowsecurity||' force='||c.relforcerowsecurity as v
           from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'`,
  columns: `select table_name||'.'||column_name as k, data_type||' null='||is_nullable||' default='||coalesce(column_default,'-') as v
            from information_schema.columns where table_schema='public'`,
};

async function snapshot(c) {
  const out = {};
  for (const [name, sql] of Object.entries(QUERIES)) {
    const { rows } = await c.query(sql);
    out[name] = new Map(rows.map((r) => [r.k, r.v]));
  }
  return out;
}

const live = liveClient();
await live.connect();
await live.query("set default_transaction_read_only = on");
const L = await snapshot(live);
await live.end();

const local = new pg.Client(LOCAL_URL);
await local.connect();
await local.query("drop schema if exists public cascade; create schema public;");
await local.query("grant usage on schema public to anon, authenticated, service_role; grant all on schema public to postgres;");
await local.query("alter default privileges in schema public grant all on tables to anon, authenticated, service_role;");
await local.query("alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;");
await local.query("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;");
await applyAll(local, SCHEMA_FILES);
const R = await snapshot(local);
await local.end();

let total = 0;
for (const name of Object.keys(QUERIES)) {
  const a = L[name], b = R[name];
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort();
  const lines = [];
  for (const k of keys) {
    if (!b.has(k)) lines.push(`  只在正式庫  ${k}\n      ${a.get(k)}`);
    else if (!a.has(k)) lines.push(`  只在 repo   ${k}\n      ${b.get(k)}`);
    else if (a.get(k) !== b.get(k)) lines.push(`  不一樣      ${k}\n      正式庫：${a.get(k)}\n      repo  ：${b.get(k)}`);
  }
  console.log(`\n## ${name}：正式庫 ${a.size}、repo ${b.size}、差異 ${lines.length}`);
  if (lines.length) console.log(lines.join("\n"));
  total += lines.length;
}
console.log(`\n差異共 ${total} 項。已知、可以接受的差異記在 docs/permission-matrix.md。`);
