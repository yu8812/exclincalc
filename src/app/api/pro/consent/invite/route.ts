import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

// 可發出病患授權邀請的角色（僅醫師與管理員，護理師/行政不可）
const CONSENT_ROLES = ["doctor", "admin", "super_admin"];

function getAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // 不再 fallback 到 anon key：缺 service key 應明確失敗，而非默默降權執行
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// POST /api/pro/consent/invite
// 醫師呼叫：建立邀請 token，回傳連結
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_pro, pro_role")
    .eq("id", user.id)
    .single();

  if (!profile?.is_pro || !CONSENT_ROLES.includes(profile.pro_role ?? "")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const doctorPatientId: string | null = body.doctor_patient_id ?? null;

  let admin;
  try {
    admin = getAdminClient();
  } catch {
    return NextResponse.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503 });
  }
  const { data, error } = await admin
    .from("patient_consents")
    .insert({ doctor_id: user.id, doctor_patient_id: doctorPatientId })
    .select("invite_token, invite_expires_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const clincalcUrl = process.env.NEXT_PUBLIC_CLINCALC_URL || "https://clincalc.pages.dev";
  const link = `${clincalcUrl}/consent/${data.invite_token}`;

  return NextResponse.json({ token: data.invite_token, link, expires_at: data.invite_expires_at });
}

// GET /api/pro/consent/invite - 取得醫師的所有邀請清單
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const { data } = await supabase
    .from("patient_consents")
    .select("id, invite_token, invite_expires_at, status, granted_at, patient_user_id")
    .eq("doctor_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ consents: data || [] });
}
