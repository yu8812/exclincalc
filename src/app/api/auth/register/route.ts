import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit } from "@/lib/rateLimit";

const MIN_PASSWORD_LENGTH = 8;

// R4：驗證信 redirect 使用 server 端可控的 canonical origin，不信任 request 的 Origin header。
// production 應設 APP_ORIGIN（精確 https host）；未設時退回已知正式站，仍不採用 caller 提供的 Origin。
const FALLBACK_ORIGIN = "https://exclincalc.ro883c.workers.dev";
function canonicalOrigin(): string {
  const raw = process.env.APP_ORIGIN;
  if (!raw) return FALLBACK_ORIGIN;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return FALLBACK_ORIGIN;
    return u.origin;
  } catch {
    return FALLBACK_ORIGIN;
  }
}

function getAnonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// R5：對所有「帳號是否已存在」相關路徑回完全一致的 status + body，避免帳號枚舉。
function accepted() {
  return NextResponse.json({ ok: true }, { status: 202 });
}

export async function POST(req: NextRequest) {
  // 持久化限流：每 IP 每小時最多 5 次註冊
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown";
  if (!(await checkRateLimit(`register:${ip}`, 5, 3600))) {
    return NextResponse.json({ error: "註冊次數過多，請 1 小時後再試" }, { status: 429 });
  }

  const { email, password, name } = await req.json();

  // 輸入驗證（與帳號存在性無關，可回具體 400）
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "請輸入有效的電子郵件" }, { status: 400 });
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ error: `密碼至少需要 ${MIN_PASSWORD_LENGTH} 個字元` }, { status: 400 });
  }

  const supabase = getAnonClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name },
      // token_hash 流程用；信件模板以 {{ .RedirectTo }} 帶回此網址（見 /auth/confirm）
      emailRedirectTo: `${canonicalOrigin()}/auth/confirm`,
    },
  });

  // R5：無論成功、既有 email、或 signUp 混淆結果，一律回 202 {ok:true}，不回 session-derived flag。
  // 僅「密碼強度」這類與帳號存在性無關的錯誤回 400（Supabase 對已存在 email 不會走此路徑）。
  if (error && error.message.toLowerCase().includes("password")) {
    return NextResponse.json({ error: "密碼不符合安全要求" }, { status: 400 });
  }
  return accepted();
}
