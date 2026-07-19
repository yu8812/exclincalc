// RLS × 角色 × is_pro × aal 矩陣測試（對本機 Supabase 測試 DB）。
// 用法：node supabase/tests/rls_matrix.mjs [DB_URL]
// 前置：先 node -e 套用 schema（apply_schema.mjs）。
import pg from "pg";
import { applyAll, SCHEMA_FILES } from "./apply_schema.mjs";

const DB_URL = process.argv[2] || process.env.TEST_DB_URL
  || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let pass = 0, fail = 0;
const results = [];
function check(name, cond) {
  (cond ? pass++ : fail++);
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}`);
}

// 以 postgres（繞過 RLS）建立測試用戶 + profile
async function seedUser(c, email, isPro, role) {
  const { rows } = await c.query(
    `insert into auth.users (id, instance_id, email, aud, role)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated')
     returning id`, [email]);
  const uid = rows[0].id;
  // handle_new_user trigger 已建 profile；用 postgres 設定 is_pro/pro_role（繞過欄位鎖）
  await c.query(`update public.profiles set is_pro=$2, pro_role=$3 where id=$1`, [uid, isPro, role]);
  return uid;
}

// 模擬某 user 的 authenticated session（含 aal），跑 fn，之後 rollback 還原
async function asUser(c, uid, aal, fn) {
  await c.query("begin");
  try {
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: uid, role: "authenticated", aal })]);
    return await fn();
  } finally {
    await c.query("rollback");
  }
}

// 同上但 commit（供需要保留狀態的測試，如 accept_consent single-use）
async function asUserPersist(c, uid, aal, fn) {
  await c.query("begin");
  try {
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: uid, role: "authenticated", aal })]);
    const r = await fn();
    await c.query("commit");
    return r;
  } catch (e) { await c.query("rollback"); throw e; }
}

// 以 anon 角色跑 fn
async function asAnon(c, fn) {
  await c.query("begin");
  try {
    await c.query("set local role anon");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "anon" })]);
    return await fn();
  } finally { await c.query("rollback"); }
}

async function canSelect(c, uid, aal, sql, params) {
  return asUser(c, uid, aal, async () => {
    try { const r = await c.query(sql, params); return r.rowCount > 0; }
    catch { return false; }
  });
}
async function canWrite(c, uid, aal, sql, params) {
  return asUser(c, uid, aal, async () => {
    try { await c.query(sql, params); return true; }
    catch { return false; }
  });
}

async function main() {
  const c = new pg.Client(DB_URL);
  await c.connect();

  // 乾淨重建 schema + 補回 Supabase 的預設授權（否則 authenticated 對新表無任何權限）
  await c.query("drop schema if exists public cascade; create schema public;");
  await c.query("grant usage on schema public to anon, authenticated, service_role; grant all on schema public to postgres;");
  // 模擬 Supabase：postgres 在 public 建立的新表/序列/函式，預設授權給三個角色
  await c.query(`alter default privileges in schema public grant all on tables to anon, authenticated, service_role;`);
  await c.query(`alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);
  await c.query(`alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`);
  await applyAll(c, SCHEMA_FILES);

  // 清掉上次殘留的測試帳號（auth schema 不受 drop public 影響）
  await c.query("delete from auth.users where email like '%@test.local'");

  // 測試用戶
  const doctor  = await seedUser(c, "d@test.local", true, "doctor");
  const doctor2 = await seedUser(c, "d2@test.local", true, "doctor");
  const nurse   = await seedUser(c, "n@test.local", true, "nurse");
  const pharm   = await seedUser(c, "p@test.local", true, "pharmacist");
  const plain   = await seedUser(c, "u@test.local", false, null);
  const demoted = await seedUser(c, "x@test.local", false, "doctor"); // 停權：is_pro=false 但保留 role

  // doctor 擁有一位病患（postgres 直接插入，繞過 RLS）
  const { rows: pr } = await c.query(
    `insert into public.doctor_patients (doctor_id, full_name) values ($1,'Test Patient') returning id`, [doctor]);
  const patientId = pr[0].id;

  // ── doctor_patients 矩陣 ──────────────────────────────────────────
  check("doctor aal2 可讀自己的病患",
    await canSelect(c, doctor, "aal2", "select 1 from public.doctor_patients where id=$1", [patientId]));
  check("doctor aal1 不可讀自己的病患（RR8 強制 MFA）",
    !(await canSelect(c, doctor, "aal1", "select 1 from public.doctor_patients where id=$1", [patientId])));
  check("停權 doctor(is_pro=false) aal2 不可讀（即時失效）",
    !(await canSelect(c, demoted, "aal2", "select 1 from public.doctor_patients where id=$1", [patientId])));
  check("其他 doctor aal2 讀不到別人的病患",
    !(await canSelect(c, doctor2, "aal2", "select 1 from public.doctor_patients where id=$1", [patientId])));
  check("nurse aal2 可讀所有病患",
    await canSelect(c, nurse, "aal2", "select 1 from public.doctor_patients where id=$1", [patientId]));
  check("nurse aal1 不可讀病患",
    !(await canSelect(c, nurse, "aal1", "select 1 from public.doctor_patients where id=$1", [patientId])));
  check("一般用戶 不可讀病患",
    !(await canSelect(c, plain, "aal2", "select 1 from public.doctor_patients where id=$1", [patientId])));
  check("doctor aal2 可新增自己的病患",
    await canWrite(c, doctor, "aal2", "insert into public.doctor_patients (doctor_id, full_name) values ($1,'New')", [doctor]));
  check("doctor aal1 不可新增病患",
    !(await canWrite(c, doctor, "aal1", "insert into public.doctor_patients (doctor_id, full_name) values ($1,'New2')", [doctor])));

  // ── 自我提權（R1）──────────────────────────────────────────────
  check("一般用戶 不可自改 pro_role（R1）",
    !(await canWrite(c, plain, "aal2", "update public.profiles set pro_role='super_admin' where id=$1", [plain])));
  check("一般用戶 不可自開 is_pro（R1）",
    !(await canWrite(c, plain, "aal2", "update public.profiles set is_pro=true where id=$1", [plain])));
  check("一般用戶 可改自己的 name（安全欄位）",
    await canWrite(c, plain, "aal2", "update public.profiles set name='ok' where id=$1", [plain]));

  // ── 其他病歷表 aal2 gating ────────────────────────────────────────
  const { rows: cr } = await c.query(
    `insert into public.clinical_records (doctor_id, patient_id) values ($1,$2) returning id`, [doctor, patientId]);
  check("doctor aal2 可讀自己的 clinical_records",
    await canSelect(c, doctor, "aal2", "select 1 from public.clinical_records where id=$1", [cr[0].id]));
  check("doctor aal1 不可讀 clinical_records",
    !(await canSelect(c, doctor, "aal1", "select 1 from public.clinical_records where id=$1", [cr[0].id])));
  check("doctor aal2 可新增 appointment",
    await canWrite(c, doctor, "aal2", "insert into public.appointments (doctor_id) values ($1)", [doctor]));
  check("doctor aal1 不可新增 appointment",
    !(await canWrite(c, doctor, "aal1", "insert into public.appointments (doctor_id) values ($1)", [doctor])));
  check("pharmacist aal2 可管理 drug_interaction_checks",
    await canWrite(c, pharm, "aal2", "insert into public.drug_interaction_checks (doctor_id, drug_list) values ($1, array['a','b'])", [pharm]));

  // ── consent PHI（RR2：需 aal2 + active consent）────────────────────
  const patientUser = await seedUser(c, "pt@test.local", false, null);
  await c.query(`insert into public.health_records (user_id, type, data) values ($1,'manual','{}')`, [patientUser]);
  await c.query(`insert into public.patient_consents (doctor_id, patient_user_id, status, granted_at)
                 values ($1,$2,'active',now())`, [doctor, patientUser]);
  check("doctor aal2 + active consent 可讀病患 PHI（RR2）",
    await canSelect(c, doctor, "aal2", "select 1 from public.health_records where user_id=$1", [patientUser]));
  check("doctor aal1 + active consent 不可讀 PHI（RR2 需 aal2）",
    !(await canSelect(c, doctor, "aal1", "select 1 from public.health_records where user_id=$1", [patientUser])));
  check("doctor2 無 consent aal2 不可讀該病患 PHI",
    !(await canSelect(c, doctor2, "aal2", "select 1 from public.health_records where user_id=$1", [patientUser])));

  // ── accept_consent single-use + anon 拒絕（RR5/R8）─────────────────
  const { rows: tok } = await c.query(
    `insert into public.patient_consents (doctor_id, status) values ($1,'pending') returning invite_token`, [doctor]);
  const token = tok[0].invite_token;
  const c1 = await seedUser(c, "c1@test.local", false, null);
  const c2 = await seedUser(c, "c2@test.local", false, null);
  const a1 = await asUserPersist(c, c1, "aal1", async () => (await c.query("select public.accept_consent($1) as ok", [token])).rows[0].ok);
  check("accept_consent 首次接受成功", a1 === true);
  const a2 = await asUserPersist(c, c2, "aal1", async () => (await c.query("select public.accept_consent($1) as ok", [token])).rows[0].ok);
  check("accept_consent 同 token 第二次失敗（single-use，R8）", a2 === false);
  const anonOk = await asAnon(c, async () => {
    try { await c.query("select public.accept_consent($1)", [token]); return true; } catch { return false; }
  });
  check("anon 不可執行 accept_consent（已 revoke public/anon，RR5）", anonOk === false);

  // ── restrictive gate 抗繞過（SEC001D-03）──────────────────────────
  await c.query(`create policy "rogue_open" on public.doctor_patients as permissive for select to authenticated using (true)`);
  check("加了無 aal2 的 rogue permissive policy 後，doctor aal1 仍被 restrictive gate 擋（不可繞過）",
    !(await canSelect(c, doctor, "aal1", "select 1 from public.doctor_patients where id=$1", [patientId])));
  check("restrictive gate 下 doctor aal2 仍可讀（正常不受影響）",
    await canSelect(c, doctor, "aal2", "select 1 from public.doctor_patients where id=$1", [patientId]));
  await c.query(`drop policy "rogue_open" on public.doctor_patients`);

  // ── 真並發：兩連線搶同一 token，只有一個成功（R8 atomic single-use）──────
  const { rows: tk } = await c.query(
    `insert into public.patient_consents (doctor_id, status) values ($1,'pending') returning invite_token`, [doctor]);
  const raceToken = tk[0].invite_token;
  const rc1 = await seedUser(c, "race1@test.local", false, null);
  const rc2 = await seedUser(c, "race2@test.local", false, null);
  const A = new pg.Client(DB_URL), B = new pg.Client(DB_URL);
  await A.connect(); await B.connect();
  const beginAs = async (cl, uid) => {
    await cl.query("begin");
    await cl.query("set local role authenticated");
    await cl.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: "authenticated", aal: "aal1" })]);
  };
  await beginAs(A, rc1); await beginAs(B, rc2);
  const rA = await A.query("select public.accept_consent($1) as ok", [raceToken]); // A 取得 row lock
  const pB = B.query("select public.accept_consent($1) as ok", [raceToken]);       // B 卡在 lock
  await A.query("commit");                                                          // 釋放 lock
  const rB = await pB;                                                              // B 續行：status 已 active → 0 row
  await B.query("commit");
  await A.end(); await B.end();
  check("並發：先到的連線成功接受 token", rA.rows[0].ok === true);
  check("並發：後到的連線失敗（atomic single-use，不會重複接受）", rB.rows[0].ok === false);

  console.log("\n" + results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await c.end();
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error("HARNESS ERROR:", e.message); process.exit(2); });
