import { NextRequest, NextResponse } from "next/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase-server";

// RR1（R4）：email 確認改用 token_hash + verifyOtp（server 端、跨裝置安全），
// 取代與 client flowType 綁定、implicit 時會把 session 放進 URL fragment 而 server 讀不到的舊流程。
//
// 需在 Supabase Dashboard 的 Confirm signup email template 指向此路由：
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
// （見 docs/audit/handoffs/SEC-001b-auth-operations-evidence.md）

function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${origin}/auth/login?error=invalid_link`);
  }

  // SEC001D-06：signup-only endpoint 只接受 signup 相關 type（不 brute-force、
  // 不接受 recovery/invite/email_change hash），單次 verify。
  // template 目前用 type=email；若部署後 E2E 證明需 signup，改此 allowlist 與 template 一致。
  if (type !== "email" && type !== "signup") {
    return NextResponse.redirect(`${origin}/auth/login?error=invalid_link`);
  }
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    return NextResponse.redirect(`${origin}/auth/login?error=verification_failed`);
  }

  if (next) return NextResponse.redirect(`${origin}${next}`);

  // 驗證成功後：pro 帳號（已被管理員開通）→ dashboard；否則 → 待核准提示。
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase
      .from("profiles").select("is_pro").eq("id", user.id).single();
    if (profile?.is_pro) return NextResponse.redirect(`${origin}/pro/dashboard`);
  }
  return NextResponse.redirect(`${origin}/auth/login?verified=1`);
}
