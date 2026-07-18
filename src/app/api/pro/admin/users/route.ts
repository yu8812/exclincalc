import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase-server";

const MIN_PASSWORD_LENGTH = 8;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// ── 授權守衛 ────────────────────────────────────────────────────────
// 安全模型（與 IM.md / THREAT_MODEL.md 一致）：
//   - super_admin：可管理所有帳號
//   - admin：只能管理 doctor / pharmacist / nurse / admin_staff，
//            不可對其他 admin 或 super_admin 執行破壞性操作
//   - 任何人不可修改自己的角色（避免自我提權 / 誤鎖）

/** 取得呼叫者身分，非 admin/super_admin 回傳 null。角色只查一次。 */
async function getCaller(): Promise<{ id: string; email: string; role: string } | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles").select("pro_role").eq("id", user.id).single();
  const role = profile?.pro_role ?? "";
  if (!["admin", "super_admin"].includes(role)) return null;
  return { id: user.id, email: user.email ?? "", role };
}

/** 用 service client 讀目標帳號目前角色（不受 RLS 限制，確保拿得到真值）。 */
async function fetchTargetRole(
  admin: ReturnType<typeof getAdminClient>, userId: string,
): Promise<string | null> {
  const { data } = await admin.from("profiles").select("pro_role").eq("id", userId).single();
  return data?.pro_role ?? null;
}

/**
 * 判斷呼叫者是否可對目標帳號執行破壞性操作（改密碼 / 重置 MFA / 刪帳號 / 改角色）。
 * 允許回傳 null；不允許回傳 { error, status }。
 */
function guardTarget(
  caller: { id: string; role: string },
  targetId: string,
  targetRole: string | null,
): { error: string; status: number } | null {
  if (caller.role === "super_admin") return null; // super_admin 可操作任何人
  // caller 為 admin：
  if (targetRole === "super_admin") {
    return { error: "無法對超級管理員帳號執行此操作", status: 403 };
  }
  if (targetRole === "admin" && targetId !== caller.id) {
    return { error: "管理員無法操作其他管理員帳號", status: 403 };
  }
  return null;
}

async function writeAuditLog(params: {
  actorId: string; actorEmail: string;
  action: string; targetId?: string; targetEmail?: string;
  details?: Record<string, unknown>;
}) {
  const admin = getAdminClient();
  await admin.from("audit_logs").insert({
    actor_id:     params.actorId,
    actor_email:  params.actorEmail,
    action:       params.action,
    target_id:    params.targetId ?? null,
    target_email: params.targetEmail ?? null,
    details:      params.details ?? {},
  });
}

// GET — list all users with stats
export async function GET() {
  const caller = await getCaller();
  if (!caller) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = getAdminClient();

  // Get all auth users
  const { data: { users }, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Get profiles
  const { data: profiles } = await admin.from("profiles")
    .select("id, is_pro, pro_role, institution, license_number");

  // Get activity stats per user
  const { data: patientCounts } = await admin
    .from("doctor_patients")
    .select("doctor_id")
    .then(({ data }) => ({
      data: data?.reduce((acc: Record<string, number>, r) => {
        acc[r.doctor_id] = (acc[r.doctor_id] || 0) + 1;
        return acc;
      }, {}),
    }));

  const { data: recordCounts } = await admin
    .from("clinical_records")
    .select("doctor_id")
    .then(({ data }) => ({
      data: data?.reduce((acc: Record<string, number>, r) => {
        acc[r.doctor_id] = (acc[r.doctor_id] || 0) + 1;
        return acc;
      }, {}),
    }));

  const { data: noteCounts } = await admin
    .from("soap_notes")
    .select("doctor_id")
    .then(({ data }) => ({
      data: data?.reduce((acc: Record<string, number>, r) => {
        acc[r.doctor_id] = (acc[r.doctor_id] || 0) + 1;
        return acc;
      }, {}),
    }));

  const profileMap = new Map((profiles || []).map((p) => [p.id, p]));

  const result = users.map((u) => {
    const p = profileMap.get(u.id);
    return {
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      email_confirmed_at: u.email_confirmed_at,
      is_pro: p?.is_pro ?? false,
      pro_role: p?.pro_role ?? "doctor",
      institution: p?.institution ?? null,
      license_number: p?.license_number ?? null,
      patients: (patientCounts as Record<string, number>)?.[u.id] ?? 0,
      records: (recordCounts as Record<string, number>)?.[u.id] ?? 0,
      notes: (noteCounts as Record<string, number>)?.[u.id] ?? 0,
    };
  });

  return NextResponse.json({
    users: result,
    currentUserId: caller.id,
    currentRole: caller.role,
  });
}

// POST — reset password or reset MFA
export async function POST(req: NextRequest) {
  const caller = await getCaller();
  if (!caller) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const admin = getAdminClient();

  if (body.action === "reset_password") {
    const { userId, newPassword } = body;
    if (!userId) return NextResponse.json({ error: "缺少 userId" }, { status: 400 });
    if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json({ error: `密碼至少 ${MIN_PASSWORD_LENGTH} 字元` }, { status: 400 });
    }

    const targetRole = await fetchTargetRole(admin, userId);
    const denied = guardTarget(caller, userId, targetRole);
    if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });

    const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const { data: targetUser } = await admin.auth.admin.getUserById(userId);
    await writeAuditLog({
      actorId: caller.id, actorEmail: caller.email,
      action: "reset_password",
      targetId: userId, targetEmail: targetUser.user?.email ?? "",
    });
    return NextResponse.json({ ok: true });
  }

  // 解除 MFA 鎖定 / 重置 TOTP factor
  if (body.action === "reset_mfa") {
    const { userId } = body;
    if (!userId) return NextResponse.json({ error: "缺少 userId" }, { status: 400 });

    const targetRole = await fetchTargetRole(admin, userId);
    const denied = guardTarget(caller, userId, targetRole);
    if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });

    const { data: factorsData, error: lfErr } = await admin.auth.admin.mfa.listFactors({ userId });
    if (lfErr) return NextResponse.json({ error: lfErr.message }, { status: 500 });
    const factors = factorsData?.factors ?? [];
    let removed = 0;
    for (const f of factors) {
      const { error } = await admin.auth.admin.mfa.deleteFactor({ userId, id: f.id });
      if (!error) removed++;
    }
    const { data: targetUser } = await admin.auth.admin.getUserById(userId);
    await writeAuditLog({
      actorId: caller.id, actorEmail: caller.email,
      action: "reset_mfa",
      targetId: userId, targetEmail: targetUser.user?.email ?? "",
      details: { removed_factors: removed },
    });
    return NextResponse.json({ ok: true, removed });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

// PATCH — update user profile (is_pro, pro_role, etc.)
export async function PATCH(req: NextRequest) {
  const caller = await getCaller();
  if (!caller) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId, updates } = await req.json();
  if (!userId || !updates) return NextResponse.json({ error: "缺少 userId 或 updates" }, { status: 400 });
  const admin = getAdminClient();

  const targetRole = await fetchTargetRole(admin, userId);

  // 目標帳號層級守衛（admin 不能碰 super_admin / 其他 admin）
  const denied = guardTarget(caller, userId, targetRole);
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });

  // 不可修改自己的角色（避免自我提權 / 誤鎖）
  if ("pro_role" in updates && userId === caller.id) {
    return NextResponse.json({ error: "無法修改自己的角色" }, { status: 403 });
  }
  // 只有 super_admin 能指派 super_admin 角色
  if (updates.pro_role === "super_admin" && caller.role !== "super_admin") {
    return NextResponse.json({ error: "無法設定超級管理員角色" }, { status: 403 });
  }
  // admin 不可把帳號提升為 admin（僅 super_admin 可指派 admin）
  if (updates.pro_role === "admin" && caller.role !== "super_admin") {
    return NextResponse.json({ error: "無法指派管理員角色" }, { status: 403 });
  }

  // Allowed fields only
  const allowed: Record<string, unknown> = {};
  if ("is_pro" in updates) allowed.is_pro = updates.is_pro;
  if ("pro_role" in updates) allowed.pro_role = updates.pro_role;
  if ("institution" in updates) allowed.institution = updates.institution;

  // Upsert: insert if row doesn't exist, update if it does
  const { error } = await admin
    .from("profiles")
    .upsert({ id: userId, ...allowed }, { onConflict: "id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit log
  const { data: targetUser } = await admin.auth.admin.getUserById(userId);
  await writeAuditLog({
    actorId: caller.id, actorEmail: caller.email,
    action: "role_change",
    targetId: userId, targetEmail: targetUser.user?.email ?? "",
    details: { updates: allowed, prev_role: targetRole },
  });

  return NextResponse.json({ ok: true });
}

// DELETE — delete user account
export async function DELETE(req: NextRequest) {
  const caller = await getCaller();
  if (!caller) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: "缺少 userId" }, { status: 400 });

  // Prevent self-deletion
  if (userId === caller.id) {
    return NextResponse.json({ error: "無法刪除自己的帳號" }, { status: 400 });
  }

  const admin = getAdminClient();
  const targetRole = await fetchTargetRole(admin, userId);

  // 目標帳號層級守衛
  const denied = guardTarget(caller, userId, targetRole);
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });

  const { data: targetUser } = await admin.auth.admin.getUserById(userId);
  const targetEmail = targetUser.user?.email ?? "";

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    actorId: caller.id, actorEmail: caller.email,
    action: "delete_user",
    targetId: userId, targetEmail,
    details: { deleted_role: targetRole },
  });

  return NextResponse.json({ ok: true });
}
