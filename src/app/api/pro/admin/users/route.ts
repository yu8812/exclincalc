import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePrivileged } from "@/lib/pro/serverAuth";
import {
  authorizeAdminAction, canAssignRole,
  type CallerContext, type TargetClass, type AdminAction,
} from "@/lib/pro/authz";

const MIN_PASSWORD_LENGTH = 8;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// ── Caller context ──────────────────────────────────────────────────
// R2：privileged mutation 不可只靠 middleware（middleware 只 match /pro/*，不含 /api/pro/*）。
// route 內自行取得 user + is_pro + role + 目前 session 的 AAL，交給純函式判斷。

// R3：typed target lookup — error/not_found 一律 fail closed，不用 null 混淆語意。
async function classifyTarget(
  admin: ReturnType<typeof getAdminClient>, userId: string,
): Promise<{ cls: TargetClass; id: string }> {
  const { data, error } = await admin
    .from("profiles").select("pro_role").eq("id", userId).maybeSingle();
  if (error) return { cls: "error", id: userId };
  if (!data) return { cls: "not_found", id: userId };
  const role = data.pro_role;
  if (role === "super_admin") return { cls: "super_admin", id: userId };
  if (role === "admin") return { cls: "admin", id: userId };
  return { cls: "ordinary", id: userId };
}

function denyResponse(d: { status: number; reason: string }) {
  return NextResponse.json({ error: "FORBIDDEN", reason: d.reason }, { status: d.status });
}

async function writeAuditLog(params: {
  actorId: string; actorEmail: string;
  action: string; targetId?: string; targetEmail?: string;
  details?: Record<string, unknown>;
}) {
  try {
    const admin = getAdminClient();
    const { error } = await admin.from("audit_logs").insert({
      actor_id:     params.actorId,
      actor_email:  params.actorEmail,
      action:       params.action,
      target_id:    params.targetId ?? null,
      target_email: params.targetEmail ?? null,
      details:      params.details ?? {},
    });
    if (error) console.error("[audit] write failed:", error.message, params.action);
  } catch (e) {
    console.error("[audit] write threw:", e instanceof Error ? e.message : String(e));
  }
}

// requirePrivileged 改用共用的 serverAuth（SEC001D-02：避免重複實作漂移）

// GET — list all users with stats
export async function GET() {
  const gate = await requirePrivileged();
  if (!gate.ok) return gate.res;
  const caller = gate.ctx;

  const admin = getAdminClient();
  const { data: { users }, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: profiles } = await admin.from("profiles")
    .select("id, is_pro, pro_role, institution, license_number");

  const countBy = async (table: string) => {
    const { data } = await admin.from(table).select("doctor_id");
    return (data ?? []).reduce((acc: Record<string, number>, r: { doctor_id: string }) => {
      acc[r.doctor_id] = (acc[r.doctor_id] || 0) + 1;
      return acc;
    }, {});
  };
  const patientCounts = await countBy("doctor_patients");
  const recordCounts = await countBy("clinical_records");
  const noteCounts = await countBy("soap_notes");

  const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
  const result = users.map((u) => {
    const p = profileMap.get(u.id);
    return {
      id: u.id, email: u.email, created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at, email_confirmed_at: u.email_confirmed_at,
      is_pro: p?.is_pro ?? false, pro_role: p?.pro_role ?? "doctor",
      institution: p?.institution ?? null, license_number: p?.license_number ?? null,
      patients: patientCounts[u.id] ?? 0,
      records: recordCounts[u.id] ?? 0,
      notes: noteCounts[u.id] ?? 0,
    };
  });

  return NextResponse.json({ users: result, currentUserId: caller.id, currentRole: caller.role });
}

// 共用：解析 body、分類 target、跑授權決策
async function authorizeMutation(
  caller: CallerContext, admin: ReturnType<typeof getAdminClient>,
  userId: string, action: AdminAction,
): Promise<{ ok: true; target: { cls: TargetClass; id: string } } | { ok: false; res: NextResponse }> {
  const target = await classifyTarget(admin, userId);
  const decision = authorizeAdminAction(caller, target, action);
  if (!decision.ok) return { ok: false, res: denyResponse(decision) };
  return { ok: true, target };
}

// POST — reset password or reset MFA
export async function POST(req: NextRequest) {
  const gate = await requirePrivileged();
  if (!gate.ok) return gate.res;
  const caller = gate.ctx;

  const body = await req.json();
  const admin = getAdminClient();
  const userId: string | undefined = body.userId;
  if (!userId) return NextResponse.json({ error: "缺少 userId" }, { status: 400 });

  if (body.action === "reset_password") {
    const { newPassword } = body;
    if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json({ error: `密碼至少 ${MIN_PASSWORD_LENGTH} 字元` }, { status: 400 });
    }
    const az = await authorizeMutation(caller, admin, userId, "reset_password");
    if (!az.ok) return az.res;

    const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const { data: t } = await admin.auth.admin.getUserById(userId);
    await writeAuditLog({ actorId: caller.id, actorEmail: gate.email, action: "reset_password", targetId: userId, targetEmail: t.user?.email ?? "" });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "reset_mfa") {
    const az = await authorizeMutation(caller, admin, userId, "reset_mfa");
    if (!az.ok) return az.res;

    const { data: factorsData, error: lfErr } = await admin.auth.admin.mfa.listFactors({ userId });
    if (lfErr) return NextResponse.json({ error: lfErr.message }, { status: 500 });
    const factors = factorsData?.factors ?? [];
    let removed = 0; const failed: string[] = [];
    for (const f of factors) {
      const { error } = await admin.auth.admin.mfa.deleteFactor({ userId, id: f.id });
      if (error) failed.push(f.id); else removed++;
    }
    const { data: t } = await admin.auth.admin.getUserById(userId);
    await writeAuditLog({ actorId: caller.id, actorEmail: gate.email, action: "reset_mfa", targetId: userId, targetEmail: t.user?.email ?? "", details: { removed, failed } });
    if (failed.length) return NextResponse.json({ error: "部分 MFA factor 移除失敗", removed, failed }, { status: 500 });
    return NextResponse.json({ ok: true, removed });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

// PATCH — update user profile (is_pro, pro_role, institution)
export async function PATCH(req: NextRequest) {
  const gate = await requirePrivileged();
  if (!gate.ok) return gate.res;
  const caller = gate.ctx;

  const { userId, updates } = await req.json();
  if (!userId || !updates) return NextResponse.json({ error: "缺少 userId 或 updates" }, { status: 400 });
  const admin = getAdminClient();

  const changingRole = "pro_role" in updates;
  if (changingRole) {
    const az = await authorizeMutation(caller, admin, userId, "role_change");
    if (!az.ok) return az.res;
    if (!canAssignRole(caller.role, updates.pro_role)) {
      return NextResponse.json({ error: "無權指派此角色", reason: "role_assignment_forbidden" }, { status: 403 });
    }
  } else {
    // 非角色變更（is_pro / institution）仍需目標層級守衛（例如撤銷他人 pro 也不可越級）
    const az = await authorizeMutation(caller, admin, userId, "role_change");
    if (!az.ok) return az.res;
  }

  const targetRoleBefore = (await classifyTarget(admin, userId)).cls;

  const allowed: Record<string, unknown> = {};
  if ("is_pro" in updates) allowed.is_pro = updates.is_pro;
  if ("pro_role" in updates) allowed.pro_role = updates.pro_role;
  if ("institution" in updates) allowed.institution = updates.institution;

  const { error } = await admin.from("profiles").upsert({ id: userId, ...allowed }, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: t } = await admin.auth.admin.getUserById(userId);
  await writeAuditLog({ actorId: caller.id, actorEmail: gate.email, action: "role_change", targetId: userId, targetEmail: t.user?.email ?? "", details: { updates: allowed, prev_class: targetRoleBefore } });
  return NextResponse.json({ ok: true });
}

// DELETE — delete user account
export async function DELETE(req: NextRequest) {
  const gate = await requirePrivileged();
  if (!gate.ok) return gate.res;
  const caller = gate.ctx;

  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: "缺少 userId" }, { status: 400 });
  const admin = getAdminClient();

  const az = await authorizeMutation(caller, admin, userId, "delete");
  if (!az.ok) return az.res;

  const { data: t } = await admin.auth.admin.getUserById(userId);
  const targetEmail = t.user?.email ?? "";
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({ actorId: caller.id, actorEmail: gate.email, action: "delete_user", targetId: userId, targetEmail, details: { deleted_class: az.target.cls } });
  return NextResponse.json({ ok: true });
}
