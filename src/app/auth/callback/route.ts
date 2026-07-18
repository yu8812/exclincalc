import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

// 只允許站內相對路徑，避免 open redirect（`//evil` / 絕對 URL 一律拒絕）。
function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/login?error=missing_code`);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/auth/login?error=verification_failed`);
  }

  // 有明確且安全的 next → 用它。
  if (next) return NextResponse.redirect(`${origin}${next}`);

  // R4：新註冊完成信箱驗證後，帳號尚未被管理員開通 is_pro；
  // 不可預設導到 /pro/dashboard（會被 middleware 判 unauthorized 彈回）。
  // 依 is_pro 決定落點：pro → dashboard；否則 → 已驗證、待核准頁。
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase
      .from("profiles").select("is_pro").eq("id", user.id).single();
    if (profile?.is_pro) return NextResponse.redirect(`${origin}/pro/dashboard`);
  }
  return NextResponse.redirect(`${origin}/auth/login?verified=1`);
}
