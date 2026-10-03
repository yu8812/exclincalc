// 共用 server 端授權：取得 caller context（user + is_pro + role + AAL），
// 交給 authz.ts 的純函式判斷。RR8 要求所有 service-role 特權 route 都用同一守衛，
// 不能依賴只 match /pro/* 的 middleware。

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  checkPrivilegedCaller, checkPrivilegedRead, checkProAal2,
  type CallerContext, type ProRole,
} from "@/lib/pro/authz";

/** 取得 caller context（含目前 session 的 AAL）。未登入回 null。 */
export async function loadCaller(): Promise<{ ctx: CallerContext; email: string } | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles").select("is_pro, pro_role, is_demo").eq("id", user.id).single();

  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const aal = (aalData?.currentLevel as "aal1" | "aal2" | null) ?? null;

  return {
    ctx: {
      id: user.id,
      role: (profile?.pro_role as ProRole) ?? null,
      isPro: profile?.is_pro === true,
      aal,
      isDemo: profile?.is_demo === true,
    },
    email: user.email ?? "",
  };
}

function deny(status: number, reason: string) {
  return NextResponse.json({ error: "FORBIDDEN", reason }, { status });
}

/** admin/super_admin + is_pro + AAL2。 */
export async function requirePrivileged():
  Promise<{ ok: true; ctx: CallerContext; email: string } | { ok: false; res: NextResponse }> {
  const loaded = await loadCaller();
  if (!loaded) return { ok: false, res: NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }) };
  const d = checkPrivilegedCaller(loaded.ctx);
  if (!d.ok) return { ok: false, res: deny(d.status, d.reason) };
  return { ok: true, ctx: loaded.ctx, email: loaded.email };
}

/**
 * 管理頁的唯讀查詢（帳號列表、統計）。真正的管理員照舊；
 * 展示用 admin 回傳 demoView = true，route 必須只給展示帳號的資料。修改類操作一律用 requirePrivileged。
 */
export async function requirePrivilegedRead():
  Promise<{ ok: true; ctx: CallerContext; email: string; demoView: boolean } | { ok: false; res: NextResponse }> {
  const loaded = await loadCaller();
  if (!loaded) return { ok: false, res: NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }) };
  const d = checkPrivilegedRead(loaded.ctx);
  if (!d.ok) return { ok: false, res: deny(d.status, d.reason) };
  return { ok: true, ctx: loaded.ctx, email: loaded.email, demoView: d.demoView };
}

/** 任一 pro 角色 + is_pro + AAL2（用於讀寫病患資料的 service-role route）。 */
export async function requireProAal2():
  Promise<{ ok: true; ctx: CallerContext; email: string } | { ok: false; res: NextResponse }> {
  const loaded = await loadCaller();
  if (!loaded) return { ok: false, res: NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }) };
  const d = checkProAal2(loaded.ctx);
  if (!d.ok) return { ok: false, res: deny(d.status, d.reason) };
  return { ok: true, ctx: loaded.ctx, email: loaded.email };
}
