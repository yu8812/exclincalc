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

// 以某身分寫入（可帶 request header），再切回 postgres 檢查結果；整個交易最後 rollback。
// 用來驗證 trigger 寫進去的東西（一般身分讀不到稽核表，所以要切回來看）。
async function writeThenInspect(c, uid, aal, { headers, rawHeaders } = {}, writeFn, inspectFn) {
  await c.query("begin");
  try {
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: uid, role: "authenticated", aal })]);
    if (headers) await c.query("select set_config('request.headers', $1, true)", [JSON.stringify(headers)]);
    if (rawHeaders) await c.query("select set_config('request.headers', $1, true)", [rawHeaders]);
    let wrote = true;
    try { await writeFn(); } catch { wrote = false; }
    await c.query("reset role");
    return { wrote, ...(wrote ? await inspectFn() : {}) };
  } finally {
    await c.query("rollback");
  }
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

  // ── RR10：刪除有 active consent 的病患應成功、consent 轉 revoked ────────
  const delPatient = await seedUser(c, "delp@test.local", false, null);
  const { rows: dc } = await c.query(
    `insert into public.patient_consents (doctor_id, patient_user_id, status, granted_at)
     values ($1,$2,'active',now()) returning id`, [doctor, delPatient]);
  let delOk = false;
  try { await c.query("delete from auth.users where id=$1", [delPatient]); delOk = true; } catch { delOk = false; }
  check("RR10：刪除有 active consent 的病患成功（不再撞 constraint）", delOk);
  const { rows: after } = await c.query("select status, patient_user_id from public.patient_consents where id=$1", [dc[0].id]);
  check("RR10：該 consent 轉為 revoked 並保留記錄（audit）",
    after.length === 1 && after[0].status === "revoked" && after[0].patient_user_id === null);

  // ── RR11：同一 doctor/patient 不可有兩筆 active consent ────────────────
  const dupPatient = await seedUser(c, "dup@test.local", false, null);
  await c.query(`insert into public.patient_consents (doctor_id, patient_user_id, status, granted_at) values ($1,$2,'active',now())`, [doctor, dupPatient]);
  let dupOk = false;
  try { await c.query(`insert into public.patient_consents (doctor_id, patient_user_id, status, granted_at) values ($1,$2,'active',now())`, [doctor, dupPatient]); dupOk = true; } catch { dupOk = false; }
  check("RR11：同一 doctor/patient 第二筆 active consent 被唯一索引擋下", !dupOk);

  // ── 角色能力矩陣（SEC001D-03 診所模式）────────────────────────────────
  check("藥師 aal2 可讀 clinical_records（調配看處方）",
    await canSelect(c, pharm, "aal2", "select 1 from public.clinical_records where id=$1", [cr[0].id]));
  check("藥師 aal2 可改調配欄 dispensed_at",
    await canWrite(c, pharm, "aal2", "update public.clinical_records set dispensed_at=now() where id=$1", [cr[0].id]));
  check("藥師 aal2 不可竄改醫囑 assessment（trigger 擋）",
    !(await canWrite(c, pharm, "aal2", "update public.clinical_records set assessment='hacked' where id=$1", [cr[0].id])));
  check("藥師 aal2 不可管理 appointments（角色排除）",
    !(await canWrite(c, pharm, "aal2", "insert into public.appointments (doctor_id) values ($1)", [doctor])));
  check("nurse aal2 可寫 triage_vitals",
    await canWrite(c, nurse, "aal2", "insert into public.triage_vitals (patient_id, nurse_id) values ($1,$2)", [patientId, nurse]));
  check("doctor aal2 可讀 triage_vitals",
    await (async () => {
      await c.query(`insert into public.triage_vitals (patient_id, nurse_id) values ($1,$2)`, [patientId, nurse]);
      return canSelect(c, doctor, "aal2", "select 1 from public.triage_vitals where patient_id=$1", [patientId]);
    })());
  check("藥師 aal2 不可寫 triage_vitals（角色排除）",
    !(await canWrite(c, pharm, "aal2", "insert into public.triage_vitals (patient_id, nurse_id) values ($1,$2)", [patientId, pharm])));

  // ════ 2026-10：病歷稽核（migration 14）════════════════════════════
  const admin     = await seedUser(c, "a@test.local", true, "admin");
  const demoAdmin = await seedUser(c, "da@test.local", true, "admin");
  const demoNurse = await seedUser(c, "dn@test.local", true, "nurse");
  const demoDoc   = await seedUser(c, "dd@test.local", true, "doctor");
  const pharm2    = await seedUser(c, "p2@test.local", true, "pharmacist");
  await c.query("update public.profiles set is_demo = true where id = any($1)", [[demoAdmin, demoNurse, demoDoc]]);

  const lastAudit = async (rowId) => (await c.query(
    `select action, actor_id, actor_role, old_row, new_row, ip, user_agent
       from public.clinical_audit_log where row_id = $1 order by id desc limit 1`, [rowId])).rows[0] ?? {};

  {
    const r = await writeThenInspect(c, doctor, "aal2", {},
      () => c.query("update public.clinical_records set assessment = 'after' where id = $1", [cr[0].id]),
      () => lastAudit(cr[0].id));
    check("稽核：醫師改自己的病歷 → 多一筆 UPDATE，記下操作者與角色",
      r.wrote && r.action === "UPDATE" && r.actor_id === doctor && r.actor_role === "doctor");
    check("稽核：UPDATE 同時留下改之前與改之後的內容",
      r.old_row?.assessment === null && r.new_row?.assessment === "after");
  }
  {
    const { rows: [note] } = await c.query(
      `insert into public.soap_notes (doctor_id, patient_id, title) values ($1,$2,'原本的筆記') returning id`, [doctor, patientId]);
    const r = await writeThenInspect(c, doctor, "aal2", {},
      () => c.query("delete from public.soap_notes where id = $1", [note.id]),
      () => lastAudit(note.id));
    check("稽核：醫師刪自己的 SOAP 筆記 → 留下 DELETE，old_row 有原內容",
      r.wrote && r.action === "DELETE" && r.old_row?.title === "原本的筆記" && r.new_row === null);
    await c.query("delete from public.soap_notes where id = $1", [note.id]);
  }
  {
    const r = await writeThenInspect(c, doctor, "aal2",
      { headers: { "user-agent": "Mozilla/5.0 test", "x-forwarded-for": "203.0.113.9, 10.0.0.1" } },
      () => c.query("update public.clinical_records set plan = 'p1' where id = $1", [cr[0].id]),
      () => lastAudit(cr[0].id));
    check("稽核：有 request header 時記下 IP（x-forwarded-for 第一段）和瀏覽器",
      r.wrote && r.ip === "203.0.113.9" && r.user_agent === "Mozilla/5.0 test");
  }
  {
    const r = await writeThenInspect(c, doctor, "aal2",
      { headers: { "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.9" } },
      () => c.query("update public.clinical_records set plan = 'p2' where id = $1", [cr[0].id]),
      () => lastAudit(cr[0].id));
    check("稽核：有 cf-connecting-ip 時優先用它", r.wrote && r.ip === "198.51.100.7");
  }
  {
    const r = await writeThenInspect(c, doctor, "aal2", {},
      () => c.query("update public.clinical_records set plan = 'p3' where id = $1", [cr[0].id]),
      () => lastAudit(cr[0].id));
    check("稽核：沒有 request header 時寫入照常成功，ip / user_agent 是 null",
      r.wrote && r.action === "UPDATE" && r.ip === null && r.user_agent === null);
  }
  {
    const r = await writeThenInspect(c, doctor, "aal2", { rawHeaders: "{not json" },
      () => c.query("update public.clinical_records set plan = 'p4' where id = $1", [cr[0].id]),
      () => lastAudit(cr[0].id));
    check("稽核：header 不是合法 JSON 也不會擋住病歷寫入", r.wrote && r.ip === null);
  }
  {
    const r = await writeThenInspect(c, doctor, "aal2", {},
      () => c.query("update public.clinical_records set plan = plan where id = $1", [cr[0].id]),
      async () => ({ n: (await c.query("select count(*)::int as n from public.clinical_audit_log where row_id = $1", [cr[0].id])).rows[0].n }));
    const { rows: [{ n: before }] } = await c.query("select count(*)::int as n from public.clinical_audit_log where row_id = $1", [cr[0].id]);
    check("稽核：內容完全沒變的 UPDATE 不另外記一筆", r.wrote && r.n === before);
  }
  {
    // fail-closed：讓稽核表暫時拒收任何資料，病歷寫入必須跟著失敗
    await c.query("begin");
    let wrote = true;
    try {
      await c.query("alter table public.clinical_audit_log add constraint audit_reject_all check (false) not valid");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: doctor, role: "authenticated", aal: "aal2" })]);
      await c.query("update public.clinical_records set plan = 'should-fail' where id = $1", [cr[0].id]);
    } catch { wrote = false; } finally { await c.query("rollback"); }
    check("稽核：稽核寫不進去時，原本的病歷修改也一起失敗（fail-closed）", wrote === false);
  }
  check("稽核表：醫師讀不到", !(await canSelect(c, doctor, "aal2", "select 1 from public.clinical_audit_log")));
  check("稽核表：護理師讀不到", !(await canSelect(c, nurse, "aal2", "select 1 from public.clinical_audit_log")));
  check("稽核表：藥師讀不到", !(await canSelect(c, pharm, "aal2", "select 1 from public.clinical_audit_log")));
  check("稽核表：管理員（aal2）讀得到", await canSelect(c, admin, "aal2", "select 1 from public.clinical_audit_log"));
  check("稽核表：管理員沒過 MFA（aal1）讀不到", !(await canSelect(c, admin, "aal1", "select 1 from public.clinical_audit_log")));
  check("稽核表：展示用 admin 讀不到（密碼公開）", !(await canSelect(c, demoAdmin, "aal2", "select 1 from public.clinical_audit_log")));
  check("稽核表：任何人都不能直接新增",
    !(await canWrite(c, admin, "aal2", "insert into public.clinical_audit_log (table_name, action) values ('clinical_records','INSERT')")));
  check("稽核表：任何人都不能修改",
    !(await canWrite(c, admin, "aal2", "update public.clinical_audit_log set action = 'DELETE'")));
  check("稽核表：任何人都不能刪除",
    !(await canWrite(c, admin, "aal2", "delete from public.clinical_audit_log")));

  // ════ 2026-10：調配由資料庫蓋章（migration 15）══════════════════════
  {
    const r = await writeThenInspect(c, pharm, "aal2", {},
      () => c.query("update public.clinical_records set dispensed_at = '2020-01-01', dispensed_by = $2 where id = $1", [cr[0].id, doctor]),
      async () => (await c.query("select dispensed_by, dispensed_at > now() - interval '1 minute' as fresh from public.clinical_records where id = $1", [cr[0].id])).rows[0]);
    check("調配：藥師傳別人的 dispensed_by，存進去的仍是藥師自己", r.wrote && r.dispensed_by === pharm);
    check("調配：前端傳的時間不算，用資料庫的現在時間（不能倒填）", r.wrote && r.fresh === true);
  }
  {
    await asUserPersist(c, pharm, "aal2", () =>
      c.query("update public.clinical_records set dispensed_at = now() where id = $1", [cr[0].id]));
    const { rows: [first] } = await c.query("select dispensed_by, dispensed_at from public.clinical_records where id = $1", [cr[0].id]);
    const r = await writeThenInspect(c, pharm2, "aal2", {},
      () => c.query("update public.clinical_records set dispensed_at = '2030-01-01', dispensed_by = $2 where id = $1", [cr[0].id, pharm2]),
      async () => (await c.query("select dispensed_by, dispensed_at from public.clinical_records where id = $1", [cr[0].id])).rows[0]);
    check("調配：已調配的紀錄，別人不能改成自己或改時間",
      r.dispensed_by === first.dispensed_by && r.dispensed_at?.getTime() === first.dispensed_at.getTime());
    const cancel = await writeThenInspect(c, pharm, "aal2", {},
      () => c.query("update public.clinical_records set dispensed_at = null where id = $1", [cr[0].id]),
      async () => (await c.query("select dispensed_by from public.clinical_records where id = $1", [cr[0].id])).rows[0]);
    check("調配：取消調配時 dispensed_by 一起清空", cancel.wrote && cancel.dispensed_by === null);
    await c.query("update public.clinical_records set dispensed_at = null, dispensed_by = null where id = $1", [cr[0].id]);
  }

  // ════ 2026-10：資源庫、藥物資料庫、稽核紀錄的寫入權（migration 13）══════
  const { rows: [pubRes] } = await c.query(
    `insert into public.pro_resources (title, category, is_public) values ('公開指引','指引',true) returning id`);
  check("資源庫：一般註冊用戶不能改公開資源",
    (await asUser(c, plain, "aal1", async () => {
      try { return (await c.query("update public.pro_resources set url = 'https://evil.example' where id = $1", [pubRes.id])).rowCount; }
      catch { return 0; }
    })) === 0);
  check("資源庫：醫師（aal2）也不能改別人的公開資源",
    (await asUser(c, doctor, "aal2", async () =>
      (await c.query("update public.pro_resources set url = 'https://evil.example' where id = $1", [pubRes.id])).rowCount)) === 0);
  check("資源庫：一般註冊用戶不能自己發佈公開資源",
    !(await canWrite(c, plain, "aal1", "insert into public.pro_resources (title, is_public, created_by) values ('x', true, $1)", [plain])));
  check("資源庫：醫師（aal2）可以新增自己的私人資源",
    await canWrite(c, doctor, "aal2", "insert into public.pro_resources (title, is_public, created_by) values ('my', false, $1)", [doctor]));
  check("資源庫：醫師不能把資源設成公開",
    !(await canWrite(c, doctor, "aal2", "insert into public.pro_resources (title, is_public, created_by) values ('pub', true, $1)", [doctor])));
  check("資源庫：漏填 is_public 時預設是不公開",
    (await asUser(c, doctor, "aal2", async () =>
      (await c.query("insert into public.pro_resources (title, created_by) values ('d', $1) returning is_public", [doctor])).rows[0].is_public)) === false);
  check("資源庫：管理員（aal2）可以改公開資源",
    (await asUser(c, admin, "aal2", async () =>
      (await c.query("update public.pro_resources set title = 'ok' where id = $1", [pubRes.id])).rowCount)) === 1);
  check("資源庫：管理員沒過 MFA 不能改",
    (await asUser(c, admin, "aal1", async () =>
      (await c.query("update public.pro_resources set title = 'x' where id = $1", [pubRes.id])).rowCount)) === 0);
  check("資源庫：展示用 admin 不能改",
    (await asUser(c, demoAdmin, "aal2", async () =>
      (await c.query("update public.pro_resources set title = 'x' where id = $1", [pubRes.id])).rowCount)) === 0);

  const medSql = "insert into public.medications (name_zh, name_en, category, uses_zh) values ('測試藥','Testmed','測試','測試')";
  check("藥物資料庫：管理員（aal2）可以新增", await canWrite(c, admin, "aal2", medSql));
  check("藥物資料庫：管理員沒過 MFA 不能新增", !(await canWrite(c, admin, "aal1", medSql)));
  check("藥物資料庫：展示用 admin 不能新增", !(await canWrite(c, demoAdmin, "aal2", medSql)));
  check("藥物資料庫：醫師不能新增", !(await canWrite(c, doctor, "aal2", medSql)));

  await c.query(`insert into public.audit_logs (actor_id, actor_email, action) values ($1, 'a@test.local', 'role_change')`, [admin]);
  check("audit_logs：管理員（aal2）讀得到", await canSelect(c, admin, "aal2", "select 1 from public.audit_logs"));
  check("audit_logs：展示用 admin 讀不到（裡面有真實 email）", !(await canSelect(c, demoAdmin, "aal2", "select 1 from public.audit_logs")));
  check("audit_logs：登入者不能自己寫稽核紀錄（不能偽造）",
    !(await canWrite(c, doctor, "aal2", "insert into public.audit_logs (actor_id, action) values ($1, 'role_change')", [doctor])));
  check("audit_logs：沒人用的 insert_audit_log() 已移除",
    (await c.query("select to_regprocedure('public.insert_audit_log(text,text,text,jsonb)') is null as gone")).rows[0].gone);

  check("profiles：展示用 admin 只看得到自己的 profile",
    (await asUser(c, demoAdmin, "aal2", async () => (await c.query("select 1 from public.profiles")).rowCount)) === 1);
  check("profiles：管理員（aal2）看得到所有 profile",
    (await asUser(c, admin, "aal2", async () => (await c.query("select 1 from public.profiles")).rowCount)) > 1);

  const rateSql = "select public.check_rate_limit('gemini-clinical:someone', 0, 60)";
  check("限流：前端登入者不能直接呼叫 check_rate_limit（不能灌爆別人的額度）", !(await canWrite(c, doctor, "aal2", rateSql)));
  check("限流：匿名不能呼叫 check_rate_limit",
    !(await asAnon(c, async () => { try { await c.query(rateSql); return true; } catch { return false; } })));

  // ════ 2026-10：展示帳號沙盒（migration 13）════════════════════════════
  const { rows: [demoPt] } = await c.query(
    `insert into public.doctor_patients (doctor_id, full_name) values ($1,'Demo Patient') returning id`, [demoDoc]);
  check("沙盒：展示護理師讀得到展示醫師的病人",
    await canSelect(c, demoNurse, "aal1", "select 1 from public.doctor_patients where id=$1", [demoPt.id]));
  check("沙盒：展示護理師讀不到真醫師的病人",
    !(await canSelect(c, demoNurse, "aal1", "select 1 from public.doctor_patients where id=$1", [patientId])));
  check("沙盒：展示 admin 讀不到真醫師的病歷",
    !(await canSelect(c, demoAdmin, "aal1", "select 1 from public.clinical_records where id=$1", [cr[0].id])));
  check("沙盒：展示醫師不能把病人建在真醫師名下",
    !(await canWrite(c, demoDoc, "aal1", "insert into public.doctor_patients (doctor_id, full_name) values ($1,'x')", [doctor])));
  check("沙盒：展示醫師照常管理自己的病人（免 MFA 不受影響）",
    await canWrite(c, demoDoc, "aal1", "insert into public.doctor_patients (doctor_id, full_name) values ($1,'mine')", [demoDoc]));
  check("沙盒：真的護理師（aal2）照常讀得到所有病人",
    await canSelect(c, nurse, "aal2", "select 1 from public.doctor_patients where id=$1", [demoPt.id]));

  // ── replay-safety（RR12）：重跑 base 檔後，安全狀態不得還原 ────────────
  await applyAll(c, [
    "supabase/complete_setup.sql",
    "supabase/clinic_flow.sql",
    "supabase/create_patient_consents.sql",
  ]);
  check("replay 後 doctor aal1 仍不可讀病患（AAL2 gate 未被還原）",
    !(await canSelect(c, doctor, "aal1", "select 1 from public.doctor_patients where id=$1", [patientId])));
  check("replay 後 藥師仍不可管理 appointments（角色範圍未被還原）",
    !(await canWrite(c, pharm, "aal2", "insert into public.appointments (doctor_id) values ($1)", [doctor])));
  check("replay 後 一般用戶仍不可自我提權（R1 未被還原）",
    !(await canWrite(c, plain, "aal2", "update public.profiles set pro_role='super_admin' where id=$1", [plain])));
  check("replay 後 一般註冊用戶仍不能改公開資源",
    (await asUser(c, plain, "aal1", async () => {
      try { return (await c.query("update public.pro_resources set url = 'https://evil.example' where id = $1", [pubRes.id])).rowCount; }
      catch { return 0; }
    })) === 0);
  check("replay 後 展示用 admin 仍不能寫藥物資料庫", !(await canWrite(c, demoAdmin, "aal2", medSql)));
  check("replay 後 展示用 admin 仍讀不到 audit_logs", !(await canSelect(c, demoAdmin, "aal2", "select 1 from public.audit_logs")));
  check("replay 後 insert_audit_log() 沒有被建回來",
    (await c.query("select to_regprocedure('public.insert_audit_log(text,text,text,jsonb)') is null as gone")).rows[0].gone);
  check("replay 後 登入者仍不能自己寫 audit_logs",
    !(await canWrite(c, doctor, "aal2", "insert into public.audit_logs (actor_id, action) values ($1, 'x')", [doctor])));
  check("replay 後 使用者仍可改自己的名字（profiles policy 沒有重複或消失）",
    await canWrite(c, plain, "aal2", "update public.profiles set name='again' where id=$1", [plain]));

  console.log("\n" + results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  await c.end();
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error("HARNESS ERROR:", e.message); process.exit(2); });
