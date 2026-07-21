// Middleware：保護 /pro/* 路由
// 1. 未登入 → /auth/login
// 2. 已登入但 is_pro=false → /auth/login?error=unauthorized
// 3. 已綁 TOTP 但目前 session 仍是 aal1 → /auth/mfa-verify
// 4. /pro/security 例外（讓尚未綁 MFA 的使用者可進去 enroll）

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll(); },
        setAll(toSet) {
          toSet.forEach(({ name, value, options }) => {
            res.cookies.set({ name, value, ...options });
          });
        },
      },
    }
  );

  // SEC001D-04：redirect 必須保留 Supabase 刷新的 set-cookie，避免 session/MFA loop。
  const redirectWith = (url: URL): NextResponse => {
    const r = NextResponse.redirect(url);
    res.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };

  const { data: { user } } = await supabase.auth.getUser();
  const path = req.nextUrl.pathname;

  // 未登入
  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("redirect", path);
    return redirectWith(url);
  }

  // 檢查 is_pro
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_pro, is_demo")
    .eq("id", user.id)
    .single();
  if (!profile?.is_pro) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("error", "unauthorized");
    return redirectWith(url);
  }

  // demo 帳號（僅合成資料，DB 層亦豁免 AAL2）→ 免 MFA 強制，直接放行
  if (profile.is_demo) return res;

  // /pro/security 是 enroll MFA 的入口，不論 AAL 都允許
  if (path.startsWith("/pro/security")) return res;

  const { data: aal, error: aalErr } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  // SEC001D-04：AAL 查詢失敗 / 無法判定 → fail closed（不放行），導回可重試的登入。
  if (aalErr || !aal) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("error", "session_check");
    url.searchParams.set("redirect", path);
    return redirectWith(url);
  }

  // RR8：尚未 enroll MFA 的 pro user（nextLevel 仍停在 aal1）→ 強制先去綁定。
  if (aal.nextLevel === "aal1") {
    const url = req.nextUrl.clone();
    url.pathname = "/pro/security";
    url.searchParams.set("enroll", "required");
    return redirectWith(url);
  }

  // 已 enroll 但目前 session 尚未升級到 aal2 → 輸入動態碼
  if (aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    const url = req.nextUrl.clone();
    url.pathname = "/auth/mfa-verify";
    url.searchParams.set("redirect", path);
    return redirectWith(url);
  }

  return res;
}

export const config = {
  matcher: ["/pro/:path*"],
};
