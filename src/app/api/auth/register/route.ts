import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit } from "@/lib/rateLimit";

const MIN_PASSWORD_LENGTH = 8;

// 一般公開註冊：用 anon key 走 supabase.auth.signUp。
// - Supabase 專案需開啟「Confirm email」，帳號才會處於未驗證狀態並寄出驗證信。
// - signUp 對「已存在的 email」會回傳混淆結果（不報錯），天然避免帳號枚舉。
function getAnonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  // 持久化限流：每 IP 每小時最多 5 次註冊（跨 isolate 有效）
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown";
  if (!(await checkRateLimit(`register:${ip}`, 5, 3600))) {
    return NextResponse.json({ error: "註冊次數過多，請 1 小時後再試" }, { status: 429 });
  }

  const { email, password, name } = await req.json();

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "請輸入有效的電子郵件" }, { status: 400 });
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ error: `密碼至少需要 ${MIN_PASSWORD_LENGTH} 個字元` }, { status: 400 });
  }

  // 驗證信導回位址：優先用請求 origin，其次環境變數
  const origin =
    req.headers.get("origin") ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://exclincalc.ro883c.workers.dev";

  const supabase = getAnonClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name },
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    const msg = error.message.toLowerCase();
    // 已註冊：回傳通用成功訊息，避免帳號枚舉
    if (msg.includes("already registered") || msg.includes("already been registered")) {
      return NextResponse.json({ ok: true });
    }
    // 密碼強度等驗證錯誤可回饋
    if (msg.includes("password")) {
      return NextResponse.json({ error: "密碼不符合安全要求" }, { status: 400 });
    }
    return NextResponse.json({ error: "註冊失敗，請稍後再試" }, { status: 500 });
  }

  // signUp 對已存在 email 會回傳 user 但 identities 為空陣列 → 同樣視為成功，不洩漏
  return NextResponse.json({ ok: true, needsVerification: !data.session });
}
