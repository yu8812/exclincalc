// 在本機測試庫實測「每張表 × 高風險身分 × 讀 / 改 / 刪」，全部在 rollback 的交易裡做。
// 身分：匿名（anon key）、一般註冊用戶（民眾端開放註冊）、展示用 admin（密碼公開）、沒過 MFA 的醫師。
// 每格是「讀到幾筆 / 改到幾筆 / 刪到幾筆」，ERR 代表權限直接拒絕。
//
// 為什麼需要：RLS 測試只測得到「想得到的情境」。2026-10-03 就是用這個方法找到
// 「任何登入者都能改資源庫」和「展示 admin 能寫藥物資料庫」（見 migration 13）。
// 新增資料表或改 policy 之後跑一次，看有沒有不該出現的數字。
//
// 用法：node scripts/exposure-scan.mjs        （預設 127.0.0.1:54322，可用 LOCAL_DB_URL 覆寫）
// ⚠️ 本機資料庫的 public schema 會被整個清掉重建。
import pg from "pg";
import { readFileSync } from "node:fs";
import { applyAll, SCHEMA_FILES } from "../supabase/tests/apply_schema.mjs";

const LOCAL_URL = process.env.LOCAL_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!/@(127\.0\.0\.1|localhost):/.test(LOCAL_URL)) {
  console.error("LOCAL_DB_URL 必須是本機資料庫（會被清空），拒絕執行。");
  process.exit(1);
}

const c = new pg.Client(LOCAL_URL);
await c.connect();
await c.query("drop schema if exists public cascade; create schema public;");
await c.query("grant usage on schema public to anon, authenticated, service_role; grant all on schema public to postgres;");
await c.query("alter default privileges in schema public grant all on tables to anon, authenticated, service_role;");
await c.query("alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;");
await c.query("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;");
await applyAll(c, SCHEMA_FILES);
await c.query("delete from auth.users where email like '%@scan.local'");

async function user(email, isPro, role, isDemo = false) {
  const { rows } = await c.query(
    `insert into auth.users (id, instance_id, email, aud, role)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated') returning id`, [email]);
  await c.query(`update public.profiles set is_pro=$2, pro_role=$3, is_demo=$4 where id=$1`, [rows[0].id, isPro, role, isDemo]);
  return rows[0].id;
}
const realAdmin = await user("admin@scan.local", true, "admin");
const doctor = await user("doc@scan.local", true, "doctor");
const consumer = await user("consumer@scan.local", false, null);
const demoAdmin = await user("demo-admin@scan.local", true, "admin", true);

// 每張表放幾筆「屬於別人（非展示帳號）」的資料
for (const f of ["supabase/seed_medications.sql", "supabase/seed_resources.sql"]) {
  try { await c.query(readFileSync(f, "utf8")); } catch (e) { console.log(`略過 ${f}：${e.message.slice(0, 80)}`); }
}
const { rows: [pt] } = await c.query(`insert into public.doctor_patients (doctor_id, full_name) values ($1,'P') returning id`, [doctor]);
await c.query(`insert into public.clinical_records (doctor_id, patient_id) values ($1,$2)`, [doctor, pt.id]);
await c.query(`insert into public.soap_notes (doctor_id, patient_id) values ($1,$2)`, [doctor, pt.id]);
await c.query(`insert into public.health_records (user_id, type) values ($1,'manual')`, [consumer]);
await c.query(`insert into public.audit_logs (actor_id, actor_email, action) values ($1,'admin@scan.local','role_change')`, [realAdmin]);
await c.query(`insert into public.appointments (doctor_id) values ($1)`, [doctor]);
await c.query(`insert into public.triage_vitals (patient_id, nurse_id) values ($1,$2)`, [pt.id, doctor]);
await c.query(`insert into public.drug_interaction_checks (doctor_id, drug_list) values ($1, array['a','b'])`, [doctor]);
await c.query(`insert into public.patient_consents (doctor_id, status) values ($1,'pending')`, [doctor]);

const { rows: tables } = await c.query(
  `select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1`);

async function as(who, fn) {
  await c.query("begin");
  try {
    if (who.anon) {
      await c.query("set local role anon");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "anon" })]);
    } else {
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)",
        [JSON.stringify({ sub: who.id, role: "authenticated", aal: who.aal })]);
    }
    return await fn();
  } catch {
    return "ERR";
  } finally {
    await c.query("rollback");
  }
}

const people = [
  { name: "匿名", anon: true },
  { name: "一般註冊用戶", id: consumer, aal: "aal1" },
  { name: "展示 admin", id: demoAdmin, aal: "aal1" },
  { name: "醫師（沒過 MFA）", id: doctor, aal: "aal1" },
];

console.log("\n表（總筆數）".padEnd(28), people.map((p) => p.name.padEnd(18)).join(""));
console.log("".padEnd(28), people.map(() => "讀/改/刪".padEnd(18)).join(""));
for (const { relname: t } of tables) {
  const { rows: [{ total }] } = await c.query(`select count(*)::int as total from public.${t}`);
  const { rows: cols } = await c.query(
    `select column_name from information_schema.columns
      where table_schema='public' and table_name=$1 and column_name <> 'id' order by ordinal_position limit 1`, [t]);
  const col = cols[0]?.column_name;
  const cells = [];
  for (const p of people) {
    const sel = await as(p, async () => (await c.query(`select 1 from public.${t}`)).rowCount);
    const upd = col ? await as(p, async () => (await c.query(`update public.${t} set ${col} = ${col} returning 1`)).rowCount) : "-";
    const del = await as(p, async () => (await c.query(`delete from public.${t} returning 1`)).rowCount);
    cells.push(`${sel}/${upd}/${del}`.padEnd(18));
  }
  console.log(`${t}（${total}）`.padEnd(28), cells.join(""));
}
await c.end();
