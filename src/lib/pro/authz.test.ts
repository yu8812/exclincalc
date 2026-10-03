import { describe, it, expect } from "vitest";
import {
  checkPrivilegedCaller, checkPrivilegedRead, checkProAal2, authorizeAdminAction, canAssignRole,
  type CallerContext, type AdminAction,
} from "./authz";

const caller = (over: Partial<CallerContext> = {}): CallerContext => ({
  id: "self", role: "admin", isPro: true, aal: "aal2", isDemo: false, ...over,
});

describe("checkPrivilegedCaller (R2 前置條件)", () => {
  it("admin + is_pro + aal2 通過", () => {
    expect(checkPrivilegedCaller(caller()).ok).toBe(true);
  });
  const denyCases: Array<[string, Partial<CallerContext>, number]> = [
    ["未登入",          { id: "" },              401],
    ["非 pro",          { isPro: false },        403],
    ["非 admin 角色",   { role: "doctor" },      403],
    ["nurse",           { role: "nurse" },       403],
    ["角色為 null",     { role: null },          403],
    ["僅 aal1（未過 MFA）", { aal: "aal1" },      403],
    ["aal 為 null",     { aal: null },           403],
  ];
  it.each(denyCases)("拒絕：%s → %i", (_label, over, status) => {
    const d = checkPrivilegedCaller(caller(over));
    expect(d.ok).toBe(false);
    expect(d.status).toBe(status);
  });
});

describe("authorizeAdminAction (R3 fail-closed + 目標守衛)", () => {
  const actions: AdminAction[] = ["reset_password", "reset_mfa", "delete", "role_change"];

  it.each(actions)("target lookup error → 503 fail closed (%s)", (action) => {
    const d = authorizeAdminAction(caller(), { cls: "error", id: "x" }, action);
    expect(d).toMatchObject({ ok: false, status: 503 });
  });
  it.each(actions)("target not_found → 404 fail closed (%s)", (action) => {
    const d = authorizeAdminAction(caller(), { cls: "not_found", id: "x" }, action);
    expect(d).toMatchObject({ ok: false, status: 404 });
  });

  it("admin 不可 reset_password 其他 admin", () => {
    expect(authorizeAdminAction(caller(), { cls: "admin", id: "other" }, "reset_password").ok).toBe(false);
  });
  it("admin 不可 reset_mfa super_admin", () => {
    expect(authorizeAdminAction(caller(), { cls: "super_admin", id: "sa" }, "reset_mfa").ok).toBe(false);
  });
  it("admin 不可 delete super_admin", () => {
    expect(authorizeAdminAction(caller(), { cls: "super_admin", id: "sa" }, "delete").ok).toBe(false);
  });

  it("super_admin 可對其他 admin 操作", () => {
    expect(authorizeAdminAction(caller({ role: "super_admin" }), { cls: "admin", id: "a" }, "reset_password").ok).toBe(true);
  });
  it("super_admin 可對 ordinary 操作", () => {
    expect(authorizeAdminAction(caller({ role: "super_admin" }), { cls: "ordinary", id: "d" }, "delete").ok).toBe(true);
  });

  // self 操作限制（R2）
  it("self reset_mfa 禁止（走個人流程）", () => {
    expect(authorizeAdminAction(caller(), { cls: "admin", id: "self" }, "reset_mfa")).toMatchObject({ ok: false, status: 403 });
  });
  it("self reset_password 禁止（走個人流程）", () => {
    expect(authorizeAdminAction(caller(), { cls: "admin", id: "self" }, "reset_password")).toMatchObject({ ok: false, status: 403 });
  });
  it("self delete 禁止", () => {
    expect(authorizeAdminAction(caller(), { cls: "admin", id: "self" }, "delete")).toMatchObject({ ok: false, status: 400 });
  });
  it("self role_change 禁止", () => {
    expect(authorizeAdminAction(caller(), { cls: "admin", id: "self" }, "role_change")).toMatchObject({ ok: false, status: 403 });
  });

  it("admin 可 delete ordinary", () => {
    expect(authorizeAdminAction(caller(), { cls: "ordinary", id: "d" }, "delete").ok).toBe(true);
  });
});

describe("checkProAal2 (RR8：任一 pro + is_pro + AAL2)", () => {
  it("doctor + is_pro + aal2 通過", () => {
    expect(checkProAal2(caller({ role: "doctor" })).ok).toBe(true);
  });
  it("nurse + is_pro + aal2 通過", () => {
    expect(checkProAal2(caller({ role: "nurse" })).ok).toBe(true);
  });
  const denyCases: Array<[string, Partial<CallerContext>, number]> = [
    ["未登入",        { id: "" },        401],
    ["非 pro",        { isPro: false },  403],
    ["aal1（未過 MFA）", { aal: "aal1" }, 403],
    ["aal null",      { aal: null },     403],
  ];
  it.each(denyCases)("拒絕：%s → %i", (_l, over, status) => {
    const d = checkProAal2(caller(over));
    expect(d.ok).toBe(false);
    expect(d.status).toBe(status);
  });
});

describe("canAssignRole", () => {
  it("admin 不可指派 admin / super_admin", () => {
    expect(canAssignRole("admin", "admin")).toBe(false);
    expect(canAssignRole("admin", "super_admin")).toBe(false);
  });
  it("admin 可指派低階角色", () => {
    expect(canAssignRole("admin", "doctor")).toBe(true);
    expect(canAssignRole("admin", "nurse")).toBe(true);
  });
  it("super_admin 可指派任何角色", () => {
    expect(canAssignRole("super_admin", "admin")).toBe(true);
    expect(canAssignRole("super_admin", "super_admin")).toBe(true);
  });
});

// 展示帳號：帳密公開在 README，資料全是虛構的。
// 規則：一般臨床功能和 DB 層一致免 MFA；管理權則永遠沒有。
describe("展示帳號的權限邊界", () => {
  it("展示用 admin 就算拿到 aal2（有人替它綁了 MFA），也不能做任何管理操作", () => {
    const d = checkPrivilegedCaller(caller({ isDemo: true, aal: "aal2" }));
    expect(d).toMatchObject({ ok: false, status: 403, reason: "demo_account_read_only" });
  });

  it("展示用 admin 可以唯讀瀏覽管理頁（route 只會給它展示帳號）", () => {
    const d = checkPrivilegedRead(caller({ isDemo: true, aal: "aal1" }));
    expect(d).toMatchObject({ ok: true, demoView: true });
  });

  it("真正的管理員唯讀瀏覽時不是 demoView，而且仍然要 aal2", () => {
    expect(checkPrivilegedRead(caller())).toMatchObject({ ok: true, demoView: false });
    expect(checkPrivilegedRead(caller({ aal: "aal1" }))).toMatchObject({ ok: false, status: 403, demoView: false });
  });

  it("展示用醫師不能唯讀瀏覽管理頁（不是管理角色）", () => {
    expect(checkPrivilegedRead(caller({ isDemo: true, role: "doctor" }))).toMatchObject({ ok: false, status: 403 });
  });

  it("展示用醫師在 aal1 可以用一般臨床 API（藥物交互、AI 輔助）", () => {
    expect(checkProAal2(caller({ isDemo: true, role: "doctor", aal: "aal1" })).ok).toBe(true);
  });

  it("非展示帳號在 aal1 仍然不能用臨床 API", () => {
    expect(checkProAal2(caller({ role: "doctor", aal: "aal1" }))).toMatchObject({ ok: false, status: 403 });
  });

  it("is_demo 但不是 pro 的帳號，什麼都不能用", () => {
    expect(checkProAal2(caller({ isDemo: true, isPro: false }))).toMatchObject({ ok: false, status: 403 });
    expect(checkPrivilegedRead(caller({ isDemo: true, isPro: false })).ok).toBe(false);
  });
});
