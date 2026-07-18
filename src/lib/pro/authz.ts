// Admin API 授權決策 — 純函式、無 I/O，可 table-driven 測試。
// route 端負責取得 caller context（user / is_pro / role / AAL）與 target 分類，
// 再交由此處做 fail-closed 決策。SEC-001b R2 / R3。

export type ProRole =
  | "doctor" | "admin" | "super_admin" | "pharmacist" | "nurse" | "admin_staff";

export const PRIVILEGED_ROLES: ProRole[] = ["admin", "super_admin"];

export interface CallerContext {
  id: string;
  role: ProRole | null;
  isPro: boolean;
  aal: "aal1" | "aal2" | null;   // 目前 session 的 AAL（getAuthenticatorAssuranceLevel().currentLevel）
}

// R3：目標帳號分類 — 不可再用 null 同時代表「普通帳號」與「查不到」。
export type TargetClass =
  | "ordinary"
  | "admin"
  | "super_admin"
  | "not_found"
  | "error";

export type AdminAction = "reset_password" | "reset_mfa" | "delete" | "role_change";

export interface Decision { ok: boolean; status: number; reason: string; }

const ALLOW: Decision = { ok: true, status: 200, reason: "ok" };
const deny = (status: number, reason: string): Decision => ({ ok: false, status, reason });

/**
 * R2：privileged caller 前置條件。所有 privileged mutation（與敏感讀取）都必須在
 * route 內先過此檢查，不可只靠頁面 middleware（middleware 只 match /pro/*，不含 /api/pro/*）。
 * 條件：已登入 + is_pro=true + admin/super_admin + 目前 session 已達 AAL2（MFA 通過）。
 */
export function checkPrivilegedCaller(c: CallerContext): Decision {
  if (!c.id) return deny(401, "unauthenticated");
  if (!c.isPro) return deny(403, "not_pro");
  if (!c.role || !PRIVILEGED_ROLES.includes(c.role)) return deny(403, "not_admin");
  if (c.aal !== "aal2") return deny(403, "aal2_required");
  return ALLOW;
}

/**
 * caller 對 target 執行 action 是否允許。呼叫前 caller 須已通過 checkPrivilegedCaller。
 * 全部 fail closed：目標查詢 error/not_found 一律拒絕。
 */
export function authorizeAdminAction(
  caller: CallerContext,
  target: { cls: TargetClass; id: string },
  action: AdminAction,
): Decision {
  // R3：fail closed
  if (target.cls === "error") return deny(503, "target_lookup_failed");
  if (target.cls === "not_found") return deny(404, "target_not_found");

  const isSelf = target.id === caller.id;

  // R2：Admin API 不得對自己做 MFA / 密碼重設 —— 走個人安全流程（/pro/security、/pro/profile，需 reauth）。
  if (isSelf && (action === "reset_mfa" || action === "reset_password")) {
    return deny(403, "self_service_via_personal_flow");
  }
  // 不可刪除自己
  if (isSelf && action === "delete") return deny(400, "cannot_delete_self");
  // 不可修改自己的角色
  if (isSelf && action === "role_change") return deny(403, "cannot_change_own_role");

  // 目標層級守衛：admin 不可對 super_admin / 其他 admin 執行破壞性操作
  if (caller.role !== "super_admin") {
    if (target.cls === "super_admin") return deny(403, "cannot_act_on_super_admin");
    if (target.cls === "admin" && !isSelf) return deny(403, "cannot_act_on_other_admin");
  }
  return ALLOW;
}

/** 角色指派限制：只有 super_admin 可指派 admin / super_admin。 */
export function canAssignRole(callerRole: ProRole | null, newRole: string): boolean {
  if (newRole === "super_admin" || newRole === "admin") return callerRole === "super_admin";
  return true;
}
