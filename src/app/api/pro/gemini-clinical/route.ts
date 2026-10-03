import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { allowDemoAiCall, checkRateLimit } from "@/lib/rateLimit";
import { requireProAal2 } from "@/lib/pro/serverAuth";

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
  // SEC001D-02：接收 patient context/labs/SOAP 並送第三方 AI → 需 is_pro + AAL2
  const gate = await requireProAal2();
  if (!gate.ok) return gate.res;
  const userId = gate.ctx.id;

  // 以已驗證的 user.id 限流（取代原本可偽造的 x-forwarded-for），30 req/min，持久化跨 isolate。
  // 展示帳號是所有訪客共用的，改用共用額度，免得陌生人把真正使用者的 Gemini 配額用光。
  const isDemo = gate.ctx.isDemo;
  const allowed = isDemo
    ? await allowDemoAiCall()
    : await checkRateLimit(`gemini-clinical:${userId}`, 30, 60);
  if (!allowed) {
    return NextResponse.json({
      error: "RATE_LIMIT",
      message: isDemo
        ? "展示帳號的 AI 額度是所有訪客共用的，現在用完了，晚一點再試。"
        : "一分鐘內最多問 AI 30 次，稍等一下再送出。",
    }, { status: 429 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "NO_API_KEY", message: "伺服器沒有設定 AI 金鑰" }, { status: 503 });

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
      return NextResponse.json({ error: "QUOTA_EXCEEDED", message: "Gemini 今天的配額用完了，明天再試。" }, { status: 429 });
    }
    return NextResponse.json({ error: "GEMINI_ERROR", message: "AI 這次沒有回應，等一下再試一次。" }, { status: 500 });
  }
}
