import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import { requireProAal2 } from "@/lib/pro/serverAuth";

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
  // SEC001D-02：consent bearer token 產生需 is_pro + AAL2（不能只靠 middleware）
  const gate = await requireProAal2();
  if (!gate.ok) return gate.res;
  const user = { id: gate.ctx.id };

  // 再套 consent-specific 角色限制（只有醫師/管理員可發邀請）
  if (!CONSENT_ROLES.includes(gate.ctx.role ?? "")) {
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

  // R6：若指定 doctor_patient_id，必須先驗證該病歷屬於這位醫師，
  // 不可信任 client 傳來的 ID 就用 service role 直接寫入（否則可污染他人 chart↔account 關聯）。
  if (doctorPatientId) {
    const { data: owned, error: ownErr } = await admin
      .from("doctor_patients")
      .select("id")
      .eq("id", doctorPatientId)
      .eq("doctor_id", user.id)
      .maybeSingle();
    if (ownErr) return NextResponse.json({ error: "OWNERSHIP_CHECK_FAILED" }, { status: 503 });
    if (!owned) return NextResponse.json({ error: "FORBIDDEN_PATIENT" }, { status: 403 });
  }

  const { data, error } = await admin
    .from("patient_consents")
    .insert({ doctor_id: user.id, doctor_patient_id: doctorPatientId })
    .select("invite_token, invite_expires_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const clincalcUrl = process.env.NEXT_PUBLIC_CLINCALC_URL || "https://clincalc.yuyulsc881209.workers.dev";
  const link = `${clincalcUrl}/consent/${data.invite_token}`;

  return NextResponse.json({ token: data.invite_token, link, expires_at: data.invite_expires_at });
}

// GET /api/pro/consent/invite - 取得醫師的所有邀請清單
export async function GET() {
  // SEC001D-02：列出 bearer token / patient 關聯需 is_pro + AAL2
  const gate = await requireProAal2();
  if (!gate.ok) return gate.res;

  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("patient_consents")
    .select("id, invite_token, invite_expires_at, status, granted_at, patient_user_id")
    .eq("doctor_id", gate.ctx.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ consents: data || [] });
}
