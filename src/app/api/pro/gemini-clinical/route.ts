import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { checkRateLimit } from "@/lib/rateLimit";

const CLINICAL_SYSTEM_PROMPT = `You are a clinical decision support assistant for licensed physicians using ClinCalc Pro.

Respond using full medical terminology appropriate for qualified clinicians. For each request, provide:
1. Structured clinical assessment with ICD-10 code suggestions where applicable
2. Differential diagnosis ranked by probability with supporting/against findings
3. Recommended investigations (if indicated by the data)
4. Evidence-based treatment considerations (reference guidelines where applicable)
5. Patient safety flags and monitoring parameters

Important guidelines:
- Respond in Traditional Chinese (繁體中文) by default
- Use medical terminology; do NOT add lay-language disclaimers
- Reference current clinical guidelines (ADA 2024, ACC/AHA, KDIGO, etc.)
- Flag critical values requiring immediate attention
- Note drug-drug interactions or contraindications if patient medications are provided
- The clinician is qualified to interpret this information professionally`;

export async function POST(req: NextRequest) {
  // Pro auth check（保留 user.id 供限流用）
  let userId: string;
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    const { data: profile } = await supabase.from("profiles").select("is_pro").eq("id", user.id).single();
    if (!profile?.is_pro) {
      return NextResponse.json({ error: "PRO_REQUIRED" }, { status: 403 });
    }
    userId = user.id;
  } catch {
    return NextResponse.json({ error: "AUTH_ERROR" }, { status: 500 });
  }

  // 以已驗證的 user.id 限流（取代原本可偽造的 x-forwarded-for），30 req/min，持久化跨 isolate
  if (!(await checkRateLimit(`gemini-clinical:${userId}`, 30, 60))) {
    return NextResponse.json({ error: "RATE_LIMIT", message: "請求過於頻繁" }, { status: 429 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "NO_API_KEY" }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const { type, patientContext, labData, symptoms, soapDraft } = body as {
    type?: string;
    patientContext?: string;
    labData?: string;
    symptoms?: string;
    soapDraft?: string;
  };

  if (type !== "clinical") {
    return NextResponse.json({ error: "INVALID_TYPE" }, { status: 400 });
  }

  const parts: string[] = [];
  if (patientContext) parts.push(`Patient Context:\n${patientContext}`);
  if (symptoms) parts.push(`Chief Complaint / Symptoms:\n${symptoms}`);
  if (labData) parts.push(`Laboratory / Objective Data:\n${labData}`);
  if (soapDraft) parts.push(`SOAP Draft (S+O so far):\n${soapDraft}`);

  if (parts.length === 0) {
    return NextResponse.json({ error: "EMPTY_INPUT" }, { status: 400 });
  }

  const prompt = `${CLINICAL_SYSTEM_PROMPT}\n\n${parts.join("\n\n")}\n\nProvide a structured clinical assessment (A) and management plan (P) based on the above information.`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return NextResponse.json({ result: text });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Pro Gemini Clinical]", msg);
    if (msg.includes("429") || msg.includes("quota")) {
      return NextResponse.json({ error: "QUOTA_EXCEEDED", message: "API 配額已達上限" }, { status: 429 });
    }
    return NextResponse.json({ error: "GEMINI_ERROR", message: "AI 處理失敗" }, { status: 500 });
  }
}
